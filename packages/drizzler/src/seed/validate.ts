import type { Result } from "./result.js";
import { fail, ok } from "./result.js";
import * as z from "zod";
import type { SeedRow, SeedValue } from "./config.js";
import { SeedGenerationError } from "./errors.js";
import type { ModelTable, SeedColumn } from "./schema.js";

// cspell:ignore emailaddress
/** What a text column is by its name: an email address or a URL. */
function namedSchema(column: SeedColumn) {
  const name = column.field.toLowerCase().replaceAll(/[_-]/gu, "");
  if (/^(e?mail|emailaddress)$/u.test(name)) return z.email();
  if (/^(url|uri|website|homepage)$/u.test(name)) return z.url();
  return null;
}

function stringSchema(column: SeedColumn) {
  const base = namedSchema(column) ?? z.string();
  return column.length === null ? base : base.max(column.length);
}

function decimalSchema(column: SeedColumn) {
  const { precision, scale } = column;
  if (precision !== null && scale !== null) {
    const integer = Math.max(precision - scale, 1);
    const fraction = scale > 0 ? `(\\.\\d{1,${scale}})?` : "";
    return z
      .string()
      .regex(
        new RegExp(`^-?\\d{1,${integer}}${fraction}$`, "u"),
        `Invalid decimal: at most ${precision - scale} integer and ${scale} fraction digits (precision ${precision}, scale ${scale})`,
      );
  }
  return z.string().regex(/^-?\d+(\.\d+)?$/u, "Invalid decimal string");
}

const DATE_TEXT = {
  date: /^\d{4}-\d{2}-\d{2}$/u,
  time: /^\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/u,
  timestamp: /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}(:?\d{2})?)?$/u,
} as const;

/** What the column's stored scalar must look like, from its type, length, enum and bounds. */
function scalarSchema(column: SeedColumn) {
  switch (column.kind) {
    case "enum":
      return z.enum(column.enumValues ?? []);
    case "string":
      return stringSchema(column);
    case "uuid":
      return z.uuid();
    case "int": {
      const range = column.range ?? { min: -Number.MAX_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER };
      return z.int().min(range.min).max(range.max);
    }
    case "bigint":
      return z.bigint();
    case "float":
      return z.number();
    case "decimal":
      return decimalSchema(column);
    case "boolean":
      return z.boolean();
    case "date":
      return z.date();
    case "dateString":
      return z
        .string()
        .regex(
          DATE_TEXT[column.format ?? "timestamp"],
          `Invalid ${column.format ?? "timestamp"} text`,
        );
    case "json":
      return z.json();
    case "bytes":
      return z.instanceof(Uint8Array);
    case "inet":
    case "cidr":
    case "mac":
    case "interval":
      return z.string();
    default:
      // A kind the seeder cannot make: whatever a rule gives is the user's, but there must be one.
      return z.custom<SeedValue>(
        (value) => value !== null && value !== undefined,
        `drizzler cannot make a ${column.type} value; give the column a rule or a value`,
      );
  }
}

/** The zod schema a column's value must pass: the scalar, in a list or nullable as declared. */
export function columnSchema(column: SeedColumn) {
  const scalar = scalarSchema(column);
  const shaped = column.isList ? z.array(scalar) : scalar;
  return column.isRequired ? shaped : shaped.nullable();
}

function rowSchema(table: ModelTable) {
  return z.object(
    Object.fromEntries(
      table.columns.map((column) => [
        column.field,
        // A row may leave a column the database fills to its default.
        column.databaseFills ? columnSchema(column).optional() : columnSchema(column),
      ]),
    ),
  );
}

function describeValue(value: SeedValue | undefined) {
  if (value === undefined) return "nothing";
  if (typeof value === "bigint") return `${value.toString()}n`;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return `<${value.length} bytes>`;
  return JSON.stringify(value);
}

/** `["tags", 0]` as zod reports a path, as `tags[0]` and the column name. */
function readPath(path: readonly PropertyKey[]) {
  const [first = "", ...rest] = path.map(String);
  const text = rest.map((segment, i) =>
    typeof path[i + 1] === "number" ? `[${segment}]` : `.${segment}`,
  );
  return { text: first + text.join(""), field: first };
}

function issuesOf(table: ModelTable, index: number, row: SeedRow, error: z.ZodError) {
  return error.issues.map((issue) => {
    const { text, field } = readPath(issue.path);
    return `${table.name}[${index}].${text}: ${issue.message} (got ${describeValue(row[field])})`;
  });
}

/**
 * Checks every row against the schema built from the Drizzle columns: the types, enum members,
 * uuid, email and URL text, lengths, integer ranges, decimal digits, dates, lists and
 * nullability. Nothing is inserted while one value fails.
 */
export function validateRows(
  table: ModelTable,
  rows: readonly SeedRow[],
): Result<void, SeedGenerationError> {
  const schema = rowSchema(table);
  const problems = rows.flatMap((row, index) => {
    const result = schema.safeParse(row);
    return result.success ? [] : issuesOf(table, index, row, result.error);
  });
  if (problems.length === 0) return ok(undefined);
  const shown = problems.slice(0, 20);
  const more = problems.length - shown.length;
  return fail(
    new SeedGenerationError({
      message: `${table.name}: ${problems.length} value${problems.length === 1 ? "" : "s"} failed validation, nothing was inserted.\n   ${shown.join("\n   ")}${more > 0 ? `\n   ... and ${more} more` : ""}`,
    }),
  );
}
