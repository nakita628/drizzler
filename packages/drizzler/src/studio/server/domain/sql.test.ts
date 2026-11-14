import { describe, expect, it } from "vite-plus/test";
import {
  makeAnalysisSchema,
  makeExplainStatement,
  makeCell,
  makeDeleteStatement,
  makeConnection,
  makeConnectionKind,
  makeD1Target,
  makeDialect,
  makeLibsqlTarget,
  makeTlsRequired,
  makeInsertStatement,
  makeRedactedUrl,
  makeCountStatement,
  makeSelectStatement,
  makeSqlitePath,
  makeUpdateStatement,
} from "./sql.js";

const table = {
  table: "post_tags",
  columns: [
    { name: "postId", column: "post_id" },
    { name: "tagId", column: "tag_id" },
    { name: "note", column: "note" },
  ],
  key: ["postId", "tagId"],
};

describe("makeDialect", () => {
  it.each([
    ["postgres://u:p@h/db", "postgresql"],
    ["postgresql://h/db", "postgresql"],
    ["mysql://h/db", "mysql"],
    ["mariadb://h/db", "mysql"],
    ["file:./dev.db", "sqlite"],
    ["./local.sqlite", "sqlite"],
    ["libsql://app-ada.turso.io", "sqlite"],
    ["d1://account/database", "sqlite"],
    ["redis://h", null],
  ] as const)("reads %s as %s", (url, dialect) => {
    expect(makeDialect({ url })).toBe(dialect);
  });

  it("finds the SQLite file and hides passwords", () => {
    expect(makeSqlitePath({ url: "file:./dev.db" })).toBe("./dev.db");
    expect(makeSqlitePath({ url: "sqlite://data/app.db" })).toBe("data/app.db");
    expect(makeRedactedUrl({ url: "postgres://admin:s3cr3t@db:5432/app" })).toBe(
      "postgres://admin:****@db:5432/app",
    );
  });
});

describe("makeConnectionKind", () => {
  it.each([
    ["file:./dev.db", "sqlite"],
    [":memory:", "sqlite"],
    ["libsql://app-ada.turso.io?authToken=t", "libsql"],
    ["d1://0123abcd/5678-ef90", "d1"],
    ["postgres://u:p@ep-cool-1.us-east-2.aws.neon.tech/app?sslmode=require", "postgresql"],
    ["mysql://u:p@aws.connect.psdb.cloud/app", "mysql"],
    ["https://app-ada.turso.io", null],
  ] as const)("reads %s as %s", (url, kind) => {
    expect(makeConnectionKind({ url })).toBe(kind);
  });
});

describe("makeConnection", () => {
  const none = { TURSO_AUTH_TOKEN: null, CLOUDFLARE_D1_TOKEN: null, CLOUDFLARE_API_TOKEN: null };

  it("opens a SQLite file, and Neon with TLS", () => {
    expect(makeConnection({ url: "file:./dev.db", env: none })).toStrictEqual({
      kind: "sqlite",
      file: "./dev.db",
    });
    expect(
      makeConnection({ url: "postgres://u:p@ep-1.us-east-2.aws.neon.tech/app", env: none }),
    ).toStrictEqual({
      kind: "postgresql",
      url: "postgres://u:p@ep-1.us-east-2.aws.neon.tech/app",
      tls: true,
    });
  });

  it("takes Turso's token from the URL first, then TURSO_AUTH_TOKEN", () => {
    const env = { ...none, TURSO_AUTH_TOKEN: "from-env" };
    expect(makeConnection({ url: "libsql://app.turso.io?authToken=abc", env })).toStrictEqual({
      kind: "libsql",
      url: "libsql://app.turso.io",
      authToken: "abc",
    });
    expect(makeConnection({ url: "libsql://app.turso.io", env })).toStrictEqual({
      kind: "libsql",
      url: "libsql://app.turso.io",
      authToken: "from-env",
    });
    expect(makeConnection({ url: "libsql://app.turso.io", env: none })).toMatchObject({
      authToken: null,
    });
  });

  it("gives D1's endpoint, with the token from the URL, CLOUDFLARE_D1_TOKEN, then CLOUDFLARE_API_TOKEN", () => {
    const endpoint = "https://api.cloudflare.com/client/v4/accounts/acc/d1/database/db/raw";
    expect(makeConnection({ url: "d1://acc/db?token=url", env: none })).toStrictEqual({
      kind: "d1",
      endpoint,
      token: "url",
    });
    expect(
      makeConnection({
        url: "d1://acc/db",
        env: { ...none, CLOUDFLARE_D1_TOKEN: "d1", CLOUDFLARE_API_TOKEN: "api" },
      }),
    ).toMatchObject({ token: "d1" });
    expect(
      makeConnection({ url: "d1://acc/db", env: { ...none, CLOUDFLARE_API_TOKEN: "api" } }),
    ).toMatchObject({ token: "api" });
  });

  it("says why it cannot open a D1 URL without both ids or a token, or an unknown URL", () => {
    expect(makeConnection({ url: "d1://acc", env: none })).toMatchObject({
      kind: "unsupported",
      reason: expect.stringContaining("d1://<account id>/<database id>"),
    });
    expect(
      makeConnection({ url: "d1://acc/db", env: { ...none, CLOUDFLARE_D1_TOKEN: "" } }),
    ).toMatchObject({
      kind: "unsupported",
      reason: expect.stringContaining("CLOUDFLARE_D1_TOKEN"),
    });
    expect(makeConnection({ url: "redis://h", env: none })).toMatchObject({
      kind: "unsupported",
      reason: expect.stringContaining("libsql://"),
    });
  });
});

describe("makeLibsqlTarget", () => {
  it("takes the token out of the URL", () => {
    expect(makeLibsqlTarget({ url: "libsql://app-ada.turso.io?authToken=abc" })).toStrictEqual({
      url: "libsql://app-ada.turso.io",
      authToken: "abc",
    });
  });

  it("keeps the other parameters, and has no token when the URL has none", () => {
    expect(makeLibsqlTarget({ url: "libsql://127.0.0.1:8080?tls=0&authToken=abc" })).toStrictEqual({
      url: "libsql://127.0.0.1:8080?tls=0",
      authToken: "abc",
    });
    expect(makeLibsqlTarget({ url: "libsql://app-ada.turso.io" })).toStrictEqual({
      url: "libsql://app-ada.turso.io",
      authToken: null,
    });
  });
});

describe("makeD1Target", () => {
  it("reads the account, the database and the token", () => {
    expect(makeD1Target({ url: "d1://0123abcd/5678-ef90?token=secret" })).toStrictEqual({
      accountId: "0123abcd",
      databaseId: "5678-ef90",
      token: "secret",
    });
    expect(makeD1Target({ url: "d1://0123abcd/5678-ef90/" })).toStrictEqual({
      accountId: "0123abcd",
      databaseId: "5678-ef90",
      token: null,
    });
  });

  it.each(["d1://0123abcd", "d1://0123abcd/", "d1://0123abcd/a/b"])(
    "has no target for %s",
    (url) => {
      expect(makeD1Target({ url })).toBeNull();
    },
  );
});

describe("makeTlsRequired", () => {
  it.each([
    ["postgres://u:p@ep-cool-1.us-east-2.aws.neon.tech/app", true],
    ["postgres://u:p@ep-cool-1.us-east-2.aws.neon.tech/app?sslmode=require", false],
    ["mysql://u:p@aws.connect.psdb.cloud/app", true],
    ['mysql://u:p@aws.connect.psdb.cloud/app?ssl={"rejectUnauthorized":true}', false],
    ["postgres://u:p@us-east-3.pg.psdb.cloud/app", true],
    ["postgres://u:p@localhost/app", false],
    ["mysql://u:p@localhost/app", false],
  ] as const)("%s: %s", (url, required) => {
    expect(makeTlsRequired({ url })).toBe(required);
  });
});

describe("makeRedactedUrl", () => {
  it("hides the tokens Turso and D1 carry as parameters", () => {
    expect(makeRedactedUrl({ url: "libsql://app.turso.io?authToken=abc&tls=1" })).toBe(
      "libsql://app.turso.io?authToken=****&tls=1",
    );
    expect(makeRedactedUrl({ url: "d1://acc/db?token=secret" })).toBe("d1://acc/db?token=****");
  });
});

describe("makeCell", () => {
  it("writes the ArrayBuffer libSQL hands a blob back as in hex", () => {
    expect(makeCell({ value: new Uint8Array([0xde, 0xad]).buffer })).toBe("\\xdead");
  });
});

describe("statements", () => {
  it("orders a page by the key columns", () => {
    expect(makeSelectStatement({ dialect: "postgresql", table, skip: 20, take: 10 })).toStrictEqual(
      {
        sql: 'SELECT * FROM "post_tags" ORDER BY "post_id", "tag_id" LIMIT $1 OFFSET $2',
        params: [10, 20],
      },
    );
  });

  it("searches every column as text, escaping the wildcards, before the page", () => {
    expect(
      makeSelectStatement({ dialect: "postgresql", table, skip: 0, take: 10, search: "5%_off" }),
    ).toStrictEqual({
      sql:
        'SELECT * FROM "post_tags" WHERE CAST("post_id" AS TEXT) ILIKE $1 ESCAPE \'!\' OR ' +
        "CAST(\"tag_id\" AS TEXT) ILIKE $2 ESCAPE '!' OR CAST(\"note\" AS TEXT) ILIKE $3 ESCAPE '!' " +
        'ORDER BY "post_id", "tag_id" LIMIT $4 OFFSET $5',
      params: ["%5!%!_off%", "%5!%!_off%", "%5!%!_off%", 10, 0],
    });
    expect(makeCountStatement({ dialect: "mysql", table, search: "a" }).sql).toContain(
      "LOWER(CAST(`note` AS CHAR)) LIKE LOWER(?) ESCAPE '!'",
    );
    expect(makeCountStatement({ dialect: "sqlite", table, search: "" })).toStrictEqual({
      sql: 'SELECT COUNT(*) AS count FROM "post_tags"',
      params: [],
    });
  });

  it("numbers the PostgreSQL placeholders past the SET values, skipping IS NULL", () => {
    expect(
      makeUpdateStatement({
        dialect: "postgresql",
        table,
        where: { postId: 1, note: null, tagId: 2 },
        values: { note: "x" },
      }),
    ).toStrictEqual({
      sql: 'UPDATE "post_tags" SET "note" = $1 WHERE "post_id" = $2 AND "note" IS NULL AND "tag_id" = $3',
      params: ["x", 1, 2],
    });
  });

  it("quotes MySQL identifiers with backticks and SQLite booleans as numbers", () => {
    expect(makeDeleteStatement({ dialect: "mysql", table, where: { postId: 1 } })).toStrictEqual({
      sql: "DELETE FROM `post_tags` WHERE `post_id` = ?",
      params: [1],
    });
    expect(makeInsertStatement({ dialect: "sqlite", table, values: { note: true } })).toStrictEqual(
      {
        sql: 'INSERT INTO "post_tags" ("note") VALUES (?)',
        params: [1],
      },
    );
  });

  it("inserts the defaults when no value is given", () => {
    expect(makeInsertStatement({ dialect: "postgresql", table, values: {} }).sql).toBe(
      'INSERT INTO "post_tags" DEFAULT VALUES',
    );
    expect(makeInsertStatement({ dialect: "mysql", table, values: {} }).sql).toBe(
      "INSERT INTO `post_tags` () VALUES ()",
    );
  });

  it("escapes a quote inside an identifier", () => {
    const odd = { ...table, table: 'we"ird' };
    expect(makeDeleteStatement({ dialect: "sqlite", table: odd, where: { postId: 1 } }).sql).toBe(
      'DELETE FROM "we""ird" WHERE "post_id" = ?',
    );
  });
});

describe("makeCell", () => {
  it("turns driver values into what JSON can carry", () => {
    expect(makeCell({ value: new Date("2026-01-02T03:04:05Z") })).toBe("2026-01-02T03:04:05.000Z");
    expect(makeCell({ value: 42n })).toBe(42);
    expect(makeCell({ value: 2n ** 64n })).toBe("18446744073709551616");
    expect(makeCell({ value: new Uint8Array([0xde, 0xad]) })).toBe("\\xdead");
    expect(makeCell({ value: { a: 1 } })).toBe('{"a":1}');
    expect(makeCell({ value: undefined })).toBeNull();
    expect(makeCell({ value: Number.NaN })).toBe("NaN");
  });
});

describe("makeExplainStatement", () => {
  it("asks each database for the plan in the form it reads best", () => {
    expect(makeExplainStatement({ dialect: "sqlite", sql: "SELECT 1;" })).toBe(
      "EXPLAIN QUERY PLAN SELECT 1",
    );
    expect(makeExplainStatement({ dialect: "postgresql", sql: "SELECT 1" })).toBe(
      "EXPLAIN (FORMAT JSON) SELECT 1",
    );
    expect(makeExplainStatement({ dialect: "mysql", sql: "SELECT 1" })).toBe(
      "EXPLAIN FORMAT=JSON SELECT 1",
    );
  });
});

function field(name: string, type: string, extra = {}) {
  return {
    name,
    dbName: null,
    kind: "scalar" as const,
    type,
    isList: false,
    isRequired: true,
    ...extra,
  };
}

describe("makeAnalysisSchema", () => {
  it("names tables and columns as the database does and spells the builders as SQL types", () => {
    expect(
      makeAnalysisSchema({
        dialect: "postgresql",
        models: [
          {
            name: "post",
            dbName: "posts",
            fields: [
              field("authorId", "integer", { dbName: "author_id" }),
              field("score", "doublePrecision", { isRequired: false }),
              field("status", "status", { kind: "enum" }),
              field("tags", "text", { isList: true }),
              field("author", "user", { kind: "object" }),
            ],
          },
        ],
      }),
    ).toStrictEqual({
      dialect: "postgresql",
      tables: [
        {
          name: "posts",
          columns: [
            { name: "author_id", dataType: "integer", nullable: false },
            { name: "score", dataType: "double precision", nullable: true },
            { name: "status", dataType: "text", nullable: false },
            { name: "tags", dataType: "text[]", nullable: false },
          ],
        },
      ],
    });
  });
});
