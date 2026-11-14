import { describe, expect, it } from "vite-plus/test";
import { canvasHighlight, highlightOf, modelOfTable } from "./highlight.js";

const schema = {
  models: [
    {
      name: "user",
      dbName: "users",
      fields: [
        { name: "id", dbName: "id" },
        { name: "createdAt", dbName: "created_at" },
      ],
    },
    { name: "post", dbName: null, fields: [{ name: "title" }] },
  ],
};

describe("highlightOf", () => {
  it("merges each table's columns, in lower case, and is null for no table", () => {
    const map = highlightOf({
      tables: [
        { name: "Users", columnsUsed: ["ID"] },
        { name: "users", columnsUsed: ["created_at"] },
      ],
    });
    expect(map).toStrictEqual(new Map([["users", new Set(["id", "created_at"])]]));
    expect(highlightOf({ tables: [] })).toBeNull();
    expect(highlightOf(null)).toBeNull();
  });
});

describe("canvasHighlight", () => {
  it("keys the highlight by export and property, read back from the database's names", () => {
    expect(
      canvasHighlight(
        new Map([
          ["users", new Set(["created_at"])],
          ["post", new Set(["title"])],
        ]),
        schema,
      ),
    ).toStrictEqual(
      new Map([
        ["user", new Set(["createdAt"])],
        ["post", new Set(["title"])],
      ]),
    );
    expect(canvasHighlight(new Map([["gone", new Set<string>()]]), schema)).toBeNull();
    expect(canvasHighlight(null, schema)).toBeNull();
  });
});

describe("modelOfTable", () => {
  it("finds the export the database knows by a name, in any case", () => {
    expect(modelOfTable(schema, "USERS")).toBe("user");
    expect(modelOfTable(schema, "post")).toBe("post");
    expect(modelOfTable(schema, "gone")).toBeNull();
    expect(modelOfTable(null, "users")).toBeNull();
  });
});
