import { stat } from "node:fs/promises";
import path from "node:path";
import { layer as nodeFileSystemLayer } from "@effect/platform-node/NodeFileSystem";
import { Duration, Effect, FileSystem, Ref, Schedule } from "effect";
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

/** The file's modification time, or null while it is missing (an editor that replaces the file on save). */
function mtimeOf(file: string) {
  return Effect.tryPromise(() => stat(file)).pipe(
    Effect.map((stats): number | null => stats.mtimeMs),
    Effect.catch((error) => Effect.as(Effect.logDebug(`cannot stat ${file}`, error), null)),
  );
}

/**
 * Calls `input.onChange` whenever a file's modification time changes, for as long as the scope it
 * runs in stays open. The file is polled: `fs.watch` misses writes through bind mounts and editors
 * that replace the file.
 *
 * The time it starts from is read before this returns, so a change made as soon as the caller goes
 * on (the studio's `ready` event) is seen. `fs.watchFile` read its own first time later, on the
 * libuv thread pool: when the pool was busy, a change made in between became that first time and
 * was never reported.
 *
 * ```mermaid
 * flowchart LR
 *   file[input.file] --> start[read its mtime, then return]
 *   start --> poll[read it again every input.intervalMs]
 *   poll -- differs from the last one --> change[input.onChange]
 *   scope[scope closes] --> stop[stop polling]
 * ```
 *
 * @param input.file - the path of the file to watch
 * @param input.intervalMs - how often the file is polled
 * @param input.onChange - called once for every change seen
 * @returns nothing once the starting time is read; the watch stops when the surrounding scope closes
 */
export function watchFile(input: {
  readonly file: string;
  readonly intervalMs: number;
  readonly onChange: () => void;
}) {
  return Effect.gen(function* () {
    const last = yield* Ref.make(yield* mtimeOf(input.file));
    const check = Effect.flatMap(mtimeOf(input.file), (mtime) =>
      Effect.flatMap(Ref.getAndSet(last, mtime), (previous) =>
        previous === mtime ? Effect.void : Effect.sync(input.onChange),
      ),
    );
    yield* Effect.forkScoped(
      check.pipe(Effect.repeat(Schedule.spaced(Duration.millis(input.intervalMs)))),
    );
  });
}
