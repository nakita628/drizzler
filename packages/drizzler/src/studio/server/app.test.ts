import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import studio from "./index.js";
import { configureStudio, connectDatabase } from "./usecases/studio.js";

const schema = `import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

/// People who sign in
export const user = sqliteTable('users', {
  /// Primary key
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
})

export const post = sqliteTable('posts', {
  id: integer('id').primaryKey(),
  authorId: integer('author_id').references(() => user.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
})
`;

const BASE = "http://127.0.0.1";

describe("drizzler studio API", () => {
  let dir: string;
  let file: string;
  let api: typeof studio;

  function request(method: string, url: string, body?: unknown) {
    return api.request(`${BASE}${url}`, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "drizzler-studio-api-"));
    file = path.join(dir, "schema.ts");
    fs.writeFileSync(file, schema);
    const dbFile = path.join(dir, "dev.db");
    const seed = new DatabaseSync(dbFile);
    seed.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE posts (id INTEGER PRIMARY KEY, author_id INTEGER REFERENCES users(id), title TEXT NOT NULL);
      INSERT INTO users (id, name) VALUES (1, 'Ada'), (2, 'Linus');
      INSERT INTO posts (id, author_id, title) VALUES (1, 1, 'Hello');
    `);
    seed.close();
    const database = await Effect.runPromise(connectDatabase({ url: `file:${dbFile}`, cwd: dir }));
    configureStudio({ schemaPath: file, cwd: dir, database });
    api = studio;
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("reads and writes the schema file", async () => {
    const read = await (await request("GET", "/api/schema")).json();
    expect(read).toStrictEqual({ path: file, file: "schema.ts", source: schema, parseError: null });

    const broken = `${schema}\nexport const x = (`;
    const written = await (await request("PUT", "/api/schema", { source: broken })).json();
    expect(fs.readFileSync(file, "utf-8")).toBe(broken);
    expect(written.parseError.line).toBe(17);
  });

  it("streams a change event when the schema file changes on disk, until the client leaves", async () => {
    const abort = new AbortController();
    const response = await api.request(`${BASE}/api/schema/events`, { signal: abort.signal });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    async function until(event: string, seen = ""): Promise<string> {
      if (seen.includes(`event: ${event}`)) return seen;
      const { value, done } = await reader.read();
      if (done) return seen;
      return until(event, seen + decoder.decode(value));
    }
    expect(await until("ready")).toContain("event: ready");
    // A later modification time than the file has, so the poll sees a change.
    const later = new Date(Date.now() + 5000);
    fs.writeFileSync(file, `${schema}\n// edited elsewhere\n`);
    fs.utimesSync(file, later, later);
    expect(await until("change")).toContain("event: change");
    abort.abort();
    await reader.cancel();
  });

  it("draws the diagram, and reports a syntax error instead of failing", async () => {
    const ok = await (
      await request("POST", "/api/diagram/svg", { source: schema, theme: "dark" })
    ).json();
    expect(ok.svg.startsWith("<svg")).toBe(true);
    expect(ok.svg).toContain("#0f1117");

    const bad = await (
      await request("POST", "/api/diagram/svg", { source: "export const = 1" })
    ).json();
    expect(bad.svg).toBeNull();
    expect(bad.parseError.line).toBe(1);

    const png = await request("POST", "/api/diagram/png", { source: "export const = 1" });
    expect(png.status).toBe(422);
    expect(png.headers.get("content-type")).toContain("application/problem+json");
  });

  it("formats with oxfmt's defaults when the project has no config", async () => {
    const formatted = await (
      await request("POST", "/api/format", { source: "export const a = {b:'x'}" })
    ).json();
    expect(formatted.source).toBe('export const a = { b: "x" };\n');
  });

  it("formats as the project's .oxfmtrc.jsonc says, and never writes it", async () => {
    const config = path.join(dir, ".oxfmtrc.jsonc");
    const text = '{\n  // the project\'s own\n  "semi": false,\n  "singleQuote": true,\n}\n';
    fs.writeFileSync(config, text);
    const formatted = await (
      await request("POST", "/api/format", { source: 'export const a = {b:"x"}' })
    ).json();
    expect(formatted.source).toBe("export const a = { b: 'x' }\n");
    expect(fs.readFileSync(config, "utf-8")).toBe(text);
  });

  it("answers a syntax error with a 422 problem", async () => {
    const res = await request("POST", "/api/format", { source: "export const = (" });
    expect(res.status).toBe(422);
    expect((await res.json()).errors[0].field).toBe("source");
  });

  it("rejects a body that fails validation with a 422 problem", async () => {
    const res = await request("PUT", "/api/schema", { source: 42 });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.type).toBe("/problems/validation-failed");
    expect(body.errors[0].field).toBe("source");
  });

  it("documents tables, columns and relations both ways", async () => {
    const docs = await (await request("GET", "/api/docs")).json();
    const [user, post] = docs.tables;
    expect(user.dbName).toBe("users");
    expect(user.description).toBe("People who sign in");
    expect(user.columns[0]).toMatchObject({
      name: "id",
      primaryKey: true,
      description: "Primary key",
    });
    expect(user.referencedBy).toStrictEqual([
      {
        table: "post",
        column: "id",
        otherColumn: "authorId",
        kind: "one to many",
        origin: "inferred",
        onDelete: "cascade",
        onUpdate: null,
      },
    ]);
    expect(post.columns[1].references).toStrictEqual({ table: "user", column: "id" });
  });

  it("reads, inserts, updates and deletes rows by property name", async () => {
    const status = await (await request("GET", "/api/db")).json();
    expect(status).toMatchObject({ connected: true, dialect: "sqlite", error: null });
    expect(status.tables[0]).toMatchObject({ name: "user", table: "users", key: ["id"] });

    expect((await (await request("GET", "/api/db/counts")).json()).counts).toStrictEqual({
      user: 2,
      post: 1,
    });

    const page = await (await request("GET", "/api/db/rows/post?skip=0&take=10")).json();
    expect(page).toStrictEqual({
      rows: [{ id: 1, authorId: 1, title: "Hello" }],
      total: 1,
      skip: 0,
      take: 10,
      search: "",
    });

    // A search reads any column as text, whatever its case, and counts what it matched.
    const found = await (
      await request("GET", "/api/db/rows/user?skip=0&take=10&search=ADA")
    ).json();
    expect(found).toMatchObject({ total: 1, search: "ADA" });
    expect(found.rows).toHaveLength(1);
    expect(
      (await (await request("GET", "/api/db/rows/user?skip=0&take=10&search=%25")).json()).total,
    ).toBe(0);

    const inserted = await request("POST", "/api/db/rows/user", {
      values: { id: 3, name: "Grace", active: false },
    });
    expect(await inserted.json()).toStrictEqual({ count: 1 });

    await request("PATCH", "/api/db/rows/user", { where: { id: 3 }, values: { name: "Grace H." } });
    await request("DELETE", "/api/db/rows/user", { where: { id: 2 } });

    const users = await (await request("GET", "/api/db/rows/user?skip=0&take=10")).json();
    expect(users.rows).toStrictEqual([
      { id: 1, name: "Ada", active: 1 },
      { id: 3, name: "Grace H.", active: 0 },
    ]);
  });

  it("answers 404 for an unknown table and 422 for an unknown column", async () => {
    const missing = await request("GET", "/api/db/rows/nope?skip=0&take=10");
    expect(missing.status).toBe(404);

    const unknown = await request("POST", "/api/db/rows/user", { values: { nope: 1 } });
    expect(unknown.status).toBe(422);
    expect((await unknown.json()).errors).toStrictEqual([
      { field: "values", message: "Unknown column of user: nope" },
    ]);
  });

  it("runs SQL, and reports a rejected statement as 503 with its message", async () => {
    const result = await (
      await request("POST", "/api/db/sql", { sql: "SELECT name FROM users ORDER BY id" })
    ).json();
    expect(result).toMatchObject({
      columns: ["name"],
      rows: [{ name: "Ada" }, { name: "Linus" }],
      rowCount: 2,
    });

    const write = await (
      await request("POST", "/api/db/sql", { sql: "UPDATE users SET active = 0" })
    ).json();
    expect(write).toMatchObject({ columns: [], rowCount: 2 });

    const bad = await request("POST", "/api/db/sql", { sql: "SELECT * FROM nope" });
    expect(bad.status).toBe(503);
    expect((await bad.json()).detail).toContain("no such table");
  });

  it("runs several statements with values bound, explains one and analyzes them", async () => {
    const last = await (
      await request("POST", "/api/db/sql", {
        sql: "SELECT 1 AS a; SELECT name FROM users WHERE id = ?",
        params: [1],
      })
    ).json();
    expect(last).toMatchObject({ columns: ["name"], rows: [{ name: "Ada" }], rowCount: 1 });

    const empty = await request("POST", "/api/db/sql", { sql: ";;" });
    expect(empty.status).toBe(422);

    const plan = await (
      await request("POST", "/api/db/explain", {
        sql: "SELECT * FROM users WHERE id = ?",
        params: [1],
      })
    ).json();
    expect(plan.dialect).toBe("sqlite");
    expect(plan.nodes.length).toBeGreaterThan(0);

    const analysis = await (
      await request("POST", "/api/db/analyze", {
        sql: "SELECT u.name, u.nmae FROM users u WHERE u.id = ?",
      })
    ).json();
    const [statement] = analysis.statements;
    expect(statement.kind).toBe("select");
    expect(statement.tables[0]).toMatchObject({ name: "users", known: true });
    expect(statement.parameters).toHaveLength(1);
    expect(statement.diagnostics.map((d: { message: string }) => d.message).join()).toContain(
      "nmae",
    );
  });

  it("answers 503 for the data routes without a database", async () => {
    const database = await Effect.runPromise(connectDatabase({ url: null, cwd: dir }));
    configureStudio({ schemaPath: file, cwd: dir, database });
    const res = await request("GET", "/api/db/counts");
    expect(res.status).toBe(503);
    expect((await (await request("GET", "/api/db")).json()).connected).toBe(false);
  });

  it("refuses a request for another host name", async () => {
    const res = await api.request("http://evil.example/api/schema");
    expect(res.status).toBe(403);
  });
});
