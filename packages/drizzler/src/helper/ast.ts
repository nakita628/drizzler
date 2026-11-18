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
function commentsBefore(source: Source, start: number) {
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
function exportedDeclarations(program: ReturnType<typeof parseSource>["program"]) {
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

type Statement = Program["body"][number];

/**
 * Every declarator of every top-level `const` (or `let`, `var`), exported in place or not, with
 * the offsets of the statement. A schema split over files often declares its tables plainly
 * and exports them in a list at the end (`const user = pgTable(...); export { user };`), so a
 * table is found by how it is built, not by how it is exported.
 *
 * The declarations at the top of a top-level function's body are read in place as well: a
 * schema may build its tables in a function and export what it returns
 * (`export const { users } = defineTables()`, as the Auth.js adapter does), so the tables are
 * values only once the module runs.
 */
export function topLevelDeclarations(program: Program) {
  return program.body.flatMap((stmt) => [
    ...declarationsOf(stmt),
    ...functionBody(stmt).flatMap(declarationsOf),
  ]);
}

// The declarators a statement makes, `export const ...` included.
function declarationsOf(stmt: Statement) {
  const decl = stmt.type === "ExportNamedDeclaration" ? stmt.declaration : stmt;
  if (decl?.type !== "VariableDeclaration") return [];
  return decl.declarations.map((declarator) => ({
    declarator,
    start: stmt.start,
    end: stmt.end,
  }));
}

// The statements of the function a top-level statement declares: `function f() {}`, exported or
// the default export, and `const f = () => {}` or `const f = function () {}`.
function functionBody(stmt: Statement): Statement[] {
  const decl =
    stmt.type === "ExportNamedDeclaration" || stmt.type === "ExportDefaultDeclaration"
      ? stmt.declaration
      : stmt;
  if (decl === null || decl === undefined) return [];
  if (decl.type === "FunctionDeclaration" || decl.type === "FunctionExpression") {
    return decl.body?.body ?? [];
  }
  if (decl.type !== "VariableDeclaration") return [];
  return decl.declarations.flatMap((declarator) => {
    const init = declarator.init ? unwrapTypes(declarator.init) : null;
    if (init?.type === "FunctionExpression") return init.body?.body ?? [];
    if (init?.type === "ArrowFunctionExpression" && init.body.type === "BlockStatement") {
      return init.body.body;
    }
    return [];
  });
}

/**
 * The value a declaration is given when it is not handed one: `sqliteTable(...)` in
 * `schema.users ?? sqliteTable(...)`, the fallback a table built in a function falls back to.
 */
export function fallbackValue(node: Expression): Expression {
  const expr = unwrapTypes(node);
  return expr.type === "LogicalExpression" && (expr.operator === "??" || expr.operator === "||")
    ? fallbackValue(expr.right)
    : expr;
}

// `x as const` and `x satisfies T` are `x` to a reader of the schema.
function unwrapTypes(node: Expression): Expression {
  if (node.type === "TSAsExpression" || node.type === "TSSatisfiesExpression") {
    return unwrapTypes(node.expression);
  }
  return unwrapParens(node) === node ? node : unwrapTypes(unwrapParens(node));
}

type Declared<T> = { readonly start: number; readonly node: T };

/**
 * The declaration of `name` a use at `at` reaches, of the ones the schema's files make: the last
 * one before it, else the first. The files are read as one source, so two of them may each keep a
 * module-local helper of the same name; a helper is declared above where its own file uses it
 * (a `const` must be, to run), which tells the two apart.
 */
function nearest<T>(declared: readonly Declared<T>[] | undefined, at: number | undefined) {
  if (declared === undefined) return undefined;
  const before = at === undefined ? [] : declared.filter((d) => d.start <= at);
  return (before.at(-1) ?? declared[0])?.node;
}

const valuesOf = new WeakMap<Program, ReadonlyMap<string, readonly Declared<Expression>[]>>();

// Every value a top-level `const name = value` is given, by name, in the order written.
function topLevelValues(program: Program) {
  const known = valuesOf.get(program);
  if (known) return known;
  const declared = topLevelDeclarations(program).flatMap(({ declarator, start }) => {
    const name = declaratorName(declarator);
    return name !== null && declarator.init
      ? [{ name, start, node: unwrapTypes(declarator.init) }]
      : [];
  });
  const values = new Map(
    [...Map.groupBy(declared, (d) => d.name)].map(([name, list]) => [
      name,
      list.toSorted((x, y) => x.start - y.start),
    ]),
  );
  valuesOf.set(program, values);
  return values;
}

/**
 * The value a top-level `const name = value` is given, `as` and `satisfies` aside: the one a use
 * at `at` reaches when two files declare the name, else the first.
 */
export function topLevelValue(name: string, program: Program, at?: number) {
  return nearest(topLevelValues(program).get(name), at);
}

type Bindings = ReadonlyMap<string, Expression>;

// The keys of a node that name something rather than read it: `x.key`, `{ key: ... }`.
function namingKey(node: Node, key: string) {
  if (node.type === "MemberExpression") return key === "property" && !node.computed;
  return node.type === "Property" && key === "key" && !node.computed;
}

function substituted(node: unknown, bindings: Bindings): unknown {
  if (Array.isArray(node)) return node.map((item) => substituted(item, bindings));
  if (!isNode(node)) return node;
  if (node.type === "Identifier" && bindings.has(node.name)) return bindings.get(node.name);
  return Object.fromEntries(
    Object.entries(node).map(([key, value]) =>
      key === "parent" || namingKey(node, key) ? [key, value] : [key, substituted(value, bindings)],
    ),
  );
}

function isExpression(value: unknown): value is Expression {
  return isNode(value);
}

/**
 * An expression with each parameter it reads replaced by what the call gives it: in a helper
 * `(modelMediaId) => ({ mediaId: integer().references(() => modelMediaId) })` called as
 * `helper(books.id)`, the key points at `books.id`. The nodes keep their offsets, so the text of
 * the expression is still the helper's.
 */
function substitute(node: Expression, bindings: Bindings): Expression {
  if (bindings.size === 0) return node;
  const result = substituted(node, bindings);
  return isExpression(result) ? result : node;
}

/**
 * What each parameter of a function stands for in a call of it: the argument given, or the
 * parameter's default when the call leaves it out. A destructured parameter is left out.
 */
function parameterBindings(fn: Node, args: CallExpression["arguments"]): Bindings {
  const params: readonly Node[] = "params" in fn ? fn.params : [];
  return new Map(
    params.flatMap((param, index): (readonly [string, Expression])[] => {
      const arg = args[index];
      const given = arg !== undefined && arg.type !== "SpreadElement" ? arg : undefined;
      if (param.type === "Identifier") return given === undefined ? [] : [[param.name, given]];
      return param.type === "AssignmentPattern" && param.left.type === "Identifier"
        ? [[param.left.name, given ?? param.right]]
        : [];
    }),
  );
}

/**
 * The function a call of a top-level helper runs and what it returns, its parameters bound to
 * the call's arguments. Null when the callee is not a top-level function with one `return`.
 */
export function helperCall(call: CallExpression, program: Program) {
  if (call.callee.type !== "Identifier") return null;
  const fn = nearest(topLevelFunctions(program).get(call.callee.name), call.start);
  const returned = fn === undefined ? null : returnedValue(fn);
  if (fn === undefined || returned === null) return null;
  const bindings = parameterBindings(fn, call.arguments);
  return { name: call.callee.name, returned: substitute(returned, bindings), bindings };
}

/**
 * The `key: value` columns of a table's second argument, in the order they are written: an
 * object literal, or the `(t) => ({ ... })` form, with each spread of a top-level object
 * (`...timestamps`, kept in a helper module) or of what a top-level function returns
 * (`...createTimestampColumns()`, which may spread other helpers in turn, its parameters bound
 * to the call's arguments) read in place. A column held in a top-level constant
 * (`id: idUuid`, or the shorthand `createdAt`) is the builder the constant holds. A spread of
 * something else, and a column that is not a `key: value`, is left out.
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
      if (isCall(arg)) return spreadCallColumns(arg, program, seen);
      if (arg.type !== "Identifier" || seen.has(arg.name)) return [];
      return columnProperties(arg, program, new Set([...seen, arg.name]));
    }
    if (prop.type !== "Property" || prop.kind !== "init" || prop.method) return [];
    const value = heldColumn(prop.value, program);
    if (value === prop.value) return prop.shorthand ? [] : [prop];
    return [{ ...prop, shorthand: false, value }];
  });
}

// The builder a column held in a top-level constant is: `uuid("id").primaryKey()` for `idUuid`
// with `const idUuid = uuid("id").primaryKey()`, through aliases. The value itself otherwise.
function heldColumn(value: Expression, program: Program, depth = 0): Expression {
  const expr = unwrapTypes(value);
  if (expr.type !== "Identifier" || depth > 8) return value;
  const bound = topLevelValue(expr.name, program, expr.start);
  if (bound?.type === "Identifier") {
    const held = heldColumn(bound, program, depth + 1);
    return held === bound ? value : held;
  }
  return isCall(bound) ? bound : value;
}

// The columns of `...createTimestampColumns()`: those of the object the top-level function
// returns, its parameters bound to the call's arguments.
function spreadCallColumns(call: CallExpression, program: Program, seen: ReadonlySet<string>) {
  if (call.callee.type !== "Identifier") return [];
  const key = `${call.callee.name}()`;
  if (seen.has(key)) return [];
  const helper = helperCall(call, program);
  return isObject(helper?.returned)
    ? columnProperties(helper.returned, program, new Set([...seen, key]))
    : [];
}

// The object literal a table's columns are written in: itself, the one `(t) => ({ ... })` returns,
// or the top-level object an identifier names.
function columnsObject(node: Node, program: Program, seen: ReadonlySet<string>) {
  if (isArrow(node)) return arrowObject(node);
  if (node.type === "Identifier") return resolveObject(node.name, program, seen, node.start);
  return isObject(node) ? node : null;
}

function resolveObject(name: string, program: Program, seen: ReadonlySet<string>, at: number) {
  const value = topLevelValue(name, program, at);
  if (value === undefined) return null;
  if (isObject(value)) return value;
  // `const columns = { ...a, ...b }` is an object too; an alias (`const t = timestamps`) follows.
  if (value.type === "Identifier" && !seen.has(value.name)) {
    return resolveObject(value.name, program, new Set([...seen, value.name]), value.start);
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

/**
 * Reads the names a schema module exports, in file order: `export const` declarations and the
 * names of an `export { ... }` list. A query sees these as its scope.
 */
export function schemaExports(input: { readonly source: string }) {
  const { program } = parseSource(input.source.split("\n"));
  const declared = exportedDeclarations(program)
    .map(({ declarator }) => declaratorName(declarator))
    .filter((name): name is string => name !== null);
  // `const user = pgTable(...); export { user, post as posts };` exports by a list.
  const listed = program.body.flatMap((stmt) =>
    stmt.type === "ExportNamedDeclaration" && stmt.declaration === null && stmt.source === null
      ? stmt.specifiers.flatMap((s) =>
          s.exported.type === "Identifier" && s.exportKind !== "type" ? [s.exported.name] : [],
        )
      : [],
  );
  return [...new Set([...declared, ...listed])];
}

// The call at the root of a chain: `createdAtField("at")` in `createdAtField("at").unique()`.
function rootCall(call: CallExpression): CallExpression {
  const { callee } = call;
  return callee.type === "MemberExpression" && isCall(callee.object)
    ? rootCall(callee.object)
    : call;
}

// The expression a function gives back: an arrow's body, or the one `return` of its block.
function returnedValue(fn: Node): Expression | null {
  if (fn.type === "ArrowFunctionExpression" && fn.body.type !== "BlockStatement") {
    return unwrapTypes(fn.body);
  }
  const isFunction =
    fn.type === "ArrowFunctionExpression" ||
    fn.type === "FunctionExpression" ||
    fn.type === "FunctionDeclaration";
  const statements = isFunction && fn.body?.type === "BlockStatement" ? fn.body.body : [];
  const returns = statements.filter((stmt) => stmt.type === "ReturnStatement");
  const [only] = returns;
  return returns.length === 1 && only?.argument ? unwrapTypes(only.argument) : null;
}

const functionsOf = new WeakMap<Program, ReadonlyMap<string, readonly Declared<Node>[]>>();

// Every function the schema declares at the top level, by name, in the order written:
// `function f() {}`, exported or not, and `const f = () => ...` or `const f = function () {}`.
function topLevelFunctions(program: Program) {
  const known = functionsOf.get(program);
  if (known) return known;
  const declarations = program.body.flatMap((stmt) => {
    const decl = stmt.type === "ExportNamedDeclaration" ? stmt.declaration : stmt;
    return decl?.type === "FunctionDeclaration" && decl.id
      ? [{ name: decl.id.name, start: stmt.start, node: decl }]
      : [];
  });
  const expressions = [...topLevelValues(program)].flatMap(([name, list]) =>
    list.flatMap(({ start, node }) =>
      node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression"
        ? [{ name, start, node }]
        : [],
    ),
  );
  const functions = new Map(
    [...Map.groupBy([...declarations, ...expressions], (d) => d.name)].map(([name, list]) => [
      name,
      list.toSorted((x, y) => x.start - y.start),
    ]),
  );
  functionsOf.set(program, functions);
  return functions;
}

/**
 * A column a helper function of the schema builds: for `createdAt: createdAtField("at").unique()`
 * with `function createdAtField(name = "createdAt") { return integer(name).notNull(); }`, the
 * chain the helper returns (`integer(name).notNull()`, each parameter it reads replaced by what
 * the call gives it), the call that runs it, and what each of its parameters stands for there
 * (`name` is `"at"`, or the default when the call leaves it out). Null when the column is not a
 * call of a top-level function that returns a call.
 */
export function helperColumn(expr: Expression, program: Program) {
  const value = unwrapTypes(expr);
  if (!isCall(value)) return null;
  const root = rootCall(value);
  const helper = helperCall(root, program);
  if (helper === null || !isCall(helper.returned)) return null;
  return { chain: helper.returned, call: root, bindings: helper.bindings, name: helper.name };
}

/**
 * The text of a column as the reader takes it: its own, or for a column a helper builds, the
 * chain the helper returns followed by the methods the column calls on it
 * (`integer(name).notNull()` + `.unique()`), so a `.notNull()` or `.references()` written in the
 * helper counts.
 */
export function columnText(expr: Expression, program: Program, text: string, depth = 0): string {
  // A helper that calls itself would never end; eight helpers deep is more than any schema needs.
  const helper = depth < 8 ? helperColumn(expr, program) : null;
  if (helper === null) return textOf(text, expr);
  const inner = columnText(helper.chain, program, text, depth + 1);
  return `${inner}${text.slice(helper.call.end, expr.end)}`;
}

/**
 * The expressions a column is written in: itself, and for a column a helper builds, the chain the
 * helper returns too (and so on, for a helper that calls another).
 */
export function columnExpressions(expr: Expression, program: Program, depth = 0): Expression[] {
  const helper = depth < 8 ? helperColumn(expr, program) : null;
  return helper === null ? [expr] : [expr, ...columnExpressions(helper.chain, program, depth + 1)];
}
