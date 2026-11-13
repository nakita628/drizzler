import { describe, expect, it } from "vite-plus/test";
import { paramsByStatement } from "./params.js";

describe("paramsByStatement", () => {
  it("hands the ? values out in turn, and none to a statement without a placeholder", () => {
    expect(
      paramsByStatement(
        ["SELECT 1", "SELECT * FROM t WHERE a = ? AND b = '?'", "DELETE FROM t WHERE c = ?"],
        [1, 2],
      ),
    ).toStrictEqual([[], [1], [2]]);
  });

  it("gives a $n statement the values up to the highest number it uses", () => {
    expect(paramsByStatement(["SELECT $2, $1", "SELECT 1"], ["a", "b", "c"])).toStrictEqual([
      ["a", "b"],
      [],
    ]);
  });
});
