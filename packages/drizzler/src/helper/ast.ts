import type {
  ArrowFunctionExpression,
  CallExpression,
  Expression,
  Node,
  ObjectExpression,
  ObjectProperty,
  VariableDeclarator,
} from "oxc-parser";
import { parseSync } from "oxc-parser";

/**
 * The Drizzle schema parsed once with oxc. `text` is the source the offsets
 * point into: oxc hands JS UTF-16 offsets, so `text.slice(start, end)` is the
 * node's own text, as ts-morph's `getText()` was.
 */
export function parseSource(code: readonly string[]) {
  const text = code.join("\n");
  const known = lastParsed.get(text);
  if (known) return known;
  const source = parseText(text);
  // One schema is usually read several times over (its tables, its relations, its diagram), so
  // the last one parsed is kept; nothing reading it changes the tree.
  lastParsed.clear();
  lastParsed.set(text, source);
  return source;
}

function parseText(text: string) {
  const { program, comments } = parseSync("temp.ts", text, { lang: "ts", sourceType: "module" });
  return { program, text, comments };
}

const lastParsed = new Map<string, ReturnType<typeof parseText>>();

type Source = Pick<ReturnType<typeof parseSource>, "text" | "comments">;

// The lines a comment says, without its markers: `// a` and `/// a` are `a`; a block's lines
// lose the ` * ` a JSDoc block starts each of them with.
function commentLines(comment: Source["comments"][number]) {
  const lines =
    comment.type === "Line"
      ? [comment.value.replace(/^\/+/u, "")]
      : comment.value
          .replace(/^\*/u, "")
          .split("\n")
          .map((line) => line.replace(/^\s*\*?/u, ""));
  return lines.map((line) => line.trim()).filter((line) => line !== "");
}

/**
 * The comments written directly above `start`, oldest first: a JSDoc or block comment, or a run
 * of `//` lines, with nothing but whitespace between them and the code — a blank line ends the
 * run, so a file header is not taken for the first table's comment, and a comment that ends a
 * line of code is that line's.
 */
export function commentsBefore(source: Source, start: number) {
  return commentRun(source, endingBy(source.comments, start), start).flatMap(commentLines);
}

// How many of the comments end by `at`. They come in the order they are written and never
// overlap, so those are the first ones, and a binary search finds where they stop.
function endingBy(
  comments: Source["comments"],
  at: number,
  low = 0,
  high = comments.length,
): number {
  if (low >= high) return low;
  const middle = Math.floor((low + high) / 2);
  return (comments[middle]?.end ?? Infinity) <= at
    ? endingBy(comments, at, middle + 1, high)
    : endingBy(comments, at, low, middle);
}

// The comments at the end of the first `count` that run up to `at` with only whitespace between
// them, oldest first.
function commentRun(
  source: Source,
  count: number,
  at: number,
): readonly Source["comments"][number][] {
  const comment = source.comments[count - 1];
  if (comment === undefined) return [];
  const gap = source.text.slice(comment.end, at);
  if (gap.trim() !== "" || (gap.match(/\n/gu)?.length ?? 0) > 1) return [];
  // One that ends a line of code (`id: int(), // ...`) belongs to that line, not to this one.
  const lineStart = source.text.lastIndexOf("\n", comment.start - 1) + 1;
  if (source.text.slice(lineStart, comment.start).trim() !== "") return [];
  return [...commentRun(source, count - 1, comment.start), comment];
}

/**
 * What the comment above `start` says of the table or column, on one line; the `@` lines are
 * tags (`@deprecated`, ...), not description. Null when there is no comment, or only tags.
 */
export function descriptionBefore(source: Source, start: number) {
  const lines = commentsBefore(source, start).filter((line) => !line.startsWith("@"));
  return lines.length === 0 ? null : lines.join(" ");
}

/** The source text of a node. */
export function textOf(text: string, node: { readonly start: number; readonly end: number }) {
  return text.slice(node.start, node.end);
}

/**
 * The first declarator of every `export const ...` at the top level, with the
 * offsets of the statement: `start` is the `export` keyword its leading comments
 * sit above.
 */
export function exportedDeclarations(program: ReturnType<typeof parseSource>["program"]) {
  return program.body.flatMap((stmt) => {
    if (stmt.type !== "ExportNamedDeclaration") return [];
    const decl = stmt.declaration;
    if (decl?.type !== "VariableDeclaration") return [];
    return decl.declarations.map((declarator) => ({
      declarator,
      start: stmt.start,
      end: stmt.end,
    }));
  });
}

type Program = ReturnType<typeof parseSource>["program"];

/**
 * The first declarator of every top-level `const` (or `let`, `var`), exported in place or not,
 * with the offsets of the statement. A schema split over files often declares its tables plainly
 * and exports them in a list at the end (`const user = pgTable(...); export { user };`), so a
 * table is found by how it is built, not by how it is exported.
 */
export function topLevelDeclarations(program: Program) {
  return program.body.flatMap((stmt) => {
    const decl = stmt.type === "ExportNamedDeclaration" ? stmt.declaration : stmt;
    if (decl?.type !== "VariableDeclaration") return [];
    return decl.declarations.map((declarator) => ({
      declarator,
      start: stmt.start,
      end: stmt.end,
    }));
  });
}

// `x as const` and `x satisfies T` are `x` to a reader of the schema.
function unwrapTypes(node: Expression): Expression {
  if (node.type === "TSAsExpression" || node.type === "TSSatisfiesExpression") {
    return unwrapTypes(node.expression);
  }
  return unwrapParens(node) === node ? node : unwrapTypes(unwrapParens(node));
}

const valuesOf = new WeakMap<Program, ReadonlyMap<string, Expression>>();

// The value every top-level `const name = value` is given, by name.
function topLevelValues(program: Program) {
  const known = valuesOf.get(program);
  if (known) return known;
  const values = new Map<string, Expression>();
  for (const { declarator } of topLevelDeclarations(program)) {
    const name = declaratorName(declarator);
    // The first declaration wins: two files may each keep a helper of the same name.
    if (name !== null && declarator.init && !values.has(name)) {
      values.set(name, unwrapTypes(declarator.init));
    }
  }
  valuesOf.set(program, values);
  return values;
}

/**
 * The `key: value` columns of a table's second argument, in the order they are written: an
 * object literal, or the `(t) => ({ ... })` form, with each spread of a top-level object
 * (`...timestamps`, kept in a helper module) read in place. A spread of something else, and a
 * column that is not a `key: value`, is left out.
 */
export function columnProperties(
  node: Node | null | undefined,
  program: Program,
  seen: ReadonlySet<string> = new Set(),
): ObjectProperty[] {
  if (node === null || node === undefined) return [];
  const object = columnsObject(node, program, seen);
  if (object === null) return [];
  return object.properties.flatMap((prop) => {
    if (prop.type === "SpreadElement") {
      const arg = unwrapTypes(prop.argument);
      if (arg.type !== "Identifier" || seen.has(arg.name)) return [];
      return columnProperties(arg, program, new Set([...seen, arg.name]));
    }
    return isPropertyAssignment(prop) ? [prop] : [];
  });
}

// The object literal a table's columns are written in: itself, the one `(t) => ({ ... })` returns,
// or the top-level object an identifier names.
function columnsObject(node: Node, program: Program, seen: ReadonlySet<string>) {
  if (isArrow(node)) return arrowObject(node);
  if (node.type === "Identifier") return resolveObject(node.name, program, seen);
  return isObject(node) ? node : null;
}

function resolveObject(name: string, program: Program, seen: ReadonlySet<string>) {
  const value = topLevelValues(program).get(name);
  if (value === undefined) return null;
  if (isObject(value)) return value;
  // `const columns = { ...a, ...b }` is an object too; an alias (`const t = timestamps`) follows.
  if (value.type === "Identifier" && !seen.has(value.name)) {
    return resolveObject(value.name, program, new Set([...seen, value.name]));
  }
  return null;
}

/** The name a declarator binds, or null for a destructuring pattern. */
export function declaratorName(declarator: VariableDeclarator) {
  return declarator.id.type === "Identifier" ? declarator.id.name : null;
}

/** Whether a node is a call expression. */
export function isCall(node: Node | null | undefined): node is CallExpression {
  return node?.type === "CallExpression";
}

/** Whether a node is an arrow function. */
export function isArrow(node: Node | null | undefined): node is ArrowFunctionExpression {
  return node?.type === "ArrowFunctionExpression";
}

/** Whether a node is an object literal. */
export function isObject(node: Node | null | undefined): node is ObjectExpression {
  return node?.type === "ObjectExpression";
}

/** `key: value` — not a shorthand `key`, a method `key() {}`, an accessor or a spread. */
export function isPropertyAssignment(node: Node): node is ObjectProperty {
  return node.type === "Property" && node.kind === "init" && !node.shorthand && !node.method;
}

/** The expression inside any parentheses. */
export function unwrapParens(node: Expression): Expression {
  return node.type === "ParenthesizedExpression" ? unwrapParens(node.expression) : node;
}

/** The object an arrow returns: `() => ({ ... })`, `() => { return { ... } }`. */
export function arrowObject(arrow: ArrowFunctionExpression) {
  if (arrow.body.type !== "BlockStatement") {
    const expr = unwrapParens(arrow.body);
    return isObject(expr) ? expr : null;
  }
  const ret = arrow.body.body.find((stmt) => stmt.type === "ReturnStatement");
  return ret?.argument && isObject(ret.argument) ? ret.argument : null;
}

/** Every call expression in a subtree, the node itself included, outermost first. */
export function callsIn(node: Node): CallExpression[] {
  // `parent` points back up the tree; following it would never end.
  const children = Object.entries(node).flatMap(([key, value]): Node[] => {
    if (key === "parent") return [];
    if (Array.isArray(value)) return value.filter(isNode);
    return isNode(value) ? [value] : [];
  });
  return [...(isCall(node) ? [node] : []), ...children.flatMap(callsIn)];
}

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && "type" in value && "start" in value;
}
