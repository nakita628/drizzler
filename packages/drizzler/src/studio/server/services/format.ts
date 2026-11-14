import path from "node:path";
import { layer as nodeFileSystemLayer } from "@effect/platform-node/NodeFileSystem";
import { Effect, FileSystem } from "effect";
import type { PlatformError } from "effect";
import { format } from "oxfmt";
import type { FormatOptions } from "../../../helper/format-options.js";
import { pickFormatOptions } from "../../../helper/format-options.js";
import { stripJsonc } from "../../../helper/jsonc.js";
import { FileReadError, FormatError } from "../errors/index.js";
import { errorMessage } from "../../../helper/error-message.js";

export type { FormatOptions } from "../../../helper/format-options.js";

const CONFIG_FILES = [".oxfmtrc.json", ".oxfmtrc.jsonc"] as const;
type FoundConfig = { readonly path: string; readonly text: string };

/** A file's text, or null when it does not exist; any other failure is a FileReadError. */
function readIfExists(file: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs.readFileString(file);
  }).pipe(
    Effect.catchIf(
      (error: PlatformError.PlatformError) => error.reason._tag === "NotFound",
      () => Effect.logDebug(`${file} does not exist`).pipe(Effect.as(null)),
    ),
    Effect.mapError((error) => new FileReadError({ path: file, cause: error.message })),
    Effect.provide(nodeFileSystemLayer),
  );
}

/** The first config file in `dir`, or null. */
function configIn(
  dir: string,
  names: readonly string[],
): Effect.Effect<FoundConfig | null, FileReadError> {
  const [name, ...rest] = names;
  if (name === undefined) return Effect.succeed(null);
  const file = path.join(dir, name);
  return readIfExists(file).pipe(
    Effect.flatMap((text) =>
      text === null ? configIn(dir, rest) : Effect.succeed({ path: file, text }),
    ),
  );
}

/** The nearest `.oxfmtrc.json(c)` from the schema's directory upwards, as oxfmt itself looks for it. */
function findConfig(from: string): Effect.Effect<FoundConfig | null, FileReadError> {
  const dir = path.resolve(from);
  return configIn(dir, CONFIG_FILES).pipe(
    Effect.flatMap((found) => {
      if (found !== null) return Effect.succeed(found);
      const parent = path.dirname(dir);
      return parent === dir ? Effect.succeed(null) : findConfig(parent);
    }),
  );
}

function parseConfig(config: { readonly path: string; readonly text: string }) {
  return Effect.try({
    try: (): unknown => JSON.parse(stripJsonc(config.text)),
    catch: (error) =>
      new FormatError({
        message: `${config.path} is not valid JSON: ${errorMessage(error)}`,
      }),
  });
}

/**
 * The oxfmt options in effect for the schema, found as oxfmt finds them: the nearest
 * `.oxfmtrc.json(c)` from the schema's directory upwards, with only the options the studio passes on.
 *
 * ```mermaid
 * flowchart LR
 *   schema[input.schemaPath] --> dir[its directory]
 *   dir --> look{.oxfmtrc.json / .jsonc here?}
 *   look -- no --> up[parent directory] --> look
 *   look -- yes --> parse[strip comments, JSON.parse]
 *   parse --> pick[known options only]
 *   pick --> out[options + configPath]
 *   look -- reached the root --> none[empty options, configPath null]
 *   parse -. not JSON .-> err[FormatError]
 * ```
 *
 * @param input.schemaPath - the schema file the formatter will format
 * @returns the options and the config file they came from (null when there is none)
 */
export function readSettings(input: { readonly schemaPath: string }) {
  return Effect.gen(function* () {
    const config = yield* findConfig(path.dirname(input.schemaPath));
    if (config === null) return { options: {}, configPath: null };
    return { options: pickFormatOptions(yield* parseConfig(config)), configPath: config.path };
  });
}

/**
 * Formats a schema source with oxfmt and the given options, as Format in the editor does.
 *
 * ```mermaid
 * flowchart LR
 *   in[input.source + input.options] --> oxfmt[oxfmt format]
 *   oxfmt -- ok --> code[formatted source]
 *   oxfmt -. syntax error / failure .-> err[FormatError]
 * ```
 *
 * @param input.source - the TypeScript source to format
 * @param input.options - the oxfmt options, from readSettings
 * @returns the formatted source; fails with FormatError when oxfmt reports errors
 */
export function formatSource(input: { readonly source: string; readonly options: FormatOptions }) {
  return Effect.gen(function* () {
    const result = yield* Effect.tryPromise({
      try: () => format("schema.ts", input.source, input.options),
      catch: (error) => new FormatError({ message: errorMessage(error) }),
    });
    if (result.errors.length > 0) {
      return yield* new FormatError({ message: result.errors.map((e) => e.message).join("\n") });
    }
    return result.code;
  });
}
