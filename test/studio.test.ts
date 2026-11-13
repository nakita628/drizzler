import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { makeSqliteDatabase, SQLITE_SCHEMA } from "./fixtures.ts";
import {
  drizzler,
  freePort,
  makeProject,
  removeProject,
  requestWithHost,
  STUDIO_ASSETS,
  startStudio,
} from "./helpers.ts";

let project = "";
let port = 0;
let base = "";
let banner = "";
let stop: () => Promise<void> = async () => {};

beforeAll(async () => {
  project = makeProject({ "schema.ts": SQLITE_SCHEMA });
  makeSqliteDatabase({ dir: project, users: ["Ada", "Linus"] });
  port = await freePort();
  base = `http://127.0.0.1:${port}`;
  const studio = startStudio(
    ["studio", "schema.ts", "--url", "file:./dev.db", "--port", String(port)],
    project,
  );
  stop = studio.stop;
  banner = await studio.banner;
});

afterAll(async () => {
  await stop();
  removeProject(project);
});

function json(path: string, init?: { readonly method: string; readonly body: unknown }) {
  return fetch(`${base}${path}`, {
    method: init?.method ?? "GET",
    headers: { "content-type": "application/json" },
    body: init === undefined ? undefined : JSON.stringify(init.body),
  });
}

describe("drizzler studio, the packaged command", () => {
  it("says what it edits, where it listens and the database it is connected to", () => {
    expect(banner).toBe(`💧 drizzler studio is editing schema.ts at ${base}`);
  });

  it("serves the client on every page, so the client can route on the path", async () => {
    for (const page of ["/", "/tables/user", "/docs"]) {
      const res = await fetch(`${base}${page}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      expect(await res.text()).toContain('<div id="root">');
    }
  });

  // The editors colour TypeScript and SQL with the Monarch grammars Monaco registers on import.
  // A bundler that takes the package for side-effect free drops those imports, and the editors
  // lose their colours (and their completion with them), so the shipped chunks are checked.
  it("ships and serves the editors' TypeScript and SQL highlighting", async () => {
    const chunks = fs.readdirSync(STUDIO_ASSETS).filter((file) => file.endsWith(".js"));
    for (const postfix of [".ts", ".sql"]) {
      const grammar = chunks.find((file) =>
        fs
          .readFileSync(path.join(STUDIO_ASSETS, file), "utf8")
          .includes(`tokenPostfix:\`${postfix}\``),
      );
      expect(grammar, `a chunk with the ${postfix} grammar`).toBeDefined();
      const res = await fetch(`${base}/assets/${grammar}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("javascript");
    }
  });

  it("answers the schema and its rows from the database", async () => {
    const schema = await (await json("/api/schema")).json();
    expect(schema.source).toContain('sqliteTable("users"');

    const rows = await (await json("/api/db/rows/user?skip=0&take=10")).json();
    expect(rows.rows.map((row: { name: string }) => row.name)).toStrictEqual(["Ada", "Linus"]);
  });

  it("runs Drizzle code and SQL against the database", async () => {
    const drizzle = await (
      await json("/api/drizzle", {
        method: "POST",
        body: { code: "db.select({ name: user.name }).from(user).orderBy(user.id)" },
      })
    ).json();
    expect(drizzle.error).toBeNull();
    expect(drizzle.result).toStrictEqual([{ name: "Ada" }, { name: "Linus" }]);

    const sql = await (
      await json("/api/db/sql", {
        method: "POST",
        body: { sql: "select count(*) as n from users", params: [] },
      })
    ).json();
    expect(sql.rows).toStrictEqual([{ n: 2 }]);
  });

  it("answers a request that fails validation with a 422 problem", async () => {
    const res = await json("/api/schema", { method: "PUT", body: { source: 42 } });
    expect(res.status).toBe(422);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    const problem = await res.json();
    expect(problem.type).toBe("/problems/validation-failed");
    expect(problem.errors[0].field).toBe("source");
  });

  it("keeps an unknown API path a 404, not the client", async () => {
    expect((await json("/api/nope")).status).toBe(404);
  });

  it("refuses a request whose Host is not localhost", async () => {
    const res = await requestWithHost(`${base}/api/schema`, "evil.example");
    expect(res.status).toBe(403);
  });

  it("says the port is in use when another studio holds it", async () => {
    const { code, output } = await drizzler(
      ["studio", "schema.ts", "--port", String(port)],
      project,
    );
    expect(code).toBe(1);
    expect(output).toContain(`Port ${port} is in use. Pass --port to pick another.`);
  });
});
