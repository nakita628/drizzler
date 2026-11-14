// What the database drivers hand back, read into one shape, and what they are handed: pure
// functions over plain values. The studio's database service does the I/O around them.

/** A statement's rows by column name, or a write's count. */
export type DriverResult = {
  readonly columns: readonly string[];
  readonly rows: readonly Readonly<Record<string, unknown>>[];
  readonly rowCount: number;
};

/** A statement's rows as arrays in column order (what Drizzle's proxy drivers take), or a write's count and inserted id. */
export type DriverArrayResult = {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly unknown[])[];
  readonly rowCount: number;
  /** The id the database gave an inserted row, where it says (MySQL, SQLite). */
  readonly insertId: number | null;
};

/** What a driver answered one statement with, read: the rows as arrays, and a write's counts. */
export type DriverAnswer = {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly unknown[])[];
  readonly changes: number;
  readonly lastRowId: number | null;
};

/** The drivers whose parameters are checked before they are bound. */
export type Binder = "sqlite" | "libsql" | "d1";

/** A plain object: not null, not an array. */
export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The rows of a driver's answer that are objects; anything else is dropped. */
export function rowRecords(value: unknown): readonly Readonly<Record<string, unknown>>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

/** Rows a driver handed back as arrays (`rowMode: "array"`, `rowsAsArray`), each checked to be one. */
export function rowArrays(value: unknown): readonly (readonly unknown[])[] {
  return Array.isArray(value) ? value.filter((row): row is unknown[] => Array.isArray(row)) : [];
}

/** Rows as arrays keyed by their columns; of two columns of one name, the last wins. */
export function rowsByName(
  columns: readonly string[],
  rows: readonly (readonly unknown[])[],
): readonly Readonly<Record<string, unknown>>[] {
  return rows.map((row) => Object.fromEntries(columns.map((column, i) => [column, row[i]])));
}

/** A value node:sqlite binds: null, a number, a big integer, text or bytes. */
export function isSqliteValue(
  value: unknown,
): value is null | number | bigint | string | NodeJS.ArrayBufferView {
  return (
    value === null ||
    typeof value === "number" ||
    typeof value === "bigint" ||
    typeof value === "string" ||
    ArrayBuffer.isView(value)
  );
}

// What each driver binds: node:sqlite SQLite's values; libSQL those, plus the booleans and dates
// it converts itself; D1's HTTP API what JSON carries (big integers are converted first).
const BINDS = {
  sqlite: isSqliteValue,
  libsql: (value) => isSqliteValue(value) || typeof value === "boolean" || value instanceof Date,
  d1: (value) =>
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint",
} as const satisfies Readonly<Record<Binder, (value: unknown) => boolean>>;

const BINDER_NAMES = {
  sqlite: "SQLite",
  libsql: "libSQL",
  d1: "D1's HTTP API",
} as const satisfies Readonly<Record<Binder, string>>;

/**
 * Why the driver cannot bind these parameters, or null when it can bind every one.
 *
 * @example bindError("sqlite", [1, true]) // => "SQLite cannot bind a boolean parameter"
 */
export function bindError(binder: Binder, params: readonly unknown[]): string | null {
  const bad = params.find((param) => !BINDS[binder](param));
  return bad === undefined ? null : `${BINDER_NAMES[binder]} cannot bind a ${typeof bad} parameter`;
}

/** A parameter as JSON carries it to D1: a big integer as a number, or as text past the safe range. */
export function d1Param(param: unknown) {
  if (typeof param !== "bigint") return param;
  return Number.isSafeInteger(Number(param)) ? Number(param) : param.toString();
}

/**
 * The body of one request to D1's `/raw` endpoint: one statement as it is, several as a batch,
 * which D1 runs as one transaction.
 */
export function d1Body(
  statements: readonly { readonly sql: string; readonly params: readonly unknown[] }[],
) {
  const queries = statements.map((statement) => ({
    sql: statement.sql,
    params: statement.params.map(d1Param),
  }));
  return queries.length === 1 ? queries[0] : { batch: queries };
}

/** One statement's result in D1's answer: `results.columns` / `results.rows` and `meta`. */
function d1Answer(value: unknown): DriverAnswer {
  const results = isRecord(value) && isRecord(value.results) ? value.results : {};
  const meta = isRecord(value) && isRecord(value.meta) ? value.meta : {};
  return {
    columns: Array.isArray(results.columns) ? results.columns.map(String) : [],
    rows: rowArrays(results.rows),
    changes: typeof meta.changes === "number" ? meta.changes : 0,
    lastRowId: typeof meta.last_row_id === "number" ? meta.last_row_id : null,
  };
}

/** The errors Cloudflare's API answered with, as one message. */
function cloudflareErrors(body: unknown, status: number) {
  const errors = isRecord(body) && Array.isArray(body.errors) ? body.errors.filter(isRecord) : [];
  const messages = errors.map((error) =>
    typeof error.code === "number"
      ? `${String(error.message)} (${error.code})`
      : String(error.message),
  );
  return messages.length > 0 ? messages.join("; ") : `Cloudflare's API answered ${status}`;
}

/**
 * D1's answer to one request, read: each statement's result, or what Cloudflare refused (its
 * errors, else the status and the start of the body). `body` is the parsed JSON, undefined when
 * the body was not JSON.
 *
 * @example readD1Response({ status: 403, text: "", body: { success: false, errors: [{ code: 10000, message: "Authentication error" }] } })
 * // => { error: "Authentication error (10000)" }
 */
export function readD1Response(response: {
  readonly status: number;
  readonly text: string;
  readonly body: unknown;
}): { readonly answers: readonly DriverAnswer[] } | { readonly error: string } {
  const { status, text, body } = response;
  if (body === undefined) {
    return { error: `Cloudflare's API answered ${status}: ${text.slice(0, 200)}` };
  }
  if (status < 200 || status >= 300 || !isRecord(body) || body.success !== true) {
    return { error: cloudflareErrors(body, status) };
  }
  return { answers: Array.isArray(body.result) ? body.result.map(d1Answer) : [] };
}

/**
 * What `@libsql/client` answered one statement with, read: its rows are array-likes, read by
 * index, and the id it gave an inserted row is a big integer.
 */
export function readLibsqlResult(result: unknown): DriverAnswer {
  const value = isRecord(result) ? result : {};
  const columns = Array.isArray(value.columns) ? value.columns.map(String) : [];
  const rows = Array.isArray(value.rows)
    ? value.rows
        .filter((row): row is ArrayLike<unknown> => typeof row === "object" && row !== null)
        .map((row) => columns.map((_, i) => row[i]))
    : [];
  const lastRowId = value.lastInsertRowid;
  return {
    columns,
    rows,
    changes: typeof value.rowsAffected === "number" ? value.rowsAffected : 0,
    lastRowId:
      typeof lastRowId === "bigint" || typeof lastRowId === "number" ? Number(lastRowId) : null,
  };
}

function fieldNames(fields: unknown) {
  return Array.isArray(fields) ? fields.filter(isRecord).map((field) => String(field.name)) : [];
}

/** What `pg` answered a statement with (`rows`, `fields`, `rowCount`), rows by column name. */
export function readPgResult(result: unknown): DriverResult {
  const value = isRecord(result) ? result : {};
  const rows = rowRecords(value.rows);
  return {
    columns: fieldNames(value.fields),
    rows,
    rowCount: typeof value.rowCount === "number" ? value.rowCount : rows.length,
  };
}

/** What `pg` answered a statement run with `rowMode: "array"` with, rows as arrays. */
export function readPgArrayResult(result: unknown): DriverArrayResult {
  const value = isRecord(result) ? result : {};
  const rows = rowArrays(value.rows);
  return {
    columns: fieldNames(value.fields),
    rows,
    rowCount: typeof value.rowCount === "number" ? value.rowCount : rows.length,
    insertId: null,
  };
}

/**
 * What `mysql2` answered a statement with (`[result, fields]`): rows by column name, or a write's
 * header with the rows it changed.
 */
export function readMysqlResult(result: unknown, fields: unknown): DriverResult {
  if (Array.isArray(result)) {
    const rows = rowRecords(result);
    const columns = Array.isArray(fields) ? fieldNames(fields) : Object.keys(rows[0] ?? {});
    return { columns, rows, rowCount: rows.length };
  }
  const header = isRecord(result) ? result : {};
  return {
    columns: [],
    rows: [],
    rowCount: typeof header.affectedRows === "number" ? header.affectedRows : 0,
  };
}

/** The same for a statement run with `rowsAsArray`: rows as arrays, or a write's count and inserted id. */
export function readMysqlArrayResult(result: unknown, fields: unknown): DriverArrayResult {
  if (Array.isArray(result)) {
    return {
      columns: fieldNames(fields),
      rows: rowArrays(result),
      rowCount: result.length,
      insertId: null,
    };
  }
  const header = isRecord(result) ? result : {};
  return {
    columns: [],
    rows: [],
    rowCount: typeof header.affectedRows === "number" ? header.affectedRows : 0,
    insertId: typeof header.insertId === "number" ? header.insertId : null,
  };
}

/** An answer by column name; a statement with no result columns is a write, counted by what it changed. */
export function answerResult(answer: DriverAnswer): DriverResult {
  if (answer.columns.length === 0) return { columns: [], rows: [], rowCount: answer.changes };
  return {
    columns: answer.columns,
    rows: rowsByName(answer.columns, answer.rows),
    rowCount: answer.rows.length,
  };
}

/** An answer as arrays; a write gives its count and the id of the row it inserted. */
export function answerArrayResult(answer: DriverAnswer): DriverArrayResult {
  if (answer.columns.length === 0) {
    return { columns: [], rows: [], rowCount: answer.changes, insertId: answer.lastRowId };
  }
  return {
    columns: answer.columns,
    rows: answer.rows,
    rowCount: answer.rows.length,
    insertId: null,
  };
}

/** What went wrong, with the reason under it: a network failure says only "fetch failed". */
export function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error.cause instanceof Error
    ? `${error.message}: ${errorMessage(error.cause)}`
    : error.message;
}

/** A refused statement's message, with the start of the statement it was running. */
export function failedStatement(cause: string, sql: string) {
  return `${cause}\n   while running: ${sql.slice(0, 200)}`;
}

/** The statement of a batch libSQL says it failed at (`statementIndex`), or null. */
export function batchFailureIndex(error: unknown) {
  return isRecord(error) && typeof error.statementIndex === "number" ? error.statementIndex : null;
}
