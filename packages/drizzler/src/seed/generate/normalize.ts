import type { SeedRow, SeedValue } from "../config.js";
import type { SeedColumn } from "../schema.js";
import { dateText } from "../values.js";
import type { RowInput } from "./context.js";
import { isSeedList } from "./context.js";

/**
 * A given scalar as the column stores it, when the value can be read that way: an ISO string
 * becomes a Date, a Date the text of a string-mode date, an integer a bigint, a number a decimal
 * string, base64 text bytes. Anything else is left as it is for validation to report.
 */
function normalizeScalar(column: SeedColumn, value: SeedValue) {
  switch (column.kind) {
    case "date": {
      if (typeof value !== "string" && typeof value !== "number") return value;
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? value : date;
    }
    case "dateString":
      return value instanceof Date ? dateText(value, column.format) : value;
    case "bigint":
      if (typeof value === "number" && Number.isInteger(value)) return BigInt(value);
      return typeof value === "string" && /^-?\d+$/u.test(value) ? BigInt(value) : value;
    case "decimal":
      return typeof value === "number" && Number.isFinite(value) ? String(value) : value;
    case "bytes":
      return typeof value === "string" ? Uint8Array.from(Buffer.from(value, "base64")) : value;
    default:
      return value;
  }
}

/** A generated value in the form its column stores, element by element for a list. */
export function normalizeValue(column: SeedColumn, value: SeedValue) {
  if (value === null) return value;
  if (column.isList) {
    return isSeedList(value) ? value.map((item) => normalizeScalar(column, item)) : value;
  }
  return normalizeScalar(column, value);
}

/** The given values of the row, each read as its column stores them. */
export function normalizeGiven(input: RowInput) {
  const { given, table } = input;
  if (given === null) return {};
  const fitted: SeedRow = Object.fromEntries(
    table.columns
      .filter((column) => column.field in given)
      .map((column) => [column.field, normalizeValue(column, given[column.field] ?? null)]),
  );
  return fitted;
}
