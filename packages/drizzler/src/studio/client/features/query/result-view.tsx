type Cell = string | number | boolean | null;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cell(value: unknown): Cell {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    return value;
  return JSON.stringify(value);
}

function listOf(value: unknown): readonly unknown[] | null {
  if (Array.isArray(value)) return value;
  return isRecord(value) ? [value] : null;
}

/** The rows of a result that is a list of objects, with every key any of them has; else null. */
export function asRows(value: unknown) {
  const list = listOf(value);
  if (list === null || list.length === 0 || !list.every(isRecord)) return null;
  const columns = [...new Set(list.flatMap((row) => Object.keys(row)))];
  return {
    columns,
    rows: list.map((row) =>
      Object.fromEntries(columns.map((column) => [column, cell(row[column])])),
    ),
  };
}
