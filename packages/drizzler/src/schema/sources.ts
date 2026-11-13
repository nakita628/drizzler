import fs from "node:fs";
import path from "node:path";
import type { Expression, Node, Program } from "oxc-parser";
import { parseSync } from "oxc-parser";
import { stripImports } from "./strip-imports.js";

/** The extensions a schema module may have. */
const MODULE_EXTENSIONS = [".ts", ".mts", ".cts", ".tsx", ".js", ".mjs", ".cjs", ".jsx"] as const;

/** What `drizzle.config.*` drizzler looks for when no input is given, in this order. */
export const DRIZZLE_CONFIG_FILES = [
  "drizzle.config.ts",
  "drizzle.config.mts",
  "drizzle.config.cts",
  "drizzle.config.js",
  "drizzle.config.mjs",
  "drizzle.config.cjs",
] as const;

/** A schema input that cannot be read: a path that is not there, a glob that matches nothing. */
export class SchemaInputError extends Error {
  override readonly name = "SchemaInputError";
}

function parse(file: string, text: string) {
  return parseSync(file, text, { lang: langOf(file), sourceType: "module" }).program;
}

function langOf(file: string) {
  const ext = path.extname(file);
  if (ext === ".tsx") return "tsx" as const;
  if (ext === ".jsx") return "jsx" as const;
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") return "js" as const;
  return "ts" as const;
}

/** Whether a file in a schema directory is a schema module: not a test, not a declaration file. */
export function isSchemaModule(file: string) {
  const base = path.basename(file);
  if (!MODULE_EXTENSIONS.some((ext) => base.endsWith(ext))) return false;
  if (/\.d\.[cm]?ts$/u.test(base)) return false;
  return !/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(base);
}

function isGlob(input: string) {
  return /[*?[\]{}]/u.test(input);
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
export function expandInput(input: string, cwd: string): string[] {
  if (isGlob(input)) {
    const matched = fs
      .globSync(input, { cwd })
      .map((file) => path.resolve(cwd, file))
      .filter((file) => fs.statSync(file).isFile() && isSchemaModule(file))
      .toSorted();
    if (matched.length === 0) throw new SchemaInputError(`${input} matches no schema file`);
    return matched;
  }
  const full = path.resolve(cwd, input);
  if (!fs.existsSync(full)) throw new SchemaInputError(`${input} does not exist`);
  if (fs.statSync(full).isDirectory()) {
    const files = walk(full);
    if (files.length === 0) throw new SchemaInputError(`${input} holds no schema file`);
    return files;
  }
  return [full];
}

/** tsconfig.json allows comments and trailing commas; JSON.parse does not. */
export function parseJsonc(text: string): unknown {
  // A string is kept whole, so a `//` inside one (a URL) is not taken for a comment.
  const bare = text.replace(
    /("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/gu,
    (_match, quoted: string | undefined) => quoted ?? "",
  );
  return JSON.parse(bare.replace(/,(\s*[}\]])/gu, "$1"));
}

type PathAliases = { readonly base: string; readonly paths: Readonly<Record<string, string[]>> };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// `compilerOptions.paths` of a tsconfig, following a relative `extends` until one has them.
function readAliases(file: string, depth = 0): PathAliases | null {
  if (depth > 8 || !fs.existsSync(file)) return null;
  const config = (() => {
    try {
      return parseJsonc(fs.readFileSync(file, "utf8"));
    } catch {
      return null;
    }
  })();
  if (!isRecord(config)) return null;
  const dir = path.dirname(file);
  const options = isRecord(config.compilerOptions) ? config.compilerOptions : {};
  if (isRecord(options.paths)) {
    const paths = Object.fromEntries(
      Object.entries(options.paths).map(([key, targets]) => [
        key,
        Array.isArray(targets) ? targets.filter((t): t is string => typeof t === "string") : [],
      ]),
    );
    const base = typeof options.baseUrl === "string" ? path.resolve(dir, options.baseUrl) : dir;
    return { base, paths };
  }
  const parents = typeof config.extends === "string" ? [config.extends] : [];
  for (const parent of parents) {
    if (!parent.startsWith(".")) continue;
    const next = path.resolve(dir, parent.endsWith(".json") ? parent : `${parent}.json`);
    const found = readAliases(next, depth + 1);
    if (found) return found;
  }
  return null;
}

const aliasesByDir = new Map<string, PathAliases | null>();

// The path aliases of the nearest tsconfig.json above a file.
function aliasesFor(file: string): PathAliases | null {
  const dir = path.dirname(file);
  const known = aliasesByDir.get(dir);
  if (known !== undefined) return known;
  const found = nearestAliases(dir);
  aliasesByDir.set(dir, found);
  return found;
}

function nearestAliases(dir: string) {
  const config = path.join(dir, "tsconfig.json");
  if (fs.existsSync(config)) return readAliases(config);
  const parent = path.dirname(dir);
  return parent === dir ? null : aliasesFor(path.join(parent, "x"));
}

// The file a module path names: itself, its `.ts` twin for a `.js` import, or an index module.
function toFile(candidate: string) {
  const twins: Readonly<Record<string, readonly string[]>> = {
    ".js": [".ts", ".tsx"],
    ".mjs": [".mts"],
    ".cjs": [".cts"],
    ".jsx": [".tsx"],
  };
  const ext = path.extname(candidate);
  const stem = candidate.slice(0, candidate.length - ext.length);
  const options = [
    candidate,
    ...(twins[ext] ?? []).map((twin) => stem + twin),
    ...MODULE_EXTENSIONS.map((e) => candidate + e),
    ...MODULE_EXTENSIONS.map((e) => path.join(candidate, `index${e}`)),
  ];
  return options.find((option) => fs.existsSync(option) && fs.statSync(option).isFile()) ?? null;
}

/**
 * The project file an import names, or null for a package: a relative path, or one of the
 * tsconfig's `paths` (`#/db/schema/user.sql.js`, `@/db/schema`).
 */
export function resolveImport(specifier: string, from: string): string | null {
  if (specifier.startsWith(".")) return toFile(path.resolve(path.dirname(from), specifier));
  const aliases = aliasesFor(from);
  if (aliases === null) return null;
  for (const [pattern, targets] of Object.entries(aliases.paths)) {
    const star = pattern.indexOf("*");
    const prefix = star === -1 ? pattern : pattern.slice(0, star);
    const suffix = star === -1 ? "" : pattern.slice(star + 1);
    const matches =
      star === -1
        ? specifier === pattern
        : specifier.startsWith(prefix) &&
          specifier.endsWith(suffix) &&
          specifier.length >= prefix.length + suffix.length;
    if (!matches) continue;
    const middle =
      star === -1 ? "" : specifier.slice(prefix.length, specifier.length - suffix.length);
    for (const target of targets) {
      const file = toFile(path.resolve(aliases.base, target.replace("*", middle)));
      if (file !== null && !file.split(path.sep).includes("node_modules")) return file;
    }
  }
  return null;
}

// The modules a file takes values from: its imports (not `import type`) and re-exports.
function importedSpecifiers(program: Program) {
  return program.body.flatMap((stmt) => {
    if (stmt.type === "ImportDeclaration") {
      return stmt.importKind === "type" ? [] : [stmt.source.value];
    }
    if (stmt.type === "ExportAllDeclaration") {
      return stmt.exportKind === "type" ? [] : [stmt.source.value];
    }
    if (stmt.type === "ExportNamedDeclaration" && stmt.source !== null) {
      return stmt.exportKind === "type" ? [] : [stmt.source.value];
    }
    return [];
  });
}

/**
 * Every file the schema is made of: the inputs (files, directories or globs) and, followed from
 * them, each project module they import or re-export — a helper with shared columns, a
 * `relations.ts`, the files an `index.ts` re-exports. Packages are not followed. Inputs come
 * first, in the order given; a file is read once.
 */
export function collectSchemaFiles(inputs: readonly string[], cwd: string) {
  return visitFiles(
    inputs.flatMap((input) => expandInput(input, cwd)),
    new Set(),
  );
}

// Breadth first, a level at a time: the files of `level` not yet `seen`, each added once, then
// what they import, in the order a queue of them would take.
function visitFiles(level: readonly string[], seen: Set<string>): readonly string[] {
  if (level.length === 0) return [];
  const fresh = level.filter((file) => {
    if (seen.has(file)) return false;
    seen.add(file);
    return true;
  });
  const imported = fresh.flatMap((file) =>
    importedSpecifiers(parse(file, fs.readFileSync(file, "utf8"))).flatMap((specifier) => {
      const resolved = resolveImport(specifier, file);
      return resolved !== null && isSchemaModule(resolved) ? [resolved] : [];
    }),
  );
  return [...fresh, ...visitFiles(imported, seen)];
}

/**
 * The schema as one source, its lines: each file without its imports, one after another. The
 * tables, columns and relations are read across files as they are within one, so a column
 * spread from another file or a `defineRelations` in its own module is found.
 */
export function readSchemaSources(files: readonly string[]) {
  return files.flatMap((file, i) => [
    ...(i === 0 ? [] : [""]),
    ...stripImports(fs.readFileSync(file, "utf8")),
  ]);
}

function stringValue(node: Node | null | undefined) {
  if (node?.type === "Literal" && typeof node.value === "string") return node.value;
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked ?? null;
  }
  return null;
}

function unwrap(node: Expression): Expression {
  if (
    node.type === "TSAsExpression" ||
    node.type === "TSSatisfiesExpression" ||
    node.type === "ParenthesizedExpression"
  ) {
    return unwrap(node.expression);
  }
  return node;
}

// The object `export default defineConfig({ ... })` or `export default { ... }` is given, a
// `const config = { ... }` it names followed.
function configObject(program: Program) {
  const named = new Map(
    program.body.flatMap((stmt) => {
      const decl = stmt.type === "ExportNamedDeclaration" ? stmt.declaration : stmt;
      if (decl?.type !== "VariableDeclaration") return [];
      return decl.declarations.flatMap((d) =>
        d.id.type === "Identifier" && d.init ? [[d.id.name, unwrap(d.init)] as const] : [],
      );
    }),
  );
  function resolve(node: Node | null | undefined): Node | null {
    if (node === null || node === undefined) return null;
    if (
      node.type === "TSAsExpression" ||
      node.type === "TSSatisfiesExpression" ||
      node.type === "ParenthesizedExpression"
    ) {
      return resolve(node.expression);
    }
    if (node.type === "Identifier") return named.get(node.name) ?? null;
    if (node.type === "CallExpression") {
      const [arg] = node.arguments;
      return arg && arg.type !== "SpreadElement" ? resolve(arg) : null;
    }
    return node;
  }
  for (const stmt of program.body) {
    if (stmt.type === "ExportDefaultDeclaration") {
      const found = resolve(stmt.declaration);
      if (found?.type === "ObjectExpression") return found;
    }
    // `module.exports = defineConfig({ ... })` in a CommonJS config.
    if (
      stmt.type === "ExpressionStatement" &&
      stmt.expression.type === "AssignmentExpression" &&
      stmt.expression.left.type === "MemberExpression"
    ) {
      const found = resolve(stmt.expression.right);
      if (found?.type === "ObjectExpression") return found;
    }
  }
  return null;
}

/**
 * The schema drizzle-kit is configured with: the `schema` of the first `drizzle.config.*` in
 * `cwd`, a path or glob or a list of them, as written. Null when there is no config, or it does
 * not give `schema` as text drizzler can read without running it.
 */
export function drizzleConfigSchema(cwd: string) {
  const file = DRIZZLE_CONFIG_FILES.map((name) => path.join(cwd, name)).find((f) =>
    fs.existsSync(f),
  );
  if (file === undefined) return null;
  const object = configObject(parse(file, fs.readFileSync(file, "utf8")));
  const schema = object?.properties.find(
    (p) =>
      p.type === "Property" &&
      !p.computed &&
      ((p.key.type === "Identifier" && p.key.name === "schema") || stringValue(p.key) === "schema"),
  );
  if (schema?.type !== "Property") return null;
  const value = unwrap(schema.value);
  const paths =
    value.type === "ArrayExpression"
      ? value.elements.map((e) => (e && e.type !== "SpreadElement" ? stringValue(e) : null))
      : [stringValue(value)];
  if (paths.length === 0 || paths.some((p) => p === null)) return null;
  return {
    file,
    inputs: paths.filter((p): p is string => p !== null),
  };
}
