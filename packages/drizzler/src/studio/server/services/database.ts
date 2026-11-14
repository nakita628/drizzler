import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Effect } from "effect";
import type { Connection, Dialect, Statement } from "../domain/sql.js";
import {
  answerArrayResult,
  answerResult,
  batchFailureIndex,
  d1Body,
  errorMessage,
  failedStatement,
  isRecord,
  isSqliteValue,
  readD1Response,
  readLibsqlResult,
  readMysqlArrayResult,
  readMysqlResult,
  readPgArrayResult,
  readPgResult,
  rowArrays,
  rowRecords,
  bindError,
} from "../../../sql/driver.js";
import type { Binder, DriverArrayResult, DriverResult } from "../../../sql/driver.js";
import { DatabaseError, DatabaseUnavailableError } from "../errors/index.js";

/** An open connection: every statement is an Effect that fails with the driver's message. */
export type Driver = {
  readonly dialect: Dialect;
  readonly query: (statement: Statement) => Effect.Effect<DriverResult, DatabaseError>;
  /** The same, with each row an array: two columns of one name (a join) both survive. */
  readonly queryArrays: (statement: Statement) => Effect.Effect<DriverArrayResult, DatabaseError>;
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

function queryError(error: unknown) {
  return new DatabaseError({ cause: errorMessage(error) });
}

function failedAt(error: DatabaseError, statement: Statement) {
  return new DatabaseError({ cause: failedStatement(error.cause, statement.sql) });
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

/** The parameters, when the driver binds every one; else the statement fails, saying which it cannot. */
function bindable(binder: Binder, params: readonly unknown[]) {
  const reason = bindError(binder, params);
  return reason === null
    ? Effect.succeed([...params])
    : Effect.fail(new DatabaseError({ cause: reason }));
}

/** The same for node:sqlite, typed as it binds them. */
function sqliteParams(params: readonly unknown[]) {
  return Effect.map(bindable("sqlite", params), (values) => values.filter(isSqliteValue));
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
        reason: `Cannot load "${specifier}" from ${cwd}: ${errorMessage(error)}\n   Install it in your project (npm install ${specifier}) so drizzler studio can connect.`,
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
      catch: (error) => new DatabaseUnavailableError({ reason: errorMessage(error) }),
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
            const rows = rowRecords(prepared.all(...params));
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
      catch: (error) => new DatabaseUnavailableError({ reason: errorMessage(error) }),
    });
    function query(statement: Statement) {
      return Effect.tryPromise({
        async try() {
          return readPgResult(await client.query(statement.sql, statement.params));
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
            return readPgArrayResult(result);
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
      catch: (error) => new DatabaseUnavailableError({ reason: errorMessage(error) }),
    });
    function query(statement: Statement) {
      return Effect.tryPromise({
        async try() {
          const [result, fields] = await connection.query(statement.sql, statement.params);
          return readMysqlResult(result, fields);
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
            return readMysqlArrayResult(result, fields);
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

type LibsqlStatement = { readonly sql: string; readonly args: unknown[] };

type LibsqlClient = {
  readonly execute: (statement: LibsqlStatement) => Promise<unknown>;
  readonly batch: (statements: readonly LibsqlStatement[], mode: "write") => Promise<unknown>;
  readonly close: () => void;
};

/** `@libsql/client`'s createClient, checked to be a function. */
function isLibsqlConnect(
  value: unknown,
): value is (config: { readonly url: string; readonly authToken?: string }) => LibsqlClient {
  return typeof value === "function";
}

function libsqlStatement(statement: Statement) {
  return Effect.map(bindable("libsql", statement.params), (args) => ({ sql: statement.sql, args }));
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
    const { url, authToken } = target;
    const client = yield* Effect.try({
      try: () => createClient({ url, ...(authToken === null ? {} : { authToken }) }),
      catch: (error) => new DatabaseUnavailableError({ reason: errorMessage(error) }),
    });
    function execute(statement: Statement) {
      return Effect.flatMap(libsqlStatement(statement), (prepared) =>
        Effect.tryPromise({ try: () => client.execute(prepared), catch: queryError }).pipe(
          Effect.map(readLibsqlResult),
        ),
      );
    }
    // The client connects lazily: a first statement says now whether the URL and token are good.
    yield* execute({ sql: "SELECT 1", params: [] }).pipe(
      Effect.tapError(() => Effect.sync(() => client.close())),
      Effect.mapError((error) => new DatabaseUnavailableError({ reason: error.cause })),
    );
    const driver: Driver = {
      dialect: "sqlite",
      query: (statement) => Effect.map(execute(statement), answerResult),
      queryArrays: (statement) => Effect.map(execute(statement), answerArrayResult),
      // Each request to Turso stands alone, so BEGIN would not hold: the client's batch is one
      // transaction on the server.
      transaction: (statements) =>
        Effect.flatMap(Effect.forEach(statements, libsqlStatement), (batch) =>
          Effect.tryPromise({
            try: () => client.batch(batch, "write"),
            catch(error) {
              const statement = statements[batchFailureIndex(error) ?? -1];
              return statement === undefined
                ? queryError(error)
                : failedAt(queryError(error), statement);
            },
          }),
        ),
      close: Effect.try(() => client.close()).pipe(
        Effect.catch((error) => Effect.logWarning("cannot close the libSQL client", error)),
      ),
    };
    return driver;
  });
}

/** One request to D1's `/raw` endpoint, answered with each statement's result. */
function d1Request(target: D1Connection, body: unknown) {
  return Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(target.endpoint, {
          method: "POST",
          headers: { authorization: `Bearer ${target.token}`, "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      catch: queryError,
    });
    const text = yield* Effect.tryPromise({ try: () => response.text(), catch: queryError });
    // A body that is not JSON is not dropped: readD1Response quotes it as the failure.
    const json: unknown = yield* Effect.try(() => JSON.parse(text)).pipe(
      Effect.match({ onSuccess: (value: unknown) => value, onFailure: () => undefined }),
    );
    const read = readD1Response({ status: response.status, text, body: json });
    return "error" in read ? yield* new DatabaseError({ cause: read.error }) : read.answers;
  });
}

type D1Connection = Extract<Connection, { readonly kind: "d1" }>;

/** Every statement in one request; D1 runs a batch as one transaction. */
function d1Post(target: D1Connection, statements: readonly Statement[]) {
  return Effect.flatMap(
    Effect.forEach(statements, (statement) => bindable("d1", statement.params)),
    () => d1Request(target, d1Body(statements)),
  );
}

/** One statement, and its answer. */
function d1One(target: D1Connection, statement: Statement) {
  return Effect.flatMap(d1Post(target, [statement]), (answers) => {
    const answer = answers[0];
    return answer === undefined
      ? Effect.fail(new DatabaseError({ cause: "D1 answered no result" }))
      : Effect.succeed(answer);
  });
}

function openD1(target: D1Connection) {
  return Effect.gen(function* () {
    // Each request stands alone: a first statement says now whether the endpoint and token are good.
    yield* d1One(target, { sql: "SELECT 1", params: [] }).pipe(
      Effect.mapError((error) => new DatabaseUnavailableError({ reason: error.cause })),
    );
    const driver: Driver = {
      dialect: "sqlite",
      query: (statement) => Effect.map(d1One(target, statement), answerResult),
      queryArrays: (statement) => Effect.map(d1One(target, statement), answerArrayResult),
      transaction: (statements) =>
        statements.length === 0 ? Effect.void : Effect.asVoid(d1Post(target, statements)),
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
 * @param input.connection - how to reach the database, from makeConnection: the SQLite file (`:memory:` for an in-memory database), the Turso URL and token, D1's endpoint and token, or the URL and whether to turn TLS on; `unsupported` fails with its reason
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
