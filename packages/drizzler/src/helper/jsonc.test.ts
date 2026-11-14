import { describe, expect, it } from "vite-plus/test";
import { stripJsonc } from "./jsonc.js";

describe("stripJsonc", () => {
  it("drops comments and trailing commas, and leaves strings alone", () => {
    const text = `{
  // a line comment
  "url": "https://example.com/*not a comment*/", /* block */
  "slashes": "a // b",
  "escaped": "say \\"hi\\" // still a string",
  "list": [1, 2,],
}`;
    expect(JSON.parse(stripJsonc(text))).toStrictEqual({
      url: "https://example.com/*not a comment*/",
      slashes: "a // b",
      escaped: 'say "hi" // still a string',
      list: [1, 2],
    });
  });
  it("reads comments and trailing commas, and keeps slashes inside strings", () => {
    expect(
      JSON.parse(
        stripJsonc(`{
        // a comment
        "paths": { "#/*": ["./src/*"], }, /* another */
        "url": "http://x//y",
      }`),
      ),
    ).toStrictEqual({ paths: { "#/*": ["./src/*"] }, url: "http://x//y" });
  });
});

describe("an unclosed string or comment", () => {
  it("keeps the string and drops the comment to the end", () => {
    expect(stripJsonc('{"a": "open')).toBe('{"a": "open');
    expect(stripJsonc('{"a": 1} /* never closed')).toBe('{"a": 1} ');
  });
});
