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
    fs.writeFileSync(path.join(tmpdir, "schema.ts"), ecSchemaContent, "utf-8");
    const output = path.join(tmpdir, "output", "schema.dbml");

    const code = stripImports(ecSchemaContent);
    await runEffect(drizzlerDbml(code, output));

    expect(fs.existsSync(output)).toBe(true);

    const content = fs.readFileSync(output, "utf-8");

    // Tables exist
    expect(content.includes("Table user {")).toBe(true);
    expect(content.includes("Table order {")).toBe(true);
    expect(content.includes("Table order_item {")).toBe(true);

    // User columns
    expect(content.includes("id varchar [pk, not null]")).toBe(true);
    expect(content.includes("name varchar [not null]")).toBe(true);
    expect(content.includes("email varchar [not null]")).toBe(true);

    // Order columns
    expect(content.includes("user_id varchar [not null]")).toBe(true);
    expect(content.includes("total decimal [not null]")).toBe(true);
    expect(content.includes("created_at timestamp [not null]")).toBe(true);

    // OrderItem columns
    expect(content.includes("order_id integer [not null]")).toBe(true);
    expect(content.includes("product_name varchar [not null]")).toBe(true);
    expect(content.includes("quantity integer [not null]")).toBe(true);
    expect(content.includes("price decimal [not null]")).toBe(true);

    // Foreign key refs
    expect(content.includes("Ref order_user_id_user_id_fk: order.user_id > user.id")).toBe(true);
    expect(
      content.includes("Ref order_item_order_id_order_id_fk: order_item.order_id > order.id"),
    ).toBe(true);
    expect(() => run(content, "svg")).not.toThrow();
  });

  it("generates DBML with field descriptions as notes for auth schema", async () => {
    fs.writeFileSync(path.join(tmpdir, "schema.ts"), pgAuthSchema, "utf-8");
    const output = path.join(tmpdir, "output", "auth.dbml");

    const code = stripImports(pgAuthSchema);
    await runEffect(drizzlerDbml(code, output));

    const content = fs.readFileSync(output, "utf-8");

    expect(content.includes("Table account {")).toBe(true);
    expect(content.includes("note: 'Primary key'")).toBe(true);
    expect(content.includes("note: 'User email address'")).toBe(true);
  });

  it("generates DBML for single-table schema without refs", async () => {
    fs.writeFileSync(path.join(tmpdir, "schema.ts"), singleTableSchema, "utf-8");
    const output = path.join(tmpdir, "output", "config.dbml");

    const code = stripImports(singleTableSchema);
    await runEffect(drizzlerDbml(code, output));

    const content = fs.readFileSync(output, "utf-8");

    expect(content.includes("Table config {")).toBe(true);
    expect(content.includes("key text [pk, not null]")).toBe(true);
    expect(content.includes("value text [not null]")).toBe(true);
    // No Ref lines
    expect(content.includes("Ref ")).toBe(false);
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
