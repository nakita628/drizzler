import type { CallExpression, Node, Program, Statement } from "oxc-parser";
import { isCall, isObject, topLevelValue } from "./ast.js";

/** What the reader cannot work out without running the schema. */
const UNKNOWN = Symbol("unknown");

type Value = unknown;

function isRecord(value: Value): value is Readonly<Record<string, Value>> {
  return typeof value === "object" && value !== null;
}

// The key of `obj.key`, `obj["key"]` or `{ key: ... }`.
function keyName(key: Node, computed: boolean) {
  if (!computed && key.type === "Identifier") return key.name;
  return key.type === "Literal" && (typeof key.value === "string" || typeof key.value === "number")
    ? String(key.value)
    : null;
}

function evaluateObject(node: Node & { type: "ObjectExpression" }, scope: Scope): Value {
  const entries = node.properties.map((prop) => {
    if (prop.type !== "Property" || prop.kind !== "init" || prop.method) return null;
    const key = keyName(prop.key, prop.computed);
    return key === null ? null : ([key, evaluate(prop.value, scope)] as const);
  });
  return entries.every((e) => e !== null) ? Object.fromEntries(entries) : UNKNOWN;
}

function evaluateMember(node: Node & { type: "MemberExpression" }, scope: Scope): Value {
  const object = evaluate(node.object, scope);
  if (object === UNKNOWN) return UNKNOWN;
  if (object === null || object === undefined) return node.optional ? undefined : UNKNOWN;
  const key = keyName(node.property, node.computed);
  if (key === null || !isRecord(object)) return UNKNOWN;
  return Object.hasOwn(object, key) ? object[key] : undefined;
}

// The comparisons the reader follows between two numbers.
const COMPARISONS = new Map<string, (left: number, right: number) => boolean>([
  [">", (left, right) => left > right],
  ["<", (left, right) => left < right],
  [">=", (left, right) => left >= right],
  ["<=", (left, right) => left <= right],
]);

// `a + b`: a sum of numbers, else the two joined when either is a string.
function plus(left: Value, right: Value): Value {
  if (typeof left === "number" && typeof right === "number") return left + right;
  return typeof left === "string" || typeof right === "string"
    ? `${String(left)}${String(right)}`
    : UNKNOWN;
}

function evaluateBinary(operator: string, left: Value, right: Value): Value {
  if (left === UNKNOWN || right === UNKNOWN) return UNKNOWN;
  if (operator === "===" || operator === "==") return left === right;
  if (operator === "!==" || operator === "!=") return left !== right;
  if (operator === "+") return plus(left, right);
  const compare = COMPARISONS.get(operator);
  return compare !== undefined && typeof left === "number" && typeof right === "number"
    ? compare(left, right)
    : UNKNOWN;
}

// Whether a value counts as true in a condition, as JavaScript reads it.
function truthy(value: Value) {
  return !(
    value === false ||
    value === 0 ||
    value === "" ||
    value === null ||
    value === undefined ||
    Number.isNaN(value)
  );
}

type Scope = ReadonlyMap<string, Value>;

// oxlint-disable-next-line complexity -- one branch per kind of expression the reader follows
function evaluate(node: Node | null | undefined, scope: Scope): Value {
  if (node === null || node === undefined) return UNKNOWN;
  switch (node.type) {
    case "Literal":
      return node.value instanceof RegExp || typeof node.value === "bigint" ? UNKNOWN : node.value;
    case "Identifier":
      if (scope.has(node.name)) return scope.get(node.name);
      return node.name === "undefined" ? undefined : UNKNOWN;
    case "TemplateLiteral": {
      const parts = node.expressions.map((e) => evaluate(e, scope));
      if (parts.some((p) => p === UNKNOWN || isRecord(p))) return UNKNOWN;
      return node.quasis
        .map((q, i) => `${q.value.cooked ?? ""}${i < parts.length ? String(parts[i]) : ""}`)
        .join("");
    }
    case "ParenthesizedExpression":
    case "TSAsExpression":
    case "TSSatisfiesExpression":
    case "TSNonNullExpression":
    case "ChainExpression":
      return evaluate(node.expression, scope);
    case "MemberExpression":
      return evaluateMember(node, scope);
    case "ObjectExpression":
      return evaluateObject(node, scope);
    case "ConditionalExpression": {
      const test = evaluate(node.test, scope);
      if (test === UNKNOWN) return UNKNOWN;
      return evaluate(truthy(test) ? node.consequent : node.alternate, scope);
    }
    case "LogicalExpression": {
      const left = evaluate(node.left, scope);
      if (left === UNKNOWN) return UNKNOWN;
      if (node.operator === "&&") return truthy(left) ? evaluate(node.right, scope) : left;
      if (node.operator === "||") return truthy(left) ? left : evaluate(node.right, scope);
      return left ?? evaluate(node.right, scope);
    }
    case "BinaryExpression":
      return evaluateBinary(node.operator, evaluate(node.left, scope), evaluate(node.right, scope));
    case "UnaryExpression": {
      const argument = evaluate(node.argument, scope);
      if (argument === UNKNOWN) return UNKNOWN;
      if (node.operator === "!") return !truthy(argument);
      return node.operator === "-" && typeof argument === "number" ? -argument : UNKNOWN;
    }
    default:
      return UNKNOWN;
  }
}

// The statements of an `if` branch: a block's, or the one statement it is.
function statementsOf(branch: Statement | null): readonly Statement[] {
  if (branch === null) return [];
  return branch.type === "BlockStatement" ? branch.body : [branch];
}

// What a block of statements returns, following `const`s and `if`s; UNKNOWN for anything else.
function run(statements: readonly Statement[], scope: Scope): Value {
  const [first, ...rest] = statements;
  if (first === undefined) return undefined;
  if (first.type === "ReturnStatement") return evaluate(first.argument, scope);
  if (first.type === "IfStatement") {
    const test = evaluate(first.test, scope);
    if (test === UNKNOWN) return UNKNOWN;
    const taken = statementsOf(truthy(test) ? first.consequent : first.alternate);
    // The branch runs, then what follows it, unless the branch returns first.
    return run([...taken, ...rest], scope);
  }
  if (first.type === "VariableDeclaration" && first.kind === "const") {
    const bound = new Map(scope);
    for (const d of first.declarations) {
      if (d.id.type !== "Identifier") return UNKNOWN;
      bound.set(d.id.name, evaluate(d.init, bound));
    }
    return run(rest, bound);
  }
  return UNKNOWN;
}

// The `dataType` function of a `customType({ ... })` options object, a method or an arrow.
function dataTypeFunction(options: Node | undefined) {
  if (!isObject(options)) return null;
  const prop = options.properties.find(
    (p) => p.type === "Property" && !p.computed && keyName(p.key, false) === "dataType",
  );
  if (prop?.type !== "Property") return null;
  const fn = prop.value;
  return fn.type === "ArrowFunctionExpression" || fn.type === "FunctionExpression" ? fn : null;
}

// The strings a subtree writes: each string literal, and each fixed part of a template.
function stringsIn(node: unknown): readonly string[] {
  if (Array.isArray(node)) return node.flatMap(stringsIn);
  if (!isRecord(node) || !("type" in node)) return [];
  const children = Object.entries(node).flatMap(([key, child]) =>
    key === "parent" ? [] : stringsIn(child),
  );
  return [...ownString(node), ...children];
}

// The string a node writes itself: a string literal's, or a template part's.
function ownString(node: Readonly<Record<string, Value>>): readonly string[] {
  const { type, value } = node;
  if (type === "Literal") return typeof value === "string" ? [value] : [];
  if (type !== "TemplateElement" || !isRecord(value)) return [];
  return typeof value.cooked === "string" ? [value.cooked] : [];
}

// The word a function's strings start with: `numeric` in `` `numeric(${p})` `` and in
// `"numeric"`, the type a `dataType` the reader cannot follow most likely makes.
function leadingWord(fn: Node): string | null {
  const words = stringsIn(fn).flatMap(
    (s) => /^\s*([A-Za-z_][\w ]*?)\s*(?:\(|$)/u.exec(s)?.[1] ?? [],
  );
  return words[0] ?? null;
}

/**
 * The SQL type of a column made with a `customType()` of the schema: what its `dataType` returns
 * for the column's config, as drizzle-orm calls it (`numeric(10,2)` for
 * `numericCasted("amount", { precision: 10, scale: 2 })`). When the reader cannot follow
 * `dataType`, the word its strings start with (`numeric`). Null when the builder is not a
 * `customType()`.
 *
 * @param builder - the name the column is built with: the variable that holds the custom type
 * @param args - the arguments the column passes it: a name, a config, or both
 */
export function customTypeName(
  builder: string,
  args: readonly Node[],
  program: Program,
): string | null {
  const value = topLevelValue(builder, program);
  return isCustomType(value) ? customTypeCallName(value, args) : null;
}

/** Whether a node is a `customType({ ... })` call: the builder a custom column is made with. */
export function isCustomType(node: Node | null | undefined): node is CallExpression {
  return isCall(node) && node.callee.type === "Identifier" && node.callee.name === "customType";
}

/**
 * The SQL type of a column a `customType({ ... })` call builds, given the arguments the column
 * passes it: what `dataType` returns for the column's config, else the word its strings start
 * with. Null when `dataType` is not a function the reader can find.
 *
 * @param custom - the `customType({ ... })` call
 * @param args - the arguments the column passes the custom type: a name, a config, or both
 */
export function customTypeCallName(custom: CallExpression, args: readonly Node[]): string | null {
  const fn = dataTypeFunction(custom.arguments[0]);
  if (fn === null) return null;
  const config = args.find((arg) => isObject(arg));
  const configValue = config === undefined ? undefined : evaluate(config, new Map());
  const [param] = fn.params;
  const scope = new Map<string, Value>(
    param?.type === "Identifier" ? [[param.name, configValue]] : [],
  );
  const result =
    fn.type === "ArrowFunctionExpression" && fn.body.type !== "BlockStatement"
      ? evaluate(fn.body, scope)
      : run(fn.body?.type === "BlockStatement" ? fn.body.body : [], scope);
  if (typeof result === "string" && result.trim() !== "") {
    // drizzle-kit writes `numeric(10,2)`, without the space a template may put after the comma.
    return result.trim().replaceAll(/\s*,\s*/gu, ",");
  }
  return leadingWord(fn);
}
