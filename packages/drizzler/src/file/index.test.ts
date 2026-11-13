import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Effect, Exit } from "effect";
import type { FileSystem } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { exists, makeDirectory, readFile, writeFile } from "./index.js";

function runExit<A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem>) {
  return Effect.runPromiseExit(effect.pipe(Effect.provide(NodeServices.layer)));
}

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "drizzler-file-"));
  dirs.push(dir);
  return dir;
}

describe("file", () => {
  it("makes nested directories, and an existing one is not an error", async () => {
    const dir = path.join(tmp(), "a", "b");
    expect(Exit.isSuccess(await runExit(makeDirectory(dir)))).toBe(true);
    expect(Exit.isSuccess(await runExit(makeDirectory(dir)))).toBe(true);
    expect(fs.statSync(dir).isDirectory()).toBe(true);
  });

  it("writes and reads UTF-8 text, replacing what was there", async () => {
    const file = path.join(tmp(), "a.txt");
    await runExit(writeFile(file, "first"));
    await runExit(writeFile(file, "こんにちは 💧"));
    const read = await runExit(readFile(file));
    expect(Exit.isSuccess(read) && read.value).toBe("こんにちは 💧");
  });

  it("writes bytes as they are", async () => {
    const file = path.join(tmp(), "a.bin");
    await runExit(writeFile(file, new Uint8Array([0, 255, 1])));
    expect([...fs.readFileSync(file)]).toStrictEqual([0, 255, 1]);
  });

  it("says whether a path exists, and fails to read one that does not", async () => {
    const dir = tmp();
    const there = await runExit(exists(dir));
    const missing = await runExit(exists(path.join(dir, "nope")));
    expect(Exit.isSuccess(there) && there.value).toBe(true);
    expect(Exit.isSuccess(missing) && missing.value).toBe(false);
    expect(Exit.isFailure(await runExit(readFile(path.join(dir, "nope"))))).toBe(true);
  });
});
