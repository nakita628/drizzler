import nodeModule from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Effect, FileSystem } from "effect";
import { exists, readFile, writeFile } from "../file/index.js";
import { SeedConfigError } from "./errors.js";
import { errorMessage } from "../helper/error-message.js";
import { decodeSeedConfig } from "./config-schema.js";
import {
  CONFIG_FILE,
  configMessages,
  defaultExportOf,
  isConfigTypeScript,
  isTypeScriptUnsupported,
  strippedSiblingPath,
} from "./config-file.js";

/** The file `drizzler seed` looks for when `--config` is omitted. */
export { CONFIG_FILE } from "./config-file.js";

/**
 * The explicit config path when it is a TypeScript file that exists, else `drizzler.config.ts` in
 * `cwd` when that exists, else null. The config is TypeScript only: it is typed against the
 * schema module, and a JavaScript file would lose that check.
 */
export function resolveConfigPath(explicit: string | null, cwd: string) {
  return Effect.gen(function* () {
    if (explicit !== null) {
      if (!isConfigTypeScript(explicit)) {
        return yield* new SeedConfigError({ message: configMessages.notTypeScript(explicit) });
      }
      const resolved = path.resolve(cwd, explicit);
      if (yield* exists(resolved)) return resolved;
      return yield* new SeedConfigError({ message: configMessages.notFound(explicit) });
    }
    const resolved = path.resolve(cwd, CONFIG_FILE);
    if (yield* exists(resolved)) return resolved;
    return yield* new SeedConfigError({ message: configMessages.noneIn(cwd) });
  });
}

/** The import failure as Node.js raised it, so the caller can tell TypeScript syntax it cannot read from anything else. */
class ImportFailure {
  readonly _tag = "ImportFailure";
  constructor(readonly error: unknown) {}
}

function importModule(file: string) {
  return Effect.tryPromise({
    async try() {
      const namespace: unknown = await import(/* @vite-ignore */ pathToFileURL(file).href);
      return namespace;
    },
    catch: (error) => new ImportFailure(error),
  });
}

function importError(file: string, failure: ImportFailure) {
  const { error } = failure;
  return new SeedConfigError({ message: configMessages.cannotLoad(file, errorMessage(error)) });
}

/**
 * Imports a TypeScript config on a Node.js without type stripping by stripping the types itself
 * and importing the result from a sibling file, so `import ... from "drizzler"` resolves as it
 * would from the config.
 */
function importStripped(file: string, original: SeedConfigError) {
  return Effect.gen(function* () {
    if (typeof nodeModule.stripTypeScriptTypes !== "function") return yield* original;
    const source = yield* readFile(file).pipe(Effect.mapError(() => original));
    const stripped = yield* Effect.try({
      try: () => nodeModule.stripTypeScriptTypes(source, { mode: "strip" }),
      catch: () => original,
    });
    const sibling = strippedSiblingPath(file, process.pid);
    yield* writeFile(sibling, stripped).pipe(Effect.mapError(() => original));
    const fs = yield* FileSystem.FileSystem;
    return yield* importModule(sibling).pipe(
      Effect.mapError((failure) => importError(file, failure)),
      Effect.ensuring(
        fs
          .remove(sibling)
          .pipe(
            Effect.catch((error) =>
              Effect.logWarning(`Could not remove the stripped config ${sibling}`, error),
            ),
          ),
      ),
    );
  });
}

/** Loads the config module and checks its default export against what `drizzler seed` accepts. */
export function loadSeedConfig(file: string) {
  return Effect.gen(function* () {
    const namespace = yield* importModule(file).pipe(
      Effect.catch((failure) =>
        isTypeScriptUnsupported(failure.error)
          ? importStripped(file, importError(file, failure))
          : Effect.fail(importError(file, failure)),
      ),
    );
    const exported = defaultExportOf(namespace);
    if (exported === undefined) {
      return yield* new SeedConfigError({ message: configMessages.noDefaultExport(file) });
    }
    const decoded = decodeSeedConfig(file, exported);
    return decoded.ok ? decoded.value : yield* decoded.error;
  });
}
