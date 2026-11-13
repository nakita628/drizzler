import { describe, expect, it } from "vite-plus/test";
import { queryExamples, schemaDialect } from "./query-examples.js";

const schema = [
  "export const role = pgEnum('role', ['admin', 'member'])",
  "export const user = pgTable('users', {",
  "  id: uuid('id').primaryKey().defaultRandom(),",
  "  name: text('name').notNull(),",
  "  age: integer('age'),",
  "  role: role('role').notNull(),",
  "  createdAt: timestamp('created_at').notNull().defaultNow(),",
  "})",
  "export const tag = pgTable('tags', {",
  "  postId: uuid('post_id').notNull(),",
  "  label: text('label').notNull(),",
  "}, (t) => [primaryKey({ columns: [t.postId, t.label] })])",
  "export const relations = defineRelations({ user, tag }, (r) => ({",
  "  user: { tags: r.many.tag({ from: r.user.id, to: r.tag.postId }) },",
  "}))",
];

describe("queryExamples", () => {
  const examples = queryExamples(schema);
  function of(table: string) {
    return Object.fromEntries(
      examples.filter((e) => e.table === table).map((e) => [e.name, e.code] as const),
    );
  }

  it("writes every query of a table, its relations named in the relational query", () => {
    expect(of("user")).toStrictEqual({
      Select: "db.select().from(user)",
      Count: "db.select({ count: count() }).from(user)",
      "Find many with relations": "db.query.user.findMany({ with: { tags: true } })",
      "Find by primary key":
        'db.query.user.findFirst({ where: { id: "00000000-0000-0000-0000-000000000000" } })',
      // Only the columns without a default and not nullable; an enum takes its first value.
      Insert: 'db.insert(user).values({ name: "name", role: "admin" })',
      Update:
        'db.update(user).set({ name: "name" }).where(eq(user.id, "00000000-0000-0000-0000-000000000000"))',
      Delete: 'db.delete(user).where(eq(user.id, "00000000-0000-0000-0000-000000000000"))',
    });
  });

  it("finds a row of a composite key by all its columns", () => {
    const tag = of("tag");
    expect(tag["Find many"]).toBe("db.query.tag.findMany()");
    expect(tag.Delete).toBe(
      'db.delete(tag).where(and(eq(tag.postId, "00000000-0000-0000-0000-000000000000"), eq(tag.label, "label")))',
    );
  });
});

describe("schemaDialect", () => {
  it("reads the dialect from the core module a file imports", () => {
    expect(schemaDialect(['import { sqliteTable } from "drizzle-orm/sqlite-core";'])).toBe(
      "sqlite",
    );
    expect(schemaDialect(["export {}", "import { pgTable } from 'drizzle-orm/pg-core'"])).toBe(
      "pg",
    );
    expect(schemaDialect(['import { sql } from "drizzle-orm";'])).toBeNull();
  });
});
