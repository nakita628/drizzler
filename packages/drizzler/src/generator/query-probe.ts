// The module drizzler writes beside the project's node_modules to build each query example's SQL
// with the project's drizzle-orm, and what it gives back, read. Pure: core/schema-sql.ts writes,
// imports and removes the module.
import type { QueryExample, QueryExampleSql } from "./query-examples.js";

/** The tables' definitions as drizzle-kit writes them, or why they could not be written. */
export type SchemaDdl = { readonly statements: readonly string[]; readonly error: string | null };

// Drizzle's proxy drivers need no database client: the SQL is built, never sent.
const PROXIES = {
  pg: "drizzle-orm/pg-proxy",
  mysql: "drizzle-orm/mysql-proxy",
  sqlite: "drizzle-orm/sqlite-proxy",
} as const;

// drizzle-kit's programmatic API for each dialect, which writes a migration from two snapshots.
const KITS = {
  pg: "drizzle-kit/payload/postgres",
  mysql: "drizzle-kit/payload/mysql",
  sqlite: "drizzle-kit/payload/sqlite",
} as const;

/**
 * The module that imports the schema, builds `db` and turns each example into its SQL, and has
 * drizzle-kit write the tables' definitions. The caller writes it to a file and imports it.
 */
export function makeProbeModule(input: {
  readonly dialect: keyof typeof PROXIES;
  /** The schema files, as the `file:` URLs the module imports. */
  readonly fileUrls: readonly string[];
  readonly examples: readonly QueryExample[];
}) {
  const namespaces = input.fileUrls.map((_, i) => `__s${i}`);
  const tables = [...new Set(input.examples.map((example) => example.table))];
  return [
    `import * as __orm from "drizzle-orm";`,
    `import { drizzle as __drizzle } from "${PROXIES[input.dialect]}";`,
    ...input.fileUrls.map((url, i) => `import * as __s${i} from ${JSON.stringify(url)};`),
    `const __schema = Object.assign({}, ${namespaces.join(", ")});`,
    // Every table is queryable; each `defineRelations` export and part adds its relations, the
    // main one (with the most tables) first, each table's relations merged, as the studio does.
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
    `const db = __drizzle(async () => ({ rows: [] }), { relations: __relations });`,
    `const { eq, and, count } = __orm;`,
    `const { ${tables.join(", ")} } = __schema;`,
    `const __param = (v) => v instanceof Date ? v.toISOString() : typeof v === "bigint" ? String(v) : v;`,
    `const __sql = (build) => {`,
    `  try { const q = build().toSQL(); return { sql: q.sql, params: q.params.map(__param), error: null }; }`,
    `  catch (e) { return { sql: null, params: [], error: String(e instanceof Error ? e.message : e) }; }`,
    `};`,
    // A default the schema computes ($defaultFn, $onUpdate) reads the clock or a random source;
    // they are held still while the SQL is built, so the docs are the same on every run.
    `const __fixed = Date.parse("2026-01-01T00:00:00.000Z");`,
    `const __Date = globalThis.Date;`,
    `class __FixedDate extends __Date {`,
    `  constructor(...args) { if (args.length === 0) super(__fixed); else super(...args); }`,
    `  static now() { return __fixed; }`,
    `}`,
    `const __crypto = globalThis.crypto;`,
    `const __random = Math.random;`,
    `const __still = (run) => {`,
    `  globalThis.Date = __FixedDate;`,
    `  Math.random = () => 0.5;`,
    `  Object.defineProperty(__crypto, "randomUUID", { value: () => "00000000-0000-4000-8000-000000000000", configurable: true });`,
    `  Object.defineProperty(__crypto, "getRandomValues", { value: (array) => array.fill(0), configurable: true });`,
    `  try { return run(); }`,
    `  finally {`,
    `    globalThis.Date = __Date;`,
    `    Math.random = __random;`,
    `    delete __crypto.randomUUID;`,
    `    delete __crypto.getRandomValues;`,
    `  }`,
    `};`,
    `export default __still(() => [`,
    ...input.examples.map((example) => `  __sql(() => ${example.code}),`),
    `]);`,
    // The tables' definitions, as \`drizzle-kit generate\` writes them for an empty database.
    `export const ddl = await (async () => {`,
    `  try {`,
    `    const kit = await import("${KITS[input.dialect]}");`,
    `    const statements = await kit.generateMigration(await kit.generateDrizzleJson({}), await kit.generateDrizzleJson(__schema));`,
    `    return { statements: statements.map((s) => String(s).trim()), error: null };`,
    `  } catch (e) {`,
    `    const missing = e !== null && typeof e === "object" && e.code === "ERR_MODULE_NOT_FOUND" && String(e.message).includes("drizzle-kit");`,
    `    return { statements: [], error: missing ? "drizzle-kit is not installed in the project" : String(e instanceof Error ? e.message : e) };`,
    `  }`,
    `})();`,
  ].join("\n");
}

type Built = {
  readonly sql: string | null;
  readonly params: readonly unknown[];
  readonly error: string | null;
};

function isBuilt(value: unknown): value is Built {
  return (
    typeof value === "object" &&
    value !== null &&
    "sql" in value &&
    "params" in value &&
    Array.isArray(value.params) &&
    "error" in value
  );
}

function builtOf(loaded: unknown, count: number) {
  const list =
    typeof loaded === "object" && loaded !== null && "default" in loaded ? loaded.default : null;
  return Array.isArray(list) && list.length === count && list.every(isBuilt) ? list : null;
}

function ddlOf(loaded: unknown): SchemaDdl {
  const ddl = typeof loaded === "object" && loaded !== null && "ddl" in loaded ? loaded.ddl : null;
  const statements =
    typeof ddl === "object" && ddl !== null && "statements" in ddl ? ddl.statements : null;
  const error = typeof ddl === "object" && ddl !== null && "error" in ddl ? ddl.error : null;
  if (!Array.isArray(statements) || !statements.every((s) => typeof s === "string")) {
    return { statements: [], error: "drizzle-kit did not give back the statements" };
  }
  return { statements, error: typeof error === "string" ? error : null };
}

/**
 * What the imported probe module gave back: each example with its SQL and params, and the DDL;
 * null when it did not give one built query per example.
 */
export function readProbeResult(
  loaded: unknown,
  examples: readonly QueryExample[],
): { readonly queries: readonly QueryExampleSql[]; readonly ddl: SchemaDdl } | null {
  const built = builtOf(loaded, examples.length);
  if (built === null) return null;
  return {
    // builtOf checked there is one built query per example.
    queries: examples.flatMap((example, i): readonly QueryExampleSql[] => {
      const sql = built[i];
      return sql === undefined ? [] : [{ ...example, ...sql }];
    }),
    ddl: ddlOf(loaded),
  };
}
