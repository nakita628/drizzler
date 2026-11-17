import { NodeServices } from "@effect/platform-node";
import { Effect } from "effect";
import type { FileSystem } from "effect";
import { run } from "@softwaretechnik/dbml-renderer";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { dbml } from "../generator/index.js";
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
      "// Ref users_id_users_id_fk: users.id - users.id [delete: cascade] (a key from a column to itself, which DBML cannot express)",
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
