// What the result table shows of a query's rows: the ones the filter keeps, in the order the
// sorted column puts them. Pure, so the table component only holds the filter and the sort.
import { displayCell } from "./cells.js";

type Cell = string | number | boolean | null;
type Row = Readonly<Record<string, Cell>>;

// One collator for the whole sort: `localeCompare` with options builds a new one per call, which
// dominates sorting a result of thousands of rows.
const COLLATOR = new Intl.Collator(undefined, { numeric: true });

/** Two non-null cells in ascending order: numbers by value, anything else as text, digits by number. */
function compareValues(a: Exclude<Cell, null>, b: Exclude<Cell, null>) {
  return typeof a === "number" && typeof b === "number"
    ? a - b
    : COLLATOR.compare(String(a), String(b));
}

/**
 * Two cells in the order a column sorted `direction` shows them. NULLs go last whichever way the
 * column is sorted, as they do in a spreadsheet.
 */
export function compareCells(a: Cell, b: Cell, direction: "ascending" | "descending") {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const order = compareValues(a, b);
  return direction === "descending" ? -order : order;
}

/**
 * The rows the table shows: those with a cell that holds the filter's text (any case), sorted by a
 * column when one is chosen, NULLs last either way.
 */
export function shownRows<R extends Row>(input: {
  readonly rows: readonly R[];
  readonly columns: readonly string[];
  readonly filter: string;
  readonly sort: { readonly column: string; readonly direction: "ascending" | "descending" } | null;
}): readonly R[] {
  const needle = input.filter.trim().toLowerCase();
  const kept =
    needle === ""
      ? input.rows
      : input.rows.filter((row) =>
          input.columns.some((column) =>
            displayCell(row[column] ?? null)
              .toLowerCase()
              .includes(needle),
          ),
        );
  const { sort } = input;
  if (sort === null) return kept;
  return kept.toSorted((a, b) =>
    compareCells(a[sort.column] ?? null, b[sort.column] ?? null, sort.direction),
  );
}
