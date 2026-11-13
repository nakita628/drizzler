import * as z from "zod";
import type { SchemaModel } from "../../../types/index.js";
import { RelationFields } from "./docs.js";
import { makePosition } from "./parse.js";
import { Dialect } from "./sql.js";

/**
 * What drizzle-orm exports for writing queries, in scope without an import. One that the
 * installed version lacks is simply undefined at run time.
 */
export const OPERATORS = [
  "eq",
  "ne",
  "gt",
  "gte",
  "lt",
  "lte",
  "and",
  "or",
  "not",
  "isNull",
  "isNotNull",
  "inArray",
  "notInArray",
  "exists",
  "notExists",
  "between",
  "notBetween",
  "like",
  "notLike",
  "ilike",
  "notIlike",
  "arrayContains",
  "arrayContained",
  "arrayOverlaps",
  "asc",
  "desc",
  "sql",
  "count",
  "countDistinct",
  "avg",
  "avgDistinct",
  "sum",
  "sumDistinct",
  "max",
  "min",
  "getTableColumns",
] as const;

// A proxy driver decodes nothing on its own (`1` stays `1` for a boolean column); it is given the
// codecs of the driver the studio connects with: node:sqlite, pg and mysql2.
const PROXIES = {
  sqlite: {
    module: "drizzle-orm/sqlite-proxy",
    type: "SqliteRemoteDatabase",
    codecs: { module: "drizzle-orm/node-sqlite/codecs", name: "nodeSQLiteCodecs" },
  },
  postgresql: {
    module: "drizzle-orm/pg-proxy",
    type: "PgRemoteDatabase",
    codecs: { module: "drizzle-orm/node-postgres/codecs", name: "nodePgCodecs" },
  },
  mysql: {
    module: "drizzle-orm/mysql-proxy",
    type: "MySqlRemoteDatabase",
    codecs: { module: "drizzle-orm/mysql2/codecs", name: "mysql2Codecs" },
  },
} as const;

const MakeSchemaDialectInput = z
  .object({ source: z.string().meta({ description: "The schema source" }) })
  .readonly()
  .meta({ description: "A schema source" });

/**
 * The dialect the schema is written for, read from the table builder it calls.
 *
 * @param input - The schema `source`.
 * @returns `"postgresql"`, `"mysql"` or `"sqlite"`, or null when it calls none of their builders.
 * @example
 * ```ts
 * makeSchemaDialect({ source: 'export const user = pgTable("user", {})' });
 * // => "postgresql"
 * ```
 */
export function makeSchemaDialect(input: z.infer<typeof MakeSchemaDialectInput>): Dialect | null {
  if (/\bpgTable\s*\(/u.test(input.source)) return "postgresql";
  if (/\bmysqlTable\s*\(/u.test(input.source)) return "mysql";
  if (/\bsqliteTable\s*\(/u.test(input.source)) return "sqlite";
  return null;
}

/** The names a query has in scope: every export of the schema, and the operators it does not shadow. */
function scope(names: readonly string[]) {
  const tables = names.filter((name) => name !== "db");
  const shadowed = new Set(tables);
  const operators = OPERATORS.filter((name) => !shadowed.has(name));
  return { tables, operators };
}

const SPAN = {
  start: z.number().meta({ description: "Its first offset in the query" }),
  end: z.number().meta({ description: "The offset just past it" }),
} as const;

const MakeQueryBodyInput = z
  .object({
    code: z
      .string()
      .meta({ description: "The query as written", example: "db.select().from(user)" }),
    error: z
      .object({
        message: z.string().meta({ description: "What the parser says" }),
        offset: z.number().meta({ description: "Where the error starts in the query" }),
      })
      .readonly()
      .nullable()
      .meta({ description: "Its first syntax error; null when it parsed" }),
    last: z
      .object({
        ...SPAN,
        expression: z
          .object(SPAN)
          .readonly()
          .meta({ description: "The expression the statement is made of" }),
      })
      .readonly()
      .nullable()
      .meta({ description: "Its last statement, when that is an expression statement" }),
  })
  .readonly()
  .meta({ description: "A query and what the parser found in it" });

/**
 * The query as the body of an async function, its last expression statement turned into a
 * `return`, so `db.select().from(user)` gives its rows the way a REPL gives a value. A query
 * that does not parse fails with the line and column of the error in the query's own text.
 *
 * @param input - The query `code`, its first syntax `error` (null when it parsed) and the span of
 *   its `last` statement when that is an expression statement.
 * @returns The function `body` with a null `error`, or a null `body` with the `error`'s position.
 * @example
 * ```ts
 * makeQueryBody({
 *   code: "db.select().from(user)",
 *   error: null,
 *   last: { start: 0, end: 22, expression: { start: 0, end: 22 } },
 * });
 * // => { body: "return (db.select().from(user));", error: null }
 * ```
 */
export function makeQueryBody(input: z.infer<typeof MakeQueryBodyInput>) {
  const { code, error, last } = input;
  if (error !== null) {
    const position = makePosition({ source: code, offset: error.offset });
    return { body: null, error: { message: error.message, ...position } } as const;
  }
  if (last === null) return { body: code, error: null } as const;
  const expression = code.slice(last.expression.start, last.expression.end);
  return {
    body: `${code.slice(0, last.start)}return (${expression});${code.slice(last.end)}`,
    error: null,
  } as const;
}

const Names = z
  .array(z.string())
  .readonly()
  .meta({ description: "The names the schema exports", example: ["user", "post"] });

const MakeTypePreambleInput = z
  .object({
    dialect: Dialect,
    schemaImport: z
      .string()
      .meta({ description: "The schema as the query file imports it", example: "./schema.ts" }),
    names: Names,
  })
  .readonly()
  .meta({ description: "What a query is type-checked against" });

/**
 * The lines the language service reads in front of a query: `db` typed as the schema's Drizzle
 * database, the schema's exports and the operators imported, and the query inside an async
 * function so `await` and `return` mean what they do when it runs. `suffix` closes it.
 *
 * @param input - The `dialect`, the `schemaImport` the query file imports the schema by, and the
 *   `names` the schema exports.
 * @returns The `preamble` to put before the query and the `suffix` to put after it.
 * @example
 * ```ts
 * const { preamble, suffix } = makeTypePreamble({ dialect: "sqlite", schemaImport: "./schema.ts", names: ["user"] });
 * preamble.split("\n")[0]; // => 'import type { SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";'
 * suffix; // => "\n}\n"
 * ```
 */
export function makeTypePreamble(input: z.infer<typeof MakeTypePreambleInput>) {
  const proxy = PROXIES[input.dialect];
  const { tables, operators } = scope(input.names);
  // `db.query` has every table, with the relations the schema's `defineRelations` and
  // `defineRelationsPart` exports declare, as the runtime module merges them.
  const relations = "__Every & __UnionToIntersection<__Declared<typeof __schema>>";
  const lines = [
    `import type { ${proxy.type} } from "${proxy.module}";`,
    `import type { ExtractTablesFromSchema, ExtractTablesWithRelations } from "drizzle-orm";`,
    `import * as __schema from "${input.schemaImport}";`,
    `import { ${operators.join(", ")} } from "drizzle-orm";`,
    ...(tables.length > 0 ? [`import { ${tables.join(", ")} } from "${input.schemaImport}";`] : []),
    `type __Every = ExtractTablesWithRelations<{}, ExtractTablesFromSchema<typeof __schema>>;`,
    `type __Declared<S> = { [K in keyof S]: S[K] extends { readonly [table: string]: { readonly table: unknown; readonly name: string; readonly relations: object } } ? S[K] : never }[keyof S];`,
    `type __UnionToIntersection<U> = [U] extends [never] ? {} : (U extends unknown ? (u: U) => void : never) extends (i: infer I) => void ? I : never;`,
    `declare const db: ${proxy.type}<${input.dialect === "sqlite" ? "unknown, " : ""}${relations}>;`,
    `export default async function __drizzler_query() {`,
    "",
  ];
  return { preamble: lines.join("\n"), suffix: "\n}\n" };
}

const MakeRuntimeModuleInput = z
  .object({
    dialect: Dialect,
    schemaUrl: z.string().meta({ description: "The file URL the schema is loaded from" }),
    names: Names,
    body: z.string().meta({ description: "The query as the body of the function" }),
  })
  .readonly()
  .meta({ description: "What a query runs with" });

/**
 * The module a query runs as: Drizzle's proxy driver for the dialect over `callback`, which the
 * studio answers from its own connection, with the schema loaded from `schemaUrl`.
 *
 * @param input - The `dialect`, the `schemaUrl` to load the schema from, the `names` it exports
 *   and the query `body`.
 * @returns The module's source text.
 * @example
 * ```ts
 * makeRuntimeModule({ dialect: "sqlite", schemaUrl: "file:///app/schema.ts", names: [], body: "return 1;" })
 *   .split("\n")[0];
 * // => 'import { drizzle as __drizzle } from "drizzle-orm/sqlite-proxy";'
 * ```
 */
export function makeRuntimeModule(input: z.infer<typeof MakeRuntimeModuleInput>) {
  const proxy = PROXIES[input.dialect];
  const { tables, operators } = scope(input.names);
  return [
    `import { drizzle as __drizzle } from "${proxy.module}";`,
    `import { ${proxy.codecs.name} as __codecs } from "${proxy.codecs.module}";`,
    `import * as __schema from "${input.schemaUrl}";`,
    `import * as __orm from "drizzle-orm";`,
    // Every table is queryable; the schema's `defineRelations` export and its parts add their
    // relations, the main one (with the most tables) first, each table's relations merged.
    `const __isRelational = (v) => v !== null && typeof v === "object" && !__orm.is(v, __orm.Table) &&`,
    `  Object.values(v).length > 0 && Object.values(v).every((e) => e !== null && typeof e === "object" &&`,
    `  __orm.is(e.table, __orm.Table) && typeof e.relations === "object");`,
    `const __relations = [__orm.defineRelations(__schema), ...Object.values(__schema)`,
    `  .filter(__isRelational).sort((a, b) => Object.keys(b).length - Object.keys(a).length)]`,
    `  .reduce((all, config) => {`,
    `    for (const [key, entry] of Object.entries(config)) {`,
    `      all[key] = all[key] === undefined ? entry : { ...entry, relations: { ...all[key].relations, ...entry.relations } };`,
    `    }`,
    `    return all;`,
    `  }, {});`,
    `export default async function (__executor) {`,
    `  const db = __drizzle(__executor, { relations: __relations, codecs: __codecs });`,
    `  const { ${operators.join(", ")} } = __orm;`,
    ...(tables.length > 0 ? [`  const { ${tables.join(", ")} } = __schema;`] : []),
    input.body,
    `}`,
  ].join("\n");
}

/**
 * A value a query returned, as JSON can carry it: dates as ISO strings, big integers as numbers
 * (or text past the safe range), binary as `\x` hex, maps as objects, sets as arrays, and a
 * value met again inside itself as `"[Circular]"`.
 *
 * @param input.value - The value to convert.
 * @param input.seen - The objects already met on the way down; left out at the top.
 * @returns The value as JSON can hold it.
 * @example
 * ```ts
 * makeJsonValue({ value: { at: new Date("2026-01-02T03:04:05Z"), n: 42n } });
 * // => { at: "2026-01-02T03:04:05.000Z", n: 42 }
 * ```
 */
export function makeJsonValue(input: {
  readonly value: unknown;
  readonly seen?: WeakSet<object>;
}): unknown {
  const { value } = input;
  const seen = input.seen ?? new WeakSet<object>();
  if (value === undefined || value === null) return null;
  if (typeof value === "bigint") {
    return Number.isSafeInteger(Number(value)) ? Number(value) : value.toString();
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "function" || typeof value === "symbol") return String(value);
  if (typeof value !== "object") return value;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (value instanceof Uint8Array) return `\\x${Buffer.from(value).toString("hex")}`;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (value instanceof Map) {
    return Object.fromEntries(
      [...value].map(([k, v]) => [String(k), makeJsonValue({ value: v, seen })]),
    );
  }
  if (value instanceof Set || Array.isArray(value)) {
    return [...value].map((item) => makeJsonValue({ value: item, seen }));
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, makeJsonValue({ value: item, seen })]),
  );
}

const MakeQueryTouchedInput = z
  .object({
    models: z.array(z.custom<SchemaModel>()).readonly().meta({ description: "The tables" }),
    relationFields: RelationFields,
    names: z
      .array(z.string())
      .readonly()
      .meta({ description: "The identifiers the query reads", example: ["db", "post", "eq"] }),
    members: z
      .array(
        z
          .object({
            object: z.string().meta({ description: "The object read", example: "post" }),
            property: z
              .string()
              .meta({ description: "The property read off it", example: "title" }),
          })
          .readonly(),
      )
      .readonly()
      .meta({ description: "The `a.b` accesses of the query" }),
    queries: z
      .array(z.string())
      .readonly()
      .meta({ description: "The tables of `db.query.<table>`", example: ["user"] }),
    withs: z
      .array(z.string())
      .readonly()
      .meta({ description: "The relation names given to `with`", example: ["posts"] }),
    writes: z
      .array(z.string())
      .readonly()
      .meta({ description: "The names handed to insert, update or delete", example: ["post"] }),
  })
  .readonly()
  .meta({ description: "The tables of a schema and the names a query uses" });

/**
 * The tables a query touches, each with the columns it names: a table read by its name or through
 * `db.query`, and the tables its `with` reaches through the relations of the ones already touched;
 * the ones it inserts into, updates or deletes from are marked as written.
 *
 * @param input - The schema's `models` and `relationFields`, and what the query uses: the `names`
 *   it reads, its `members` (`a.b`), the tables of its `queries`, its `withs` and its `writes`.
 * @returns One entry per touched table: its `table`, the `columns` named and whether it is a `write`.
 * @example
 * ```ts
 * makeQueryTouched({
 *   models: [{ name: "user", fields: [{ name: "id" }, { name: "name" }] }],
 *   relationFields: [],
 *   names: ["db", "user"],
 *   members: [{ object: "user", property: "name" }],
 *   queries: [],
 *   withs: [],
 *   writes: [],
 * });
 * // => [{ table: "user", columns: ["name"], write: false }]
 * ```
 */
export function makeQueryTouched(input: z.infer<typeof MakeQueryTouchedInput>) {
  const named = new Set([...input.names, ...input.queries]);
  const start = new Set(input.models.map((m) => m.name).filter((name) => named.has(name)));
  // A `with` can nest, so the relations are followed until nothing new is reached.
  const withs = new Set(input.withs);
  function reached(from: ReadonlySet<string>): ReadonlySet<string> {
    const next = new Set([
      ...from,
      ...input.relationFields
        .filter((field) => from.has(field.table) && withs.has(field.name))
        .map((field) => field.target),
    ]);
    return next.size === from.size ? from : reached(next);
  }
  const touched = reached(start);
  const membersOf = Map.groupBy(input.members, (m) => m.object);
  const writes = new Set(input.writes);
  return input.models
    .filter((model) => touched.has(model.name))
    .map((model) => {
      const fields = new Set(model.fields.map((f) => f.name));
      const columns = (membersOf.get(model.name) ?? [])
        .filter((m) => fields.has(m.property))
        .map((m) => m.property);
      return {
        table: model.name,
        columns: [...new Set(columns)],
        write: writes.has(model.name),
      };
    });
}
