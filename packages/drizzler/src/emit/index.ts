import path from "node:path";
import { Effect } from "effect";
import { makeDirectory, writeFile } from "../file/index.js";
import { fmt } from "../format/index.js";

/** Formats TypeScript source and writes it, creating the directory. */
export function emit(code: string, output: string) {
  return Effect.gen(function* () {
    const formatted = yield* fmt(code);
    yield* makeDirectory(path.dirname(output));
    yield* writeFile(output, formatted);
  });
}

/** Writes text or bytes as they are, creating the directory. */
export function emitRaw(data: string | Uint8Array, output: string) {
  return Effect.gen(function* () {
    yield* makeDirectory(path.dirname(output));
    yield* writeFile(output, data);
  });
}
