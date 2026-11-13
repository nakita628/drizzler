import * as z from "zod";

export const Dialect = z
  .enum(["sqlite", "postgresql", "mysql"])
  .meta({ description: "The SQL dialect a database speaks" });
export type Dialect = z.infer<typeof Dialect>;

const CellValue = z
  .union([z.string(), z.number(), z.boolean(), z.null()])
  .meta({ description: "A value as the API carries it: what JSON can hold in a cell" });
export type CellValue = z.infer<typeof CellValue>;

export type Statement = { readonly sql: string; readonly params: readonly unknown[] };

const Values = z
  .record(z.string(), CellValue)
  .readonly()
  .meta({ description: "Values by property name", example: { title: "Hello" } });

const Table = z
  .object({
    table: z.string().meta({ description: "The database table name", example: "posts" }),
    columns: z
      .array(
        z
          .object({
            name: z.string().meta({ description: "The property name", example: "authorId" }),
            column: z.string().meta({ description: "The column name", example: "author_id" }),
          })
          .readonly(),
      )
      .readonly()
      .meta({ description: "Its columns" }),
    key: z
      .array(z.string())
      .readonly()
      .meta({ description: "The properties that identify a row", example: ["id"] }),
  })
  .readonly()
  .meta({ description: "A table as the data views read and write it" });
type Table = z.infer<typeof Table>;

const Url = z
  .object({ url: z.string().meta({ description: "A connection URL", example: "file:./dev.db" }) })
  .readonly()
  .meta({ description: "A connection URL" });

/**
 * The dialect a connection URL speaks; null for a scheme drizzler does not know.
 *
 * @param input - The connection `url`.
 * @returns `"postgresql"`, `"mysql"` or `"sqlite"`, or null.
 * @example
 * ```ts
 * makeDialect({ url: "postgres://localhost/app" }); // => "postgresql"
 * makeDialect({ url: "file:./dev.db" }); // => "sqlite"
 * ```
 */
export function makeDialect(input: z.infer<typeof Url>): Dialect | null {
  const { url } = input;
  if (/^postgres(ql)?:\/\//u.test(url)) return "postgresql";
  if (/^(mysql|mariadb):\/\//u.test(url)) return "mysql";
  if (/^(file|sqlite):/u.test(url) || /\.(db|sqlite3?)$/u.test(url) || url === ":memory:") {
    return "sqlite";
  }
  return null;
}

/**
 * The file a SQLite URL names: `file:./dev.db` and `sqlite:./dev.db` both mean `./dev.db`.
 *
 * @param input - The SQLite connection `url`.
 * @returns The path of the database file.
 * @example
 * ```ts
 * makeSqlitePath({ url: "file:./dev.db" }); // => "./dev.db"
 * ```
 */
export function makeSqlitePath(input: z.infer<typeof Url>) {
  return input.url.replace(/^(file|sqlite):(\/\/)?/u, "");
}

/**
 * The URL with its password replaced, for showing on the page.
 *
 * @param input - The connection `url`.
 * @returns The URL with `****` in place of the password.
 * @example
 * ```ts
 * makeRedactedUrl({ url: "postgres://ada:secret@localhost/app" });
 * // => "postgres://ada:****@localhost/app"
 * ```
 */
export function makeRedactedUrl(input: z.infer<typeof Url>) {
  return input.url.replace(/(\/\/[^:/@]+:)[^@]*@/u, "$1****@");
}

const MakeIdentifierInput = z
  .object({ dialect: Dialect, name: z.string().meta({ description: "A table or column name" }) })
  .readonly()
  .meta({ description: "A name to quote" });

/**
 * The name quoted as the dialect quotes identifiers: backticks on MySQL, double quotes elsewhere,
 * with the quote character doubled inside.
 *
 * @param input - The `dialect` and the table or column `name`.
 * @returns The quoted identifier.
 * @example
 * ```ts
 * makeIdentifier({ dialect: "postgresql", name: "order" }); // => '"order"'
 * makeIdentifier({ dialect: "mysql", name: "order" }); // => "`order`"
 * ```
 */
export function makeIdentifier(input: z.infer<typeof MakeIdentifierInput>) {
  return input.dialect === "mysql"
    ? `\`${input.name.replaceAll("`", "``")}\``
    : `"${input.name.replaceAll('"', '""')}"`;
}

/** The placeholder of the n-th parameter (1-based). */
function placeholder(dialect: Dialect, n: number) {
  return dialect === "postgresql" ? `$${n}` : "?";
}

const MakeParamInput = z
  .object({ dialect: Dialect, value: CellValue })
  .readonly()
  .meta({ description: "A value to bind" });

/**
 * A value as the driver takes it: SQLite has no boolean, so true and false go as 1 and 0.
 *
 * @param input - The `dialect` and the cell `value` to bind.
 * @returns The value to pass to the driver.
 * @example
 * ```ts
 * makeParam({ dialect: "sqlite", value: true }); // => 1
 * makeParam({ dialect: "postgresql", value: true }); // => true
 * ```
 */
export function makeParam(input: z.infer<typeof MakeParamInput>) {
  if (input.dialect === "sqlite" && typeof input.value === "boolean") return input.value ? 1 : 0;
  return input.value;
}

/**
 * A value a driver returned, as JSON can carry it: dates as ISO strings, big integers as numbers
 * (or text past the safe range), binary as `\x` hex, other objects as their JSON text.
 *
 * @param input.value - The value the driver returned.
 * @returns The cell value: a string, number, boolean or null.
 * @example
 * ```ts
 * makeCell({ value: 42n }); // => 42
 * makeCell({ value: new Uint8Array([0xde, 0xad]) }); // => "\\xdead"
 * ```
 */
export function makeCell(input: { readonly value: unknown }): CellValue {
  const { value } = input;
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "bigint") {
    return Number.isSafeInteger(Number(value)) ? Number(value) : value.toString();
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (value instanceof Uint8Array) return `\\x${Buffer.from(value).toString("hex")}`;
  return JSON.stringify(value);
}

function columnOf(table: Table, name: string) {
  return table.columns.find((c) => c.name === name)?.column ?? null;
}

const MakeUnknownFieldsInput = z
  .object({ table: Table, values: Values })
  .readonly()
  .meta({ description: "Values to write to a table" });

/**
 * The fields of `values` that the table does not have, for a 422.
 *
 * @param input - The `table` and the `values` to write to it, by property name.
 * @returns The property names the table has no column for.
 * @example
 * ```ts
 * makeUnknownFields({ table: { table: "posts", columns: [{ name: "id", column: "id" }, { name: "title", column: "title" }], key: ["id"] }, values: { title: "Hi", body: "x" } });
 * // => ["body"]
 * ```
 */
export function makeUnknownFields(input: z.infer<typeof MakeUnknownFieldsInput>) {
  return Object.keys(input.values).filter((name) => columnOf(input.table, name) === null);
}

const Search = z
  .string()
  .meta({ description: "Text to look for in any column; empty matches every row", example: "ada" });

/**
 * The WHERE clause of a search: any column, read as text, holds the text, whatever its case
 * (`ILIKE` on PostgreSQL, `LOWER` on MySQL, whose binary columns would match case-sensitively;
 * SQLite's `LIKE` ignores the case already). `%`, `_` and the escape are matched as written, and
 * the parameters are numbered from `from`.
 */
function searchClause(dialect: Dialect, table: Table, search: string, from: number) {
  if (search === "") return { sql: "", params: [] };
  const pattern = `%${search.replaceAll(/[!%_]/gu, "!$&")}%`;
  const tests = table.columns.map(({ column }, index) => {
    const name = makeIdentifier({ dialect, name: column });
    const param = placeholder(dialect, from + index);
    if (dialect === "postgresql") return `CAST(${name} AS TEXT) ILIKE ${param} ESCAPE '!'`;
    if (dialect === "mysql") return `LOWER(CAST(${name} AS CHAR)) LIKE LOWER(${param}) ESCAPE '!'`;
    return `CAST(${name} AS TEXT) LIKE ${param} ESCAPE '!'`;
  });
  return { sql: ` WHERE ${tests.join(" OR ")}`, params: table.columns.map(() => pattern) };
}

const MakeCountStatementInput = z
  .object({ dialect: Dialect, table: Table, search: Search.optional() })
  .readonly()
  .meta({ description: "A table to count, or the rows of it a search matches" });

/**
 * How many rows the table has, or how many of them the search matches.
 *
 * @param input - The `dialect`, the `table`, and an optional `search` text.
 * @returns The `sql` and its `params`.
 * @example
 * ```ts
 * makeCountStatement({ dialect: "sqlite", table: { table: "posts", columns: [{ name: "id", column: "id" }, { name: "title", column: "title" }], key: ["id"] } });
 * // => { sql: 'SELECT COUNT(*) AS count FROM "posts"', params: [] }
 * ```
 */
export function makeCountStatement(input: z.infer<typeof MakeCountStatementInput>) {
  const where = searchClause(input.dialect, input.table, input.search ?? "", 1);
  return {
    sql: `SELECT COUNT(*) AS count FROM ${makeIdentifier({ dialect: input.dialect, name: input.table.table })}${where.sql}`,
    params: where.params,
  };
}

const MakeSelectStatementInput = z
  .object({
    dialect: Dialect,
    table: Table,
    skip: z.number().meta({ description: "How many rows to skip", example: 0 }),
    take: z.number().meta({ description: "How many rows to read", example: 50 }),
    search: Search.optional(),
  })
  .readonly()
  .meta({ description: "A page of a table" });

/**
 * One page of rows, or of the rows a search matches, ordered by the key so paging is stable.
 *
 * @param input - The `dialect`, the `table`, how many rows to `skip` and `take`, and an optional
 *   `search` text.
 * @returns The `sql` and its `params`.
 * @example
 * ```ts
 * makeSelectStatement({ dialect: "postgresql", table: { table: "posts", columns: [{ name: "id", column: "id" }, { name: "title", column: "title" }], key: ["id"] }, skip: 0, take: 50 });
 * // => { sql: 'SELECT * FROM "posts" ORDER BY "id" LIMIT $1 OFFSET $2', params: [50, 0] }
 * ```
 */
export function makeSelectStatement(input: z.infer<typeof MakeSelectStatementInput>): Statement {
  const { dialect, table } = input;
  const order = table.key
    .map((name) => columnOf(table, name))
    .filter((column) => column !== null)
    .map((column) => makeIdentifier({ dialect, name: column }));
  const where = searchClause(dialect, table, input.search ?? "", 1);
  const next = where.params.length + 1;
  return {
    sql: [
      `SELECT * FROM ${makeIdentifier({ dialect, name: table.table })}${where.sql}`,
      ...(order.length > 0 ? [`ORDER BY ${order.join(", ")}`] : []),
      `LIMIT ${placeholder(dialect, next)} OFFSET ${placeholder(dialect, next + 1)}`,
    ].join(" "),
    params: [...where.params, input.take, input.skip],
  };
}

const MakeRowInput = z
  .object({
    table: Table,
    row: z
      .record(z.string(), z.unknown())
      .readonly()
      .meta({ description: "A row as the driver returned it, by column name" }),
  })
  .readonly()
  .meta({ description: "A row of a table" });

/**
 * A database row keyed back by property name; a column the schema does not know keeps its own.
 *
 * @param input - The `table` and the `row` the driver returned, by column name.
 * @returns The row by property name, each value as a cell.
 * @example
 * ```ts
 * makeRow({
 *   table: { table: "posts", columns: [{ name: "authorId", column: "author_id" }], key: [] },
 *   row: { author_id: 1, extra: 2n },
 * });
 * // => { authorId: 1, extra: 2 }
 * ```
 */
export function makeRow(input: z.infer<typeof MakeRowInput>) {
  return Object.fromEntries(
    Object.entries(input.row).map(([column, value]) => [
      input.table.columns.find((c) => c.column === column)?.name ?? column,
      makeCell({ value }),
    ]),
  );
}

const MakeInsertStatementInput = z
  .object({ dialect: Dialect, table: Table, values: Values })
  .readonly()
  .meta({ description: "A row to add; the columns left out take their defaults" });

/**
 * The INSERT for one row; with no values the row takes every default.
 *
 * @param input - The `dialect`, the `table`, and the `values` to insert by property name.
 * @returns The `sql` and its `params`.
 * @example
 * ```ts
 * makeInsertStatement({ dialect: "sqlite", table: { table: "posts", columns: [{ name: "id", column: "id" }, { name: "title", column: "title" }], key: ["id"] }, values: { title: "Hi" } });
 * // => { sql: 'INSERT INTO "posts" ("title") VALUES (?)', params: ["Hi"] }
 * ```
 */
export function makeInsertStatement(input: z.infer<typeof MakeInsertStatementInput>): Statement {
  const { dialect, table } = input;
  const entries = Object.entries(input.values);
  const name = makeIdentifier({ dialect, name: table.table });
  if (entries.length === 0) {
    return {
      sql:
        dialect === "mysql"
          ? `INSERT INTO ${name} () VALUES ()`
          : `INSERT INTO ${name} DEFAULT VALUES`,
      params: [],
    };
  }
  const columns = entries.map(([field]) =>
    makeIdentifier({ dialect, name: columnOf(table, field) ?? field }),
  );
  return {
    sql: `INSERT INTO ${name} (${columns.join(", ")}) VALUES (${entries.map((_, i) => placeholder(dialect, i + 1)).join(", ")})`,
    params: entries.map(([, value]) => makeParam({ dialect, value })),
  };
}

// NULL is matched with IS NULL and takes no parameter, so only the other columns are numbered.
function whereClause(
  dialect: Dialect,
  table: Table,
  where: z.infer<typeof Values>,
  offset: number,
) {
  const entries = Object.entries(where);
  const bound = entries.filter(([, value]) => value !== null);
  const conditions = entries.map(([field, value]) => {
    const column = makeIdentifier({ dialect, name: columnOf(table, field) ?? field });
    if (value === null) return `${column} IS NULL`;
    const n = offset + bound.findIndex(([name]) => name === field) + 1;
    return `${column} = ${placeholder(dialect, n)}`;
  });
  return {
    sql: conditions.join(" AND "),
    params: bound.map(([, value]) => makeParam({ dialect, value })),
  };
}

const MakeUpdateStatementInput = z
  .object({
    dialect: Dialect,
    table: Table,
    where: Values.meta({ description: "The key of the row to change" }),
    values: Values.meta({ description: "The values to set" }),
  })
  .readonly()
  .meta({ description: "A change to one row" });

/**
 * The UPDATE of the row `where` names; a null in `where` matches with IS NULL.
 *
 * @param input - The `dialect`, the `table`, the key of the row (`where`) and the `values` to set.
 * @returns The `sql` and its `params`, the values first, then the key.
 * @example
 * ```ts
 * makeUpdateStatement({ dialect: "postgresql", table: { table: "posts", columns: [{ name: "id", column: "id" }, { name: "title", column: "title" }], key: ["id"] }, where: { id: 1 }, values: { title: "Hi" } });
 * // => { sql: 'UPDATE "posts" SET "title" = $1 WHERE "id" = $2', params: ["Hi", 1] }
 * ```
 */
export function makeUpdateStatement(input: z.infer<typeof MakeUpdateStatementInput>): Statement {
  const { dialect, table } = input;
  const entries = Object.entries(input.values);
  const set = entries.map(
    ([field], i) =>
      `${makeIdentifier({ dialect, name: columnOf(table, field) ?? field })} = ${placeholder(dialect, i + 1)}`,
  );
  const where = whereClause(dialect, table, input.where, entries.length);
  return {
    sql: `UPDATE ${makeIdentifier({ dialect, name: table.table })} SET ${set.join(", ")} WHERE ${where.sql}`,
    params: [...entries.map(([, value]) => makeParam({ dialect, value })), ...where.params],
  };
}

const MakeDeleteStatementInput = z
  .object({
    dialect: Dialect,
    table: Table,
    where: Values.meta({ description: "The key of the row to delete" }),
  })
  .readonly()
  .meta({ description: "A row to delete" });

/**
 * The DELETE of the row `where` names; a null in `where` matches with IS NULL.
 *
 * @param input - The `dialect`, the `table` and the key of the row (`where`).
 * @returns The `sql` and its `params`.
 * @example
 * ```ts
 * makeDeleteStatement({ dialect: "sqlite", table: { table: "posts", columns: [{ name: "id", column: "id" }, { name: "title", column: "title" }], key: ["id"] }, where: { id: 1 } });
 * // => { sql: 'DELETE FROM "posts" WHERE "id" = ?', params: [1] }
 * ```
 */
export function makeDeleteStatement(input: z.infer<typeof MakeDeleteStatementInput>): Statement {
  const where = whereClause(input.dialect, input.table, input.where, 0);
  return {
    sql: `DELETE FROM ${makeIdentifier({ dialect: input.dialect, name: input.table.table })} WHERE ${where.sql}`,
    params: where.params,
  };
}

const MakeExplainStatementInput = z
  .object({
    dialect: Dialect,
    sql: z.string().meta({ description: "The statement to explain", example: "SELECT 1" }),
  })
  .readonly()
  .meta({ description: "A statement and the dialect whose EXPLAIN syntax to use" });

/**
 * The EXPLAIN form each database answers with a machine-readable plan; a trailing `;` is dropped.
 *
 * @param input - The `dialect` and the `sql` statement to explain.
 * @returns The EXPLAIN statement.
 * @example
 * ```ts
 * makeExplainStatement({ dialect: "postgresql", sql: "SELECT 1;" });
 * // => "EXPLAIN (FORMAT JSON) SELECT 1"
 * ```
 */
export function makeExplainStatement(input: z.infer<typeof MakeExplainStatementInput>) {
  const body = input.sql.trim().replace(/;\s*$/u, "");
  if (input.dialect === "postgresql") return `EXPLAIN (FORMAT JSON) ${body}`;
  if (input.dialect === "mysql") return `EXPLAIN FORMAT=JSON ${body}`;
  return `EXPLAIN QUERY PLAN ${body}`;
}

/** The type an enum column is stored as, per dialect. */
const ENUM_COLUMN_TYPES = { postgresql: "text", mysql: "enum", sqlite: "TEXT" } as const;

const MakeAnalysisSchemaInput = z
  .object({
    dialect: Dialect,
    models: z
      .array(
        z
          .object({
            name: z.string().meta({ description: "The exported name", example: "user" }),
            dbName: z.string().nullable().meta({ description: "The table name", example: "users" }),
            fields: z
              .array(
                z
                  .object({
                    name: z
                      .string()
                      .meta({ description: "The property name", example: "authorId" }),
                    dbName: z
                      .string()
                      .nullable()
                      .optional()
                      .meta({ description: "The column name", example: "author_id" }),
                    kind: z
                      .enum(["scalar", "object", "enum", "unsupported"])
                      .meta({ description: "What the field holds" }),
                    type: z
                      .string()
                      .meta({ description: "The column builder", example: "integer" }),
                    isList: z.boolean().meta({ description: "Whether it is an array column" }),
                    isRequired: z.boolean().meta({ description: "Whether it is NOT NULL" }),
                  })
                  .readonly(),
              )
              .readonly(),
          })
          .readonly(),
      )
      .readonly()
      .meta({ description: "The tables of the schema" }),
  })
  .readonly()
  .meta({ description: "The schema's tables and the dialect to read SQL in" });

/**
 * The tables the SQL analysis runs against, read off the schema: the names the database knows,
 * and a column's type as SQL spells its builder (`doublePrecision` is `double precision`), an
 * enum's as the dialect stores it, and an array's with `[]` on PostgreSQL.
 *
 * @param input - The `dialect` and the schema's `models`.
 * @returns The `dialect` and the `tables` with their columns' names, types and nullability.
 * @example
 * ```ts
 * makeAnalysisSchema({
 *   dialect: "postgresql",
 *   models: [{ name: "user", dbName: "users", fields: [{ name: "score", dbName: null, kind: "scalar", type: "doublePrecision", isList: false, isRequired: false }] }],
 * });
 * // => { dialect: "postgresql", tables: [{ name: "users", columns: [{ name: "score", dataType: "double precision", nullable: true }] }] }
 * ```
 */
export function makeAnalysisSchema(input: z.infer<typeof MakeAnalysisSchemaInput>) {
  const { dialect } = input;
  return {
    dialect,
    tables: input.models.map((model) => ({
      name: model.dbName ?? model.name,
      columns: model.fields
        .filter((field) => field.kind !== "object")
        .map((field) => {
          const base =
            field.kind === "enum"
              ? ENUM_COLUMN_TYPES[dialect]
              : field.type.replaceAll(/([a-z])([A-Z])/gu, "$1 $2").toLowerCase();
          return {
            name: field.dbName ?? field.name,
            dataType: field.isList && dialect === "postgresql" ? `${base}[]` : base,
            nullable: !field.isRequired,
          };
        }),
    })),
  };
}
