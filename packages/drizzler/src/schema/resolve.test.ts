import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { collectModules, isWalkedDirectory, joinSources, resolveSpecifier } from "./paths.js";

const root = path.resolve("/app");
function at(...parts: string[]) {
  return path.join(root, ...parts);
}

describe("collectModules", () => {
  it("takes the start files, then what they import a level at a time, each once", () => {
    const imports: Record<string, string[]> = {
      a: ["c", "d"],
      b: ["d", "e"],
      c: ["f"],
      d: ["a"],
      e: [],
      f: ["b"],
    };
    expect(collectModules(["a", "b"], (file) => imports[file]!)).toStrictEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
    ]);
  });

  it("takes a file named twice once, in its first place", () => {
    expect(collectModules(["a", "a", "b"], () => [])).toStrictEqual(["a", "b"]);
  });
});

describe("resolveSpecifier", () => {
  const files = new Set([
    at("src", "db", "user.ts"),
    at("src", "db", "index.ts"),
    at("node_modules", "pkg", "index.ts"),
  ]);
  function isFile(file: string) {
    return files.has(file);
  }
  const aliases = {
    base: root,
    paths: { "#/*": ["./src/*"], "@pkg": ["./node_modules/pkg"] },
  };

  it("reads a relative import, its .ts twin for .js, and an index module", () => {
    const from = at("src", "schema.ts");
    expect(resolveSpecifier({ specifier: "./db/user.js", from, aliases: null, isFile })).toBe(
      at("src", "db", "user.ts"),
    );
    expect(resolveSpecifier({ specifier: "./db", from, aliases: null, isFile })).toBe(
      at("src", "db", "index.ts"),
    );
    expect(resolveSpecifier({ specifier: "./missing", from, aliases: null, isFile })).toBeNull();
  });

  it("reads a tsconfig alias, but not one that lands in node_modules, nor a package", () => {
    const from = at("src", "schema.ts");
    expect(resolveSpecifier({ specifier: "#/db/user.js", from, aliases, isFile })).toBe(
      at("src", "db", "user.ts"),
    );
    expect(resolveSpecifier({ specifier: "@pkg", from, aliases, isFile })).toBeNull();
    expect(resolveSpecifier({ specifier: "drizzle-orm", from, aliases, isFile })).toBeNull();
    expect(resolveSpecifier({ specifier: "#/db/user.js", from, aliases: null, isFile })).toBeNull();
  });
});

describe("joinSources and isWalkedDirectory", () => {
  it("puts a blank line between files", () => {
    expect(joinSources([["a", "b"], ["c"], []])).toStrictEqual(["a", "b", "", "c", ""]);
  });

  it("walks every directory but node_modules and hidden ones", () => {
    expect(["db", "node_modules", ".git", "schema"].filter(isWalkedDirectory)).toStrictEqual([
      "db",
      "schema",
    ]);
  });
});
