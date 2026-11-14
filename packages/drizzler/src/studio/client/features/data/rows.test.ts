import { describe, expect, it } from "vite-plus/test";
import { compareCells, shownRows } from "./rows.js";

const rows = [
  { id: 2, name: "item10" },
  { id: null, name: "Item2" },
  { id: 1, name: "item1" },
];
const columns = ["id", "name"];

/** The ids of the rows sorted by id. */
function ids(direction: "ascending" | "descending") {
  return shownRows({ rows, columns, filter: "", sort: { column: "id", direction } }).map(
    (row) => row.id,
  );
}

describe("shownRows", () => {
  it("keeps the rows with a cell that holds the filter, in any case", () => {
    expect(shownRows({ rows, columns, filter: " ITEM1 ", sort: null })).toStrictEqual([
      { id: 2, name: "item10" },
      { id: 1, name: "item1" },
    ]);
    expect(shownRows({ rows, columns, filter: "", sort: null })).toBe(rows);
  });

  it("sorts numbers by value and text with digits by number", () => {
    expect(
      shownRows({
        rows,
        columns,
        filter: "",
        sort: { column: "name", direction: "ascending" },
      }).map((row) => row.name),
    ).toStrictEqual(["item1", "Item2", "item10"]);
  });

  it("puts NULLs last whichever way the column is sorted", () => {
    expect(ids("ascending")).toStrictEqual([1, 2, null]);
    expect(ids("descending")).toStrictEqual([2, 1, null]);
  });
});

describe("compareCells", () => {
  it("orders equal cells as equal, and NULL after any value", () => {
    expect(compareCells("a", "a", "ascending")).toBe(0);
    expect(compareCells(null, 1, "descending")).toBe(1);
    expect(compareCells(1, null, "descending")).toBe(-1);
  });
});
