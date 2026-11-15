import { describe, expect, it } from "vite-plus/test";
import path from "node:path";
import {
  carryVersion,
  isProjectFile,
  isProjectTypeScript,
  queryTypeScriptCandidates,
  seedImportBase,
  seedImportCandidates,
} from "./module-url.js";

describe("module URLs", () => {
  it.each([
    ["file:///app/db/schema.ts", true, true],
    ["file:///app/db/schema.mts", true, true],
    ["file:///app/db/schema.js", true, false],
    ["file:///app/node_modules/drizzle-orm/index.ts", false, false],
    ["node:fs", false, false],
  ])("%s: project file %s, project TypeScript %s", (url, file, typescript) => {
    expect(isProjectFile(url)).toBe(file);
    expect(isProjectTypeScript(url)).toBe(typescript);
  });
});

describe("the seed's resolution", () => {
  it("resolves relative imports from a file: module, and file: URLs; leaves packages alone", () => {
    expect(seedImportBase("./db/schema", "file:///app/drizzler.config.ts")).toBe(
      path.join(path.sep, "app", "db", "schema"),
    );
    expect(seedImportBase("file:///app/a.ts", undefined)).toBe(path.join(path.sep, "app", "a.ts"));
    expect(seedImportBase("drizzle-orm", "file:///app/a.ts")).toBeNull();
    expect(seedImportBase("./a", "node:internal")).toBeNull();
    expect(seedImportBase("./a", undefined)).toBeNull();
  });

  it("tries the .ts twin first, then the extensions, then an index module", () => {
    expect(seedImportCandidates("/app/user.js")).toStrictEqual([
      "/app/user.ts",
      "/app/user.js.ts",
      "/app/user.js.mts",
      "/app/user.js.js",
      "/app/user.js.mjs",
      path.join("/app/user.js", "index.ts"),
      path.join("/app/user.js", "index.js"),
    ]);
  });
});

describe("the query's resolution", () => {
  it("tries .ts added, an index.ts, and the .ts twin of .js / .mjs / .cjs", () => {
    expect(queryTypeScriptCandidates("./user")).toStrictEqual([
      "./user.ts",
      "./user/index.ts",
      "./user",
    ]);
    expect(queryTypeScriptCandidates("./user.mjs")[2]).toBe("./user.mts");
    expect(queryTypeScriptCandidates("./user.cjs")[2]).toBe("./user.cts");
  });

  it("carries the importer's version on to the project's TypeScript only", () => {
    expect(carryVersion("file:///app/schema.ts?drizzler=3", "file:///app/user.ts")).toBe(
      "file:///app/user.ts?drizzler=3",
    );
    expect(carryVersion("file:///app/schema.ts", "file:///app/user.ts")).toBeNull();
    expect(
      carryVersion("file:///app/schema.ts?drizzler=3", "file:///app/node_modules/x/index.ts"),
    ).toBeNull();
  });
});
