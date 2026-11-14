import { describe, expect, it } from "vite-plus/test";
import {
  clampOffset,
  completionItems,
  editorDiagnostics,
  hoverContents,
  localSpan,
  queryDocument,
  severityOf,
  signatureHelp,
} from "./language.js";

const categories = { error: 1, warning: 0 };

/** Display parts as text, here plain strings joined. */
function parts(list: readonly unknown[] | undefined) {
  return (list ?? []).join("");
}

describe("positions", () => {
  it("reads a span of the file as one of the editor's text, null in the preamble or past it", () => {
    expect(localSpan({ start: 12, length: 3 }, 10, 20)).toStrictEqual({ start: 2, end: 5 });
    expect(localSpan({ start: 5, length: 3 }, 10, 20)).toBeNull();
    expect(localSpan({ start: 28, length: 5 }, 10, 20)).toBeNull();
  });

  it("puts the query after its preamble and keeps the offset within it", () => {
    expect(queryDocument({ preamble: "pre;", suffix: "}", code: "db", offset: 99 })).toStrictEqual({
      text: "pre;db}",
      base: 4,
      position: 6,
    });
    expect(queryDocument({ preamble: "pre;", suffix: "}", code: "db", offset: -3 }).position).toBe(
      4,
    );
    expect(clampOffset(10, 4)).toBe(4);
    expect(clampOffset(-1, 4)).toBe(0);
  });
});

describe("answers", () => {
  it("offers the completions without the preamble's __ names", () => {
    expect(
      completionItems(
        [
          { name: "__schema", kind: "const", sortText: "1" },
          { name: "user", kind: "const", sortText: "1", replacementSpan: { start: 12, length: 2 } },
        ],
        10,
        20,
      ),
    ).toStrictEqual([
      {
        label: "user",
        kind: "const",
        sortText: "1",
        insertText: null,
        replacement: { start: 2, end: 4 },
      },
    ]);
  });

  it("writes a hover as a code block, then its documentation", () => {
    expect(hoverContents("const x: number", "")).toBe("```typescript\nconst x: number\n```");
    expect(hoverContents("const x: number", "The x.")).toBe(
      "```typescript\nconst x: number\n```\n\nThe x.",
    );
  });

  it("builds a signature's label from its parts", () => {
    expect(
      signatureHelp(
        {
          items: [
            {
              prefixDisplayParts: ["eq("],
              separatorDisplayParts: [", "],
              suffixDisplayParts: [")"],
              documentation: [],
              parameters: [
                { displayParts: ["left"], documentation: ["The column."] },
                { displayParts: ["right"], documentation: [] },
              ],
            },
          ],
          selectedItemIndex: 0,
          argumentIndex: 1,
        },
        parts,
      ),
    ).toStrictEqual({
      signatures: [
        {
          label: "eq(left, right)",
          documentation: null,
          parameters: [
            { label: "left", documentation: "The column." },
            { label: "right", documentation: null },
          ],
        },
      ],
      activeSignature: 0,
      activeParameter: 1,
    });
    expect(signatureHelp(undefined, parts)).toStrictEqual({
      signatures: [],
      activeSignature: 0,
      activeParameter: 0,
    });
  });

  it("keeps the diagnostics inside the editor's text, in order, with their severity", () => {
    expect(
      editorDiagnostics(
        [
          { start: 18, length: 1, category: 0, message: "unused" },
          { start: 12, length: 2, category: 1, message: "wrong type" },
          { start: 2, length: 1, category: 1, message: "in the preamble" },
          { start: undefined, length: undefined, category: 1, message: "global" },
        ],
        { base: 10, length: 20, categories },
      ),
    ).toStrictEqual([
      { message: "wrong type", severity: "error", range: { start: 2, end: 4 } },
      { message: "unused", severity: "warning", range: { start: 8, end: 9 } },
    ]);
    expect(severityOf(2, categories)).toBe("info");
  });
});
