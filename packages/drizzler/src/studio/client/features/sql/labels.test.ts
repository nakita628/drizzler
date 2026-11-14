import { describe, expect, it } from "vite-plus/test";
import { rowSummary, statementLabel, tabOf, textToRun } from "./labels.js";

describe("rowSummary", () => {
  it("counts the rows, and says when only the first page is shown", () => {
    expect(rowSummary(1, 1)).toBe("1 row");
    expect(rowSummary(3, 3)).toBe("3 rows");
    expect(rowSummary(2, 5)).toBe("first 2 of 5 rows");
  });
});

describe("statementLabel", () => {
  it("numbers a statement by its first line, cut to fit, or by its kind", () => {
    expect(statementLabel({ text: "  select 1\nfrom t", kind: "select" }, 0)).toBe("1 · select 1");
    expect(
      statementLabel({ text: "select a_very_long_column_name from t", kind: "select" }, 1),
    ).toBe("2 · select a_very_long_column_n…");
    expect(statementLabel({ text: "  ", kind: "unknown" }, 2)).toBe("3 · unknown");
  });
});

describe("tabOf and textToRun", () => {
  it("names a tab, the flow for any other key", () => {
    expect(tabOf("plan")).toBe("plan");
    expect(tabOf(3)).toBe("flow");
  });

  it("runs the whole text for one statement, else the chosen one", () => {
    expect(textToRun("select 1; select 2", { text: "select 2" }, 2)).toBe("select 2");
    expect(textToRun("select 1", { text: "select 1" }, 1)).toBe("select 1");
    expect(textToRun("select 1; select 2", null, 2)).toBe("select 1; select 2");
  });
});
