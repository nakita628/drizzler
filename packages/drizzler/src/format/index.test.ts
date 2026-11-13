import { Effect, Exit } from "effect";
import { describe, expect, it } from "vite-plus/test";
import { fmt } from "./index.js";

describe("fmt", () => {
  it.concurrent("returns the code formatted in drizzler's output style", async () => {
    expect(await Effect.runPromise(fmt("const takibi = 'hono-takibi';"))).toBe(
      "const takibi = 'hono-takibi'\n",
    );
  });

  it.concurrent("fails with FormatError for code that does not parse", async () => {
    const exit = await Effect.runPromiseExit(fmt("const = ;"));
    expect(Exit.isFailure(exit)).toBe(true);
    expect(String(exit)).toContain("FormatError");
  });
});
