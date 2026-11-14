import { describe, expect, it } from "vite-plus/test";
import { sqlParam, startingCode, whyUnavailable } from "./query-input.js";

describe("startingCode", () => {
  it("opens with what the browser kept, but not an earlier studio's starter", () => {
    expect(startingCode("db.select().from(user)")).toBe("db.select().from(user)");
    expect(startingCode("// `db` is Drizzle over the connected database\ndb")).toBe("");
    expect(startingCode(null)).toBe("");
  });
});

describe("sqlParam", () => {
  it("binds a scalar as it is, anything else as JSON", () => {
    expect([null, "a", 1, true].map(sqlParam)).toStrictEqual([null, "a", 1, true]);
    expect(sqlParam({ a: 1 })).toBe('{"a":1}');
    expect(sqlParam([1, 2])).toBe("[1,2]");
  });
});

describe("whyUnavailable", () => {
  it("says what a query needs, the database first", () => {
    expect(whyUnavailable(false, { reason: "x" })).toContain("--url");
    expect(whyUnavailable(true, { reason: "not installed" })).toBe(
      "Running a query needs the project's TypeScript: not installed",
    );
    expect(whyUnavailable(true, null)).toBeNull();
  });
});
