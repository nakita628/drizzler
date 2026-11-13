import { describe, expect, it } from "vite-plus/test";
import {
  findSyntaxError,
  findTableSpans,
  parseQuery,
  readQueryNames,
  readRelationFields,
} from "./parse.js";

const schema = `import { integer, sqliteTable } from "drizzle-orm/sqlite-core";
import { defineRelations, defineRelationsPart } from "drizzle-orm";

export const user = sqliteTable("users", {
  id: integer("id").primaryKey(),
});

export const post = sqliteTable("posts", {
  id: integer("id").primaryKey(),
  authorId: integer("author_id").notNull(),
});

export const tag = sqliteTable("tags", {
  id: integer("id").primaryKey(),
});

export const postTag = sqliteTable("post_tags", {
  postId: integer("post_id").notNull(),
  tagId: integer("tag_id").notNull(),
});

export const relations = defineRelations({ user, post, tag, postTag }, (r) => ({
  user: { posts: r.many.post() },
  post: {
    author: r.one.user({ from: r.post.authorId, to: r.user.id }),
    tags: r.many.tag({
      from: r.post.id.through(r.postTag.postId),
      to: r.tag.id.through(r.postTag.tagId),
    }),
  },
}));

export const extra = defineRelationsPart({ tag, post, postTag }, (r) => ({
  tag: { posts: r.many.post() },
}));
`;

describe("findSyntaxError", () => {
  it("is null for a source that parses, and the offset of the first error otherwise", () => {
    expect(findSyntaxError({ source: schema })).toBeNull();
    expect(findSyntaxError({ source: "const a = ;" })?.offset).toBe(10);
  });
});

describe("findTableSpans", () => {
  it("spans each exported table from `export` to the end of its statement", () => {
    const spans = findTableSpans({ source: schema });
    expect(spans.map((s) => s.name)).toStrictEqual(["user", "post", "tag", "postTag"]);
    const user = spans[0];
    expect(schema.slice(user?.start, user?.end)).toBe(
      'export const user = sqliteTable("users", {\n  id: integer("id").primaryKey(),\n});',
    );
  });
});

describe("readRelationFields", () => {
  it("names each relation defineRelations and its parts declare, with the table it points at", () => {
    expect(readRelationFields({ source: schema })).toStrictEqual([
      { table: "user", name: "posts", target: "post" },
      { table: "post", name: "author", target: "user" },
      { table: "post", name: "tags", target: "tag" },
      { table: "tag", name: "posts", target: "post" },
    ]);
  });
});

describe("parseQuery", () => {
  it("finds the last expression statement in the query's own offsets", () => {
    const code = "const n = 1;\ndb.select().from(user);";
    const { error, last } = parseQuery({ code });
    expect(error).toBeNull();
    expect(code.slice(last?.start, last?.end)).toBe("db.select().from(user);");
    expect(code.slice(last?.expression.start, last?.expression.end)).toBe("db.select().from(user)");
  });

  it("has no last expression when the query ends in a declaration", () => {
    expect(parseQuery({ code: "const n = 1;" })).toStrictEqual({ error: null, last: null });
  });

  it("gives a syntax error at its offset in the query", () => {
    const { error } = parseQuery({ code: "a;\nb(" });
    expect(error?.offset).toBeGreaterThanOrEqual(3);
    expect(error?.offset).toBeLessThanOrEqual(5);
  });
});

describe("readQueryNames", () => {
  it("reads identifiers, member accesses, db.query tables and with keys, but not property names", () => {
    const names = readQueryNames({
      code:
        "const rows = await db.select({ t: post.title }).from(post).where(eq(post.id, 1));\n" +
        "db.query.user.findMany({ with: { posts: { with: { comments: true } } } })",
    });
    expect(names?.names).toEqual(expect.arrayContaining(["rows", "db", "post", "eq"]));
    expect(names?.names).not.toContain("title");
    expect(names?.names).not.toContain("t");
    expect(names?.members).toEqual(
      expect.arrayContaining([
        { object: "post", property: "title" },
        { object: "post", property: "id" },
      ]),
    );
    expect(names?.queries).toStrictEqual(["user"]);
    expect(names?.withs).toStrictEqual(["posts", "comments"]);
    expect(names?.writes).toStrictEqual([]);
    expect(
      readQueryNames({ code: "await db.delete(post).where(eq(post.id, 1))" })?.writes,
    ).toStrictEqual(["post"]);
  });

  it("is null for code that does not parse", () => {
    expect(readQueryNames({ code: "db.select(" })).toBeNull();
  });
});
