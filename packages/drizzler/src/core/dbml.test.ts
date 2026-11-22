import { NodeServices } from "@effect/platform-node";
import { Effect } from "effect";
import type { FileSystem } from "effect";
import { run } from "@softwaretechnik/dbml-renderer";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { dbml } from "../generator/index.js";
import { joinSources } from "../schema/paths.js";
import { stripImports } from "../schema/strip-imports.js";
import { drizzlerDbml } from "./dbml.js";

/** Runs what a core function returns, on the real file system. */
function runEffect<A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem>) {
  return Effect.runPromise(effect.pipe(Effect.provide(NodeServices.layer)));
}

const ecSchemaContent = `import { mysqlTable, varchar, int, decimal, timestamp } from 'drizzle-orm/mysql-core'
import { defineRelations } from 'drizzle-orm'


export const user = mysqlTable('user', {
  id: varchar('id', { length: 36 }).primaryKey(),
  name: varchar('name', { length: 50 }).notNull(),
  email: varchar('email', { length: 255 }).notNull(),
})

export const order = mysqlTable('order', {
  id: int('id').primaryKey().autoincrement(),
  userId: varchar('user_id', { length: 36 }).notNull().references(() => user.id),
  total: decimal('total', { precision: 10, scale: 2 }).notNull(),
  createdAt: timestamp('created_at').notNull(),
})

export const orderItem = mysqlTable('order_item', {
  id: int('id').primaryKey().autoincrement(),
  orderId: int('order_id').notNull().references(() => order.id),
  productName: varchar('product_name', { length: 200 }).notNull(),
  quantity: int('quantity').notNull(),
  price: decimal('price', { precision: 10, scale: 2 }).notNull(),
})`;

const singleTableSchema = `import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

export const config = sqliteTable('config', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})`;

const pgAuthSchema = `import { pgTable, uuid, varchar, timestamp, boolean } from 'drizzle-orm/pg-core'

/// Account table
export const account = pgTable('account', {
  /// Primary key
  id: uuid('id').primaryKey().defaultRandom(),
  /// User email address
  email: varchar('email', { length: 255 }).notNull(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  isActive: boolean('is_active').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
})`;

describe("E2E: DBML generation", () => {
  let tmpdir: string;

  beforeEach(() => {
    tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "drizzler-e2e-dbml-"));
  });

  afterEach(() => {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  });

  it("generates DBML with correct table and column definitions for EC schema", async () => {
    fs.writeFileSync(path.join(tmpdir, "schema.ts"), ecSchemaContent, "utf8");
    const output = path.join(tmpdir, "output", "schema.dbml");

    const code = stripImports(ecSchemaContent);
    await runEffect(drizzlerDbml(code, output));

    expect(fs.existsSync(output)).toBe(true);

    const content = fs.readFileSync(output, "utf8");

    // Tables exist
    expect(content).toContain("Table user {");
    expect(content).toContain("Table order {");
    expect(content).toContain("Table order_item {");

    // User columns
    expect(content).toContain("id varchar [pk, not null]");
    expect(content).toContain("name varchar [not null]");
    expect(content).toContain("email varchar [not null]");

    // Order columns
    expect(content).toContain("user_id varchar [not null]");
    expect(content).toContain("total decimal [not null]");
    expect(content).toContain("created_at timestamp [not null]");

    // OrderItem columns
    expect(content).toContain("order_id integer [not null]");
    expect(content).toContain("product_name varchar [not null]");
    expect(content).toContain("quantity integer [not null]");
    expect(content).toContain("price decimal [not null]");

    // Foreign key refs
    expect(content).toContain("Ref order_user_id_user_id_fk: order.user_id > user.id");
    expect(content).toContain(
      "Ref order_item_order_id_order_id_fk: order_item.order_id > order.id",
    );
    expect(() => run(content, "svg")).not.toThrow();
  });

  it("generates DBML with field descriptions as notes for auth schema", async () => {
    fs.writeFileSync(path.join(tmpdir, "schema.ts"), pgAuthSchema, "utf8");
    const output = path.join(tmpdir, "output", "auth.dbml");

    const code = stripImports(pgAuthSchema);
    await runEffect(drizzlerDbml(code, output));

    const content = fs.readFileSync(output, "utf8");

    expect(content).toContain("Table account {");
    expect(content).toContain("note: 'Primary key'");
    expect(content).toContain("note: 'User email address'");
  });

  it("generates DBML for single-table schema without refs", async () => {
    fs.writeFileSync(path.join(tmpdir, "schema.ts"), singleTableSchema, "utf8");
    const output = path.join(tmpdir, "output", "config.dbml");

    const code = stripImports(singleTableSchema);
    await runEffect(drizzlerDbml(code, output));

    const content = fs.readFileSync(output, "utf8");

    expect(content).toContain("Table config {");
    expect(content).toContain("key text [pk, not null]");
    expect(content).toContain("value text [not null]");
    // No Ref lines
    expect(content).not.toContain("Ref ");
  });
});

describe("dbml relations", () => {
  // Guard: a column note never spans multiple lines, so it can never break DBML's
  // single-line single-quoted string literal (which rejects embedded newlines). A
  // note is sourced from the nearest single `///` line, so even stacked `///`
  // comments collapse to one line; an apostrophe is escaped, and non-ASCII text
  // (full-width parens) passes through verbatim.
  it("joins a comment of several lines into one single-quoted note", () => {
    const code = [
      "export const user = pgTable('user', {",
      "  /// first comment line",
      "  /// second comment line",
      "  id: uuid('id').primaryKey(),",
      "  /// User's email （連絡先）",
      "  email: varchar('email').notNull(),",
      "})",
    ];
    expect(dbml(code)).toBe(
      `Table user {
  id uuid [pk, not null, note: 'first comment line second comment line']
  email varchar [not null, note: 'User\\'s email （連絡先）']
}`,
    );
  });

  // A defineRelations-only relation (no physical FK) is reflected in DBML, mirroring
  // the Mermaid generator. Logical relations drop the `_fk` suffix that physical
  // FKs carry, since they are not DB-enforced constraints.
  it("emits a defineRelations-only relation as a logical Ref (no _fk suffix)", () => {
    const code = [
      "export const user = mysqlTable('user', {",
      "  id: varchar('id', { length: 36 }).primaryKey(),",
      "  name: varchar('name', { length: 50 }).notNull(),",
      "})",
      "export const post = mysqlTable('post', {",
      "  id: varchar('id', { length: 36 }).primaryKey(),",
      "  userId: varchar('user_id', { length: 36 }).notNull().references(() => user.id),",
      "})",
      "export const profile = mysqlTable('profile', {",
      "  id: varchar('id', { length: 36 }).primaryKey(),",
      "  user_id: varchar('user_id', { length: 36 }).notNull(),",
      "})",
      "export const profileRelations = defineRelations({ profile, user }, (r) => ({",
      "  profile: {",
      "    user: r.one.user({ from: r.profile.user_id, to: r.user.id }),",
      "  },",
      "}))",
    ];
    expect(dbml(code)).toBe(
      `Table user {
  id varchar [pk, not null]
  name varchar [not null]
}

Table post {
  id varchar [pk, not null]
  user_id varchar [not null]
}

Table profile {
  id varchar [pk, not null]
  user_id varchar [not null]
}

Ref post_user_id_user_id_fk: post.user_id > user.id

Ref profile_user_id_user_id: profile.user_id > user.id`,
    );
  });

  // A FK declared with a referential-action config (`onDelete`/`onUpdate`) must
  // still render a Ref line; the relation used to be silently dropped.
  it("renders a Ref for a FK declared with an onDelete config", () => {
    const code = [
      "export const user = mysqlTable('user', {",
      "  id: varchar('id', { length: 36 }).primaryKey(),",
      "})",
      "export const post = mysqlTable('post', {",
      "  id: varchar('id', { length: 36 }).primaryKey(),",
      "  userId: varchar('user_id', { length: 36 }).notNull().references(() => user.id, { onDelete: 'cascade' }),",
      "})",
    ];
    expect(dbml(code)).toBe(
      `Table user {
  id varchar [pk, not null]
}

Table post {
  id varchar [pk, not null]
  user_id varchar [not null]
}

Ref post_user_id_user_id_fk: post.user_id > user.id [delete: cascade]`,
    );
  });

  it("writes onDelete and onUpdate as the Ref's settings", () => {
    const code = [
      "export const user = pgTable('user', {",
      "  id: text().primaryKey(),",
      "})",
      "export const session = pgTable('session', {",
      "  id: text().primaryKey(),",
      "  userId: text().notNull().references(() => user.id, { onDelete: 'set null', onUpdate: 'cascade' }),",
      "})",
      "export const token = pgTable('token', {",
      "  id: text().primaryKey(),",
      "  userId: text().notNull(),",
      "}, (t) => [foreignKey({ columns: [t.userId], foreignColumns: [user.id] }).onDelete('cascade')])",
    ];
    const out = dbml(code);
    expect(out).toContain(
      "Ref session_userId_user_id_fk: session.userId > user.id [delete: set null, update: cascade]",
    );
    expect(out).toContain("Ref token_userId_user_id_fk: token.userId > user.id [delete: cascade]");
    expect(() => run(out, "svg")).not.toThrow();
  });

  it("writes timestamptz and timetz for columns with a time zone", () => {
    const code = [
      "export const user = pgTable('user', {",
      "  createdAt: timestamp({ withTimezone: true, mode: 'date' }).defaultNow().notNull(),",
      "  updatedAt: timestamp('updated_at', { withTimezone: true }),",
      "  seenAt: timestamp(),",
      "  opensAt: time({ withTimezone: true }),",
      "  closesAt: time({ withTimezone: false }),",
      "})",
    ];
    expect(dbml(code)).toBe(
      `Table user {
  createdAt timestamptz [not null]
  updated_at timestamptz
  seenAt timestamp
  opensAt timetz
  closesAt time
}`,
    );
  });
  it("names tables and columns as the database does", () => {
    const code = [
      "const createTable = pgTableCreator((name) => `project1_${name}`)",
      "export const users = pgTable('project1_user', {",
      "  createdById: text('created_by_id').notNull(),",
      "})",
      "export const posts = createTable('post', {",
      "  id: serial('id').primaryKey(),",
      "  authorId: text('author_id').references(() => users.createdById),",
      "})",
      "export const account = snakeCase.table('account', (t) => ({",
      "  emailVerified: t.boolean().notNull(),",
      "}))",
    ];
    expect(dbml(code)).toBe(
      `Table project1_user {
  created_by_id text [not null]
}

Table project1_post {
  id serial [pk, increment, not null]
  author_id text
}

Table account {
  email_verified boolean [not null]
}

Ref project1_post_author_id_project1_user_created_by_id_fk: project1_post.author_id > project1_user.created_by_id`,
    );
  });

  it("names the columns of an aliased snakeCase.table in snake_case, in indexes too", () => {
    const code = [
      "const table = snakeCase.table",
      "export const user = table('user', {",
      "  id: text().primaryKey(),",
      "  emailVerified: boolean().notNull(),",
      "}, (t) => [index('users_email_verified_idx').on(t.emailVerified)])",
      "const pgTable = snakeCase.table",
      "export const session = pgTable('session', {",
      "  userId: text().notNull().references(() => user.id),",
      "})",
    ];
    expect(dbml(code)).toBe(
      `Table user {
  id text [pk, not null]
  email_verified boolean [not null]
  indexes {
    (email_verified) [name: 'users_email_verified_idx']
  }
}

Table session {
  user_id text [not null]
}

Ref session_user_id_user_id_fk: session.user_id > user.id`,
    );
  });

  it("quotes a type of several words, such as double precision", () => {
    const code = [
      "export const orders = pgTable('orders', {",
      "  id: varchar('id').primaryKey(),",
      "  freight: doublePrecision('freight').notNull(),",
      "})",
    ];
    const out = dbml(code);
    expect(out).toBe(
      `Table orders {
  id varchar [pk, not null]
  freight "double precision" [not null]
}`,
    );
    expect(() => run(out, "svg")).not.toThrow();
  });

  it("writes not null, unique, composite primary keys and indexes", () => {
    const code = [
      "/** Accounts. */",
      "export const users = pgTable('users', {",
      "  id: serial('id').primaryKey(),",
      "  email: text('email').notNull().unique(),",
      "}, (t) => [index('users_email_idx').on(t.email)])",
      "export const membership = pgTable('membership', {",
      "  userId: text('user_id').notNull(),",
      "  orgId: text('org_id').notNull(),",
      "}, (t) => [unique('membership_user_org').on(t.userId, t.orgId)])",
      "export const articleTags = pgTable('article_tags', {",
      "  articleId: integer('article_id'),",
      "  tagName: text('tag_name'),",
      "}, (t) => [primaryKey({ columns: [t.articleId, t.tagName] })])",
    ];
    const out = dbml(code);
    expect(out).toBe(
      `Table users {
  id serial [pk, increment, not null]
  email text [not null, unique]
  indexes {
    (email) [name: 'users_email_idx']
  }
  Note: 'Accounts.'
}

Table membership {
  user_id text [not null]
  org_id text [not null]
  indexes {
    (user_id, org_id) [unique, name: 'membership_user_org']
  }
}

Table article_tags {
  article_id integer [not null]
  tag_name text [not null]
  indexes {
    (article_id, tag_name) [pk]
  }
}`,
    );
    expect(() => run(out, "svg")).not.toThrow();
  });

  it("draws a self key of the object-style constraints to the table itself", () => {
    const code = [
      "export const employees = pgTable('employees', {",
      "  id: varchar('id').primaryKey(),",
      "  recipientId: varchar('recipient_id'),",
      "}, (table) => ({",
      "  recipientFk: foreignKey({ columns: [table.recipientId], foreignColumns: [table.id] }),",
      "}))",
    ];
    const out = dbml(code);
    expect(out).toContain(
      "Ref employees_recipient_id_employees_id_fk: employees.recipient_id > employees.id",
    );
    expect(() => run(out, "svg")).not.toThrow();
  });
});

describe("DBML output always parses (issue regression guard)", () => {
  // The reported failure was a multi-line, single-quoted `Note:` breaking the DBML
  // parser (`Invalid newline encountered while parsing` / `Unexpected token '（'`).
  // drizzler never emits a table-level `Note:`, and a column note is sourced from a
  // single `///` line, so every note stays single-line. This proves the generated
  // DBML parses even with the exact characters from the report — apostrophes,
  // full-width parens, Japanese, and stacked `///` comments.
  it("parses notes with apostrophes, full-width parens, and stacked comments", () => {
    const code = [
      "export const user = pgTable('user', {",
      "  /// 上の行（無視される）",
      "  /// User's primary key （主キー）",
      "  id: uuid('id').primaryKey(),",
      "  /// メールアドレス（連絡先）",
      "  email: varchar('email').notNull(),",
      "})",
    ];

    expect(() => run(dbml(code), "svg")).not.toThrow();
  });
});

describe("keys the column builders alone do not show", () => {
  it("writes a composite foreignKey() as one composite Ref (#33)", () => {
    const code =
      stripImports(`import { foreignKey, pgTable, primaryKey, timestamp, uuid } from "drizzle-orm/pg-core";

export const document = pgTable(
  "document",
  {
    id: uuid("id").notNull(),
    createdAt: timestamp("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.id, t.createdAt] })],
);

export const suggestion = pgTable(
  "suggestion",
  {
    id: uuid("id").primaryKey(),
    documentId: uuid("document_id").notNull(),
    documentCreatedAt: timestamp("document_created_at").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.documentId, t.documentCreatedAt],
      foreignColumns: [document.id, document.createdAt],
    }).onDelete("cascade"),
  ],
);`);
    const out = dbml(code);
    expect(out).toContain(
      "Ref suggestion_document_id_document_created_at_document_id_created_at_fk: suggestion.(document_id, document_created_at) > document.(id, created_at) [delete: cascade]",
    );
    expect(() => run(out, "svg")).not.toThrow();
  });

  it("keeps a key from a column to itself as a comment, so the file parses (#37)", () => {
    const code =
      stripImports(`import { foreignKey, pgTable, text, uuid } from "drizzle-orm/pg-core";

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    fullName: text("full_name"),
  },
  (table) => [
    foreignKey({
      columns: [table.id],
      foreignColumns: [table.id],
      name: "users_id_fkey",
    }).onDelete("cascade"),
  ],
);`);
    const out = dbml(code);
    expect(out).toContain(
      "// Ref users_id_fkey: users.id - users.id [delete: cascade] (a key from a column to itself, which DBML cannot express)",
    );
    expect(out.split("\n").filter((line) => line.startsWith("Ref "))).toStrictEqual([]);
    expect(() => run(out, "svg")).not.toThrow();
  });

  it("declares a table built with .enableRLS(), and points its refs at its SQL name (#38)", () => {
    const code = stripImports(`import { bigint, pgTable, uuid, varchar } from "drizzle-orm/pg-core";

export const users = pgTable("user", {
  id: uuid("id").primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
}).enableRLS();

export const boards = pgTable("board", {
  id: bigint("id", { mode: "number" }).primaryKey(),
  createdBy: uuid("createdBy").references(() => users.id),
});`);
    expect(dbml(code)).toBe(
      [
        "Table user {",
        "  id uuid [pk, not null]",
        "  email varchar [not null, unique]",
        "}",
        "",
        "Table board {",
        "  id bigint [pk, not null]",
        "  createdBy uuid",
        "}",
        "",
        "Ref board_createdBy_user_id_fk: board.createdBy > user.id",
      ].join("\n"),
    );
  });
});

describe("columns built another way than a builder call", () => {
  it("types a customType() column by what its dataType makes (#36)", () => {
    const code = stripImports(`import { customType, pgTable, uuid } from "drizzle-orm/pg-core";

export const numericCasted = customType<{
  data: number;
  driverData: string;
  config: { precision?: number; scale?: number };
}>({
  dataType: (config) =>
    config?.precision && config?.scale ? \`numeric(\${config.precision}, \${config.scale})\` : "numeric",
  fromDriver: (value: string) => Number.parseFloat(value),
  toDriver: (value: number) => value.toString(),
});

export const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

export const opaque = customType<{ data: string }>({
  dataType: () => pick("bytea"),
});

export const invoices = pgTable("invoices", {
  id: uuid("id").primaryKey(),
  amount: numericCasted("amount", { precision: 10, scale: 2 }),
  total: numericCasted("total"),
  search: tsvector("search"),
  blob: opaque("blob"),
});`);
    const out = dbml(code);
    expect(out).toBe(
      [
        "Table invoices {",
        "  id uuid [pk, not null]",
        "  amount numeric(10,2)",
        "  total numeric",
        "  search tsvector",
        "  blob bytea",
        "}",
      ].join("\n"),
    );
    expect(() => run(out, "svg")).not.toThrow();
  });

  it("reads a column a helper function builds: its type, NOT NULL and SQL name (#40)", () => {
    const code = stripImports(`import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

function createdAtField(colName = "createdAt") {
  return integer(colName, { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date());
}

const ownerField = (name: string) => text(name).references(() => users.id);

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
});

export const bookmarks = sqliteTable("bookmarks", {
  id: text("id").primaryKey(),
  dbCreatedAt: createdAtField(),
  createdAt: createdAtField("lastSavedAt"),
  slug: createdAtField("slug").unique(),
  ownerId: ownerField("owner_id").notNull(),
});`);
    expect(dbml(code)).toBe(
      [
        "Table users {",
        "  id text [pk, not null]",
        "}",
        "",
        "Table bookmarks {",
        "  id text [pk, not null]",
        "  createdAt integer [not null]",
        "  lastSavedAt integer [not null]",
        "  slug integer [not null, unique]",
        "  owner_id text [not null]",
        "}",
        "",
        "Ref bookmarks_owner_id_users_id_fk: bookmarks.owner_id > users.id",
      ].join("\n"),
    );
  });
});

describe("columns, tables and enums the reader follows further (#42, #44, #45, #46)", () => {
  it("reads a customType() called where it is built, in the table and from a helper (#42)", () => {
    const code = stripImports(`import { customType, pgTable, text } from "drizzle-orm/pg-core";

function sealedText(table: string, column: string) {
  return customType<{ data: string; config: { context: string } }>({
    dataType() {
      return "text";
    },
  })(column, { context: \`\${table}.\${column}\` });
}

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accessToken: sealedText("account", "access_token"),
  refreshToken: sealedText("account", "refresh_token"),
  inline: customType<{ data: string }>({ dataType: () => "text" })("inline_token"),
});`);
    const out = dbml(code);
    expect(out).toBe(
      [
        "Table account {",
        "  id text [pk, not null]",
        "  access_token text",
        "  refresh_token text",
        "  inline_token text",
        "}",
      ].join("\n"),
    );
    expect(() => run(out, "svg")).not.toThrow();
  });

  it("reads the columns spread from a helper function's result, helpers within helpers (#44)", () => {
    const code = stripImports(`import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export function createPrimaryKeyField({ prefix }: { prefix?: string } = {}) {
  return {
    id: text("id").primaryKey().$default(() => \`\${prefix ?? "id"}_1\`),
  };
}

export function createCreatedAtField() {
  return {
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$default(() => new Date()),
  };
}

export const createUpdatedAtField = () => ({
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$default(() => new Date())
    .$onUpdate(() => new Date()),
});

export function createTimestampColumns() {
  return {
    ...createCreatedAtField(),
    ...createUpdatedAtField(),
  };
}

export const tagsTable = sqliteTable("tags", {
  ...createPrimaryKeyField({ prefix: "tag" }),
  ...createTimestampColumns(),
  name: text("name").notNull(),
});

export const documentsToTagsTable = sqliteTable("documents_tags", {
  tagId: text("tag_id").notNull().references(() => tagsTable.id),
  documentId: text("document_id").notNull(),
});`);
    const out = dbml(code);
    expect(out).toBe(
      [
        "Table tags {",
        "  id text [pk, not null]",
        "  created_at integer [not null]",
        "  updated_at integer [not null]",
        "  name text [not null]",
        "}",
        "",
        "Table documents_tags {",
        "  tag_id text [not null]",
        "  document_id text [not null]",
        "}",
        "",
        "Ref documents_tags_tag_id_tags_id_fk: documents_tags.tag_id > tags.id",
      ].join("\n"),
    );
    expect(() => run(out, "svg")).not.toThrow();
  });

  it("keeps a pgSchema table under its schema, apart from a public table of its name (#45)", () => {
    const code = stripImports(`import { pgSchema, pgTable, text, uuid } from "drizzle-orm/pg-core";

export const authSchema = pgSchema("auth");

export const authUsers = authSchema.table("users", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull(),
});

export const users = pgTable("users", {
  id: uuid("id")
    .primaryKey()
    .references(() => authUsers.id, { onDelete: "cascade" }),
  displayName: text("display_name"),
});`);
    const out = dbml(code);
    expect(out).toBe(
      [
        "Table auth.users {",
        "  id uuid [pk, not null]",
        "  email text [not null]",
        "}",
        "",
        "Table users {",
        "  id uuid [pk, not null]",
        "  display_name text",
        "}",
        "",
        "Ref users_id_users_id_fk: users.id - auth.users.id [delete: cascade]",
      ].join("\n"),
    );
    expect(() => run(out, "svg")).not.toThrow();
  });

  it("reads the schema of a table built on pgSchema() in place", () => {
    const code = stripImports(`import { pgSchema, uuid } from "drizzle-orm/pg-core";

export const sessions = pgSchema("auth").table("sessions", {
  id: uuid("id").primaryKey(),
});`);
    expect(dbml(code)).toBe(["Table auth.sessions {", "  id uuid [pk, not null]", "}"].join("\n"));
  });

  it("types a column of an enum declared on a pgSchema under the enum's schema", () => {
    const code = stripImports(`import { pgEnum, pgSchema } from "drizzle-orm/pg-core";

export const authSchema = pgSchema("auth");
export const role = authSchema.enum("user_role", ["admin", "member"]);
export const kind = pgEnum("my.kind", ["a", "b"]);

export const users = authSchema.table("users", {
  role: role("role").notNull(),
  kind: kind("kind"),
});`);
    const out = dbml(code);
    // A dot in the name of an enum of the default schema is part of the name.
    expect(out).toBe(
      ["Table auth.users {", "  role auth.user_role [not null]", '  kind "my.kind"', "}"].join(
        "\n",
      ),
    );
    expect(() => run(out, "svg")).not.toThrow();
  });

  it("reads a pgEnum built from a TypeScript enum, or from one it cannot see (#46)", () => {
    const code = stripImports(`import { pgEnum, pgTable, uuid } from "drizzle-orm/pg-core";
import { PlanType } from "@acme/billing";

export enum ProjectRole {
  OWNER = "owner",
  ADMIN = "admin",
}

export const projectRole = pgEnum("project_role", ProjectRole);
export const planType = pgEnum("plan_type", PlanType);

export const userProjects = pgTable("user_projects", {
  id: uuid("id").primaryKey(),
  role: projectRole("role").notNull(),
  plan: planType("plan"),
});`);
    expect(dbml(code)).toBe(
      [
        "Table user_projects {",
        "  id uuid [pk, not null]",
        "  role project_role [not null]",
        "  plan plan_type",
        "}",
      ].join("\n"),
    );
  });
});

describe("columns, keys and indexes written another way (#49 to #58)", () => {
  it("reads a column held in a constant, by name or as a shorthand in a spread object (#49)", () => {
    const code = stripImports(`import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

const idUuid = uuid("id").primaryKey().default(sql\`gen_random_uuid()\`);
const createdAt = timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

const Audit = {
  id: idUuid,
  createdAt,
};

export const roles = pgTable("roles", {
  id: idUuid,
  name: text("name").notNull(),
});

export const users = pgTable("users", {
  ...Audit,
  name: text("name").notNull(),
  roleId: uuid("role_id").references(() => roles.id),
});`);
    const out = dbml(code);
    expect(out).toBe(
      [
        "Table roles {",
        "  id uuid [pk, not null]",
        "  name text [not null]",
        "}",
        "",
        "Table users {",
        "  id uuid [pk, not null]",
        "  created_at timestamptz [not null]",
        "  name text [not null]",
        "  role_id uuid",
        "}",
        "",
        "Ref users_role_id_roles_id_fk: users.role_id > roles.id",
      ].join("\n"),
    );
    expect(() => run(out, "svg")).not.toThrow();
  });

  it("reads d.snakeCase.table names and d.foreignKey of a namespace import (#50)", () => {
    const code = stripImports(`import * as d from "drizzle-orm/pg-core";

export const employees = d.snakeCase.table(
  "employees",
  {
    id: d.serial().primaryKey(),
    lastName: d.varchar().notNull(),
    recipientId: d.integer(),
  },
  (table) => [
    d.foreignKey({
      columns: [table.recipientId],
      foreignColumns: [table.id],
    }),
  ],
);`);
    expect(dbml(code)).toBe(
      [
        "Table employees {",
        "  id serial [pk, increment, not null]",
        "  last_name varchar [not null]",
        "  recipient_id integer",
        "}",
        "",
        "Ref employees_recipient_id_employees_id_fk: employees.recipient_id > employees.id",
      ].join("\n"),
    );
  });

  it.each([
    ['integer("id").primaryKey({ autoIncrement: true })', "sqliteTable"],
    ['int("id").primaryKey().autoincrement()', "mysqlTable"],
    ['integer("id").primaryKey().generatedByDefaultAsIdentity()', "pgTable"],
    ['integer("id").primaryKey().generatedAlwaysAsIdentity()', "pgTable"],
  ])("marks %s as increment (#51)", (column, builder) => {
    const out = dbml([`export const users = ${builder}("users", {`, `  id: ${column},`, "});"]);
    expect(out).toMatch(/^ {2}id \w+ \[pk, increment, not null\]$/mu);
  });

  it("names a table through a creator whose callback reads the schema's constants (#52)", () => {
    const code = stripImports(`import { pgTableCreator, text } from "drizzle-orm/pg-core";

const siteConfig = { name: "My Site", url: process.env.URL };
const projectName = "app";
const createTable = pgTableCreator((name) => \`\${projectName}_\${name}\`);
const createSiteTable = pgTableCreator(
  (name) => \`\${siteConfig.name.toLowerCase().replace(/\\s/g, "_")}_\${name}\`,
);

export const playlists = createTable("playlist", { id: text("id").primaryKey() });
export const pages = createSiteTable("page", { id: text("id").primaryKey() });`);
    expect(dbml(code)).toBe(
      [
        "Table app_playlist {",
        "  id text [pk, not null]",
        "}",
        "",
        "Table my_site_page {",
        "  id text [pk, not null]",
        "}",
      ].join("\n"),
    );
  });

  it("draws a relation declared only with the v1 relations() (#53)", () => {
    const code = stripImports(`import { relations } from "drizzle-orm/_relations";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
});

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));`);
    const out = dbml(code);
    expect(out).toContain("Ref sessions_user_id_users_id: sessions.user_id > users.id");
    expect(out.match(/^Ref /gmu)).toHaveLength(1);
    expect(() => run(out, "svg")).not.toThrow();
  });

  it("follows a key a spread helper builds from its parameter to the argument (#54)", () => {
    const code =
      stripImports(`import { integer, sqliteTable, text, type SQLiteColumn } from "drizzle-orm/sqlite-core";

const commonGenericCols = (modelMediaId: SQLiteColumn) => ({
  id: integer("id").primaryKey(),
  mediaId: integer("media_id").notNull().references(() => modelMediaId, { onDelete: "cascade" }),
  name: text("name").notNull(),
});

export const books = sqliteTable("books", {
  id: integer("id").primaryKey(),
  title: text("title").notNull(),
});

export const booksGenre = sqliteTable("books_genre", {
  ...commonGenericCols(books.id),
});`);
    const out = dbml(code);
    expect(out).toContain(
      "Ref books_genre_media_id_books_id_fk: books_genre.media_id > books.id [delete: cascade]",
    );
    expect(() => run(out, "svg")).not.toThrow();
  });

  it("reads the indexes a function returns to a table's third argument (#55)", () => {
    const code =
      stripImports(`import { index, integer, sqliteTable, text, uniqueIndex, type SQLiteColumn } from "drizzle-orm/sqlite-core";

const genericIndexes = (table: { mediaId: SQLiteColumn; name: SQLiteColumn }, tableName: string) => [
  uniqueIndex(\`ux_\${tableName}_media_name\`).on(table.mediaId, table.name),
  index(\`ix_\${tableName}_name\`).on(table.name),
];

export const booksGenre = sqliteTable(
  "books_genre",
  {
    id: integer("id").primaryKey(),
    mediaId: integer("media_id").notNull(),
    name: text("name").notNull(),
  },
  (table) => genericIndexes(table, "books_genre"),
);`);
    const out = dbml(code);
    expect(out).toBe(
      [
        "Table books_genre {",
        "  id integer [pk, not null]",
        "  media_id integer [not null]",
        "  name text [not null]",
        "  indexes {",
        "    (media_id, name) [unique, name: 'ux_books_genre_media_name']",
        "    (name) [name: 'ix_books_genre_name']",
        "  }",
        "}",
      ].join("\n"),
    );
    expect(() => run(out, "svg")).not.toThrow();
  });

  it("keeps index columns with a sort order or operator class, and expression indexes (#57)", () => {
    const code = stripImports(`import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const comments = pgTable(
  "comments",
  {
    id: text("id").primaryKey(),
    postId: text("post_id").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    index("comments_post_id_idx").on(table.postId),
    index("comments_created_at_desc_idx").on(table.createdAt.desc()),
    index("comments_post_id_created_at_desc_idx").on(table.postId, table.createdAt.desc()),
    index("comments_created_at_asc_idx").on(table.createdAt.asc()),
    index("comments_body_tsvector_idx").using("gin", sql\`to_tsvector('english', \${table.body})\`),
    index("comments_post_id_ops_idx").using("btree", table.postId.asc().nullsLast().op("text_ops")),
  ],
);`);
    const out = dbml(code);
    expect(out).toContain(
      [
        "  indexes {",
        "    (post_id) [name: 'comments_post_id_idx']",
        "    (created_at) [name: 'comments_created_at_desc_idx']",
        "    (post_id, created_at) [name: 'comments_post_id_created_at_desc_idx']",
        "    (created_at) [name: 'comments_created_at_asc_idx']",
        "    `to_tsvector('english', body)` [type: gin, name: 'comments_body_tsvector_idx']",
        "    (post_id) [type: btree, name: 'comments_post_id_ops_idx']",
        "  }",
      ].join("\n"),
    );
    expect(() => run(out, "svg")).not.toThrow();
  });

  it("spreads each file's own helper when two files declare one of the same name (#58)", () => {
    const a = stripImports(`import { pgTable, text } from "drizzle-orm/pg-core";

const scope = () => ({
  org_id: text("org_id").notNull(),
  account_id: text("account_id").notNull(),
});

export const messages = pgTable("messages", {
  ...scope(),
  subject: text("subject").notNull(),
});`);
    const b = stripImports(`import { pgTable, text } from "drizzle-orm/pg-core";

const scope = () => ({
  org_id: text("org_id").notNull(),
  installation_id: text("installation_id").notNull(),
  store_key: text("store_key").notNull(),
});

export const policies = pgTable("policies", {
  ...scope(),
  rule: text("rule").notNull(),
});`);
    expect(dbml(joinSources([a, b]))).toBe(
      [
        "Table messages {",
        "  org_id text [not null]",
        "  account_id text [not null]",
        "  subject text [not null]",
        "}",
        "",
        "Table policies {",
        "  org_id text [not null]",
        "  installation_id text [not null]",
        "  store_key text [not null]",
        "  rule text [not null]",
        "}",
      ].join("\n"),
    );
  });
});

describe("v1 relations and index names after 0.4.5 (#60, #61)", () => {
  it("writes a one() declared from the referenced side once, as the foreign key (#60)", () => {
    const code = stripImports(`import { relations } from "drizzle-orm/_relations";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("user", {
  id: text("id").primaryKey(),
});

export const userLinks = sqliteTable("userLink", {
  id: text("id").primaryKey(),
  userId: text("userId").unique().references(() => users.id, { onDelete: "cascade" }),
});

export const usersRelations = relations(users, ({ one }) => ({
  userLink: one(userLinks, { fields: [users.id], references: [userLinks.userId] }),
}));

export const userLinksRelations = relations(userLinks, ({ one }) => ({
  user: one(users, { fields: [userLinks.userId], references: [users.id] }),
}));`);
    const out = dbml(code);
    expect(out.match(/^Ref /gmu)).toStrictEqual(["Ref "]);
    expect(out).toContain(
      "Ref userLink_userId_user_id_fk: userLink.userId - user.id [delete: cascade]",
    );
    expect(() => run(out, "svg")).not.toThrow();
  });

  it("keeps one relation of two mirrored one()s without a foreign key, the key on its holder (#60)", () => {
    const code = stripImports(`import { relations } from "drizzle-orm/_relations";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("user", { id: text("id").primaryKey() });
export const userLinks = sqliteTable("userLink", {
  id: text("id").primaryKey(),
  userId: text("userId").unique(),
});

export const usersRelations = relations(users, ({ one }) => ({
  userLink: one(userLinks, { fields: [users.id], references: [userLinks.userId] }),
}));
export const userLinksRelations = relations(userLinks, ({ one }) => ({
  user: one(users, { fields: [userLinks.userId], references: [users.id] }),
}));`);
    const out = dbml(code);
    expect(out.match(/^Ref .*$/gmu)).toStrictEqual([
      "Ref userLink_userId_user_id: userLink.userId - user.id",
    ]);
  });

  it("names an index a helper builds from a constant object's member (#61)", () => {
    const code =
      stripImports(`import { index, integer, sqliteTable, uniqueIndex, type SQLiteColumn } from "drizzle-orm/sqlite-core";

const MediaType = { BOOKS: "books", GAMES: "games" } as const;
type MediaType = (typeof MediaType)[keyof typeof MediaType];

const listIndexes = (table: { userId: SQLiteColumn; mediaId: SQLiteColumn }, mediaTypeName: MediaType | string) => [
  uniqueIndex(\`ux_\${mediaTypeName}_list_user_media\`).on(table.userId, table.mediaId),
  index(\`ix_\${mediaTypeName}_list_media_id\`).on(table.mediaId),
];

export const booksList = sqliteTable(
  "books_list",
  { id: integer("id").primaryKey(), userId: integer("user_id").notNull(), mediaId: integer("media_id").notNull() },
  (table) => listIndexes(table, MediaType.BOOKS),
);`);
    expect(dbml(code)).toContain(
      [
        "  indexes {",
        "    (user_id, media_id) [unique, name: 'ux_books_list_user_media']",
        "    (media_id) [name: 'ix_books_list_media_id']",
        "  }",
      ].join("\n"),
    );
  });
});

describe("foreign keys, configs, expression indexes and column helpers after 0.4.6 (#64 to #67)", () => {
  it("keeps each foreign key's own action and the name foreignKey({ name }) gives it (#64)", () => {
    const code =
      stripImports(`import { foreignKey, pgTable, text, unique } from "drizzle-orm/pg-core";

export const teams = pgTable("teams", { id: text().primaryKey() });

export const categories = pgTable(
  "categories",
  { teamId: text("team_id").notNull(), slug: text().notNull() },
  (t) => [unique().on(t.teamId, t.slug)],
);

export const tx = pgTable(
  "tx",
  { id: text().primaryKey(), teamId: text("team_id").notNull(), slug: text() },
  (t) => [
    foreignKey({ columns: [t.teamId], foreignColumns: [teams.id], name: "tx_team_fk" }).onDelete("cascade"),
    foreignKey({ columns: [t.teamId, t.slug], foreignColumns: [categories.teamId, categories.slug], name: "tx_category_fk" }),
  ],
);`);
    const out = dbml(code);
    expect(out.match(/^Ref .*$/gmu)).toStrictEqual([
      "Ref tx_team_fk: tx.team_id > teams.id [delete: cascade]",
      "Ref tx_category_fk: tx.(team_id, slug) > categories.(team_id, slug)",
    ]);
    expect(() => run(out, "svg")).not.toThrow();
  });

  it("does not give a composite key the action of a .references() on its first column (#64)", () => {
    const code = stripImports(`import { foreignKey, pgTable, text } from "drizzle-orm/pg-core";

export const folder = pgTable(
  "folder",
  {
    id: text().primaryKey(),
    ownerId: text("owner_id").notNull(),
    parentId: text("parent_id").references((): AnyPgColumn => folder.id, { onDelete: "set null" }),
  },
  (t) => [
    foreignKey({ columns: [t.parentId, t.ownerId], foreignColumns: [t.id, t.ownerId], name: "folder_parent_owner_fk" }),
  ],
);`);
    const out = dbml(code);
    expect(out).toContain(
      "Ref folder_parent_id_folder_id_fk: folder.parent_id > folder.id [delete: set null]",
    );
    expect(out).toContain(
      "Ref folder_parent_owner_fk: folder.(parent_id, owner_id) > folder.(id, owner_id)",
    );
  });

  it("reads an extra config written as a block returning an array (#65)", () => {
    const code =
      stripImports(`import { index, jsonb, pgTable, primaryKey, text } from "drizzle-orm/pg-core";

export const blockArray = pgTable("block_array", { a: text().notNull(), b: jsonb().notNull() }, (t) => {
  return [primaryKey({ columns: [t.a] }), index("block_array_b_idx").on(t.b)];
});`);
    expect(dbml(code)).toBe(
      [
        "Table block_array {",
        "  a text [not null]",
        "  b jsonb [not null]",
        "  indexes {",
        "    (a) [pk]",
        "    (b) [name: 'block_array_b_idx']",
        "  }",
        "}",
      ].join("\n"),
    );
  });

  it("writes indexes on sql expressions given to .on() (#66)", () => {
    const code = stripImports(`import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text } from "drizzle-orm/pg-core";

export const exprIndex = pgTable("expr_index", { slug: text().notNull(), meta: jsonb() }, (t) => [
  index("expr_index_lower_slug_idx").on(sql\`lower(\${t.slug})\`),
  index("expr_index_meta_idx").on(sql\`(\${t.meta} ->> 'k')\`),
  index("expr_index_gin_idx").using("gin", sql\`to_tsvector('english', \${t.slug})\`),
]);`);
    const out = dbml(code);
    expect(out).toContain(
      [
        "  indexes {",
        "    `lower(slug)` [name: 'expr_index_lower_slug_idx']",
        "    `(meta ->> 'k')` [name: 'expr_index_meta_idx']",
        "    `to_tsvector('english', slug)` [type: gin, name: 'expr_index_gin_idx']",
        "  }",
      ].join("\n"),
    );
    expect(() => run(out, "svg")).not.toThrow();
  });

  it("writes an expression index a helper returns, and one mixing expressions and columns (#66)", () => {
    const code = stripImports(`import { sql, type SQL } from "drizzle-orm";
import { type AnyPgColumn, index, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";

function lower(column: AnyPgColumn): SQL {
  return sql\`lower(\${column})\`;
}

function gmail(column: AnyPgColumn): SQL {
  const address = lower(column);
  const isGmail = sql\`split_part(\${address}, '@', 2) = 'gmail.com'\`;
  return sql\`(CASE WHEN \${isGmail} THEN \${address} END)\`;
}

export const collaborator = pgTable("collaborator", { owner: text().notNull(), repo: text().notNull(), email: text().notNull() }, (table) => [
  index("collaborator_email_lower_idx").on(lower(table.email)),
  index("collaborator_gmail_idx").on(gmail(table.email)),
  uniqueIndex("uq_collaborator_owner_repo_email_ci").on(sql\`lower(\${table.owner})\`, sql\`lower(\${table.repo})\`, table.email),
]);`);
    const out = dbml(code);
    expect(out).toContain(
      [
        "  indexes {",
        "    `lower(email)` [name: 'collaborator_email_lower_idx']",
        "    `(CASE WHEN split_part(lower(email), '@', 2) = 'gmail.com' THEN lower(email) END)` [name: 'collaborator_gmail_idx']",
        "    `lower(owner), lower(repo), email` [unique, name: 'uq_collaborator_owner_repo_email_ci']",
        "  }",
      ].join("\n"),
    );
    expect(() => run(out, "svg")).not.toThrow();
  });

  it("reads a column a function with statements builds (#67)", () => {
    const code =
      stripImports(`import { type AnyPgColumn, pgTable, text } from "drizzle-orm/pg-core";

export const teams = pgTable("teams", { id: text().primaryKey() });

function teamIdColumn() {
  const column = text("team_id").references((): AnyPgColumn => teams.id, { onDelete: "restrict" });
  return process.env.X === "1" && process.env.Y === "1"
    ? (column as ReturnType<typeof column.notNull>)
    : column.notNull();
}

export const project = pgTable("project", { id: text().primaryKey(), teamId: teamIdColumn() });`);
    const out = dbml(code);
    expect(out).toContain(
      ["Table project {", "  id text [pk, not null]", "  team_id text [not null]", "}"].join("\n"),
    );
    expect(out).toContain(
      "Ref project_team_id_teams_id_fk: project.team_id > teams.id [delete: restrict]",
    );
  });
});
