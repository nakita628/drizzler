import { describe, expect, it } from "vite-plus/test";
import type { SchemaField, SchemaModel } from "../../../types/index.js";
import { makeDbTables, makeDocs } from "./docs.js";

function column(name: string, rest: Partial<SchemaField> = {}): SchemaField {
  return {
    name,
    dbName: name,
    kind: "scalar",
    type: "text",
    isList: false,
    isRequired: true,
    isId: false,
    isForeignKey: false,
    documentation: null,
    ...rest,
  };
}

const user: SchemaModel = {
  name: "user",
  dbName: "users",
  primaryKey: null,
  fields: [
    column("id", { type: "integer", isId: true }),
    column("email", { isUnique: true }),
    column("createdAt", { type: "timestamp", attributes: [".defaultNow()"] }),
  ],
};

describe("makeDbTables", () => {
  it("identifies a row by its primary key, else its unique columns, else all of them", () => {
    const noKey = { ...user, fields: user.fields.map((f) => ({ ...f, isId: false })) };
    const bare = { ...noKey, fields: noKey.fields.map((f) => ({ ...f, isUnique: false })) };
    expect(makeDbTables({ models: [user, noKey, bare] }).map((t) => t.key)).toStrictEqual([
      ["id"],
      ["email"],
      ["id", "email", "createdAt"],
    ]);
  });
});

function queries(relationNames: readonly string[]) {
  return Object.fromEntries(
    makeDocs({
      models: [user],
      relations: [],
      enums: [],
      relationFields: relationNames.map((name) => ({ table: "user", name, target: "post" })),
    }).tables[0]?.queries.map((q) => [q.name, q.code]) ?? [],
  );
}

describe("makeDocs", () => {
  it("offers queries with nothing to fill in", () => {
    expect(queries(["posts"])).toStrictEqual({
      Select: "db.select().from(user)",
      Count: "db.$count(user)",
      "Find many": "db.query.user.findMany()",
      "With relations": "db.query.user.findMany({ with: { posts: true } })",
    });
  });

  it("leaves out the relations query for a table without relations", () => {
    expect(Object.keys(queries([]))).toStrictEqual(["Select", "Count", "Find many"]);
  });
});
