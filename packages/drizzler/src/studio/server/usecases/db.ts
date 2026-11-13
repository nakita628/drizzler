import { Effect } from "effect";
import { analyze, paramsByStatement, splitStatements } from "../../../sql/index.js";
import * as DocsDomain from "../domain/docs.js";
import * as QueryDomain from "../domain/query.js";
import * as SqlDomain from "../domain/sql.js";
import type { CellValue, Dialect } from "../domain/sql.js";
import { DatabaseUnavailableError, InvalidInputError, UnknownTableError } from "../errors/index.js";
import { NO_DATABASE_MESSAGE } from "../constants/index.js";
import { readText } from "../services/file.js";
import * as ParseService from "../services/parse.js";
import * as PlanService from "../services/plan.js";
import { getStudio } from "../services/studio.js";

type Values = Readonly<Record<string, CellValue>>;

/** The tables of the saved schema; none while it does not parse. */
function tables() {
  return Effect.gen(function* () {
    const source = yield* readText({ file: getStudio().schemaPath });
    return ParseService.findSyntaxError({ source }) === null
      ? DocsDomain.makeDbTables({ models: ParseService.readSchema({ source }).models })
      : [];
  });
}

function driver() {
  const { driver } = getStudio().database;
  return driver === null
    ? Effect.fail(
        new DatabaseUnavailableError({
          reason: getStudio().database.status.error ?? NO_DATABASE_MESSAGE,
        }),
      )
    : Effect.succeed(driver);
}

function table(name: string) {
  return Effect.gen(function* () {
    const found = (yield* tables()).find((t) => t.name === name);
    if (found === undefined) return yield* new UnknownTableError({ table: name });
    return found;
  });
}

function checkFields(
  found: Effect.Success<ReturnType<typeof table>>,
  values: Values,
  field: string,
) {
  const unknown = SqlDomain.makeUnknownFields({ table: found, values });
  return unknown.length === 0
    ? Effect.void
    : Effect.fail(
        new InvalidInputError({
          field,
          message: `Unknown column${unknown.length > 1 ? "s" : ""} of ${found.name}: ${unknown.join(", ")}`,
        }),
      );
}

function requireSome(values: Values, field: string) {
  return Object.keys(values).length > 0
    ? Effect.void
    : Effect.fail(
        new InvalidInputError({ field, message: `${field} must name at least one column` }),
      );
}

/**
 * The database connection's status and the tables of the saved schema.
 *
 * @returns The connection status (connected, dialect, url, error) with the schema's `tables`
 *   (none while it does not parse). Fails with FileReadError.
 *
 * ```mermaid
 * sequenceDiagram
 *   participant U as DbUseCase
 *   participant F as file
 *   participant P as ParseService
 *   participant D as Domain
 *   U->>F: readText({ file: schemaPath })
 *   U->>P: readSchema(source)
 *   U->>D: DocsDomain.makeDbTables
 *   D-->>U: tables
 *   U-->>U: { ...status, tables }
 * ```
 */
export function readStatus() {
  return Effect.gen(function* () {
    return { ...getStudio().database.status, tables: yield* tables() };
  });
}

/** The plan an EXPLAIN gave, read as the dialect writes it. */
function planOf(dialect: Dialect, rows: readonly Readonly<Record<string, unknown>>[]) {
  if (dialect === "postgresql") {
    return PlanService.makePostgresPlan({ document: rows[0]?.["QUERY PLAN"] ?? null });
  }
  if (dialect === "mysql") {
    return PlanService.makeMysqlPlan({ document: rows[0]?.["EXPLAIN"] ?? null });
  }
  return PlanService.makeSqlitePlan({ rows });
}

/**
 * Row counts by table; a table whose count fails (not migrated yet, say) is left out.
 *
 * @returns The `counts` by table name. Fails with DatabaseUnavailableError without a database.
 *
 * ```mermaid
 * sequenceDiagram
 *   participant U as DbUseCase
 *   participant F as file
 *   participant P as ParseService
 *   participant D as Domain
 *   participant B as Driver
 *   alt no database
 *     U-->>U: DatabaseUnavailableError
 *   end
 *   U->>F: readText({ file: schemaPath })
 *   U->>P: readSchema(source)
 *   U->>D: DocsDomain.makeDbTables
 *   loop every table
 *     U->>D: SqlDomain.makeCountStatement
 *     U->>B: query(statement)
 *     B-->>U: count, or a failure (logged, table left out)
 *   end
 * ```
 */
export function readCounts() {
  return Effect.gen(function* () {
    const db = yield* driver();
    const counted = yield* Effect.forEach(yield* tables(), (t) =>
      db.query(SqlDomain.makeCountStatement({ dialect: db.dialect, table: t })).pipe(
        Effect.map((result) => [[t.name, Number(result.rows[0]?.count ?? 0)] as const]),
        Effect.catch((error) =>
          Effect.logDebug(`cannot count the rows of ${t.name}`, error).pipe(Effect.as([])),
        ),
      ),
    );
    return { counts: Object.fromEntries(counted.flat()) };
  });
}

/**
 * One page of a table's rows, or of the rows a search matches, with the total they come from.
 *
 * @param input.table - The table's export name.
 * @param input.skip - How many rows to skip.
 * @param input.take - How many rows to read.
 * @param input.search - Text to look for in any column; empty matches every row.
 * @returns The `rows` by property name, the `total`, and the `skip`, `take` and trimmed `search`.
 *   Fails with DatabaseUnavailableError, UnknownTableError, DatabaseError or FileReadError.
 *
 * ```mermaid
 * sequenceDiagram
 *   participant U as DbUseCase
 *   participant F as file
 *   participant P as ParseService
 *   participant D as Domain
 *   participant B as Driver
 *   alt no database
 *     U-->>U: DatabaseUnavailableError
 *   end
 *   U->>F: readText({ file: schemaPath })
 *   U->>P: readSchema(source)
 *   U->>D: DocsDomain.makeDbTables
 *   alt unknown table
 *     U-->>U: UnknownTableError
 *   end
 *   U->>D: SqlDomain.makeCountStatement
 *   U->>B: query(count)
 *   U->>D: SqlDomain.makeSelectStatement
 *   U->>B: query(page)
 *   B-->>U: rows
 *   U->>D: SqlDomain.makeRow (each row)
 *   Note over U,B: DatabaseError when a statement fails
 * ```
 */
export function readRows(input: {
  readonly table: string;
  readonly skip: number;
  readonly take: number;
  readonly search: string;
}) {
  return Effect.gen(function* () {
    const db = yield* driver();
    const found = yield* table(input.table);
    const search = input.search.trim();
    const total = yield* db.query(
      SqlDomain.makeCountStatement({ dialect: db.dialect, table: found, search }),
    );
    const page = yield* db.query(
      SqlDomain.makeSelectStatement({
        dialect: db.dialect,
        table: found,
        skip: input.skip,
        take: input.take,
        search,
      }),
    );
    return {
      rows: page.rows.map((row) => SqlDomain.makeRow({ table: found, row })),
      total: Number(total.rows[0]?.count ?? 0),
      skip: input.skip,
      take: input.take,
      search,
    };
  });
}

/**
 * Inserts one row; the columns left out take their defaults.
 *
 * @param input.table - The table's export name.
 * @param input.values - The values to insert, by property name.
 * @returns The `count` of rows inserted. Fails with DatabaseUnavailableError, UnknownTableError,
 *   InvalidInputError (an unknown column), DatabaseError or FileReadError.
 *
 * ```mermaid
 * sequenceDiagram
 *   participant U as DbUseCase
 *   participant F as file
 *   participant P as ParseService
 *   participant D as Domain
 *   participant B as Driver
 *   alt no database
 *     U-->>U: DatabaseUnavailableError
 *   end
 *   U->>F: readText({ file: schemaPath })
 *   U->>P: readSchema(source)
 *   U->>D: DocsDomain.makeDbTables
 *   alt unknown table
 *     U-->>U: UnknownTableError
 *   end
 *   U->>D: SqlDomain.makeUnknownFields(values)
 *   alt unknown column
 *     U-->>U: InvalidInputError
 *   end
 *   U->>D: SqlDomain.makeInsertStatement
 *   U->>B: query(insert)
 *   B-->>U: rowCount
 * ```
 */
export function insertRow(input: { readonly table: string; readonly values: Values }) {
  return Effect.gen(function* () {
    const db = yield* driver();
    const found = yield* table(input.table);
    yield* checkFields(found, input.values, "values");
    const result = yield* db.query(
      SqlDomain.makeInsertStatement({ dialect: db.dialect, table: found, values: input.values }),
    );
    return { count: result.rowCount };
  });
}

/**
 * Changes the row `where` names.
 *
 * @param input.table - The table's export name.
 * @param input.where - The key of the row to change, by property name.
 * @param input.values - The values to set, by property name.
 * @returns The `count` of rows changed. Fails with DatabaseUnavailableError, UnknownTableError,
 *   InvalidInputError (an empty `where` / `values`, or an unknown column), DatabaseError or FileReadError.
 *
 * ```mermaid
 * sequenceDiagram
 *   participant U as DbUseCase
 *   participant F as file
 *   participant P as ParseService
 *   participant D as Domain
 *   participant B as Driver
 *   alt no database
 *     U-->>U: DatabaseUnavailableError
 *   end
 *   U->>F: readText({ file: schemaPath })
 *   U->>P: readSchema(source)
 *   U->>D: DocsDomain.makeDbTables
 *   alt unknown table
 *     U-->>U: UnknownTableError
 *   end
 *   alt where / values empty, or an unknown column
 *     U-->>U: InvalidInputError
 *   end
 *   U->>D: SqlDomain.makeUpdateStatement
 *   U->>B: query(update)
 *   B-->>U: rowCount
 * ```
 */
export function updateRow(input: {
  readonly table: string;
  readonly where: Values;
  readonly values: Values;
}) {
  return Effect.gen(function* () {
    const db = yield* driver();
    const found = yield* table(input.table);
    yield* requireSome(input.where, "where");
    yield* requireSome(input.values, "values");
    yield* checkFields(found, input.where, "where");
    yield* checkFields(found, input.values, "values");
    const result = yield* db.query(
      SqlDomain.makeUpdateStatement({
        dialect: db.dialect,
        table: found,
        where: input.where,
        values: input.values,
      }),
    );
    return { count: result.rowCount };
  });
}

/**
 * Deletes the row `where` names.
 *
 * @param input.table - The table's export name.
 * @param input.where - The key of the row to delete, by property name.
 * @returns The `count` of rows deleted. Fails with DatabaseUnavailableError, UnknownTableError,
 *   InvalidInputError (an empty `where`, or an unknown column), DatabaseError or FileReadError.
 *
 * ```mermaid
 * sequenceDiagram
 *   participant U as DbUseCase
 *   participant F as file
 *   participant P as ParseService
 *   participant D as Domain
 *   participant B as Driver
 *   alt no database
 *     U-->>U: DatabaseUnavailableError
 *   end
 *   U->>F: readText({ file: schemaPath })
 *   U->>P: readSchema(source)
 *   U->>D: DocsDomain.makeDbTables
 *   alt unknown table
 *     U-->>U: UnknownTableError
 *   end
 *   alt where empty, or an unknown column
 *     U-->>U: InvalidInputError
 *   end
 *   U->>D: SqlDomain.makeDeleteStatement
 *   U->>B: query(delete)
 *   B-->>U: rowCount
 * ```
 */
export function deleteRow(input: { readonly table: string; readonly where: Values }) {
  return Effect.gen(function* () {
    const db = yield* driver();
    const found = yield* table(input.table);
    yield* requireSome(input.where, "where");
    yield* checkFields(found, input.where, "where");
    const result = yield* db.query(
      SqlDomain.makeDeleteStatement({ dialect: db.dialect, table: found, where: input.where }),
    );
    return { count: result.rowCount };
  });
}

/** The statements of the text, or an InvalidInputError when it holds none. */
function statementsOf(sql: string) {
  const statements = splitStatements(sql);
  return statements.length === 0
    ? Effect.fail(new InvalidInputError({ field: "sql", message: "holds no statement" }))
    : Effect.succeed(statements);
}

/**
 * Runs the statements one by one, each with the values its own placeholders take, and returns
 * the rows of the last, or the rows it changed for a write, with the time the whole took.
 *
 * @param input.sql - One or more SQL statements.
 * @param input.params - The values of their placeholders, in order across the statements.
 * @returns The last statement's `columns`, `rows` and `rowCount`, and `durationMs`. Fails with
 *   DatabaseUnavailableError, InvalidInputError (no statement) or DatabaseError.
 *
 * ```mermaid
 * sequenceDiagram
 *   participant U as DbUseCase
 *   participant S as sql
 *   participant D as SqlDomain
 *   participant B as Driver
 *   alt no database
 *     U-->>U: DatabaseUnavailableError
 *   end
 *   U->>S: splitStatements(sql)
 *   alt no statement
 *     U-->>U: InvalidInputError
 *   end
 *   U->>D: makeParam (each value)
 *   U->>S: paramsByStatement
 *   loop every statement
 *     U->>B: query(statement)
 *   end
 *   B-->>U: last result
 *   U->>D: makeCell (each value)
 *   Note over U,B: DatabaseError when a statement fails
 * ```
 */
export function runSql(input: { readonly sql: string; readonly params: readonly CellValue[] }) {
  return Effect.gen(function* () {
    const db = yield* driver();
    const statements = yield* statementsOf(input.sql);
    const params = input.params.map((value) => SqlDomain.makeParam({ dialect: db.dialect, value }));
    const bound = paramsByStatement(statements, params);
    const started = performance.now();
    const results = yield* Effect.forEach(statements, (sql, index) =>
      db.query({ sql, params: bound[index] ?? [] }),
    );
    const result = results.at(-1) ?? { columns: [], rows: [], rowCount: 0 };
    const columns = result.columns.length > 0 ? result.columns : Object.keys(result.rows[0] ?? {});
    return {
      columns: [...columns],
      rows: result.rows.map((row) =>
        Object.fromEntries(
          Object.entries(row).map(([key, value]) => [key, SqlDomain.makeCell({ value })]),
        ),
      ),
      rowCount: result.rowCount,
      durationMs: Math.round((performance.now() - started) * 100) / 100,
    };
  });
}

/**
 * The execution plan the database chooses for the first statement of the text.
 *
 * @param input.sql - One or more SQL statements; the first is explained.
 * @param input.params - The values of their placeholders.
 * @returns The `dialect`, the plan's `nodes` and the `raw` plan. Fails with
 *   DatabaseUnavailableError, InvalidInputError (no statement) or DatabaseError.
 *
 * ```mermaid
 * sequenceDiagram
 *   participant U as DbUseCase
 *   participant S as sql
 *   participant D as SqlDomain
 *   participant B as Driver
 *   participant L as PlanService
 *   alt no database
 *     U-->>U: DatabaseUnavailableError
 *   end
 *   U->>S: splitStatements(sql)
 *   alt no statement
 *     U-->>U: InvalidInputError
 *   end
 *   U->>D: makeExplainStatement
 *   U->>B: query(explain)
 *   B-->>U: rows
 *   U->>L: make(Postgres|Mysql|Sqlite)Plan
 *   L-->>U: nodes, raw
 * ```
 */
export function explainSql(input: { readonly sql: string; readonly params: readonly CellValue[] }) {
  return Effect.gen(function* () {
    const db = yield* driver();
    const [first = ""] = yield* statementsOf(input.sql);
    const params = paramsByStatement(
      [first],
      input.params.map((value) => SqlDomain.makeParam({ dialect: db.dialect, value })),
    )[0];
    const { rows } = yield* db.query({
      sql: SqlDomain.makeExplainStatement({ dialect: db.dialect, sql: first }),
      params: params ?? [],
    });
    const plan = planOf(db.dialect, rows);
    return { dialect: db.dialect, nodes: [...plan.nodes], raw: plan.raw };
  });
}

/**
 * Analyzes every statement of the text against the tables of the saved schema, in the connected
 * database's dialect, or the one the schema is written for while none is connected.
 *
 * @param input.sql - One or more SQL statements.
 * @returns The analysis: each statement's data flow, columns, parameters and problems. Fails with
 *   FileReadError when the schema cannot be read.
 *
 * ```mermaid
 * sequenceDiagram
 *   participant U as DbUseCase
 *   participant F as file
 *   participant P as ParseService
 *   participant D as Domain
 *   participant S as sql
 *   U->>F: readText({ file: schemaPath })
 *   U->>P: findSyntaxError(source)
 *   U->>D: QueryDomain.makeSchemaDialect (no database)
 *   U->>P: readSchema(source) (when it parses)
 *   U->>D: SqlDomain.makeAnalysisSchema
 *   U->>S: analyze(sql, schema)
 *   S-->>U: analysis
 * ```
 */
export function analyzeSql(input: { readonly sql: string }) {
  return Effect.gen(function* () {
    const source = yield* readText({ file: getStudio().schemaPath });
    const parses = ParseService.findSyntaxError({ source }) === null;
    const dialect =
      getStudio().database.status.dialect ?? QueryDomain.makeSchemaDialect({ source }) ?? "sqlite";
    return analyze(
      input.sql,
      SqlDomain.makeAnalysisSchema({
        dialect,
        models: parses ? ParseService.readSchema({ source }).models : [],
      }),
    );
  });
}
