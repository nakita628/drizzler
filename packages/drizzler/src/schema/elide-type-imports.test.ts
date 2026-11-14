import { describe, expect, it } from "vite-plus/test";
import { elideTypeOnlyImports } from "./strip-imports.js";

describe("elideTypeOnlyImports", () => {
  it("blanks an import that brings in only types, keeping every position after it", () => {
    const source = [
      'import { pgTable, varchar } from "drizzle-orm/pg-core";',
      'import { type AdapterAccount } from "next-auth/adapters";',
      'import { type A, type B } from "./types";',
      'export const accounts = pgTable("account", { type: varchar("type") });',
    ].join("\n");
    const elided = elideTypeOnlyImports(source);
    expect(elided.length).toBe(source.length);
    expect(elided.split("\n")).toStrictEqual([
      'import { pgTable, varchar } from "drizzle-orm/pg-core";',
      " ".repeat(57),
      " ".repeat(41),
      'export const accounts = pgTable("account", { type: varchar("type") });',
    ]);
  });

  it("keeps an import that brings in a value, a side-effect import and `import type`", () => {
    const source = [
      'import { type A, b } from "./mixed";',
      'import "./side-effect";',
      'import type { C } from "./types";',
      'import {} from "./empty";',
    ].join("\n");
    expect(elideTypeOnlyImports(source)).toBe(source);
  });
});
