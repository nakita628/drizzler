import { NodeServices } from "@effect/platform-node";
import { Effect } from "effect";
import type { FileSystem } from "effect";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { stripImports } from "../schema/strip-imports.js";
import { drizzlerER } from "./er.js";

/** Runs what a core function returns, on the real file system. */
function runEffect<A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem>) {
  return Effect.runPromise(effect.pipe(Effect.provide(NodeServices.layer)));
}

const ecSchemaContent = `import { mysqlTable, varchar, int, decimal, timestamp } from 'drizzle-orm/mysql-core'

export const user = mysqlTable('user', {
  id: varchar('id', { length: 36 }).primaryKey(),
  name: varchar('name', { length: 50 }).notNull(),
})

export const order = mysqlTable('order', {
  id: int('id').primaryKey().autoincrement(),
  /// 注文したユーザー
  userId: varchar('user_id', { length: 36 }).notNull().references(() => user.id, { onDelete: 'cascade' }),
  total: decimal('total', { precision: 10, scale: 2 }).notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})`;

const singleTableSchema = `import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const config = sqliteTable('config', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})`;

describe("E2E: ER diagram generation", () => {
  let tmpdir: string;

  beforeEach(() => {
    tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "drizzler-e2e-er-"));
  });

  afterEach(() => {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  });

  it("generates valid PNG binary for EC schema", async () => {
    const output = path.join(tmpdir, "output", "er.png");
    await runEffect(drizzlerER(stripImports(ecSchemaContent), output));

    const buffer = fs.readFileSync(output);
    // PNG magic bytes: 89 50 4E 47 (‰PNG)
    expect([...buffer.subarray(0, 4)]).toStrictEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(buffer.length > 1000).toBe(true);
  });

  it("generates valid PNG for single-table schema", async () => {
    const output = path.join(tmpdir, "output", "config.png");
    await runEffect(drizzlerER(stripImports(singleTableSchema), output));

    expect([...fs.readFileSync(output).subarray(0, 4)]).toStrictEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it("generates an SVG with a card per table and the relation between them", async () => {
    const output = path.join(tmpdir, "output", "er.svg");
    await runEffect(drizzlerER(stripImports(ecSchemaContent), output));

    const svg = fs.readFileSync(output, "utf-8");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.match(/class="model-node"/g)?.length).toBe(2);
    expect(svg).toContain("on delete cascade");
    expect(svg).toContain("注文したユーザー");
    expect(svg).toContain(".defaultNow()");
  });

  it("draws the dark palette with --theme dark", async () => {
    const output = path.join(tmpdir, "er.svg");
    await runEffect(drizzlerER(stripImports(singleTableSchema), output, "dark"));

    expect(fs.readFileSync(output, "utf-8")).toContain("#0f1117");
  });
});
