export const PAGE_SIZE = 100;

/**
 * Where a page of `rowCount` rows starting at `skip` sits among `total`: the first and last row
 * shown (counted from 1; 0 for an empty table), the page number and how many pages there are
 * (at least one).
 */
export function pageWindow(input: {
  readonly skip: number;
  readonly rowCount: number;
  readonly total: number;
}) {
  const { skip, rowCount, total } = input;
  return {
    from: total === 0 ? 0 : skip + 1,
    to: Math.min(skip + rowCount, total),
    page: Math.floor(skip / PAGE_SIZE) + 1,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}

/**
 * The columns a row is told apart by: its key when the table has one, else everything it holds
 * — enough to draw without two rows colliding, not enough to write back through.
 */
export function rowIdentity(rowKey: readonly string[], columns: readonly string[]) {
  return rowKey.length > 0 ? rowKey : columns;
}
