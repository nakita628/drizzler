import { describe, expect, it } from "vite-plus/test";
import { extractRelationsFromSchema, parseTableInfo } from "../helper/index.js";
import { stripImports, unaliasTableBuilders } from "./strip-imports.js";

describe("stripImports", () => {
  it("drops the imports, one over several lines included", () => {
    const source = [
      "import {",
      "  pgTable,",
      '} from "drizzle-orm/pg-core";',
      "",
      'export const user = pgTable("user", {});',
    ].join("\n");
    expect(stripImports(source)).toStrictEqual(['export const user = pgTable("user", {});']);
  });

  it("calls a table builder imported under another name by its own name", () => {
    const source = [
      'import { integer, pgTable as table, serial, text } from "drizzle-orm/pg-core";',
      "",
      'export const articles = table("articles", {',
      '  id: serial("id").primaryKey(),',
      '  slug: text("slug").notNull().unique(),',
      "});",
      "",
      'export const comments = table("comments", {',
      '  id: serial("id").primaryKey(),',
      '  articleId: integer("article_id")',
      "    .notNull()",
      "    .references(() => articles.id),",
      "});",
    ].join("\n");
    const code = stripImports(source);
    expect(code[0]).toBe('export const articles = pgTable("articles", {');
    expect(parseTableInfo(code).map((t) => t.name)).toStrictEqual(["articles", "comments"]);
    expect(extractRelationsFromSchema(code)).toStrictEqual([
      {
        fromModel: "articles",
        toModel: "comments",
        fromField: "id",
        toField: "articleId",
        isRequired: true,
        enforced: true,
        isUnique: false,
      },
    ]);
  });
});

describe("unaliasTableBuilders", () => {
  it("renames only the top-level table calls, and only for drizzle-orm's builders", () => {
    const source = [
      'import { pgTable as table } from "drizzle-orm/pg-core";',
      'import { makeTable as other } from "./helpers";',
      'export const a = table.withRLS("a", {}, (table) => [table.id]);',
      'const b = other("b", {});',
    ].join("\n");
    expect(unaliasTableBuilders(source).split("\n").slice(2)).toStrictEqual([
      'export const a = pgTable.withRLS("a", {}, (table) => [table.id]);',
      'const b = other("b", {});',
    ]);
  });

  it("leaves a source with no alias as it is", () => {
    const source = 'import { pgTable } from "drizzle-orm/pg-core";\nconst a = pgTable("a", {});';
    expect(unaliasTableBuilders(source)).toBe(source);
  });
});
