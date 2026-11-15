import { describe, expect, it } from "vite-plus/test";
import { pickFormatOptions } from "./format-options.js";

describe("pickFormatOptions", () => {
  it("keeps the options the studio passes on, and nothing for what is not an object", () => {
    expect(pickFormatOptions({ printWidth: 80, semi: false, ignorePatterns: ["x"] })).toStrictEqual(
      {
        printWidth: 80,
        semi: false,
      },
    );
    expect(pickFormatOptions(null)).toStrictEqual({});
    expect(pickFormatOptions("x")).toStrictEqual({});
  });
});
