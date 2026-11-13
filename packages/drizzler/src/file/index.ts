import { Effect, FileSystem } from "effect";

/** Reads a file as UTF-8 text. */
export function readFile(path: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs.readFileString(path);
  });
}

/** Writes text or bytes, replacing the file. */
export function writeFile(path: string, data: string | Uint8Array) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return yield* typeof data === "string"
      ? fs.writeFileString(path, data)
      : fs.writeFile(path, data);
  });
}

/** Creates the directory and its parents; an existing directory is not an error. */
export function makeDirectory(path: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs.makeDirectory(path, { recursive: true });
  });
}

/** Whether the path exists at all. */
export function exists(path: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs.exists(path);
  });
}
