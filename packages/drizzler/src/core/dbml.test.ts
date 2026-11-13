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
    expect(content.includes("Table orderItem {")).toBe(true);

    // User columns
    expect(content.includes("id varchar [pk]")).toBe(true);
    expect(content.includes("name varchar")).toBe(true);
    expect(content.includes("email varchar")).toBe(true);

    // Order columns
    expect(content.includes("userId varchar")).toBe(true);
    expect(content.includes("total decimal")).toBe(true);
    expect(content.includes("createdAt timestamp")).toBe(true);

    // OrderItem columns
    expect(content.includes("orderId int")).toBe(true);
    expect(content.includes("productName varchar")).toBe(true);
    expect(content.includes("quantity int")).toBe(true);
    expect(content.includes("price decimal")).toBe(true);

    // Foreign key refs
    expect(content.includes("Ref order_userId_user_id_fk: order.userId > user.id")).toBe(true);
    expect(
      content.includes("Ref orderItem_orderId_order_id_fk: orderItem.orderId > order.id"),
    ).toBe(true);
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
    expect(content.includes("key text [pk]")).toBe(true);
    expect(content.includes("value text")).toBe(true);
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
  id uuid [pk, note: 'first comment line second comment line']
  email varchar [note: 'User\\'s email （連絡先）']
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
  id varchar [pk]
  name varchar
}

Table post {
  id varchar [pk]
  userId varchar
}

Table profile {
  id varchar [pk]
  user_id varchar
}

Ref post_userId_user_id_fk: post.userId > user.id

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
  id varchar [pk]
}

Table post {
  id varchar [pk]
  userId varchar
}

Ref post_userId_user_id_fk: post.userId > user.id`,
    );
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
