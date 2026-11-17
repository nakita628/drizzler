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
    expect(elided).toHaveLength(source.length);
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
      "export const value = b;",
    ].join("\n");
    expect(elideTypeOnlyImports(source)).toBe(source);
  });

  it("drops an imported name that only a type reads, with its comma", () => {
    const source = [
      'import { AnySQLiteColumn, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";',
      'import { SQL, sql } from "drizzle-orm";',
      'import { Helper } from "./types";',
      'export const lists = sqliteTable("lists", {',
      '  id: text("id").primaryKey(),',
      '  parentId: text("parentId").references((): AnySQLiteColumn => lists.id),',
      '  position: integer("position").notNull(),',
      '  name: text("name").$type<Helper>().default(sql`x` as SQL),',
      "});",
    ].join("\n");
    const elided = elideTypeOnlyImports(source);
    expect(elided).toHaveLength(source.length);
    const [first, second, third, ...rest] = elided.split("\n");
    expect(first?.replaceAll(/\s+/gu, " ")).toBe(
      'import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";',
    );
    expect(second?.replaceAll(/\s+/gu, " ")).toBe('import { sql } from "drizzle-orm";');
    expect(third?.trim()).toBe("");
    expect(rest).toStrictEqual(source.split("\n").slice(3));
  });

  it("keeps a name read as a value however it is reached, and drops one only a property names", () => {
    const source = [
      'import { a, b, c, d, e } from "./values";',
      "export const x = { a, k: b, [c]: 1, e: 1 };",
      "export const y = d.e;",
    ].join("\n");
    expect(elideTypeOnlyImports(source).split("\n")[0]?.replaceAll(/\s+/gu, " ")).toBe(
      'import { a, b, c, d } from "./values";',
    );
  });
});
