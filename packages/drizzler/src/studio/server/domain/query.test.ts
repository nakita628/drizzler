import { describe, expect, it } from "vite-plus/test";
import type { SchemaModel } from "../../../types/index.js";
import { makeQueryBody, makeQueryTouched, makeSchemaDialect, makeWorkingDialect } from "./query.js";

describe("makeQueryBody", () => {
  it("returns the last expression statement", () => {
    const code = "const n = 1;\ndb.select().from(user);";
    expect(
      makeQueryBody({
        code,
        error: null,
        last: { start: 13, end: 36, expression: { start: 13, end: 35 } },
      }),
    ).toStrictEqual({ body: "const n = 1;\nreturn (db.select().from(user));", error: null });
  });

  it("leaves a query that ends in another statement as it is", () => {
    expect(makeQueryBody({ code: "const n = 1;", error: null, last: null })).toStrictEqual({
      body: "const n = 1;",
      error: null,
    });
  });

  it("puts a syntax error on the query's own line and column", () => {
    expect(
      makeQueryBody({ code: "a;\nb(", error: { message: "Expected `)`", offset: 5 }, last: null }),
    ).toStrictEqual({ body: null, error: { message: "Expected `)`", line: 2, column: 3 } });
  });
});

describe("makeSchemaDialect", () => {
  it.each([
    ['pgTable("users", {})', "postgresql"],
    ['mysqlTable("users", {})', "mysql"],
    ['sqliteTable("users", {})', "sqlite"],
    ["export const x = 1;", null],
  ] as const)("%s → %s", (source, dialect) => {
    expect(makeSchemaDialect({ source })).toBe(dialect);
  });
});

function table(name: string, fields: readonly string[]): SchemaModel {
  return {
    name,
    dbName: name,
    primaryKey: null,
    fields: fields.map((field) => ({
      name: field,
      dbName: field,
      kind: "scalar",
      type: "text",
      isList: false,
      isRequired: true,
      isId: false,
      isForeignKey: false,
      documentation: null,
    })),
  };
}

describe("makeQueryTouched", () => {
  const models = [
    table("user", ["id", "name"]),
    table("post", ["id", "title", "authorId"]),
    table("comment", ["id", "body"]),
  ];
  const relationFields = [
    { table: "user", name: "posts", target: "post" },
    { table: "post", name: "comments", target: "comment" },
  ];

  it("touches the tables read by name, with the columns named on them", () => {
    expect(
      makeQueryTouched({
        models,
        relationFields,
        names: ["db", "post", "eq"],
        members: [
          { object: "post", property: "title" },
          { object: "post", property: "title" },
          { object: "post", property: "nope" },
        ],
        queries: [],
        withs: [],
        writes: [],
      }),
    ).toStrictEqual([{ table: "post", columns: ["title"], write: false }]);
  });

  it("follows db.query and nested with through the relations", () => {
    expect(
      makeQueryTouched({
        models,
        relationFields,
        names: ["db"],
        members: [],
        queries: ["user"],
        withs: ["comments", "posts"],
        writes: [],
      }).map((t) => t.table),
    ).toStrictEqual(["user", "post", "comment"]);
  });

  it("marks the tables written by insert, update and delete", () => {
    expect(
      makeQueryTouched({
        models,
        relationFields,
        names: ["db", "post", "user"],
        members: [],
        queries: [],
        withs: [],
        writes: ["post"],
      }).map((t) => [t.table, t.write]),
    ).toStrictEqual([
      ["user", false],
      ["post", true],
    ]);
  });

  it("touches nothing that is not a table", () => {
    expect(
      makeQueryTouched({
        models,
        relationFields,
        names: ["x"],
        members: [],
        queries: [],
        withs: ["posts"],
        writes: [],
      }),
    ).toStrictEqual([]);
  });
});

describe("makeWorkingDialect", () => {
  const pg = 'export const user = pgTable("user", {})';

  it("types Drizzle code for the schema, then the database, else PostgreSQL", () => {
    expect(makeWorkingDialect({ purpose: "query", connected: "mysql", source: pg })).toBe(
      "postgresql",
    );
    expect(makeWorkingDialect({ purpose: "query", connected: "mysql", source: "" })).toBe("mysql");
    expect(makeWorkingDialect({ purpose: "query", connected: null, source: "" })).toBe(
      "postgresql",
    );
  });

  it("analyses SQL for the database, then the schema, else SQLite", () => {
    expect(makeWorkingDialect({ purpose: "sql", connected: "mysql", source: pg })).toBe("mysql");
    expect(makeWorkingDialect({ purpose: "sql", connected: null, source: pg })).toBe("postgresql");
    expect(makeWorkingDialect({ purpose: "sql", connected: null, source: "" })).toBe("sqlite");
  });
});
