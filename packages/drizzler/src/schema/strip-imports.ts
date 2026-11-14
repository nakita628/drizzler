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

function unaliased(content: string, program: Program) {
  const aliases = builderAliases(program);
  if (aliases.size === 0) return content;
  const spans = program.body.flatMap((stmt) => {
    const decl = stmt.type === "ExportNamedDeclaration" ? stmt.declaration : stmt;
    if (decl?.type !== "VariableDeclaration") return [];
    return decl.declarations.flatMap((d) => {
      if (d.init?.type !== "CallExpression") return [];
      const { callee } = d.init;
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

/**
 * The source with each import that brings in only types blanked out: `import { type X } from
 * "pkg"` names no value, and TypeScript drops it, but Node's type stripping keeps it as
 * `import {} from "pkg"`, which still loads `pkg` (a types-only subpath fails to resolve). The
 * import is replaced by spaces, so every position after it stays where it was.
 */
export function elideTypeOnlyImports(source: string, file = "schema.ts") {
  const lang = /\.(c|m)?tsx$/u.test(file) ? "tsx" : "ts";
  const { program } = parseSync(file, source, { lang, sourceType: "module" });
  const spans = program.body.flatMap((stmt) =>
    stmt.type === "ImportDeclaration" &&
    stmt.importKind !== "type" &&
    stmt.specifiers.length > 0 &&
    stmt.specifiers.every((s) => s.type === "ImportSpecifier" && s.importKind === "type")
      ? [[stmt.start, stmt.end] as const]
      : [],
  );
  return spans.reduceRight(
    (text, [start, end]) =>
      text.slice(0, start) + text.slice(start, end).replace(/[^\n]/gu, " ") + text.slice(end),
    source,
  );
}
