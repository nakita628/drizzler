import path from "node:path";
import { layer as nodeFileSystemLayer } from "@effect/platform-node/NodeFileSystem";
import { Effect, FileSystem } from "effect";
import { FileReadError, FileWriteError } from "../errors/index.js";

/**
 * The studio's file access, over Effect's FileSystem. The Node layer is provided here, so the use
 * cases and handlers that read the schema stay free of a requirement they would only pass on.
 */
function withNodeFileSystem<A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem>) {
  return effect.pipe(Effect.provide(nodeFileSystemLayer));
}

/**
 * Reads a file as UTF-8 text: the saved schema, which every page is drawn from.
 *
 * ```mermaid
 * flowchart LR
 *   file[input.file] --> fs[(file system)]
 *   fs -- read --> text[UTF-8 text]
 *   fs -. any failure .-> err[FileReadError]
 * ```
 *
 * @param input.file - the path of the file to read
 * @returns the file's text; fails with FileReadError when it cannot be read
 */
export function readText(input: { readonly file: string }) {
  return withNodeFileSystem(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      return yield* fs.readFileString(input.file);
    }).pipe(
      Effect.mapError((error) => new FileReadError({ path: input.file, cause: error.message })),
    ),
  );
}

/**
 * Writes text to a file, creating its directory first: the schema saved from the editor.
 *
 * ```mermaid
 * flowchart LR
 *   in[input.file + input.text] --> mkdir[make the directory]
 *   mkdir --> write[write the text]
 *   write --> fs[(file system)]
 *   write -. any failure .-> err[FileWriteError]
 * ```
 *
 * @param input.file - the path of the file to write
 * @param input.text - the text it holds afterwards
 * @returns nothing once the file is written; fails with FileWriteError
 */
export function writeText(input: { readonly file: string; readonly text: string }) {
  return withNodeFileSystem(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      yield* fs.makeDirectory(path.dirname(input.file), { recursive: true });
      yield* fs.writeFileString(input.file, input.text);
    }).pipe(
      Effect.mapError((error) => new FileWriteError({ path: input.file, cause: error.message })),
    ),
  );
}

/**
 * Whether a path exists at all: the schema and the built client are checked before the studio
 * starts. A path whose existence cannot be told counts as missing, and the reason is logged.
 *
 * ```mermaid
 * flowchart LR
 *   file[input.file] --> fs[(file system)]
 *   fs -- found --> yes[true]
 *   fs -- missing or unreadable --> no[false]
 * ```
 *
 * @param input.file - the path to look for
 * @returns true when the path exists; never fails
 */
export function exists(input: { readonly file: string }) {
  return withNodeFileSystem(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      return yield* fs.exists(input.file);
    }).pipe(
      Effect.catch((error) =>
        Effect.logDebug(`cannot tell whether ${input.file} exists`, error).pipe(Effect.as(false)),
      ),
    ),
  );
}
