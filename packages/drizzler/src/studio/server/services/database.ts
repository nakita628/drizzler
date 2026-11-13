import { createRequire } from "node:module";
import path from "node:path";
import type { SQLInputValue } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { Effect } from "effect";
import type { Dialect, Statement } from "../domain/sql.js";
import { DatabaseError, DatabaseUnavailableError } from "../errors/index.js";

type Result = {
  readonly columns: readonly string[];
  readonly rows: readonly Readonly<Record<string, unknown>>[];
  readonly rowCount: number;
};

/** A result with its rows as arrays, in column order: what Drizzle's proxy drivers take. */
type ArrayResult = {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly unknown[])[];
  readonly rowCount: number;
  /** The id the database gave an inserted row, where it says (MySQL, SQLite). */
  readonly insertId: number | null;
};

/** An open connection: every statement is an Effect that fails with the driver's message. */
export type Driver = {
  readonly dialect: Dialect;
  readonly query: (statement: Statement) => Effect.Effect<Result, DatabaseError>;
  /** The same, with each row an array: two columns of one name (a join) both survive. */
  readonly queryArrays: (statement: Statement) => Effect.Effect<ArrayResult, DatabaseError>;
  readonly close: Effect.Effect<void>;
};

/** The connection the studio was started with, or why there is none. */
export type Database = {
  readonly driver: Driver | null;
  readonly status: {
    readonly connected: boolean;
    readonly dialect: Dialect | null;
    readonly url: string | null;
    readonly error: string | null;
  };
};

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function queryError(error: unknown) {
  return new DatabaseError({ cause: message(error) });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rowsOf(value: unknown) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

/** Rows a driver handed back as arrays (`rowMode: "array"`, `rowsAsArray`), each checked to be one. */
function rowArrays(value: unknown): readonly (readonly unknown[])[] {
  return Array.isArray(value) ? value.filter((row): row is unknown[] => Array.isArray(row)) : [];
}

function isSqlInput(value: unknown): value is SQLInputValue {
  return (
    value === null ||
    typeof value === "number" ||
    typeof value === "bigint" ||
    typeof value === "string" ||
    ArrayBuffer.isView(value)
  );
}

/** The parameters as node:sqlite binds them; one it cannot bind fails the statement by name. */
function sqliteParams(params: readonly unknown[]): Effect.Effect<SQLInputValue[], DatabaseError> {
  const bad = params.find((param) => !isSqlInput(param));
  if (bad !== undefined) {
    return Effect.fail(
      new DatabaseError({ cause: `SQLite cannot bind a ${typeof bad} parameter` }),
    );
  }
  return Effect.succeed(params.filter(isSqlInput));
}

/** `pg`'s Client, checked to be a constructor: the package is the user's, typed here by hand. */
function isPgClientClass(
  value: unknown,
): value is new (options: { connectionString: string }) => PgClient {
  return typeof value === "function";
}

/** `mysql2/promise`'s createConnection, checked to be a function. */
function isMysqlConnect(value: unknown): value is (uri: string) => Promise<MysqlConnection> {
  return typeof value === "function";
}

/** The package as the user's project resolves it: the studio ships no database drivers of its own. */
function importFromProject(specifier: string, cwd: string) {
  return Effect.tryPromise({
    async try(): Promise<unknown> {
      const resolved = createRequire(path.join(cwd, "package.json")).resolve(specifier);
      const namespace: unknown = await import(pathToFileURL(resolved).href);
      return isRecord(namespace) && "default" in namespace ? namespace.default : namespace;
    },
    catch: (error) =>
      new DatabaseUnavailableError({
        reason: `Cannot load "${specifier}" from ${cwd}: ${message(error)}\n   Install it in your project (npm install ${specifier}) so drizzler studio can connect.`,
      }),
  });
}

function openSqlite(file: string, cwd: string) {
  return Effect.gen(function* () {
    const sqlite = yield* Effect.tryPromise({
      try: () => import("node:sqlite"),
      catch: () =>
        new DatabaseUnavailableError({
          reason: "SQLite needs the built-in node:sqlite module (Node.js 22.13 or newer).",
        }),
    });
    const db = yield* Effect.try({
      try: () => new sqlite.DatabaseSync(file === ":memory:" ? file : path.resolve(cwd, file)),
      catch: (error) => new DatabaseUnavailableError({ reason: message(error) }),
    });
    const driver: Driver = {
      dialect: "sqlite",
      query: (statement) =>
        Effect.flatMap(sqliteParams(statement.params), (params) =>
          Effect.try({
            try() {
              const prepared = db.prepare(statement.sql);
              const columns = prepared.columns().map((column) => column.name);
              // A statement with no result columns is a write: run it for the count it changed.
              if (columns.length === 0) {
                const info = prepared.run(...params);
                return { columns, rows: [], rowCount: Number(info.changes) };
              }
              const rows = rowsOf(prepared.all(...params));
              return { columns, rows, rowCount: rows.length };
            },
            catch: queryError,
          }),
        ),
      queryArrays: (statement) =>
        Effect.flatMap(sqliteParams(statement.params), (params) =>
          Effect.try({
            try() {
              const prepared = db.prepare(statement.sql);
              const columns = prepared.columns().map((column) => column.name);
              if (columns.length === 0) {
                const info = prepared.run(...params);
                return {
                  columns,
                  rows: [],
                  rowCount: Number(info.changes),
                  insertId: Number(info.lastInsertRowid),
                };
              }
              prepared.setReturnArrays(true);
              const rows = rowArrays(prepared.all(...params));
              return { columns, rows, rowCount: rows.length, insertId: null };
            },
            catch: queryError,
          }),
        ),
      close: Effect.sync(() => db.close()),
    };
    return driver;
  });
}

type PgClient = {
  readonly connect: () => Promise<void>;
  readonly end: () => Promise<void>;
  readonly query: (
    sql:
      | string
      | { readonly text: string; readonly values: readonly unknown[]; readonly rowMode: "array" },
    params?: readonly unknown[],
  ) => Promise<unknown>;
};

function openPostgres(url: string, cwd: string) {
  return Effect.gen(function* () {
    const pg = yield* importFromProject("pg", cwd);
    const pgClient = isRecord(pg) ? pg.Client : undefined;
    if (!isPgClientClass(pgClient)) {
      return yield* new DatabaseUnavailableError({
        reason: 'The "pg" package does not export Client.',
      });
    }
    const client = yield* Effect.tryPromise({
      async try() {
        const opened = new pgClient({ connectionString: url });
        await opened.connect();
        return opened;
      },
      catch: (error) => new DatabaseUnavailableError({ reason: message(error) }),
    });
    const driver: Driver = {
      dialect: "postgresql",
      query: (statement) =>
        Effect.tryPromise({
          async try() {
            const result = await client.query(statement.sql, statement.params);
            const rows = isRecord(result) ? rowsOf(result.rows) : [];
            const fields = isRecord(result) && Array.isArray(result.fields) ? result.fields : [];
            const columns = fields.filter(isRecord).map((field) => String(field.name));
            const rowCount =
              isRecord(result) && typeof result.rowCount === "number"
                ? result.rowCount
                : rows.length;
            return { columns, rows, rowCount };
          },
          catch: queryError,
        }),
      queryArrays: (statement) =>
        Effect.tryPromise({
          async try() {
            const result = await client.query({
              text: statement.sql,
              values: statement.params,
              rowMode: "array",
            });
            const rows = isRecord(result) ? rowArrays(result.rows) : [];
            const fields = isRecord(result) && Array.isArray(result.fields) ? result.fields : [];
            const rowCount =
              isRecord(result) && typeof result.rowCount === "number"
                ? result.rowCount
                : rows.length;
            return {
              columns: fields.filter(isRecord).map((field) => String(field.name)),
              rows,
              rowCount,
              insertId: null,
            };
          },
          catch: queryError,
        }),
      close: Effect.promise(() => client.end().catch(() => undefined)),
    };
    return driver;
  });
}

type MysqlConnection = {
  readonly query: (
    sql:
      | string
      | { readonly sql: string; readonly values: readonly unknown[]; readonly rowsAsArray: true },
    params?: readonly unknown[],
  ) => Promise<readonly [unknown, unknown]>;
  readonly end: () => Promise<void>;
};

function openMysql(url: string, cwd: string) {
  return Effect.gen(function* () {
    const mysql = yield* importFromProject("mysql2/promise", cwd);
    const createConnection = isRecord(mysql) ? mysql.createConnection : undefined;
    if (!isMysqlConnect(createConnection)) {
      return yield* new DatabaseUnavailableError({
        reason: 'The "mysql2/promise" package does not export createConnection.',
      });
    }
    const connection = yield* Effect.tryPromise({
      try: () => createConnection(url),
      catch: (error) => new DatabaseUnavailableError({ reason: message(error) }),
    });
    const driver: Driver = {
      dialect: "mysql",
      query: (statement) =>
        Effect.tryPromise({
          async try() {
            const [result, fields] = await connection.query(statement.sql, statement.params);
            if (Array.isArray(result)) {
              const rows = rowsOf(result);
              const columns = Array.isArray(fields)
                ? fields.filter(isRecord).map((field) => String(field.name))
                : Object.keys(rows[0] ?? {});
              return { columns, rows, rowCount: rows.length };
            }
            const affected =
              isRecord(result) && typeof result.affectedRows === "number" ? result.affectedRows : 0;
            return { columns: [], rows: [], rowCount: affected };
          },
          catch: queryError,
        }),
      queryArrays: (statement) =>
        Effect.tryPromise({
          async try() {
            const [result, fields] = await connection.query({
              sql: statement.sql,
              values: statement.params,
              rowsAsArray: true,
            });
            if (Array.isArray(result)) {
              const columns = Array.isArray(fields)
                ? fields.filter(isRecord).map((field) => String(field.name))
                : [];
              return {
                columns,
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
          },
          catch: queryError,
        }),
      close: Effect.promise(() => connection.end().catch(() => undefined)),
    };
    return driver;
  });
}

/**
 * Opens a connection to the user's database with the driver their project has installed:
 * node:sqlite for SQLite, `pg` for PostgreSQL, `mysql2` for MySQL. Every statement of the
 * connection is an Effect that fails with the driver's message.
 *
 * ```mermaid
 * flowchart LR
 *   in[input.dialect + input.url] --> which{dialect}
 *   which -- sqlite --> sqlite[(node:sqlite: input.file)]
 *   which -- postgresql --> pg[(pg from the project)]
 *   which -- mysql --> mysql[(mysql2 from the project)]
 *   which -- unknown --> err[DatabaseUnavailableError]
 *   sqlite --> driver[Driver: query, queryArrays, close]
 *   pg --> driver
 *   mysql --> driver
 * ```
 *
 * @param input.dialect - the database the URL names, or null for a URL drizzler does not know
 * @param input.url - the connection URL, used by PostgreSQL and MySQL
 * @param input.file - the SQLite file the URL names (`:memory:` for an in-memory database)
 * @param input.cwd - the project directory: drivers are loaded from it, and a relative SQLite file is resolved against it
 * @returns the open connection; fails with DatabaseUnavailableError when it cannot be opened
 */
export function openDriver(input: {
  readonly dialect: Dialect | null;
  readonly url: string;
  readonly file: string;
  readonly cwd: string;
}): Effect.Effect<Driver, DatabaseUnavailableError> {
  if (input.dialect === "sqlite") return openSqlite(input.file, input.cwd);
  if (input.dialect === "postgresql") return openPostgres(input.url, input.cwd);
  if (input.dialect === "mysql") return openMysql(input.url, input.cwd);
  return Effect.fail(
    new DatabaseUnavailableError({
      reason: `Unsupported database URL. Use file:./dev.db (SQLite), postgres://... or mysql://...`,
    }),
  );
}
