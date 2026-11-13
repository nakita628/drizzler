import { describe, expect, it } from "vite-plus/test";
import { makeParseError, makePosition } from "./parse.js";

describe("makePosition", () => {
  it("counts lines and columns from 1", () => {
    expect(makePosition({ source: "ab\ncd", offset: 0 })).toStrictEqual({ line: 1, column: 1 });
    expect(makePosition({ source: "ab\ncd", offset: 4 })).toStrictEqual({ line: 2, column: 2 });
  });
});

describe("makeParseError", () => {
  it("is null when the source parsed", () => {
    expect(makeParseError({ source: "x", error: null })).toBeNull();
  });

  it("puts the error on its line and column", () => {
    expect(
      makeParseError({ source: "a\nbc", error: { message: "Unexpected token", offset: 3 } }),
    ).toStrictEqual({ message: "Unexpected token", line: 2, column: 2 });
  });
});
