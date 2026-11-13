import { describe, expect, it } from "vite-plus/test";

import {
  displayCell,
  editableText,
  keyLabel,
  keyOf,
  matchRuns,
  parseCellInput,
  rowId,
  toCsv,
  toJson,
  toTsv,
} from "./cells.js";

type Field = {
  readonly name: string;
  readonly type: string;
  readonly nullable: boolean;
  readonly isList: boolean;
  readonly enumName: string | null;
};

function field(type: string, overrides: Partial<Field> = {}): Field {
  return { name: "f", type, nullable: false, isList: false, enumName: null, ...overrides };
}

describe("displayCell and editableText", () => {
  it("renders NULL, booleans and scalars", () => {
    expect(displayCell(null)).toBe("NULL");
    expect(displayCell(true)).toBe("true");
    expect(displayCell(3)).toBe("3");
    expect(editableText(null)).toBe("");
    expect(editableText(false)).toBe("false");
    expect(editableText("x")).toBe("x");
  });
});

describe("parseCellInput", () => {
  it("maps empty input to NULL for nullable columns only", () => {
    expect(parseCellInput(field("text", { nullable: true }), "")).toBeNull();
    expect(parseCellInput(field("text", { nullable: true }), "NULL")).toBeNull();
    expect(parseCellInput(field("text"), "")).toBe("");
  });

  it("parses numbers and booleans and keeps everything else as text", () => {
    expect(parseCellInput(field("integer"), "42")).toBe(42);
    expect(parseCellInput(field("integer"), "abc")).toBe("abc");
    expect(parseCellInput(field("real"), "1.5")).toBe(1.5);
    expect(parseCellInput(field("boolean"), "true")).toBe(true);
    expect(parseCellInput(field("boolean"), "no")).toBe(false);
    expect(parseCellInput(field("timestamp"), "2026-01-01T00:00:00.000Z")).toBe(
      "2026-01-01T00:00:00.000Z",
    );
    expect(parseCellInput(field("role", { enumName: "role" }), "42")).toBe("42");
    expect(parseCellInput(field("integer", { isList: true }), "[1,2]")).toBe("[1,2]");
  });
});

describe("keyOf and toCsv", () => {
  it("extracts the key columns and escapes csv", () => {
    expect(keyOf({ id: 1, name: "a" }, ["id"])).toStrictEqual({ id: 1 });
    expect(keyOf({ a: 1 }, ["a", "b"])).toStrictEqual({ a: 1, b: null });
    expect(
      toCsv(
        ["id", "name"],
        [
          { id: 1, name: "plain" },
          { id: 2, name: 'has,comma "quoted"' },
          { id: 3, name: null },
        ],
      ),
    ).toBe('id,name\n1,plain\n2,"has,comma ""quoted"""\n3,');
  });
});

describe("rowId and keyLabel", () => {
  it("names a row by the columns it is keyed on", () => {
    expect(rowId({ id: 7, name: "a" }, ["id"])).toBe('{"id":7}');
    expect(rowId({ a: 1, b: 2 }, ["a", "b"])).toBe('{"a":1,"b":2}');
    expect(rowId({ a: 1 }, ["a", "missing"])).toBe('{"a":1,"missing":null}');
    expect(keyLabel({ id: 7, email: "a@b.c" }, ["id", "email"])).toBe("id = 7, email = a@b.c");
    expect(keyLabel({ id: null }, ["id"])).toBe("id = NULL");
  });
});

describe("toTsv and toJson", () => {
  it("flattens tabs and newlines so a paste keeps its shape", () => {
    expect(
      toTsv(
        ["id", "note"],
        [
          { id: 1, note: "plain" },
          { id: 2, note: "two\tcolumns\nand a line" },
          { id: 3, note: null },
        ],
      ),
    ).toBe("id\tnote\n1\tplain\n2\ttwo columns and a line\n3\t");
  });

  it("writes the named columns only, with absent values as null", () => {
    expect(toJson(["id", "name"], [{ id: 1, name: "a", extra: "x" }, { id: 2 }])).toBe(
      '[\n  {\n    "id": 1,\n    "name": "a"\n  },\n  {\n    "id": 2,\n    "name": null\n  }\n]',
    );
  });
});

describe("matchRuns", () => {
  it("splits the text around every case-insensitive hit", () => {
    expect(matchRuns("Ada Lovelace", "ada")).toStrictEqual([
      { start: 0, text: "Ada", matched: true },
      { start: 3, text: " Lovelace", matched: false },
    ]);
    expect(matchRuns("banana", "an")).toStrictEqual([
      { start: 0, text: "b", matched: false },
      { start: 1, text: "an", matched: true },
      { start: 3, text: "an", matched: true },
      { start: 5, text: "a", matched: false },
    ]);
  });

  it("leaves the text whole when there is nothing to mark", () => {
    expect(matchRuns("Ada", "")).toStrictEqual([{ start: 0, text: "Ada", matched: false }]);
    expect(matchRuns("Ada", "   ")).toStrictEqual([{ start: 0, text: "Ada", matched: false }]);
    expect(matchRuns("", "ada")).toStrictEqual([{ start: 0, text: "", matched: false }]);
    expect(matchRuns("Ada", "zz")).toStrictEqual([{ start: 0, text: "Ada", matched: false }]);
  });
});
