import { describe, expect, it } from "vite-plus/test";
import { ddlBySubject, docsMarkdown } from "./docs.js";

const schema = [
  "/** Who can sign in */",
  "export const user = pgTable('users', {",
  "  /** The key */",
  "  id: uuid('id').primaryKey().defaultRandom(),",
  "  /** Shown | as written */",
  "  name: text('name').notNull(),",
  "  role: memberRole('role').notNull().default('member'),",
  "})",
  "export const post = pgTable('post', {",
  "  id: uuid('id').primaryKey(),",
  "  authorId: uuid('author_id').references(() => user.id, { onDelete: 'cascade' }),",
  "  editorId: uuid('editor_id').notNull(),",
  "}, (t) => [index('post_author').on(t.authorId)])",
  "/** What a member may do */",
  "export const memberRole = pgEnum('member_role', ['owner', 'member'])",
  "export const relations = defineRelations({ user, post }, (r) => ({",
  "  post: { editor: r.one.user({ from: r.post.editorId, to: r.user.id }) },",
  "  user: { posts: r.many.post() },",
  "}))",
];

describe("docsMarkdown", () => {
  const markdown = docsMarkdown(schema);

  it("starts with the ER diagram under its title", () => {
    expect(markdown.startsWith("# Schema docs\n\n![ER diagram](er.svg)\n\n## Contents")).toBe(true);
    expect(markdown).not.toContain("ER.md");
    expect(markdown).not.toContain("schema.dbml");
    expect(markdown).not.toContain("The whole schema as SQL");
  });

  it("lists every table and enum, linked to its section", () => {
    expect(markdown).toContain("| [user](#table-user) | `users` | Who can sign in |");
    expect(markdown).toContain(
      "| [memberRole](#enum-memberRole) | `member_role` | What a member may do |",
    );
    expect(markdown).toContain('<a id="table-post"></a>\n\n### post');
  });

  it("puts each related table's own ER diagram above its columns", () => {
    expect(markdown).toContain(
      "### post\n\n![post and the tables it relates to](tables/post.svg)\n\n| Column |",
    );
  });

  it("writes each column with its type, constraints, default and description", () => {
    expect(markdown).toContain("| `id` | `uuid` | PK NOT NULL | `.defaultRandom()` | The key |");
    // A pipe in a description would end the cell.
    expect(markdown).toContain("| `name` | `text` | NOT NULL |  | Shown \\| as written |");
    expect(markdown).toContain("| `role` | [`memberRole`](#enum-memberRole) | NOT NULL |");
    expect(markdown).toContain(
      "| `authorId` (`author_id`) | `uuid` | NULL → [user.id](#table-user) |  |  |",
    );
  });

  it("writes the indexes and the relations both ways, with their actions and where they come from", () => {
    expect(markdown).toContain("#### Indexes\n\n- INDEX `authorId`");
    expect(markdown).toContain(
      "- `authorId` → [user.id](#table-user) (many to one, on delete cascade)",
    );
    expect(markdown).toContain(
      "- `editorId` → [user.id](#table-user) (many to one, defineRelations, no foreign key)",
    );
    expect(markdown).toContain(
      "- `id` → [post.editorId](#table-post) (one to many, defineRelations)",
    );
  });

  it("gives each table its Drizzle queries, folded", () => {
    expect(markdown).toContain("<summary>Queries</summary>");
    expect(markdown).toContain("```ts\ndb.select().from(post)\n```");
  });

  it("lists an enum's values", () => {
    expect(markdown).toContain("Type `member_role`. What a member may do\n\n- `owner`\n- `member`");
  });

  it("shows each query beside the SQL drizzle-orm builds for it, a clause to a line", () => {
    const withSql = docsMarkdown(schema, {
      queries: [
        {
          table: "post",
          name: "Find by primary key",
          description: "One row of post.",
          code: 'db.query.post.findFirst({ where: { id: "x" } })',
          sql: 'select "id" from "post" where "id" = $1 limit $2',
          params: ["x", 1],
          error: null,
        },
        {
          table: "post",
          name: "Count",
          description: "How many rows post has.",
          code: "db.select({ count: count() }).from(post)",
          sql: null,
          params: [],
          error: "no such column",
        },
      ],
    });
    expect(withSql).toContain("<summary>Queries and their SQL</summary>");
    expect(withSql).toContain(
      '```ts\ndb.query.post.findFirst({ where: { id: "x" } })\n```\n\n```sql\nselect "id"\nfrom "post"\nwhere "id" = $1\nlimit $2\n-- params: ["x",1]\n```',
    );
    expect(withSql).toContain("> drizzle-orm could not build its SQL: no such column");
    // The studio's code-only queries are what a schema that could not be loaded gets.
    expect(withSql).not.toContain("db.select().from(post)\n```\n\n</details>");
  });
});

describe("ddlBySubject", () => {
  it("groups each statement under the table or enum it defines, in every dialect's quoting", () => {
    const grouped = ddlBySubject([
      "CREATE TYPE \"member_role\" AS ENUM('owner', 'member');",
      'CREATE TABLE "users" (\n\t"id" uuid PRIMARY KEY\n);',
      'CREATE TABLE "auth"."post" (\n\t"id" uuid\n);',
      'CREATE UNIQUE INDEX "post_slug" ON "auth"."post" ("slug");',
      'ALTER TABLE "post" ADD CONSTRAINT "post_author_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id");',
      "CREATE TABLE `tags` (\n\t`id` int\n);",
      'CREATE SCHEMA "auth";',
    ]);
    expect([...grouped.keys()]).toStrictEqual([
      "enum:member_role",
      "table:users",
      "table:post",
      "table:tags",
    ]);
    expect(grouped.get("table:post")).toHaveLength(3);
  });
});

describe("docsMarkdown with the tables' definitions", () => {
  it("puts the whole schema's SQL at the top, folded, and each table's and enum's own under it", () => {
    const markdown = docsMarkdown(schema, {
      ddl: [
        "CREATE TYPE \"member_role\" AS ENUM('owner', 'member');",
        'CREATE TABLE "post" (\n\t"id" uuid PRIMARY KEY\n);',
        'CREATE INDEX "post_author" ON "post" ("author_id");',
      ],
    });
    expect(markdown).toContain(
      "![ER diagram](er.svg)\n\n<details>\n<summary>The whole schema as SQL</summary>\n\n```sql\nCREATE TYPE",
    );
    expect(markdown).toContain(
      '#### Definition\n\n```sql\nCREATE TABLE "post" (\n\t"id" uuid PRIMARY KEY\n);\n\nCREATE INDEX "post_author" ON "post" ("author_id");\n```',
    );
    expect(markdown).toContain(
      "```sql\nCREATE TYPE \"member_role\" AS ENUM('owner', 'member');\n```",
    );
  });
});
