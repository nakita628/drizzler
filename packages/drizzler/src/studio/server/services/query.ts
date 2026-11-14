import fs from "node:fs";
import module from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Duration, Effect, Result } from "effect";
import type ts from "typescript";
import { QueryRunError } from "../errors/index.js";
import { isProjectTypeScript } from "../../../schema/module-url.js";
import {
  causeLines,
  driverParam,
  proxyCallbackResult,
  sqliteProxyRows,
  sqliteProxyRun,
} from "../../../sql/driver.js";
import type { Driver } from "./database.js";

/** How long a query may run before the studio stops waiting for it. */
const QUERY_TIMEOUT_MS = 30_000;

// The project's TypeScript the module hooks transpile with; the hooks are registered with the
// first one, and a later one replaces it.
const hooks = new Map<"typescript", typeof ts>();

function transpile(source: string, fileName: string) {
  const typescript = hooks.get("typescript") ?? null;
  if (typescript === null) return source;
  return typescript.transpileModule(source, {
    fileName,
    compilerOptions: {
      module: typescript.ModuleKind.ESNext,
      target: typescript.ScriptTarget.ES2022,
      // Imports used only as types are dropped, as a bundler would.
      verbatimModuleSyntax: false,
    },
  }).outputText;
}

/** The `.ts` file a relative import that Node could not find means, if there is one. */
function findTypeScript(specifier: string, parent: string) {
  const candidates = [
    `${specifier}.ts`,
    `${specifier}/index.ts`,
    specifier.replace(/\.(c|m)?js$/u, ".$1ts"),
  ];
  for (const candidate of candidates) {
    const url = new URL(candidate, parent);
    if (fs.existsSync(fileURLToPath(url))) return url.href;
  }
  return null;
}

/**
 * Lets Node load the project's TypeScript as a bundler would: `.ts` files are transpiled with
 * the project's own TypeScript, and an import without an extension (or with `.js` for a `.ts`
 * file) finds the `.ts`. A file imported by a versioned schema URL carries the version on, so a
 * saved change to any file of the schema is picked up by the next query.
 */
function registerHooks(typescript: typeof ts) {
  const registered = hooks.has("typescript");
  hooks.set("typescript", typescript);
  if (registered) return;
  module.registerHooks({
    resolve(specifier, context, nextResolve) {
      const parent = context.parentURL ?? "";
      const relative = specifier.startsWith("./") || specifier.startsWith("../");
      const first = Result.try(() => nextResolve(specifier, context));
      const found =
        Result.isFailure(first) && relative && isProjectTypeScript(parent)
          ? findTypeScript(specifier, parent)
          : null;
      // Not found by Node nor as a `.ts`: resolving again raises Node's own error for the import.
      const resolved = Result.isSuccess(first)
        ? first.success
        : ((found === null ? null : { url: found, shortCircuit: true }) ??
          nextResolve(specifier, context));
      const version = parent.startsWith("file:")
        ? new URL(parent).searchParams.get("drizzler")
        : null;
      if (version !== null && isProjectTypeScript(resolved.url)) {
        const url = new URL(resolved.url);
        url.searchParams.set("drizzler", version);
        return { ...resolved, url: url.href, shortCircuit: true };
      }
      return resolved;
    },
    load(url, context, nextLoad) {
      if (!isProjectTypeScript(url)) return nextLoad(url, context);
      const file = fileURLToPath(url);
      return {
        format: "module",
        source: transpile(fs.readFileSync(file, "utf-8"), file),
        shortCircuit: true,
      };
    },
  });
}

/**
 * Where a query module is written to be imported: the nearest `node_modules/.cache` above the
 * schema, so its imports of drizzle-orm resolve to the project's and file watchers leave it be.
 */
function queryDir(schemaPath: string) {
  const start = path.dirname(path.resolve(schemaPath));
  return cacheDirFrom(start) ?? path.join(start, ".drizzler");
}

function cacheDirFrom(dir: string): string | null {
  const modules = path.join(dir, "node_modules");
  if (fs.existsSync(modules)) return path.join(modules, ".cache", "drizzler");
  const parent = path.dirname(dir);
  return parent === dir ? null : cacheDirFrom(parent);
}

/** The statements a query sent, in order, each recorded as it finishes. */
type ExecutedLog = Map<number, Executed>;

/** What `import()` of a query module gives: a default export that runs the query. */
function isQueryModule(
  value: unknown,
): value is { readonly default: (callback: unknown) => Promise<unknown> } {
  return (
    typeof value === "object" &&
    value !== null &&
    "default" in value &&
    typeof value.default === "function"
  );
}

type Executed = {
  readonly sql: string;
  readonly params: readonly unknown[];
  readonly rowCount: number;
  readonly durationMs: number;
};

/**
 * What Drizzle's proxy driver for the dialect is handed, answered from the studio's connection in
 * the shape that driver expects: SQLite's takes `all`, `get` and `run`, PostgreSQL's and MySQL's
 * one callback. Every statement is logged.
 */
function makeExecutor(driver: Driver, executed: ExecutedLog, toJson: (value: unknown) => unknown) {
  async function run(sql: string, params: readonly unknown[]) {
    const started = performance.now();
    // Drizzle's proxy driver calls back with plain async functions, so the statement's Effect is
    // run here, inside the query the studio is already running.
    // oxlint-disable-next-line custom/effect-run-at-edge -- Drizzle's proxy driver API is Promise callbacks
    const result = await Effect.runPromise(
      driver
        .queryArrays({ sql, params: params.map((param) => driverParam(driver.dialect, param)) })
        .pipe(Effect.mapError((error) => new Error(error.cause))),
    );
    executed.set(executed.size, {
      sql,
      params: params.map((param) => toJson(param)),
      rowCount: result.rowCount,
      durationMs: Math.round((performance.now() - started) * 100) / 100,
    });
    return result;
  }
  const { dialect } = driver;
  if (dialect === "sqlite") {
    return {
      async all(sql: string, params: unknown[], rowMode?: "array" | "object") {
        return sqliteProxyRows(await run(sql, params), rowMode);
      },
      async get(sql: string, params: unknown[], rowMode?: "array" | "object") {
        return sqliteProxyRows(await run(sql, params), rowMode)[0];
      },
      async run(sql: string, params: unknown[]) {
        return sqliteProxyRun(await run(sql, params));
      },
    };
  }
  return async (sql: string, params: unknown[], method: "all" | "execute") =>
    proxyCallbackResult(dialect, method, await run(sql, params));
}

/** Loads the query module and runs its default export with the executor, within the time limit. */
function execute(input: {
  readonly file: string;
  readonly source: string;
  readonly executor: unknown;
}) {
  return Effect.gen(function* () {
    yield* Effect.try({
      try() {
        fs.mkdirSync(path.dirname(input.file), { recursive: true });
        fs.writeFileSync(input.file, input.source);
      },
      catch: (thrown) => new QueryRunError({ message: causeLines(thrown) }),
    });
    const loaded: unknown = yield* Effect.tryPromise({
      try: () => import(/* @vite-ignore */ pathToFileURL(input.file).href),
      catch: (thrown) => new QueryRunError({ message: causeLines(thrown) }),
    });
    if (!isQueryModule(loaded)) {
      return yield* new QueryRunError({ message: "The query module has no default export." });
    }
    return yield* Effect.tryPromise({
      try() {
        const timeout = new Promise<never>((_, reject) => {
          setTimeout(
            () =>
              reject(new Error(`The query did not finish in ${QUERY_TIMEOUT_MS / 1000} seconds.`)),
            QUERY_TIMEOUT_MS,
          ).unref();
        });
        return Promise.race([loaded.default(input.executor), timeout]);
      },
      catch: (thrown) => new QueryRunError({ message: causeLines(thrown) }),
    });
  }).pipe(Effect.ensuring(Effect.sync(() => fs.rmSync(input.file, { force: true }))));
}

/**
 * Runs a query module against the user's database through Drizzle. The module is written beside
 * the project's node_modules, so its imports of drizzle-orm and the schema resolve as the
 * project's do, and imported with the project's TypeScript transpiling its `.ts` imports. What the
 * database was asked is returned with the result, also when the query throws.
 *
 * ```mermaid
 * flowchart LR
 *   in[input.module + schema URL] --> ts[transpile with the project's TypeScript]
 *   ts --> file[(node_modules/.cache/drizzler/query-*.mjs)]
 *   file --> load[import the module]
 *   load --> run[default export: Drizzle over the executor]
 *   run --> db[(the user's database via input.driver)]
 *   db --> log[every statement logged]
 *   run --> out[result or error + statements + duration]
 * ```
 *
 * @param input.schemaPath - the saved schema file the module imports, versioned by its mtime
 * @param input.driver - the studio's connection, which answers Drizzle's proxy driver
 * @param input.typescript - the project's TypeScript, which transpiles the module and its imports
 * @param input.module - builds the module's source from the schema's import URL
 * @param input.toJson - turns a result or a parameter into a JSON value
 * @returns the result (null on failure), the error message (null on success), the statements and the time it took
 */
export function runQuery(input: {
  readonly schemaPath: string;
  readonly driver: Driver;
  readonly typescript: typeof ts;
  readonly module: (schemaUrl: string) => string;
  readonly toJson: (value: unknown) => unknown;
}) {
  return Effect.gen(function* () {
    registerHooks(input.typescript);
    const schemaUrl = pathToFileURL(path.resolve(input.schemaPath));
    schemaUrl.searchParams.set("drizzler", String(fs.statSync(input.schemaPath).mtimeMs));
    const source = transpile(input.module(schemaUrl.href), "query.ts");
    const file = path.join(queryDir(input.schemaPath), `query-${crypto.randomUUID()}.mjs`);
    const executed: ExecutedLog = new Map();
    const [took, outcome] = yield* execute({
      file,
      source,
      executor: makeExecutor(input.driver, executed, input.toJson),
    }).pipe(
      Effect.match({
        onSuccess: (value) => ({ result: input.toJson(value), error: null }),
        onFailure: (error) => ({ result: null, error: error.message }),
      }),
      Effect.timed,
    );
    return {
      ...outcome,
      statements: [...executed.values()],
      durationMs: Math.round(Duration.toMillis(took) * 100) / 100,
    };
  });
}
