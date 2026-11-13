import { randomUUID } from "node:crypto";
import fs from "node:fs";
import module from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Data, Effect } from "effect";
import type { QueryExample, QueryExampleSql } from "../generator/query-examples.js";
import { schemaDialect } from "../generator/query-examples.js";
import { resolveImport } from "../schema/sources.js";

/** The schema could not be loaded, or drizzle-orm could not build the examples' SQL. */
export class QuerySqlError extends Data.TaggedError("QuerySqlError")<{
  readonly message: string;
}> {}

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

/** The tables' definitions as drizzle-kit writes them, or why they could not be written. */
export type SchemaDdl = { readonly statements: readonly string[]; readonly error: string | null };

// Whether the module hooks are registered; once per process.
const hooks = new Set<"registered">();

function isProjectFile(url: string) {
  return url.startsWith("file:") && !url.includes("/node_modules/");
}

function isProjectTypeScript(url: string) {
  return isProjectFile(url) && /\.(c|m)?tsx?$/u.test(new URL(url).pathname);
}

// The source without its types. Node calls the API experimental and says so on stderr each run;
// the CLI's output stays its own, so the warning is held back for this one call.
function stripTypes(source: string) {
  const original = Object.getOwnPropertyDescriptor(process, "emitWarning");
  Object.defineProperty(process, "emitWarning", { value: () => undefined, configurable: true });
  try {
    return module.stripTypeScriptTypes(source, { mode: "strip" });
  } finally {
    if (original === undefined) Reflect.deleteProperty(process, "emitWarning");
    else Object.defineProperty(process, "emitWarning", original);
  }
}

/**
 * Lets Node load the schema as a bundler would: an import is resolved as drizzler reads the
 * schema (relative paths, `.js` for `.ts`, the tsconfig's `paths`), and a project `.ts` file is
 * loaded with its types stripped by Node itself, so no TypeScript install is needed.
 */
function registerHooks() {
  if (hooks.has("registered")) return;
  hooks.add("registered");
  module.registerHooks({
    resolve(specifier, context, nextResolve) {
      const parent = context.parentURL;
      if (parent !== undefined && isProjectFile(parent)) {
        const file = resolveImport(specifier, fileURLToPath(parent));
        if (file !== null) return { url: pathToFileURL(file).href, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      if (!isProjectTypeScript(url)) return nextLoad(url, context);
      const source = fs.readFileSync(fileURLToPath(url), "utf8");
      return { format: "module", source: stripTypes(source), shortCircuit: true };
    },
  });
}

// The cache directory of the project's node_modules above `dir`, where the probe module is
// written so `drizzle-orm` resolves to the project's own.
function cacheDirFrom(dir: string): string | null {
  const modules = path.join(dir, "node_modules");
  if (fs.existsSync(modules)) return path.join(modules, ".cache", "drizzler");
  const parent = path.dirname(dir);
  return parent === dir ? null : cacheDirFrom(parent);
}

// The module that imports the schema, builds `db` and turns each example into its SQL.
function probeModule(input: {
  readonly dialect: keyof typeof PROXIES;
  readonly files: readonly string[];
  readonly examples: readonly QueryExample[];
}) {
  const namespaces = input.files.map((_, i) => `__s${i}`);
  const tables = [...new Set(input.examples.map((example) => example.table))];
  return [
    `import * as __orm from "drizzle-orm";`,
    `import { drizzle as __drizzle } from "${PROXIES[input.dialect]}";`,
    ...input.files.map(
      (file, i) => `import * as __s${i} from ${JSON.stringify(pathToFileURL(file).href)};`,
    ),
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

function messageOf(thrown: unknown) {
  return thrown instanceof Error ? thrown.message : String(thrown);
}

/**
 * The SQL of a schema as it runs: its files are imported (with the project's drizzle-orm), each
 * example's `.toSQL()` is read from a proxy driver of the schema's dialect, and the tables'
 * definitions are written by the project's drizzle-kit as `drizzle-kit generate` would for an
 * empty database. Nothing connects to a database.
 *
 * ```mermaid
 * flowchart LR
 *   files[schema files] --> probe[probe module in node_modules/.cache/drizzler]
 *   probe --> orm[drizzle-orm proxy db] --> sql[".toSQL() of each example"]
 *   probe --> kit[drizzle-kit generateMigration] --> ddl[CREATE TABLE ...]
 * ```
 *
 * @param input.files - every file the schema is made of, as the CLI collected them
 * @param input.examples - the queries to build
 * @returns each example with its SQL and params, and the DDL (or why drizzle-kit could not write
 *   it); fails with QuerySqlError when the schema cannot be loaded
 */
export function schemaSql(input: {
  readonly files: readonly string[];
  readonly examples: readonly QueryExample[];
}) {
  return Effect.gen(function* () {
    if (
      typeof module.registerHooks !== "function" ||
      typeof module.stripTypeScriptTypes !== "function"
    ) {
      return yield* new QuerySqlError({
        message: "loading the schema needs Node.js 22.15 or later",
      });
    }
    const sources = input.files.map((file) => fs.readFileSync(file, "utf8"));
    const dialect = schemaDialect(sources);
    if (dialect === null) {
      return yield* new QuerySqlError({
        message: "no schema file imports a drizzle-orm core module",
      });
    }
    const [first] = input.files;
    const dir = first === undefined ? null : cacheDirFrom(path.dirname(first));
    if (dir === null) {
      return yield* new QuerySqlError({
        message: "no node_modules above the schema to load drizzle-orm from",
      });
    }
    registerHooks();
    const file = path.join(dir, `docs-${randomUUID()}.mjs`);
    const loaded: unknown = yield* Effect.tryPromise({
      async try() {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(
          file,
          probeModule({ dialect, files: input.files, examples: input.examples }),
        );
        return import(/* @vite-ignore */ pathToFileURL(file).href);
      },
      catch: (thrown) => new QuerySqlError({ message: messageOf(thrown) }),
    }).pipe(Effect.ensuring(Effect.sync(() => fs.rmSync(file, { force: true }))));
    const built = builtOf(loaded, input.examples.length);
    if (built === null) {
      return yield* new QuerySqlError({
        message: "the schema did not give back the examples' SQL",
      });
    }
    return {
      queries: input.examples.map((example, i): QueryExampleSql => ({ ...example, ...built[i] })),
      ddl: ddlOf(loaded),
    };
  });
}
