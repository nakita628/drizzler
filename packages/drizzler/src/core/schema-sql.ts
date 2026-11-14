import { randomUUID } from "node:crypto";
import fs from "node:fs";
import module from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Data, Effect } from "effect";
import type { QueryExample } from "../generator/query-examples.js";
import { schemaDialect } from "../generator/query-examples.js";
import { makeProbeModule, readProbeResult } from "../generator/query-probe.js";
import { isProjectFile, isProjectTypeScript } from "../schema/module-url.js";
import { resolveImport } from "../schema/sources.js";
import { elideTypeOnlyImports } from "../schema/strip-imports.js";

/** The schema could not be loaded, or drizzle-orm could not build the examples' SQL. */
export class QuerySqlError extends Data.TaggedError("QuerySqlError")<{
  readonly message: string;
}> {}

/** The tables' definitions as drizzle-kit writes them, or why they could not be written. */
export type { SchemaDdl } from "../generator/query-probe.js";

// Whether the module hooks are registered; once per process.
const hooks = new Set<"registered">();

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
      const file = fileURLToPath(url);
      const source = elideTypeOnlyImports(fs.readFileSync(file, "utf8"), file);
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
          makeProbeModule({
            dialect,
            fileUrls: input.files.map((schemaFile) => pathToFileURL(schemaFile).href),
            examples: input.examples,
          }),
        );
        return import(/* @vite-ignore */ pathToFileURL(file).href);
      },
      catch: (thrown) => new QuerySqlError({ message: messageOf(thrown) }),
    }).pipe(Effect.ensuring(Effect.sync(() => fs.rmSync(file, { force: true }))));
    const result = readProbeResult(loaded, input.examples);
    if (result === null) {
      return yield* new QuerySqlError({
        message: "the schema did not give back the examples' SQL",
      });
    }
    return result;
  });
}
