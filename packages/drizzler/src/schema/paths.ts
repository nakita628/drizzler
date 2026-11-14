// What a schema's paths, imports and configs say, read from text already in hand: nothing here
// touches the file system. ./sources.ts reads the files and asks these questions of them.
import path from "node:path";
import type { Expression, Node, Program } from "oxc-parser";
import { parseSync } from "oxc-parser";

/** The extensions a schema module may have. */
export const MODULE_EXTENSIONS = [
  ".ts",
  ".mts",
  ".cts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".jsx",
] as const;

/** What `drizzle.config.*` drizzler looks for when no input is given, in this order. */
export const DRIZZLE_CONFIG_FILES = [
  "drizzle.config.ts",
  "drizzle.config.mts",
  "drizzle.config.cts",
  "drizzle.config.js",
  "drizzle.config.mjs",
  "drizzle.config.cjs",
] as const;

/** The `compilerOptions.paths` of a tsconfig, with the directory its targets start from. */
export type PathAliases = {
  readonly base: string;
  readonly paths: Readonly<Record<string, string[]>>;
};

/** A module's program, parsed as the language its extension names. */
export function parseModule(file: string, text: string) {
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

/** Whether an input is a glob (`src/db/*.sql.ts`) rather than a path. */
export function isGlob(input: string) {
  return /[*?[\]{}]/u.test(input);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * What a parsed tsconfig in `dir` says about path aliases: its own `paths`, or else the relative
 * tsconfigs it `extends`, to be read in turn.
 */
export function aliasesOfConfig(
  config: unknown,
  dir: string,
): { readonly aliases: PathAliases | null; readonly extends: readonly string[] } {
  if (!isRecord(config)) return { aliases: null, extends: [] };
  const options = isRecord(config.compilerOptions) ? config.compilerOptions : {};
  if (isRecord(options.paths)) {
    const paths = Object.fromEntries(
      Object.entries(options.paths).map(([key, targets]) => [
        key,
        Array.isArray(targets) ? targets.filter((t): t is string => typeof t === "string") : [],
      ]),
    );
    const base = typeof options.baseUrl === "string" ? path.resolve(dir, options.baseUrl) : dir;
    return { aliases: { base, paths }, extends: [] };
  }
  const parents = typeof config.extends === "string" ? [config.extends] : [];
  return {
    aliases: null,
    extends: parents
      .filter((parent) => parent.startsWith("."))
      .map((parent) => path.resolve(dir, parent.endsWith(".json") ? parent : `${parent}.json`)),
  };
}

const TWINS: Readonly<Record<string, readonly string[]>> = {
  ".js": [".ts", ".tsx"],
  ".mjs": [".mts"],
  ".cjs": [".cts"],
  ".jsx": [".tsx"],
} as const;

/**
 * The files a module path may name, in the order they are tried: itself, its `.ts` twin for a
 * `.js` import, the path with an extension added, and an index module inside it.
 */
export function moduleCandidates(candidate: string) {
  const ext = path.extname(candidate);
  const stem = candidate.slice(0, candidate.length - ext.length);
  return [
    candidate,
    ...(TWINS[ext] ?? []).map((twin) => stem + twin),
    ...MODULE_EXTENSIONS.map((e) => candidate + e),
    ...MODULE_EXTENSIONS.map((e) => path.join(candidate, `index${e}`)),
  ];
}

/**
 * The paths an aliased import may stand for, in the order the tsconfig's `paths` give them
 * (`#/db/*` → `./src/db/*`). Empty when no alias matches.
 */
export function aliasTargets(specifier: string, aliases: PathAliases) {
  return Object.entries(aliases.paths).flatMap(([pattern, targets]) => {
    const star = pattern.indexOf("*");
    const prefix = star === -1 ? pattern : pattern.slice(0, star);
    const suffix = star === -1 ? "" : pattern.slice(star + 1);
    const matches =
      star === -1
        ? specifier === pattern
        : specifier.startsWith(prefix) &&
          specifier.endsWith(suffix) &&
          specifier.length >= prefix.length + suffix.length;
    if (!matches) return [];
    const middle =
      star === -1 ? "" : specifier.slice(prefix.length, specifier.length - suffix.length);
    return targets.map((target) => path.resolve(aliases.base, target.replace("*", middle)));
  });
}

/** The modules a file takes values from: its imports (not `import type`) and re-exports. */
export function importedSpecifiers(program: Program) {
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
 * The `schema` a drizzle-kit config gives, a path or glob or a list of them, as written. Null when
 * it does not give `schema` as text drizzler can read without running the config.
 */
export function configSchemaInputs(program: Program) {
  const object = configObject(program);
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
  return paths.filter((p): p is string => p !== null);
}
