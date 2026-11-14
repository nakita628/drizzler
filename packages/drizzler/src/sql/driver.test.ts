import { describe, expect, it } from "vite-plus/test";
import {
  answerArrayResult,
  answerResult,
  batchFailureIndex,
  d1Body,
  d1Param,
  errorMessage,
  failedStatement,
  readD1Response,
  readLibsqlResult,
  readMysqlArrayResult,
  readMysqlResult,
  readPgArrayResult,
  readPgResult,
  rowsByName,
  bindError,
} from "./driver.js";

describe("bindError", () => {
  it.each([
    ["sqlite", [1, "a", null, 2n, new Uint8Array([1])], null],
    ["sqlite", [true], "SQLite cannot bind a boolean parameter"],
    ["libsql", [true, new Date(0), new Uint8Array([1])], null],
    ["libsql", [{}], "libSQL cannot bind a object parameter"],
    ["d1", [1, "a", null, true, 2n], null],
    ["d1", [new Uint8Array([1])], "D1's HTTP API cannot bind a object parameter"],
  ] as const)("%s binds %o: %s", (binder, params, reason) => {
    expect(bindError(binder, params)).toBe(reason);
  });
});

describe("D1 requests", () => {
  it("sends a big integer as a number, or as text past the safe range", () => {
    expect(d1Param(42n)).toBe(42);
    expect(d1Param(2n ** 60n)).toBe("1152921504606846976");
    expect(d1Param("x")).toBe("x");
  });

  it("sends one statement as it is and several as a batch", () => {
    expect(d1Body([{ sql: "SELECT ?", params: [1n] }])).toStrictEqual({
      sql: "SELECT ?",
      params: [1],
    });
    expect(
      d1Body([
        { sql: "INSERT INTO t VALUES (?)", params: [1] },
        { sql: "INSERT INTO t VALUES (?)", params: [2] },
      ]),
    ).toStrictEqual({
      batch: [
        { sql: "INSERT INTO t VALUES (?)", params: [1] },
        { sql: "INSERT INTO t VALUES (?)", params: [2] },
      ],
    });
  });
});

describe("readD1Response", () => {
  it("reads each statement's columns, rows and counts", () => {
    expect(
      readD1Response({
        status: 200,
        text: "",
        body: {
          success: true,
          result: [
            {
              results: { columns: ["id", "name"], rows: [[1, "Ada"]] },
              meta: { changes: 0, last_row_id: 0 },
            },
            { results: { columns: [], rows: [] }, meta: { changes: 1, last_row_id: 7 } },
          ],
        },
      }),
    ).toStrictEqual({
      answers: [
        { columns: ["id", "name"], rows: [[1, "Ada"]], changes: 0, lastRowId: 0 },
        { columns: [], rows: [], changes: 1, lastRowId: 7 },
      ],
    });
  });

  it("says what Cloudflare refused, else the status", () => {
    expect(
      readD1Response({
        status: 400,
        text: "",
        body: {
          success: false,
          errors: [{ code: 7500, message: "UNIQUE constraint failed" }, { message: "and this" }],
        },
      }),
    ).toStrictEqual({ error: "UNIQUE constraint failed (7500); and this" });
    expect(readD1Response({ status: 500, text: "", body: { success: false } })).toStrictEqual({
      error: "Cloudflare's API answered 500",
    });
  });

  it("quotes a body that is not JSON", () => {
    expect(readD1Response({ status: 502, text: "Bad gateway", body: undefined })).toStrictEqual({
      error: "Cloudflare's API answered 502: Bad gateway",
    });
  });
});

describe("readLibsqlResult", () => {
  it("reads array-like rows by index and the inserted row's big integer id", () => {
    // libSQL's rows are array-likes that also carry the columns by name.
    const row = Object.assign(Object.create(null), {
      0: 1,
      1: "Ada",
      length: 2,
      id: 1,
      name: "Ada",
    });
    expect(
      readLibsqlResult({
        columns: ["id", "name"],
        rows: [row],
        rowsAffected: 0,
        lastInsertRowid: 9n,
      }),
    ).toStrictEqual({ columns: ["id", "name"], rows: [[1, "Ada"]], changes: 0, lastRowId: 9 });
    expect(readLibsqlResult({ columns: [], rows: [], rowsAffected: 2 })).toStrictEqual({
      columns: [],
      rows: [],
      changes: 2,
      lastRowId: null,
    });
  });
});

describe("pg and mysql2 results", () => {
  const fields = [{ name: "id" }, { name: "name" }];

  it("reads pg's rows, fields and count", () => {
    expect(readPgResult({ rows: [{ id: 1, name: "Ada" }], fields, rowCount: 1 })).toStrictEqual({
      columns: ["id", "name"],
      rows: [{ id: 1, name: "Ada" }],
      rowCount: 1,
    });
    expect(readPgArrayResult({ rows: [[1, "Ada"]], fields, rowCount: null })).toStrictEqual({
      columns: ["id", "name"],
      rows: [[1, "Ada"]],
      rowCount: 1,
      insertId: null,
    });
  });

  it("reads mysql2's rows, or a write's header", () => {
    expect(readMysqlResult([{ id: 1, name: "Ada" }], fields)).toStrictEqual({
      columns: ["id", "name"],
      rows: [{ id: 1, name: "Ada" }],
      rowCount: 1,
    });
    expect(readMysqlResult([{ id: 1 }], undefined)).toMatchObject({ columns: ["id"] });
    expect(readMysqlResult({ affectedRows: 3 }, undefined)).toStrictEqual({
      columns: [],
      rows: [],
      rowCount: 3,
    });
    expect(readMysqlArrayResult({ affectedRows: 1, insertId: 5 }, undefined)).toStrictEqual({
      columns: [],
      rows: [],
      rowCount: 1,
      insertId: 5,
    });
  });
});

describe("answers", () => {
  const rows = { columns: ["id", "name"], rows: [[1, "Ada"]], changes: 0, lastRowId: null };
  const write = { columns: [], rows: [], changes: 2, lastRowId: 7 };

  it("gives rows by name, or a write's count", () => {
    expect(answerResult(rows)).toStrictEqual({
      columns: ["id", "name"],
      rows: [{ id: 1, name: "Ada" }],
      rowCount: 1,
    });
    expect(answerResult(write)).toStrictEqual({ columns: [], rows: [], rowCount: 2 });
  });

  it("gives rows as arrays, or a write's count and inserted id", () => {
    expect(answerArrayResult(rows)).toStrictEqual({
      columns: ["id", "name"],
      rows: [[1, "Ada"]],
      rowCount: 1,
      insertId: null,
    });
    expect(answerArrayResult(write)).toStrictEqual({
      columns: [],
      rows: [],
      rowCount: 2,
      insertId: 7,
    });
  });

  it("keys rows by column, the last of two of one name winning", () => {
    expect(rowsByName(["name", "name"], [["Ada", "Engines"]])).toStrictEqual([{ name: "Engines" }]);
  });
});

describe("errors", () => {
  it("says the reason under a network failure", () => {
    const error = new Error("fetch failed", { cause: new Error("connect ECONNREFUSED") });
    expect(errorMessage(error)).toBe("fetch failed: connect ECONNREFUSED");
    expect(errorMessage("plain")).toBe("plain");
  });

  it("names the statement a failure came from, and the batch index libSQL gives", () => {
    expect(failedStatement("UNIQUE", "INSERT INTO t")).toBe(
      "UNIQUE\n   while running: INSERT INTO t",
    );
    expect(batchFailureIndex({ statementIndex: 2 })).toBe(2);
    expect(batchFailureIndex(new Error("x"))).toBeNull();
  });
});
