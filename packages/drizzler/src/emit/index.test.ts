import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Effect, Exit } from "effect";
import type { FileSystem } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { emit, emitRaw } from "./index.js";

function runExit<A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem>) {
  return Effect.runPromiseExit(effect.pipe(Effect.provide(NodeServices.layer)));
}

describe("emit", () => {
  const testDir = "tmp-emit-test";
  beforeEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
    fs.mkdirSync(testDir, { recursive: true });
  });
  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("formats the code and writes it", async () => {
    const exit = await runExit(emit('console.log("Hello, world!")', `${testDir}/test.ts`));
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(fs.readFileSync(`${testDir}/test.ts`, "utf-8")).toBe("console.log('Hello, world!')\n");
  });

  it("creates the directories the output sits in", async () => {
    const exit = await runExit(emit("const x = 1", `${testDir}/a/b/c/out.ts`));
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(fs.existsSync(`${testDir}/a/b/c/out.ts`)).toBe(true);
  });

  it("fails with FormatError on code that does not parse, and writes nothing", async () => {
    const exit = await runExit(emit("const = ;", `${testDir}/bad.ts`));
    expect(Exit.isFailure(exit)).toBe(true);
    expect(String(exit)).toContain("FormatError");
    expect(fs.existsSync(`${testDir}/bad.ts`)).toBe(false);
  });

  it("fails when the directory cannot be written", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "emit-readonly-"));
    const readonlyDir = path.join(tmpDir, "readonly");
    fs.mkdirSync(readonlyDir);
    fs.chmodSync(readonlyDir, 0o444);
    const exit = await runExit(emit("const x = 1", `${readonlyDir}/sub/out.ts`));
    expect(Exit.isFailure(exit)).toBe(true);
    fs.chmodSync(readonlyDir, 0o755);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("emitRaw", () => {
  const testDir = "tmp-emit-raw-test";
  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("writes text and bytes as they are", async () => {
    await runExit(emitRaw("Table t {}", `${testDir}/a.dbml`));
    await runExit(emitRaw(new Uint8Array([137, 80, 78, 71]), `${testDir}/b/c.png`));
    expect(fs.readFileSync(`${testDir}/a.dbml`, "utf-8")).toBe("Table t {}");
    expect([...fs.readFileSync(`${testDir}/b/c.png`)]).toStrictEqual([137, 80, 78, 71]);
  });
});
