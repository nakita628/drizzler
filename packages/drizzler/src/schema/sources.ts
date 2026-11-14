import fs from "node:fs";
import path from "node:path";
import { Data, Effect } from "effect";
import {
  aliasesOfConfig,
  aliasTargets,
  configSchemaInputs,
  DRIZZLE_CONFIG_FILES,
  importedSpecifiers,
  isGlob,
  isSchemaModule,
  moduleCandidates,
  parseModule,
} from "./paths.js";
import { stripJsonc } from "../helper/jsonc.js";
import type { PathAliases } from "./paths.js";
import { stripImports } from "./strip-imports.js";
import { errorMessage } from "../helper/error-message.js";

/** A schema input that cannot be read: a path that is not there, a glob that matches nothing. */
export class SchemaInputError extends Data.TaggedError("SchemaInputError")<{
  readonly message: string;
}> {}

// A file system call, its failure (a file gone between two looks, one that cannot be read) as a
// SchemaInputError naming what went wrong.
function attempt<A>(run: () => A) {
  return Effect.try({
    try: run,
    catch: (error) => new SchemaInputError({ message: errorMessage(error) }),
  });
}

function walk(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .toSorted((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return entry.name === "node_modules" || entry.name.startsWith(".") ? [] : walk(full);
      }
      return entry.isFile() && isSchemaModule(full) ? [full] : [];
    });
}

/**
 * The files one input names, as absolute paths: a file, every schema module under a directory
 * (tests and declaration files left out), or the files a glob matches
 * (`src/db/schema/*.sql.ts`, as drizzle-kit's `schema` is written).
 */
export function expandInput(input: string, cwd: string) {
  return Effect.gen(function* () {
    if (isGlob(input)) {
      const matched = yield* attempt(() =>
        fs
          .globSync(input, { cwd })
          .map((file) => path.resolve(cwd, file))
          .filter((file) => fs.statSync(file).isFile() && isSchemaModule(file))
          .toSorted(),
      );
      if (matched.length === 0) {
        return yield* new SchemaInputError({ message: `${input} matches no schema file` });
      }
      return matched;
    }
    const full = path.resolve(cwd, input);
    const stats = yield* attempt(() => fs.statSync(full, { throwIfNoEntry: false }));
    if (stats === undefined) {
      return yield* new SchemaInputError({ message: `${input} does not exist` });
    }
    if (!stats.isDirectory()) return [full];
    const files = yield* attempt(() => walk(full));
    if (files.length === 0) {
      return yield* new SchemaInputError({ message: `${input} holds no schema file` });
    }
    return files;
  });
}

// `compilerOptions.paths` of a tsconfig, following a relative `extends` until one has them.
function readAliases(file: string, depth = 0): PathAliases | null {
  if (depth > 8 || !fs.existsSync(file)) return null;
  // This also runs inside Node's synchronous resolve hook (core/schema-sql.ts), where there is no
  // Effect to fail: a tsconfig that cannot be read or parsed gives no aliases, and the import is
  // left to Node.
  const config = (() => {
    try {
      const parsed: unknown = JSON.parse(stripJsonc(fs.readFileSync(file, "utf8")));
      return parsed;
    } catch {
      return null;
    }
  })();
  const found = aliasesOfConfig(config, path.dirname(file));
  if (found.aliases !== null) return found.aliases;
  for (const parent of found.extends) {
    const inherited = readAliases(parent, depth + 1);
    if (inherited) return inherited;
  }
  return null;
}

/**
 * The tsconfig aliases found so far, by directory. One lives as long as one collection of the
 * schema's files, so a tsconfig edited while the studio runs is read again on the next.
 */
type AliasCache = Map<string, PathAliases | null>;

// The path aliases of the nearest tsconfig.json above a file.
function aliasesFor(file: string, cache: AliasCache): PathAliases | null {
  const dir = path.dirname(file);
  const known = cache.get(dir);
  if (known !== undefined) return known;
  const found = nearestAliases(dir, cache);
  cache.set(dir, found);
  return found;
}

function nearestAliases(dir: string, cache: AliasCache) {
  const config = path.join(dir, "tsconfig.json");
  if (fs.existsSync(config)) return readAliases(config);
  const parent = path.dirname(dir);
  return parent === dir ? null : aliasesFor(path.join(parent, "x"), cache);
}

// The file a module path names, of those it may: the first that is there.
function toFile(candidate: string) {
  return (
    moduleCandidates(candidate).find(
      (option) => fs.existsSync(option) && fs.statSync(option).isFile(),
    ) ?? null
  );
}

/**
 * The project file an import names, or null for a package: a relative path, or one of the
 * tsconfig's `paths` (`#/db/schema/user.sql.js`, `@/db/schema`).
 */
export function resolveImport(
  specifier: string,
  from: string,
  cache: AliasCache = new Map(),
): string | null {
  if (specifier.startsWith(".")) return toFile(path.resolve(path.dirname(from), specifier));
  const aliases = aliasesFor(from, cache);
  if (aliases === null) return null;
  for (const target of aliasTargets(specifier, aliases)) {
    const file = toFile(target);
    if (file !== null && !file.split(path.sep).includes("node_modules")) return file;
  }
  return null;
}

/**
 * Every file the schema is made of: the inputs (files, directories or globs) and, followed from
 * them, each project module they import or re-export — a helper with shared columns, a
 * `relations.ts`, the files an `index.ts` re-exports. Packages are not followed. Inputs come
 * first, in the order given; a file is read once.
 */
export function collectSchemaFiles(inputs: readonly string[], cwd: string) {
  return Effect.gen(function* () {
    const named = yield* Effect.forEach(inputs, (input) => expandInput(input, cwd));
    return yield* attempt(() => visitFiles(named.flat(), new Set(), new Map()));
  });
}

// Breadth first, a level at a time: the files of `level` not yet `seen`, each added once, then
// what they import, in the order a queue of them would take.
function visitFiles(
  level: readonly string[],
  seen: Set<string>,
  aliases: AliasCache,
): readonly string[] {
  if (level.length === 0) return [];
  const fresh = level.filter((file) => {
    if (seen.has(file)) return false;
    seen.add(file);
    return true;
  });
  const imported = fresh.flatMap((file) =>
    importedSpecifiers(parseModule(file, fs.readFileSync(file, "utf8"))).flatMap((specifier) => {
      const resolved = resolveImport(specifier, file, aliases);
      return resolved !== null && isSchemaModule(resolved) ? [resolved] : [];
    }),
  );
  return [...fresh, ...visitFiles(imported, seen, aliases)];
}

/**
 * The schema as one source, its lines: each file without its imports, one after another. The
 * tables, columns and relations are read across files as they are within one, so a column
 * spread from another file or a `defineRelations` in its own module is found.
 */
export function readSchemaSources(files: readonly string[]) {
  return attempt(() =>
    files.flatMap((file, i) => [
      ...(i === 0 ? [] : [""]),
      ...stripImports(fs.readFileSync(file, "utf8")),
    ]),
  );
}

/**
 * The schema drizzle-kit is configured with: the `schema` of the first `drizzle.config.*` in
 * `cwd`, a path or glob or a list of them, as written. Null when there is no config, or it does
 * not give `schema` as text drizzler can read without running it.
 */
export function drizzleConfigSchema(cwd: string) {
  return attempt(() => {
    const file = DRIZZLE_CONFIG_FILES.map((name) => path.join(cwd, name)).find((f) =>
      fs.existsSync(f),
    );
    if (file === undefined) return null;
    const inputs = configSchemaInputs(parseModule(file, fs.readFileSync(file, "utf8")));
    return inputs === null ? null : { file, inputs };
  });
}
