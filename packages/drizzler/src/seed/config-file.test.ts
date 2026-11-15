import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  configIssuesMessage,
  configMessages,
  defaultExportOf,
  isConfigTypeScript,
  isTypeScriptUnsupported,
  strippedSiblingPath,
} from "./config-file.js";

describe("the config file", () => {
  it.each([
    ["drizzler.config.ts", true],
    ["seed.mts", true],
    ["seed.cts", true],
    ["seed.js", false],
    ["seed.tsx", false],
  ])("%s is TypeScript: %s", (file, typescript) => {
    expect(isConfigTypeScript(file)).toBe(typescript);
  });

  it("takes the default export, and nothing from what has none", () => {
    expect(defaultExportOf({ default: 1 })).toBe(1);
    expect(defaultExportOf({ other: 1 })).toBeUndefined();
    expect(defaultExportOf(null)).toBeUndefined();
  });

  it("strips the types into a hidden sibling named for the process", () => {
    expect(strippedSiblingPath(path.join("app", "drizzler.config.ts"), 42)).toBe(
      path.join("app", ".drizzler.config.42.mjs"),
    );
  });
});

describe("isTypeScriptUnsupported", () => {
  it("tells TypeScript syntax Node.js cannot read from any other failure", () => {
    expect(isTypeScriptUnsupported(new SyntaxError("Unexpected token ':'"))).toBe(true);
    expect(
      isTypeScriptUnsupported(
        Object.assign(new Error("x"), { code: "ERR_UNKNOWN_FILE_EXTENSION" }),
      ),
    ).toBe(true);
    expect(
      isTypeScriptUnsupported(Object.assign(new Error("x"), { code: "ERR_MODULE_NOT_FOUND" })),
    ).toBe(false);
    expect(isTypeScriptUnsupported("not an error")).toBe(false);
  });
});

describe("messages", () => {
  it("says what is wrong with the config, word for word as before", () => {
    expect(configMessages.notTypeScript("seed.js")).toBe(
      "Config must be a TypeScript file: seed.js\n   Write it as drizzler.config.ts, typed against the schema module.",
    );
    expect(configMessages.notFound("a.ts")).toBe(
      "Config not found: a.ts\n   Check the path passed to --config.",
    );
    expect(configMessages.noneIn("/app")).toBe(
      "No drizzler.config.ts in /app.\n   Write one with `export default defineConfig(schema, { ... })`, or pass --config <path>.",
    );
    expect(configMessages.cannotLoad("a.ts", "boom")).toBe("Cannot load a.ts: boom");
    expect(configMessages.noDefaultExport("a.ts")).toBe(
      "a.ts has no default export.\n   Write `export default defineConfig(schema, { ... })`.",
    );
  });

  it("lists every problem by its path, the root as (root)", () => {
    expect(
      configIssuesMessage("a.ts", [
        { path: ["models", "user", "count"], message: "Expected a number" },
        { message: "Unexpected key" },
      ]),
    ).toBe(
      "Invalid config in a.ts:\n   models.user.count: Expected a number\n   (root): Unexpected key",
    );
  });
});
