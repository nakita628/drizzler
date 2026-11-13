import { describe, expect, it } from "vite-plus/test";
import { stripJsonComments } from "./format.js";

describe("stripJsonComments", () => {
  it("drops comments and trailing commas, and leaves strings alone", () => {
    const text = `{
  // a line comment
  "url": "https://example.com/*not a comment*/", /* block */
  "slashes": "a // b",
  "escaped": "say \\"hi\\" // still a string",
  "list": [1, 2,],
}`;
    expect(JSON.parse(stripJsonComments({ text }))).toStrictEqual({
      url: "https://example.com/*not a comment*/",
      slashes: "a // b",
      escaped: 'say "hi" // still a string',
      list: [1, 2],
    });
  });
});
