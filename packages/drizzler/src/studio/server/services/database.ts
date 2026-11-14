import { createRequire } from "node:module";
import path from "node:path";
import type { SQLInputValue } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { Effect } from "effect";
import type { Connection, Dialect, Statement } from "../domain/sql.js";
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
  /**
   * Every statement or none: a transaction on a connection that holds one open, one batch where
   * each request stands alone (Turso, D1). Fails with the statement the database refused.
   */
  readonly transaction: (statements: readonly Statement[]) => Effect.Effect<void, DatabaseError>;
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

function message(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  // A network failure says only "fetch failed"; what failed is in its cause (ECONNREFUSED, ...).
  return error.cause instanceof Error ? `${error.message}: ${message(error.cause)}` : error.message;
}

function queryError(error: unknown) {
  return new DatabaseError({ cause: message(error) });
}

function failedAt(error: DatabaseError, statement: Statement) {
  return new DatabaseError({
    cause: `${error.cause}\n   while running: ${statement.sql.slice(0, 200)}`,
  });
}

/**
 * Every statement on one connection between BEGIN and COMMIT; the first one refused rolls the
 * rest back. For the drivers that hold their connection open: node:sqlite, pg and mysql2.
 */
function sequentialTransaction(
  dialect: Dialect,
  query: (statement: Statement) => Effect.Effect<unknown, DatabaseError>,
) {
  return (statements: readonly Statement[]) =>
    Effect.gen(function* () {
      yield* query({ sql: dialect === "mysql" ? "START TRANSACTION" : "BEGIN", params: [] });
      yield* Effect.forEach(
        statements,
        (statement) =>
          query(statement).pipe(Effect.mapError((error) => failedAt(error, statement))),
        { discard: true },
      ).pipe(
        Effect.tapError(() =>
          query({ sql: "ROLLBACK", params: [] }).pipe(
            Effect.catch((error) => Effect.logWarning("ROLLBACK failed", error)),
          ),
        ),
      );
      yield* query({ sql: "COMMIT", params: [] });
    });
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
): value is new (options: { connectionString: string; ssl?: boolean }) => PgClient {
  return typeof value === "function";
}

/** `mysql2/promise`'s createConnection, checked to be a function. */
function isMysqlConnect(
  value: unknown,
): value is (
  config: string | { readonly uri: string; readonly ssl: { readonly rejectUnauthorized: true } },
) => Promise<MysqlConnection> {
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
    function query(statement: Statement) {
      return Effect.flatMap(sqliteParams(statement.params), (params) =>
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
      );
    }

    const driver: Driver = {
      dialect: "sqlite",
      query,
      transaction: sequentialTransaction("sqlite", query),
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
      close: Effect.try(() => db.close()).pipe(
        Effect.catch((error) => Effect.logWarning("cannot close the SQLite database", error)),
      ),
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

function openPostgres(url: string, tls: boolean, cwd: string) {
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
        // Neon and PlanetScale refuse a plain connection: TLS is turned on when the URL is silent.
        const opened = new pgClient({
          connectionString: url,
          ...(tls ? { ssl: true } : {}),
        });
        await opened.connect();
        return opened;
      },
      catch: (error) => new DatabaseUnavailableError({ reason: message(error) }),
    });
    function query(statement: Statement) {
      return Effect.tryPromise({
        async try() {
          const result = await client.query(statement.sql, statement.params);
          const rows = isRecord(result) ? rowsOf(result.rows) : [];
          const fields = isRecord(result) && Array.isArray(result.fields) ? result.fields : [];
          const columns = fields.filter(isRecord).map((field) => String(field.name));
          const rowCount =
            isRecord(result) && typeof result.rowCount === "number" ? result.rowCount : rows.length;
          return { columns, rows, rowCount };
        },
        catch: queryError,
      });
    }

    const driver: Driver = {
      dialect: "postgresql",
      query,
      transaction: sequentialTransaction("postgresql", query),
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
      close: Effect.tryPromise(() => client.end()).pipe(
        Effect.catch((error) => Effect.logWarning("cannot close the PostgreSQL connection", error)),
      ),
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

function openMysql(url: string, tls: boolean, cwd: string) {
  return Effect.gen(function* () {
    const mysql = yield* importFromProject("mysql2/promise", cwd);
    const createConnection = isRecord(mysql) ? mysql.createConnection : undefined;
    if (!isMysqlConnect(createConnection)) {
      return yield* new DatabaseUnavailableError({
        reason: 'The "mysql2/promise" package does not export createConnection.',
      });
    }
    const connection = yield* Effect.tryPromise({
      // PlanetScale refuses a plain connection: TLS is turned on when the URL is silent.
      try: () => createConnection(tls ? { uri: url, ssl: { rejectUnauthorized: true } } : url),
      catch: (error) => new DatabaseUnavailableError({ reason: message(error) }),
    });
    function query(statement: Statement) {
      return Effect.tryPromise({
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
      });
    }

    const driver: Driver = {
      dialect: "mysql",
      query,
      transaction: sequentialTransaction("mysql", query),
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
      close: Effect.tryPromise(() => connection.end()).pipe(
        Effect.catch((error) => Effect.logWarning("cannot close the MySQL connection", error)),
      ),
    };
    return driver;
  });
}

/** A value libSQL binds: SQLite's, plus the booleans and dates it converts itself. */
function isLibsqlInput(value: unknown) {
  return isSqlInput(value) || typeof value === "boolean" || value instanceof Date;
}

function libsqlParams(params: readonly unknown[]): Effect.Effect<unknown[], DatabaseError> {
  const bad = params.find((param) => !isLibsqlInput(param));
  if (bad !== undefined) {
    return Effect.fail(
      new DatabaseError({ cause: `libSQL cannot bind a ${typeof bad} parameter` }),
    );
  }
  return Effect.succeed([...params]);
}

/** What `@libsql/client` answers a statement with: rows are array-likes, read by index. */
type LibsqlResult = {
  readonly columns: readonly string[];
  readonly rows: readonly ArrayLike<unknown>[];
  readonly rowsAffected: number;
  readonly lastInsertRowid: bigint | undefined;
};

type LibsqlStatement = { readonly sql: string; readonly args: unknown[] };

type LibsqlClient = {
  readonly execute: (statement: LibsqlStatement) => Promise<LibsqlResult>;
  readonly batch: (statements: readonly LibsqlStatement[], mode: "write") => Promise<unknown>;
  readonly close: () => void;
};

/** `@libsql/client`'s createClient, checked to be a function. */
function isLibsqlConnect(
  value: unknown,
): value is (config: { readonly url: string; readonly authToken?: string }) => LibsqlClient {
  return typeof value === "function";
}

function libsqlArrays(result: LibsqlResult) {
  return result.rows.map((row) => result.columns.map((_, i) => row[i]));
}

/** The token from the first of the environment variables that holds one. */
function envToken(names: readonly string[]) {
  return Effect.sync(() => names.map((name) => process.env[name]).find((value) => !!value) ?? null);
}

function openLibsql(target: Extract<Connection, { readonly kind: "libsql" }>, cwd: string) {
  return Effect.gen(function* () {
    const libsql = yield* importFromProject("@libsql/client", cwd);
    const createClient = isRecord(libsql) ? libsql.createClient : undefined;
    if (!isLibsqlConnect(createClient)) {
      return yield* new DatabaseUnavailableError({
        reason: 'The "@libsql/client" package does not export createClient.',
      });
    }
    const authToken = target.authToken ?? (yield* envToken(["TURSO_AUTH_TOKEN"]));
    const client = yield* Effect.try({
      try: () => createClient({ url: target.url, ...(authToken === null ? {} : { authToken }) }),
      catch: (error) => new DatabaseUnavailableError({ reason: message(error) }),
    });
    function execute(statement: Statement) {
      return Effect.flatMap(libsqlParams(statement.params), (args) =>
        Effect.tryPromise({
          try: () => client.execute({ sql: statement.sql, args }),
          catch: queryError,
        }),
      );
    }

    // The client connects lazily: a first statement says now whether the URL and token are good.
    yield* execute({ sql: "SELECT 1", params: [] }).pipe(
      Effect.tapError(() => Effect.sync(() => client.close())),
      Effect.mapError((error) => new DatabaseUnavailableError({ reason: error.cause })),
    );
    const driver: Driver = {
      dialect: "sqlite",
      query: (statement) =>
        Effect.map(execute(statement), (result) => {
          const columns = [...result.columns];
          if (columns.length === 0) return { columns, rows: [], rowCount: result.rowsAffected };
          const rows = libsqlArrays(result).map((row) =>
            Object.fromEntries(columns.map((column, i) => [column, row[i]])),
          );
          return { columns, rows, rowCount: rows.length };
        }),
      queryArrays: (statement) =>
        Effect.map(execute(statement), (result) => {
          const columns = [...result.columns];
          if (columns.length === 0) {
            return {
              columns,
              rows: [],
              rowCount: result.rowsAffected,
              insertId:
                result.lastInsertRowid === undefined ? null : Number(result.lastInsertRowid),
            };
          }
          const rows = libsqlArrays(result);
          return { columns, rows, rowCount: rows.length, insertId: null };
        }),
      // Each request to Turso stands alone, so BEGIN would not hold: the client's batch is one
      // transaction on the server.
      transaction: (statements) =>
        Effect.gen(function* () {
          const batch = yield* Effect.forEach(statements, (statement) =>
            Effect.map(libsqlParams(statement.params), (args) => ({ sql: statement.sql, args })),
          );
          yield* Effect.tryPromise({
            try: () => client.batch(batch, "write"),
            catch(error) {
              const index =
                isRecord(error) && typeof error.statementIndex === "number"
                  ? error.statementIndex
                  : -1;
              const statement = statements[index];
              return statement === undefined
                ? queryError(error)
                : failedAt(queryError(error), statement);
            },
          });
        }),
      close: Effect.try(() => client.close()).pipe(
        Effect.catch((error) => Effect.logWarning("cannot close the libSQL client", error)),
      ),
    };
    return driver;
  });
}

/** A value D1's HTTP API binds: JSON's. Big integers go as numbers, or as text past the safe range. */
function d1Params(params: readonly unknown[]): Effect.Effect<unknown[], DatabaseError> {
  const bad = params.find(
    (param) =>
      param !== null &&
      typeof param !== "string" &&
      typeof param !== "number" &&
      typeof param !== "boolean" &&
      typeof param !== "bigint",
  );
  if (bad !== undefined) {
    return Effect.fail(
      new DatabaseError({ cause: `D1's HTTP API cannot bind a ${typeof bad} parameter` }),
    );
  }
  return Effect.succeed(params.map(d1Value));
}

function d1Value(param: unknown) {
  if (typeof param !== "bigint") return param;
  return Number.isSafeInteger(Number(param)) ? Number(param) : param.toString();
}

/** One statement's answer from D1's `/raw` endpoint: rows as arrays beside their columns. */
type D1Result = {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly unknown[])[];
  readonly changes: number;
  readonly lastRowId: number | null;
};

function d1Result(value: unknown): D1Result {
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
function d1Errors(body: unknown, status: number) {
  const errors = isRecord(body) && Array.isArray(body.errors) ? body.errors.filter(isRecord) : [];
  const messages = errors.map((error) =>
    typeof error.code === "number"
      ? `${String(error.message)} (${error.code})`
      : String(error.message),
  );
  return messages.length > 0 ? messages.join("; ") : `Cloudflare's API answered ${status}`;
}

/** One request to D1's `/raw` endpoint, answered with each statement's result. */
function d1Request(endpoint: string, token: string, body: unknown) {
  return Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(endpoint, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      catch: queryError,
    });
    const text = yield* Effect.tryPromise({ try: () => response.text(), catch: queryError });
    const answer: unknown = yield* Effect.try({
      try: () => JSON.parse(text),
      catch: () =>
        queryError(`Cloudflare's API answered ${response.status}: ${text.slice(0, 200)}`),
    });
    if (!response.ok || !isRecord(answer) || answer.success !== true) {
      return yield* new DatabaseError({ cause: d1Errors(answer, response.status) });
    }
    return Array.isArray(answer.result) ? answer.result.map(d1Result) : [];
  });
}

function openD1(target: Extract<Connection, { readonly kind: "d1" }>) {
  return Effect.gen(function* () {
    const token =
      target.token ?? (yield* envToken(["CLOUDFLARE_D1_TOKEN", "CLOUDFLARE_API_TOKEN"]));
    if (token === null) {
      return yield* new DatabaseUnavailableError({
        reason:
          "D1 needs a Cloudflare API token with D1 edit access: set CLOUDFLARE_D1_TOKEN, or add ?token=... to the URL.",
      });
    }
    const bearer = token;
    const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(target.accountId)}/d1/database/${encodeURIComponent(target.databaseId)}/raw`;
    /** Every statement in one request; D1 runs a batch as one transaction. */
    function post(statements: readonly Statement[]) {
      return Effect.flatMap(
        Effect.forEach(statements, (statement) =>
          Effect.map(d1Params(statement.params), (params) => ({ sql: statement.sql, params })),
        ),
        (batch) => d1Request(endpoint, bearer, batch.length === 1 ? batch[0] : { batch }),
      );
    }
    function one(statement: Statement) {
      return Effect.flatMap(post([statement]), (results) => {
        const result = results[0];
        return result === undefined
          ? Effect.fail(new DatabaseError({ cause: "D1 answered no result" }))
          : Effect.succeed(result);
      });
    }
    yield* one({ sql: "SELECT 1", params: [] }).pipe(
      Effect.mapError((error) => new DatabaseUnavailableError({ reason: error.cause })),
    );
    const driver: Driver = {
      dialect: "sqlite",
      query: (statement) =>
        Effect.map(one(statement), (result) => {
          if (result.columns.length === 0) {
            return { columns: [], rows: [], rowCount: result.changes };
          }
          const rows = result.rows.map((row) =>
            Object.fromEntries(result.columns.map((column, i) => [column, row[i]])),
          );
          return { columns: result.columns, rows, rowCount: rows.length };
        }),
      queryArrays: (statement) =>
        Effect.map(one(statement), (result) =>
          result.columns.length === 0
            ? { columns: [], rows: [], rowCount: result.changes, insertId: result.lastRowId }
            : {
                columns: result.columns,
                rows: result.rows,
                rowCount: result.rows.length,
                insertId: null,
              },
        ),
      transaction: (statements) =>
        statements.length === 0 ? Effect.void : Effect.asVoid(post(statements)),
      close: Effect.void,
    };
    return driver;
  });
}

/**
 * Opens a connection to the user's database: node:sqlite for a SQLite file, `@libsql/client` for
 * Turso, Cloudflare's HTTP API for D1, `pg` for PostgreSQL (Neon, PlanetScale), `mysql2` for MySQL
 * (PlanetScale). The packages are the ones the user's project has installed. Every statement of
 * the connection is an Effect that fails with the driver's message.
 *
 * ```mermaid
 * flowchart LR
 *   in[input.connection] --> which{kind}
 *   which -- sqlite --> sqlite[(node:sqlite: input.file)]
 *   which -- libsql --> libsql[(@libsql/client from the project)]
 *   which -- d1 --> d1[(Cloudflare D1 HTTP API)]
 *   which -- postgresql --> pg[(pg from the project)]
 *   which -- mysql --> mysql[(mysql2 from the project)]
 *   which -- unsupported --> err[DatabaseUnavailableError]
 *   sqlite --> driver[Driver: query, queryArrays, transaction, close]
 *   libsql --> driver
 *   d1 --> driver
 *   pg --> driver
 *   mysql --> driver
 * ```
 *
 * @param input.connection - how to reach the database, from makeConnection: the SQLite file (`:memory:` for an in-memory database), the Turso URL and token, the D1 ids and token, or the URL and whether to turn TLS on; `unsupported` fails with its reason
 * @param input.cwd - the project directory: drivers are loaded from it, and a relative SQLite file is resolved against it
 * @returns the open connection; fails with DatabaseUnavailableError when it cannot be opened
 */
export function openDriver(input: {
  readonly connection: Connection;
  readonly cwd: string;
}): Effect.Effect<Driver, DatabaseUnavailableError> {
  const { connection, cwd } = input;
  if (connection.kind === "sqlite") return openSqlite(connection.file, cwd);
  if (connection.kind === "libsql") return openLibsql(connection, cwd);
  if (connection.kind === "d1") return openD1(connection);
  if (connection.kind === "postgresql") return openPostgres(connection.url, connection.tls, cwd);
  if (connection.kind === "mysql") return openMysql(connection.url, connection.tls, cwd);
  return Effect.fail(new DatabaseUnavailableError({ reason: connection.reason }));
}
