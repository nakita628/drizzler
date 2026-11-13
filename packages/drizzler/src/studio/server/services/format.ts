import path from "node:path";
import { layer as nodeFileSystemLayer } from "@effect/platform-node/NodeFileSystem";
import { Effect, FileSystem } from "effect";
import type { PlatformError } from "effect";
import { format } from "oxfmt";
import { FileReadError, FormatError } from "../errors/index.js";

/** The oxfmt options the studio reads from the project's config. */
export type FormatOptions = {
  readonly printWidth?: number;
  readonly tabWidth?: number;
  readonly useTabs?: boolean;
  readonly semi?: boolean;
  readonly singleQuote?: boolean;
  readonly trailingComma?: "all" | "es5" | "none";
  readonly bracketSpacing?: boolean;
  readonly arrowParens?: "always" | "avoid";
};

const CONFIG_FILES = [".oxfmtrc.json", ".oxfmtrc.jsonc"] as const;
const OPTION_KEYS = [
  "printWidth",
  "tabWidth",
  "useTabs",
  "semi",
  "singleQuote",
  "trailingComma",
  "bracketSpacing",
  "arrowParens",
] as const;

/**
 * JSONC read as JSON: its `//` and `/* *\/` comments and trailing commas removed, strings left
 * as they are, so an `.oxfmtrc.jsonc` parses with `JSON.parse`.
 *
 * ```mermaid
 * flowchart LR
 *   jsonc[input.text] --> strip[drop comments outside strings]
 *   strip --> commas[drop trailing commas]
 *   commas --> json[JSON text]
 * ```
 *
 * @param input.text - the JSONC text of a config file
 * @returns the same document as plain JSON text
 */
export function stripJsonComments(input: { readonly text: string }) {
  // A string (kept, even one left open), a line comment, or a block comment (to the end of the
  // text when it is never closed), read left to right so a `//` inside a string stays.
  const stripped = input.text.replace(
    /("(?:[^"\\]|\\[\s\S])*(?:"|\\?$))|\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/gu,
    (_match, string: string | undefined) => string ?? "",
  );
  // A trailing comma is legal in JSONC and not in JSON.
  return stripped.replace(/,(\s*[}\]])/gu, "$1");
}

const OPTION_NAMES: ReadonlySet<string> = new Set(OPTION_KEYS);

function pickOptions(value: unknown): FormatOptions {
  if (typeof value !== "object" || value === null) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([key, option]) => OPTION_NAMES.has(key) && option !== undefined),
  );
}

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
    try: (): unknown => JSON.parse(stripJsonComments({ text: config.text })),
    catch: (error) =>
      new FormatError({
        message: `${config.path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
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
    return { options: pickOptions(yield* parseConfig(config)), configPath: config.path };
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
      catch: (error) =>
        new FormatError({ message: error instanceof Error ? error.message : String(error) }),
    });
    if (result.errors.length > 0) {
      return yield* new FormatError({ message: result.errors.map((e) => e.message).join("\n") });
    }
    return result.code;
  });
}
