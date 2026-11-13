import { parseSync, Visitor } from "oxc-parser";
import type { Node } from "oxc-parser";
import { parseSource, unwrapParens } from "../../../helper/ast.js";
import { diagramSchema, relationDefinitions, tableCalls } from "../../../helper/index.js";
import { stripImports } from "../../../schema/strip-imports.js";

/**
 * Parses a schema source with oxc and finds its first syntax error, so the editor can underline
 * it while the last good diagram stays.
 *
 * ```mermaid
 * flowchart LR
 *   src[input.source] --> oxc[oxc parseSync]
 *   oxc -- no errors --> none[null]
 *   oxc -- errors --> first[first error: message + offset]
 * ```
 *
 * @param input.source - the schema's TypeScript source
 * @returns the first error's message and UTF-16 offset, or null when the source parses
 */
export function findSyntaxError(input: { readonly source: string }) {
  const { errors } = parseSync("schema.ts", input.source, { lang: "ts", sourceType: "module" });
  const [first] = errors;
  if (first === undefined) return null;
  return { message: first.message, offset: first.labels[0]?.start ?? 0 };
}

/**
 * Reads the tables, relations and enums of a schema that parses, as the ER diagram draws them:
 * columns with their keys and comments, foreign keys and `defineRelations`.
 *
 * ```mermaid
 * flowchart LR
 *   src[input.source] --> strip[strip imports]
 *   strip --> read[diagramSchema: oxc AST]
 *   read --> out[models + relations + enums]
 * ```
 *
 * @param input.source - the schema's TypeScript source
 * @returns the models, relations and enums the diagram is drawn from
 */
export function readSchema(input: { readonly source: string }) {
  return diagramSchema(stripImports(input.source));
}

/**
 * Finds where each table is declared in the schema, so the editor can select the table under
 * its cursor on the diagram.
 *
 * ```mermaid
 * flowchart LR
 *   src[input.source] --> oxc[parse the whole file]
 *   oxc --> tables[table declarations]
 *   tables --> spans[name + start + end offsets]
 * ```
 *
 * @param input.source - the schema's TypeScript source, imports included
 * @returns each table's export name and the offsets of its declaration in the whole file
 */
export function findTableSpans(input: { readonly source: string }) {
  const { program, text } = parseSource(input.source.split("\n"));
  return tableCalls(program, text).map(({ varName, start, end }) => ({
    name: varName,
    start,
    end,
  }));
}

/**
 * Reads the relations `defineRelations` and `defineRelationsPart` declare, as
 * `db.query.*.findMany({ with })` names them: the table, the name it gives the relation, and the
 * table `r.one` or `r.many` points at. A name split over a definition and its parts counts once.
 *
 * ```mermaid
 * flowchart LR
 *   src[input.source] --> strip[strip imports]
 *   strip --> rel[defineRelations / defineRelationsPart calls]
 *   rel --> fields[table + relation name + target, each once]
 * ```
 *
 * @param input.source - the schema's TypeScript source
 * @returns every relation field, by table and name, with the table it points at
 */
export function readRelationFields(input: { readonly source: string }) {
  const { program, text } = parseSource(stripImports(input.source));
  const all = relationDefinitions(program, text).flatMap(({ relations }) =>
    relations.map(({ table, name, target }) => ({ table, name, target })),
  );
  // A table's relations may be split over a main definition and its parts; each name counts once.
  return all.filter(
    (field, at) => all.findIndex((o) => o.table === field.table && o.name === field.name) === at,
  );
}

const WRAP_START = "async function __drizzler_query() {\n";

/**
 * Parses a query as the body of an async function, so `await` and `return` mean what they do when
 * it runs, and finds its first syntax error, or else its last statement when that is an
 * expression statement (the query's result). Offsets are in the query's own text.
 *
 * ```mermaid
 * flowchart LR
 *   code[input.code] --> wrap[wrap in an async function]
 *   wrap --> oxc[oxc parseSync]
 *   oxc -- error --> err[error: message + offset]
 *   oxc -- parses --> last[last expression statement, or null]
 * ```
 *
 * @param input.code - the Drizzle code typed on the Query page
 * @returns the first syntax error, or the spans of the last expression statement
 */
export function parseQuery(input: { readonly code: string }) {
  const { code } = input;
  const wrapped = `${WRAP_START}${code}\n}`;
  const { program, errors } = parseSync("query.ts", wrapped, { lang: "ts", sourceType: "module" });
  function own(offset: number) {
    return Math.min(Math.max(0, offset - WRAP_START.length), code.length);
  }
  const [first] = errors;
  if (first !== undefined) {
    return {
      error: { message: first.message, offset: own(first.labels[0]?.start ?? 0) },
      last: null,
    };
  }
  const fn = program.body[0];
  const statements = fn?.type === "FunctionDeclaration" ? (fn.body?.body ?? []) : [];
  const last = statements.at(-1);
  if (last?.type !== "ExpressionStatement") return { error: null, last: null };
  return {
    error: null,
    last: {
      start: own(last.start),
      end: own(last.end),
      expression: { start: own(last.expression.start), end: own(last.expression.end) },
    },
  };
}

/**
 * Reads the names a query uses: every identifier it reads, `table.column` member accesses, the
 * tables of `db.query.<table>`, the keys of every `with: { ... }`, nested ones included, and the
 * tables handed to `.insert()`, `.update()` and `.delete()`. The diagram lights up what it touches.
 *
 * ```mermaid
 * flowchart LR
 *   code[input.code] --> oxc[oxc parseSync]
 *   oxc -- error --> none[null]
 *   oxc -- parses --> visit[visit the AST]
 *   visit --> names[names, members, queries, withs, writes]
 * ```
 *
 * @param input.code - the Drizzle code typed on the Query page
 * @returns the names it uses, or null while it does not parse
 */
export function readQueryNames(input: { readonly code: string }) {
  const { program, errors } = parseSync("query.ts", `async function __q() {\n${input.code}\n}`, {
    lang: "ts",
    sourceType: "module",
  });
  if (errors.length > 0) return null;
  // A property name is an identifier too; `post.title` reads `post`, not `title`.
  const keys = new Set<Node>();
  const identifiers = new Set<Node>();
  const names = new Set<string>();
  // A Set of fresh objects: every access is kept, in order, repeats included.
  const members = new Set<{ readonly object: string; readonly property: string }>();
  const queries = new Set<string>();
  const withs = new Set<string>();
  const writes = new Set<string>();
  new Visitor({
    CallExpression(node) {
      const callee = node.callee;
      const [first] = node.arguments;
      if (callee.type !== "MemberExpression" || callee.computed) return;
      if (callee.property.type !== "Identifier") return;
      if (!["insert", "update", "delete"].includes(callee.property.name)) return;
      if (first?.type === "Identifier") writes.add(first.name);
    },
    Identifier(node) {
      identifiers.add(node);
    },
    MemberExpression(node) {
      if (node.computed || node.property.type !== "Identifier") return;
      keys.add(node.property);
      const object = node.object;
      if (object.type === "Identifier") {
        members.add({ object: object.name, property: node.property.name });
      }
      if (
        object.type === "MemberExpression" &&
        !object.computed &&
        object.property.type === "Identifier" &&
        object.property.name === "query"
      ) {
        queries.add(node.property.name);
      }
    },
    Property(node) {
      if (node.computed || node.shorthand) return;
      keys.add(node.key);
      if (node.key.type !== "Identifier" || node.key.name !== "with") return;
      const declared = node.value;
      if (declared.type !== "ObjectExpression" && declared.type !== "ParenthesizedExpression") {
        return;
      }
      const value = unwrapParens(declared);
      if (value.type !== "ObjectExpression") return;
      for (const entry of value.properties) {
        if (entry.type === "Property" && !entry.computed && entry.key.type === "Identifier") {
          withs.add(entry.key.name);
        }
      }
    },
  }).visit(program);
  for (const node of identifiers) {
    if (!keys.has(node) && node.type === "Identifier") names.add(node.name);
  }
  return {
    names: [...names],
    members: [...members],
    queries: [...queries],
    withs: [...withs],
    writes: [...writes],
  };
}
