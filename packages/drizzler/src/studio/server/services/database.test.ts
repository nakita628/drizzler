import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { makeConnection } from "../domain/sql.js";
import type { Driver } from "./database.js";
import { openDriver } from "./database.js";

// The package directory, where its dev dependency `@libsql/client` resolves as a project's would.
const PACKAGE_DIR = path.resolve(import.meta.dirname, "../../../..");

function run<A, E>(effect: Effect.Effect<A, E>) {
  return Effect.runPromise(effect);
}

function fail<A, E>(effect: Effect.Effect<A, E>) {
  return Effect.runPromise(Effect.flip(effect));
}

const SETUP = [
  "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE)",
  "CREATE TABLE posts (id INTEGER PRIMARY KEY, author_id INTEGER NOT NULL, name TEXT NOT NULL)",
];

/** What every SQLite-speaking driver must do alike, whatever carries the statements. */
function sharedBehaviour(
  open: () => Promise<Driver>,
  // D1 says which statement failed in its own words, not by its index.
  options: { readonly namesStatement: boolean } = { namesStatement: true },
) {
  let driver: Driver;

  beforeAll(async () => {
    driver = await open();
    await run(driver.transaction(SETUP.map((sql) => ({ sql, params: [] }))));
  });

  afterAll(async () => {
    await run(driver.close);
  });

  it("writes in one transaction, and reads the rows by name and in column order", async () => {
    await run(
      driver.transaction([
        { sql: "INSERT INTO users (id, name) VALUES (?, ?)", params: [1, "Ada"] },
        {
          sql: "INSERT INTO posts (id, author_id, name) VALUES (?, ?, ?)",
          params: [1, 1, "Engines"],
        },
      ]),
    );
    expect(
      await run(driver.query({ sql: "SELECT id, name FROM users WHERE id = ?", params: [1] })),
      // node:sqlite's rows have no prototype: compared by their fields.
    ).toEqual({ columns: ["id", "name"], rows: [{ id: 1, name: "Ada" }], rowCount: 1 });
    // Two columns of one name both survive as arrays.
    expect(
      await run(
        driver.queryArrays({
          sql: "SELECT u.name, p.name FROM users u JOIN posts p ON p.author_id = u.id",
          params: [],
        }),
      ),
    ).toStrictEqual({
      columns: ["name", "name"],
      rows: [["Ada", "Engines"]],
      rowCount: 1,
      insertId: null,
    });
  });

  it("counts a write and gives the inserted row's id", async () => {
    expect(
      await run(
        driver.queryArrays({
          sql: "INSERT INTO users (id, name) VALUES (?, ?)",
          params: [7, "Linus"],
        }),
      ),
    ).toStrictEqual({ columns: [], rows: [], rowCount: 1, insertId: 7 });
    expect(
      await run(driver.query({ sql: "UPDATE users SET name = name || '!'", params: [] })),
    ).toStrictEqual({ columns: [], rows: [], rowCount: 2 });
  });

  it("rolls every statement back when one is refused, and names it", async () => {
    const error = await fail(
      driver.transaction([
        { sql: "INSERT INTO users (id, name) VALUES (?, ?)", params: [20, "Grace"] },
        { sql: "INSERT INTO users (id, name) VALUES (?, ?)", params: [21, "Ada!"] },
      ]),
    );
    expect(error.cause).toMatch(/UNIQUE/u);
    expect(error.cause.includes("while running: INSERT INTO users")).toBe(options.namesStatement);
    expect(
      await run(driver.query({ sql: "SELECT id FROM users WHERE id = ?", params: [20] })),
    ).toMatchObject({ rowCount: 0 });
  });
}

describe("node:sqlite", () => {
  sharedBehaviour(() =>
    run(openDriver({ connection: { kind: "sqlite", file: ":memory:" }, cwd: "." })),
  );
});

describe("Turso (@libsql/client)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "drizzler-libsql-"));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  // The same client a libsql:// URL opens, on a local file: no Turso account needed.
  sharedBehaviour(() =>
    run(
      openDriver({
        connection: { kind: "libsql", url: `file:${path.join(dir, "turso.db")}`, authToken: null },
        cwd: PACKAGE_DIR,
      }),
    ),
  );
});

type Call = { readonly url: string; readonly headers: Headers; readonly body: unknown };

/** A Cloudflare D1 `/raw` endpoint that answers from node:sqlite, recording each request. */
async function fakeD1(calls: Call[]) {
  const backing = await run(
    openDriver({ connection: { kind: "sqlite", file: ":memory:" }, cwd: "." }),
  );
  type Query = { readonly sql: string; readonly params?: readonly unknown[] };
  return vi.fn<(input: string, init: RequestInit) => Promise<Response>>(async (input, init) => {
    const body: unknown = JSON.parse(typeof init.body === "string" ? init.body : "null");
    calls.push({ url: input, headers: new Headers(init.headers), body });
    const queries: Query[] =
      typeof body === "object" && body !== null && "batch" in body
        ? (body.batch as Query[])
        : [body as Query];
    const statements = queries.map((query) => ({ sql: query.sql, params: query.params ?? [] }));
    const [first] = statements;
    // D1 runs a batch as one transaction.
    const answered =
      statements.length > 1 || first === undefined
        ? Effect.as(backing.transaction(statements), [])
        : Effect.map(backing.queryArrays(first), (result) => [
            {
              results: { columns: result.columns, rows: result.rows },
              meta: { changes: result.rowCount, last_row_id: result.insertId ?? 0 },
              success: true,
            },
          ]);
    return run(
      answered.pipe(
        Effect.match({
          onSuccess: (result) => Response.json({ success: true, errors: [], messages: [], result }),
          // D1's message is the database's own, without the statement it was running.
          onFailure: (error) =>
            Response.json(
              {
                success: false,
                errors: [{ code: 7500, message: error.cause.split("\n")[0] }],
                messages: [],
                result: [],
              },
              { status: 400 },
            ),
        }),
      ),
    );
  });
}

describe("Cloudflare D1 (HTTP API)", () => {
  const calls: Call[] = [];

  beforeAll(async () => {
    vi.stubGlobal("fetch", await fakeD1(calls));
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  sharedBehaviour(
    () =>
      run(
        openDriver({
          connection: makeConnection({ url: "d1://acc-1/db-2?token=secret" }),
          cwd: ".",
        }),
      ),
    { namesStatement: false },
  );

  it("posts to the database's /raw endpoint with the token, a batch as one request", () => {
    expect(calls[0]).toMatchObject({
      url: "https://api.cloudflare.com/client/v4/accounts/acc-1/d1/database/db-2/raw",
      body: { sql: "SELECT 1", params: [] },
    });
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer secret");
    expect(calls[1]?.body).toStrictEqual({
      batch: SETUP.map((sql) => ({ sql, params: [] })),
    });
  });
});

describe("Cloudflare D1, before it connects", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("needs both ids in the URL", async () => {
    const error = await fail(
      openDriver({ connection: makeConnection({ url: "d1://acc-1" }), cwd: "." }),
    );
    expect(error.reason).toContain("d1://<account id>/<database id>");
  });

  it("needs a token, from the URL or the environment", async () => {
    vi.stubEnv("CLOUDFLARE_D1_TOKEN", "");
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "");
    const error = await fail(
      openDriver({ connection: makeConnection({ url: "d1://acc/db" }), cwd: "." }),
    );
    expect(error.reason).toContain("CLOUDFLARE_D1_TOKEN");
  });

  it("takes the token from CLOUDFLARE_D1_TOKEN, and says what Cloudflare refused", async () => {
    vi.stubEnv("CLOUDFLARE_D1_TOKEN", "from-env");
    const fetch = vi.fn<(input: string, init: RequestInit) => Promise<Response>>(async () =>
      Response.json(
        { success: false, errors: [{ code: 10000, message: "Authentication error" }], result: [] },
        { status: 403 },
      ),
    );
    vi.stubGlobal("fetch", fetch);
    const error = await fail(
      openDriver({ connection: makeConnection({ url: "d1://acc/db" }), cwd: "." }),
    );
    expect(error.reason).toBe("Authentication error (10000)");
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get("authorization")).toBe(
      "Bearer from-env",
    );
  });
});

describe("an unknown URL", () => {
  it("lists the URLs drizzler opens", async () => {
    const error = await fail(
      openDriver({ connection: makeConnection({ url: "redis://h" }), cwd: "." }),
    );
    expect(error.reason).toContain("libsql://");
    expect(error.reason).toContain("d1://");
  });
});
