import type { Program } from "oxc-parser";
import { parseSync } from "oxc-parser";

function parse(content: string) {
  return parseSync("schema.ts", content, { lang: "ts", sourceType: "module" });
}

// The table builders the source imports from drizzle-orm under another name, by that name:
// `table` -> `pgTable` for `import { pgTable as table } from "drizzle-orm/pg-core"`.
function builderAliases(program: Program) {
  return new Map(
    program.body.flatMap((stmt) => {
      if (stmt.type !== "ImportDeclaration" || stmt.importKind === "type") return [];
      if (!/^drizzle-orm(?:\/|$)/u.test(stmt.source.value)) return [];
      return stmt.specifiers.flatMap((spec) => {
        if (spec.type !== "ImportSpecifier" || spec.importKind === "type") return [];
        const imported = spec.imported.type === "Identifier" ? spec.imported.name : null;
        const local = spec.local.name;
        return imported !== null && imported !== local && imported.endsWith("Table")
          ? [[local, imported] as const]
          : [];
      });
    }),
  );
}

/**
 * The source with each top-level table call written with the builder's own name: once the imports
 * are gone, `table("articles", ...)` from `import { pgTable as table }` reads as
 * `pgTable("articles", ...)`, as every reader of the schema expects. Nothing else is touched.
 */
export function unaliasTableBuilders(content: string) {
  return unaliased(content, parse(content).program);
}

type Call = Extract<Program["body"][number], { type: "ExpressionStatement" }>["expression"] & {
  type: "CallExpression";
};

// The call at the root of a chain: `table("user", {...})` in `table("user", {...}).enableRLS()`.
function innermostCall(call: Call): Call {
  const { callee } = call;
  return callee.type === "MemberExpression" && callee.object.type === "CallExpression"
    ? innermostCall(callee.object)
    : call;
}

function unaliased(content: string, program: Program) {
  const aliases = builderAliases(program);
  if (aliases.size === 0) return content;
  const spans = program.body.flatMap((stmt) => {
    const decl = stmt.type === "ExportNamedDeclaration" ? stmt.declaration : stmt;
    if (decl?.type !== "VariableDeclaration") return [];
    return decl.declarations.flatMap((d) => {
      if (d.init?.type !== "CallExpression") return [];
      const { callee } = innermostCall(d.init);
      // `table(...)`, or `table.withRLS(...)`.
      const name = callee.type === "MemberExpression" && !callee.computed ? callee.object : callee;
      if (name.type !== "Identifier") return [];
      const builder = aliases.get(name.name);
      return builder === undefined ? [] : [{ start: name.start, end: name.end, builder }];
    });
  });
  return spans.reduceRight(
    (text, span) => text.slice(0, span.start) + span.builder + text.slice(span.end),
    content,
  );
}

/**
 * The schema without its leading imports, from the first line of code on. The
 * imports are found by parsing, so one written over several lines
 * (`import {\n  pgTable,\n} from ...`) goes whole; a source that does not
 * parse falls back to dropping the lines that start with `import`. A table
 * builder imported under another name is called by its own name.
 */
export function stripImports(source: string) {
  const parsed = parse(source);
  const content = unaliased(source, parsed.program);
  const lines = content.split("\n");
  // Parsed again only when a builder was renamed: otherwise it is the source already parsed.
  const { program, errors } = content === source ? parsed : parse(content);
  const firstCode = program.body.findIndex((stmt) => stmt.type !== "ImportDeclaration");
  const imports = program.body.slice(0, firstCode === -1 ? undefined : firstCode);
  const lastImportEnd = errors.length === 0 ? imports.at(-1)?.end : undefined;
  const firstLine =
    lastImportEnd === undefined ? 0 : content.slice(0, lastImportEnd).split("\n").length;
  const codeStart = lines.findIndex(
    (line, i) =>
      i >= firstLine &&
      line.trim() !== "" &&
      (lastImportEnd !== undefined || !line.trim().startsWith("import")),
  );
  return codeStart === -1 ? [] : lines.slice(codeStart);
}

// The keys under which a node holds only types: `x: T`, `(): T =>`, `f<T>()`, `implements T`.
const TYPE_KEYS = new Set([
  "typeAnnotation",
  "returnType",
  "typeParameters",
  "typeArguments",
  "superTypeArguments",
  "implements",
]);

// The declarations that are types only, which no value can read through.
const TYPE_DECLARATIONS = new Set([
  "TSInterfaceDeclaration",
  "TSTypeAliasDeclaration",
  "TSDeclareFunction",
]);

type AnyNode = { readonly type: string; readonly [key: string]: unknown };

function isAnyNode(value: unknown): value is AnyNode {
  return typeof value === "object" && value !== null && "type" in value;
}

// The keys of a node that name something rather than read it: `x.key`, `{ key: ... }`,
// `class { key = ... }`, a label.
function namingKey(node: AnyNode, key: string) {
  if (node.computed === true) return false;
  if (node.type === "MemberExpression") return key === "property";
  if (node.type === "Property") return key === "key" && node.shorthand !== true;
  if (node.type === "MethodDefinition" || node.type === "PropertyDefinition") return key === "key";
  return key === "label";
}

/**
 * The names a module reads as values, wherever it reads them: every identifier outside a type
 * annotation, a type declaration, an import and a declare-only statement. A name only a type
 * reads (`(): AnyPgColumn => t.id`) is not one.
 */
function valueNames(node: unknown, names: Set<string> = new Set()): Set<string> {
  if (Array.isArray(node)) {
    for (const item of node) valueNames(item, names);
    return names;
  }
  if (!isAnyNode(node)) return names;
  if (node.type === "ImportDeclaration" || TYPE_DECLARATIONS.has(node.type)) return names;
  if (node.declare === true) return names;
  if (
    (node.type === "Identifier" || node.type === "JSXIdentifier") &&
    typeof node.name === "string"
  ) {
    names.add(node.name);
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === "parent" || TYPE_KEYS.has(key) || namingKey(node, key)) continue;
    valueNames(value, names);
  }
  return names;
}

type Import = Extract<
  ReturnType<typeof parse>["program"]["body"][number],
  { type: "ImportDeclaration" }
>;

// The spans of one import to blank: the whole statement when it brings in no value the module
// reads, else each named specifier that is only a type, with the comma that sets it apart.
function unusedSpans(stmt: Import, used: ReadonlySet<string>): (readonly [number, number])[] {
  const { specifiers } = stmt;
  // `import "./side-effect"` and `import {} from "pkg"` load the module for its own sake.
  if (stmt.importKind === "type" || specifiers.length === 0) return [];
  const unused = specifiers.map(
    (s) => (s.type === "ImportSpecifier" && s.importKind === "type") || !used.has(s.local.name),
  );
  if (unused.every(Boolean)) return [[stmt.start, stmt.end]];
  return specifiers.flatMap((spec, i): (readonly [number, number])[] => {
    // A default or namespace import that is unused beside a used one is left: rare, and harmless
    // unless the module lacks it. An inline `type X` is Node's own to strip.
    if (unused[i] !== true || spec.type !== "ImportSpecifier" || spec.importKind === "type") {
      return [];
    }
    const next = specifiers[i + 1];
    const previous = specifiers[i - 1];
    if (next !== undefined) return [[spec.start, next.start]];
    return previous?.type === "ImportSpecifier"
      ? [[previous.end, spec.end]]
      : [[spec.start, spec.end]];
  });
}

/**
 * The source with each import TypeScript would drop blanked out: an import that brings in only
 * types (`import { type X } from "pkg"`), and each imported name the module reads only as a type
 * (`import { AnyPgColumn, pgTable }` used as `(): AnyPgColumn => t.id`). Node's type stripping
 * keeps both, so the first still loads `pkg` (a types-only subpath fails to resolve) and the
 * second asks `pkg` for an export it does not have. A bundler (drizzle-kit's esbuild) drops
 * them, as TypeScript does. Each span is replaced by spaces, so every position after it stays
 * where it was.
 */
export function elideTypeOnlyImports(source: string, file = "schema.ts") {
  const lang = /\.(c|m)?tsx$/u.test(file) ? "tsx" : "ts";
  const { program } = parseSync(file, source, { lang, sourceType: "module" });
  const used = valueNames(program.body);
  const spans = program.body.flatMap((stmt) =>
    stmt.type === "ImportDeclaration" ? unusedSpans(stmt, used) : [],
  );
  // Spans of one import may overlap; blanking a character twice leaves it blank.
  return spans.reduce(
    (text, [start, end]) =>
      text.slice(0, start) + text.slice(start, end).replaceAll(/[^\n]/gu, " ") + text.slice(end),
    source,
  );
}
