import { NodeServices } from "@effect/platform-node";
import { Effect } from "effect";
import type { FileSystem } from "effect";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { mermaidRelationSymbol } from "../generator/index.js";
import { stripImports } from "../schema/strip-imports.js";
import { drizzlerMermaidER } from "./mermaid-er.js";

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

const TEST_CODE = [
  "export const user = mysqlTable('user', {",
  "  /// Primary key",
  "  /// @z.uuid()",
  "  /// @v.pipe(v.string(), v.uuid())",
  "  id: varchar('id', { length: 36 }).primaryKey(),",
  "  /// Display name",
  "  /// @z.string().min(1).max(50)",
  "  /// @v.pipe(v.string(), v.minLength(1), v.maxLength(50))",
  "  name: varchar('name', { length: 50 }).notNull(),",
  "})",
  "",
  "export const post = mysqlTable('post', {",
  "  /// Primary key",
  "  /// @z.uuid()",
  "  /// @v.pipe(v.string(), v.uuid())",
  "  id: varchar('id', { length: 36 }).primaryKey(),",
  "  /// Article title",
  "  /// @z.string().min(1).max(100)",
  "  /// @v.pipe(v.string(), v.minLength(1), v.maxLength(100))",
  "  title: varchar('title', { length: 100 }).notNull(),",
  "  /// Body content (no length limit)",
  "  /// @z.string()",
  "  /// @v.string()",
  "  content: varchar('content', { length: 65535 }).notNull(),",
  "  /// Foreign key referencing User.id",
  "  /// @z.uuid()",
  "  /// @v.pipe(v.string(), v.uuid())",
  "  userId: varchar('user_id', { length: 36 }).notNull().references(() => user.id),",
  "})",
  "",
];

const TEST_CODE_WITHOUT_COMMENTS = [
  "export const user = mysqlTable('user', {",
  "  id: varchar('id', { length: 36 }).primaryKey(),",
  "  name: varchar('name', { length: 50 }).notNull(),",
  "})",
  "",
  "export const post = mysqlTable('post', {",
  "  id: varchar('id', { length: 36 }).primaryKey(),",
  "  title: varchar('title', { length: 100 }).notNull(),",
  "  content: varchar('content', { length: 65535 }).notNull(),",
  "  userId: varchar('user_id', { length: 36 }).notNull().references(() => user.id),",
  "})",
  "",
];

// Test code with foreignKey() constraints
const TEST_CODE_WITH_FOREIGN_KEY = [
  "import { foreignKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'",
  "",
  "export const User = sqliteTable('User', {",
  "  id: text('id').notNull().primaryKey(),",
  "  name: text('name').notNull(),",
  "})",
  "",
  "export const Post = sqliteTable(",
  "  'Post',",
  "  {",
  "    id: text('id').notNull().primaryKey(),",
  "    body: text('body').notNull(),",
  "    userId: text('userId').notNull(),",
  "  },",
  "  (Post) => ({",
  "    Post_user_fkey: foreignKey({",
  "      name: 'Post_user_fkey',",
  "      columns: [Post.userId],",
  "      foreignColumns: [User.id],",
  "    })",
  '      .onDelete("cascade")',
  '      .onUpdate("cascade"),',
  "  }),",
  ")",
  "",
];

// Test code with a defineRelations export
const TEST_CODE_WITH_RELATIONS_BLOCK = [
  "import { defineRelations } from 'drizzle-orm'",
  "import { sqliteTable, text } from 'drizzle-orm/sqlite-core'",
  "",
  "export const User = sqliteTable('User', {",
  "  id: text('id').notNull().primaryKey(),",
  "  name: text('name').notNull(),",
  "})",
  "",
  "export const Post = sqliteTable('Post', {",
  "  id: text('id').notNull().primaryKey(),",
  "  body: text('body').notNull(),",
  "  userId: text('userId').notNull(),",
  "})",
  "",
  "export const PostRelations = defineRelations({ Post, User }, (r) => ({",
  "  Post: {",
  "    user: r.one.User({ from: r.Post.userId, to: r.User.id }),",
  "  },",
  "}))",
  "",
];

// Test code without imports (simulates how drizzler actually processes code)
const TEST_CODE_WITHOUT_IMPORTS = [
  "export const User = sqliteTable('User', {",
  "  id: text('id').notNull().primaryKey(),",
  "  name: text('name').notNull(),",
  "})",
  "",
  "export const Post = sqliteTable(",
  "  'Post',",
  "  {",
  "    id: text('id').notNull().primaryKey(),",
  "    body: text('body').notNull(),",
  "    userId: text('userId').notNull(),",
  "  },",
  "  (Post) => ({",
  "    Post_user_fkey: foreignKey({",
  "      name: 'Post_user_fkey',",
  "      columns: [Post.userId],",
  "      foreignColumns: [User.id],",
  "    })",
  '      .onDelete("cascade")',
  '      .onUpdate("cascade"),',
  "  }),",
  ")",
  "",
  "export const PostRelations = defineRelations({ Post, User }, (r) => ({",
  "  Post: {",
  "    user: r.one.User({ from: r.Post.userId, to: r.User.id }),",
  "  },",
  "}))",
  "",
];

describe("drizzlerMermaidER", () => {
  afterEach(() => {
    if (fs.existsSync("tmp-mermaid/mermaid-er-test.md")) {
      fs.unlinkSync("tmp-mermaid/mermaid-er-test.md");
    }
    if (fs.existsSync("tmp-mermaid")) {
      fs.rmSync("tmp-mermaid", { recursive: true, force: true });
    }
  });
  it("drizzlerMermaidER", async () => {
    await runEffect(drizzlerMermaidER(TEST_CODE, "tmp-mermaid/mermaid-er-test.md"));
    const result = await fsp.readFile("tmp-mermaid/mermaid-er-test.md", "utf-8");
    const expected = `\`\`\`mermaid
erDiagram
    user ||--|{ post : "(id) - (userId)"
    user {
        varchar id PK "Primary key"
        varchar name "Display name"
    }
    post {
        varchar id PK "Primary key"
        varchar title "Article title"
        varchar content "Body content (no length limit)"
        varchar userId FK "Foreign key referencing User.id"
    }
\`\`\`
`;
    expect(result).toBe(expected);
  });

  it("drizzlerMermaidER without comments", async () => {
    await runEffect(
      drizzlerMermaidER(TEST_CODE_WITHOUT_COMMENTS, "tmp-mermaid/mermaid-er-test.md"),
    );
    const result = await fsp.readFile("tmp-mermaid/mermaid-er-test.md", "utf-8");
    const expected = `\`\`\`mermaid
erDiagram
    user ||--|{ post : "(id) - (userId)"
    user {
        varchar id PK
        varchar name
    }
    post {
        varchar id PK
        varchar title
        varchar content
        varchar userId FK
    }
\`\`\`
`;
    expect(result).toBe(expected);
  });

  it("detects relations from foreignKey() constraints", async () => {
    await runEffect(
      drizzlerMermaidER(TEST_CODE_WITH_FOREIGN_KEY, "tmp-mermaid/mermaid-er-test.md"),
    );
    const result = await fsp.readFile("tmp-mermaid/mermaid-er-test.md", "utf-8");
    const expected = `\`\`\`mermaid
erDiagram
    User ||--|{ Post : "(id) - (userId)"
    User {
        text id PK
        text name
    }
    Post {
        text id PK
        text body
        text userId
    }
\`\`\`
`;
    expect(result).toBe(expected);
  });

  it("detects relations from defineRelations exports", async () => {
    await runEffect(
      drizzlerMermaidER(TEST_CODE_WITH_RELATIONS_BLOCK, "tmp-mermaid/mermaid-er-test.md"),
    );
    const result = await fsp.readFile("tmp-mermaid/mermaid-er-test.md", "utf-8");
    const expected = `\`\`\`mermaid
erDiagram
    User ||..|{ Post : "(id) - (userId)"
    User {
        text id PK
        text name
    }
    Post {
        text id PK
        text body
        text userId
    }
\`\`\`
`;
    expect(result).toBe(expected);
  });

  it("detects relations without imports (simulates real usage)", async () => {
    await runEffect(drizzlerMermaidER(TEST_CODE_WITHOUT_IMPORTS, "tmp-mermaid/mermaid-er-test.md"));
    const result = await fsp.readFile("tmp-mermaid/mermaid-er-test.md", "utf-8");
    const expected = `\`\`\`mermaid
erDiagram
    User ||--|{ Post : "(id) - (userId)"
    User {
        text id PK
        text name
    }
    Post {
        text id PK
        text body
        text userId
    }
\`\`\`
`;
    expect(result).toBe(expected);
  });
});

describe("E2E: Mermaid ER generation", () => {
  let tmpdir: string;

  beforeEach(() => {
    tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "drizzler-e2e-mermaid-"));
  });

  afterEach(() => {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  });

  it("generates Mermaid ER with full erDiagram block for EC schema", async () => {
    fs.writeFileSync(path.join(tmpdir, "schema.ts"), ecSchemaContent, "utf-8");
    const output = path.join(tmpdir, "output", "ER.md");

    const code = stripImports(ecSchemaContent);
    await runEffect(drizzlerMermaidER(code, output));

    expect(fs.existsSync(output)).toBe(true);

    const content = fs.readFileSync(output, "utf-8");

    // Mermaid structure
    expect(content.startsWith("```mermaid\nerDiagram")).toBe(true);
    expect(content.endsWith("```\n")).toBe(true);

    // Relations (user -> order, order -> orderItem)
    expect(content.includes('user ||--|{ order : "(id) - (userId)"')).toBe(true);
    expect(content.includes('order ||--|{ orderItem : "(id) - (orderId)"')).toBe(true);

    // Table definitions
    expect(content.includes("user {")).toBe(true);
    expect(content.includes("order {")).toBe(true);
    expect(content.includes("orderItem {")).toBe(true);

    // Field details
    expect(content.includes("varchar id PK")).toBe(true);
    expect(content.includes("varchar name")).toBe(true);
    expect(content.includes("varchar userId FK")).toBe(true);
    expect(content.includes("int orderId FK")).toBe(true);
  });

  it("generates Mermaid ER for single-table schema without relations", async () => {
    fs.writeFileSync(path.join(tmpdir, "schema.ts"), singleTableSchema, "utf-8");
    const output = path.join(tmpdir, "output", "ER.md");

    const code = stripImports(singleTableSchema);
    await runEffect(drizzlerMermaidER(code, output));

    const content = fs.readFileSync(output, "utf-8");

    expect(content.startsWith("```mermaid\nerDiagram")).toBe(true);
    expect(content.endsWith("```\n")).toBe(true);
    expect(content.includes("config {")).toBe(true);
    expect(content.includes("text key PK")).toBe(true);
    expect(content.includes("text value")).toBe(true);
    // No relation lines (no ||-- pattern)
    expect(content.includes("||--")).toBe(false);
  });

  it("generates Mermaid ER with field descriptions for auth schema", async () => {
    fs.writeFileSync(path.join(tmpdir, "schema.ts"), pgAuthSchema, "utf-8");
    const output = path.join(tmpdir, "output", "ER.md");

    const code = stripImports(pgAuthSchema);
    await runEffect(drizzlerMermaidER(code, output));

    const content = fs.readFileSync(output, "utf-8");

    expect(content.includes("account {")).toBe(true);
    expect(content.includes('uuid id PK "Primary key"')).toBe(true);
    expect(content.includes('varchar email "User email address"')).toBe(true);
  });
});

// Locks the Mermaid crow's-foot spec: the right side is the MIRROR of the left
// (e.g. "one or more" is `}|` on the left but `|{` on the right), and an
// identifying relation uses `--` while a non-identifying one uses `..`.
// https://mermaid.js.org/syntax/entityRelationshipDiagram.html
describe("mermaidRelationSymbol", () => {
  const cases = [
    { from: "zero-one", to: "zero-one", identifying: true, expected: "|o--o|" },
    { from: "one", to: "one", identifying: true, expected: "||--||" },
    { from: "zero-many", to: "zero-many", identifying: true, expected: "}o--o{" },
    { from: "many", to: "many", identifying: true, expected: "}|--|{" },
    { from: "one", to: "many", identifying: true, expected: "||--|{" },
    { from: "many", to: "one", identifying: true, expected: "}|--||" },
    { from: "zero-one", to: "many", identifying: false, expected: "|o..|{" },
    { from: "one", to: "zero-many", identifying: false, expected: "||..o{" },
  ] as const;
  it.each(cases)("renders $from -> $to (identifying=$identifying) as $expected", (c) => {
    expect(
      mermaidRelationSymbol({
        from: { cardinality: c.from },
        to: { cardinality: c.to },
        identifying: c.identifying,
      }),
    ).toBe(c.expected);
  });
});
