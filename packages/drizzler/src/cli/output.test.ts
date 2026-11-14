import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  describeOutput,
  generatedLine,
  studioFailure,
  unsupportedOutputMessage,
} from "./output.js";

describe("describeOutput", () => {
  it("names each kind, and the files the docs hold", () => {
    expect(describeOutput("dbml", "a.dbml", [])).toBe("DBML");
    expect(describeOutput("mermaid", "a.md", [])).toBe("Mermaid ER");
    expect(describeOutput("diagram", "a.png", [])).toBe("PNG ER diagram");
    expect(describeOutput("diagram", "a.svg", [])).toBe("SVG ER diagram");
    expect(
      describeOutput("docs", "docs", [
        path.join("docs", "README.md"),
        path.join("docs", "er.svg"),
        path.join("docs", "tables", "users.svg"),
      ]),
    ).toBe("docs (README.md, er.svg, tables/*.svg)");
  });

  it("writes the line printed after writing", () => {
    expect(generatedLine("dbml", "out.dbml", ["out.dbml"])).toBe("💧 Generated DBML at: out.dbml");
    expect(unsupportedOutputMessage("a.txt")).toContain("Unsupported output format: a.txt.");
  });
});

describe("studioFailure", () => {
  it("says what stopped the studio", () => {
    expect(
      studioFailure({
        _tag: "ServerListenError",
        port: 4983,
        code: "EADDRINUSE",
        message: "x",
      } as never),
    ).toBe("Port 4983 is in use. Pass --port to pick another.");
    expect(
      studioFailure({
        _tag: "ServerListenError",
        port: 1,
        code: "EACCES",
        message: "denied",
      } as never),
    ).toBe("Failed to start studio: denied");
    expect(
      studioFailure({ _tag: "FileReadError", path: "a.ts", cause: "does not exist" } as never),
    ).toBe("Failed to read input: a.ts does not exist");
  });
});
