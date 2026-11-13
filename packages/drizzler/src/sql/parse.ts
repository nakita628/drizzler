/**
 * A recursive-descent SQL parser over the tokens of `tokenize.ts`. It reads the dialect-neutral
 * core of SQLite, PostgreSQL and MySQL: what an application query is made of. Anything it does
 * not model inside an expression is kept as a `raw` node with its text and range, so an unusual
 * operator or a vendor function changes what the picture can say about a column, never whether
 * there is a picture at all. A statement it cannot read at the clause level is reported as
 * `invalid` with the offset, and parsing resumes at the next `;`.
 */
import type {
  CaseBranch,
  Cte,
  Expr,
  FromItem,
  InsertSource,
  JoinType,
  OrderItem,
  Query,
  QueryBody,
  Range,
  SelectCore,
  SelectItem,
  Statement,
  TableName,
  WindowSpec,
} from "./ast.js";
import { tokenize } from "./tokenize.js";
import type { Token } from "./tokenize.js";

class ParseFailure extends Error {
  constructor(
    message: string,
    readonly offset: number,
  ) {
    super(message);
  }
}

/**
 * The parser's state: the tokens and the cursor into them. Recursive descent moves one cursor
 * through every rule; `advance` is the only place it moves.
 */
type Parser = {
  readonly text: string;
  readonly tokens: readonly Token[];
  pos: number;
};

/**
 * The items of a list as the parser reads them: `read` takes one item, moving the cursor, and the
 * list goes on while `more` (which may take a separator) says so. A generator, so a long list (a
 * large VALUES) is neither copied per item nor read by recursion.
 *
 * @yields Each item, as `read` returns it.
 */
function* readEach<T>(read: () => T, more: () => boolean): Generator<T> {
  do yield read();
  while (more());
}

/**
 * As `readEach`, for a list that may be empty: `more` is asked before the first item.
 *
 * @yields Each item, as `read` returns it.
 */
function* readWhile<T>(more: () => boolean, read: () => T): Generator<T> {
  while (more()) yield read();
}

/**
 * Moves past tokens, counting parentheses, up to the `until` punctuation at the depth it started
 * (or the end of the tokens). `clamp` keeps a stray `)` from taking the depth below zero.
 */
function skipNested(p: Parser, until: string, clamp: boolean) {
  // oxlint-disable-next-line custom/no-let -- the depth follows the cursor token by token; a long DDL statement would overflow a recursive walk
  let depth = 0;
  while (peek(p).kind !== "eof" && !(depth === 0 && atPunct(p, until))) {
    if (atPunct(p, "(")) depth += 1;
    if (atPunct(p, ")")) depth = clamp ? Math.max(0, depth - 1) : depth - 1;
    advance(p);
  }
}

/** Words that never name a column or table, so they end an expression or an alias. */
const RESERVED = new Set([
  "SELECT",
  "FROM",
  "WHERE",
  "GROUP",
  "HAVING",
  "ORDER",
  "LIMIT",
  "OFFSET",
  "JOIN",
  "ON",
  "USING",
  "AND",
  "OR",
  "NOT",
  "IN",
  "IS",
  "NULL",
  "BETWEEN",
  "CASE",
  "WHEN",
  "THEN",
  "ELSE",
  "END",
  "DISTINCT",
  "UNION",
  "INTERSECT",
  "EXCEPT",
  "WITH",
  "INSERT",
  "INTO",
  "VALUES",
  "UPDATE",
  "SET",
  "DELETE",
  "RETURNING",
  "LEFT",
  "RIGHT",
  "INNER",
  "OUTER",
  "CROSS",
  "FULL",
  "NATURAL",
  "EXISTS",
  "AS",
  "LIKE",
  "ILIKE",
  "FETCH",
  "WINDOW",
  "COLLATE",
]);

const COMPARISON = new Set(["=", "<>", "!=", "<", ">", "<=", ">=", "<=>", "~", "!~", "~*", "!~*"]);
const OTHER_OPERATORS = new Set([
  "||",
  "->",
  "->>",
  "#>",
  "#>>",
  "@>",
  "<@",
  "<<",
  ">>",
  "&",
  "|",
  "#",
]);
const LIKE_WORDS = new Set(["LIKE", "ILIKE", "GLOB", "REGEXP", "MATCH", "RLIKE", "SIMILAR"]);
const SET_OPERATORS = new Set(["UNION", "INTERSECT", "EXCEPT"]);
const JOIN_WORDS = new Set(["JOIN", "LEFT", "RIGHT", "INNER", "CROSS", "FULL", "NATURAL"]);

function peek(p: Parser, ahead = 0): Token {
  const token = p.tokens[p.pos + ahead];
  return token ?? p.tokens.at(-1) ?? { kind: "eof", raw: "", text: "", start: 0, end: 0 };
}

function advance(p: Parser) {
  const token = peek(p);
  // oxlint-disable-next-line custom/no-property-assignment, no-param-reassign -- the one place the parser's cursor moves (see Parser)
  if (token.kind !== "eof") p.pos += 1;
  return token;
}

function fail(p: Parser, message: string): never {
  throw new ParseFailure(message, peek(p).start);
}

function isWord(token: Token, word: string) {
  return token.kind === "word" && token.text === word;
}

function atWord(p: Parser, word: string, ahead = 0) {
  return isWord(peek(p, ahead), word);
}

function atPunct(p: Parser, punct: string, ahead = 0) {
  const token = peek(p, ahead);
  return token.kind === "punct" && token.text === punct;
}

function atOp(p: Parser, op: string, ahead = 0) {
  const token = peek(p, ahead);
  return token.kind === "op" && token.text === op;
}

function acceptWord(p: Parser, word: string) {
  if (!atWord(p, word)) return false;
  advance(p);
  return true;
}

function acceptPunct(p: Parser, punct: string) {
  if (!atPunct(p, punct)) return false;
  advance(p);
  return true;
}

function expectWord(p: Parser, word: string) {
  if (!acceptWord(p, word)) fail(p, `Expected ${word}`);
}

function expectPunct(p: Parser, punct: string) {
  if (!acceptPunct(p, punct)) fail(p, `Expected "${punct}"`);
}

/** `A B C` in a row, each accepted only when the whole phrase is there. */
function acceptWords(p: Parser, ...words: readonly string[]) {
  if (!words.every((word, index) => atWord(p, word, index))) return false;
  for (const _ of words) advance(p);
  return true;
}

function previousEnd(p: Parser) {
  return p.tokens[p.pos - 1]?.end ?? 0;
}

function rangeFrom(p: Parser, start: number): Range {
  return { start, end: previousEnd(p) };
}

/** Whether the token can name something: an identifier, or a word that is not reserved. */
function isNameToken(token: Token) {
  return token.kind === "quoted" || (token.kind === "word" && !RESERVED.has(token.text));
}

function nameOf(token: Token) {
  return token.kind === "quoted" ? token.text : token.raw;
}

function expectName(p: Parser, what: string) {
  const token = peek(p);
  if (!isNameToken(token)) fail(p, `Expected ${what}`);
  advance(p);
  return nameOf(token);
}

/** `[AS] alias`, where a bare alias must not be a reserved word. */
function parseAlias(p: Parser) {
  if (acceptWord(p, "AS")) return expectName(p, "an alias");
  const token = peek(p);
  if (isNameToken(token)) {
    advance(p);
    return nameOf(token);
  }
  return null;
}

// --- expressions ------------------------------------------------------------------------------

function parseOr(p: Parser): Expr {
  const start = peek(p).start;
  const first = parseAnd(p);
  return fold(p, start, first, () => (acceptWord(p, "OR") ? "OR" : null), parseAnd);
}

function parseAnd(p: Parser): Expr {
  const start = peek(p).start;
  const first = parseNot(p);
  return fold(p, start, first, () => (acceptWord(p, "AND") ? "AND" : null), parseNot);
}

/** Left-associative binary chain: `first (op next)*`. */
function fold(
  p: Parser,
  start: number,
  first: Expr,
  operator: () => string | null,
  parseNext: (p: Parser) => Expr,
): Expr {
  const op = operator();
  if (op === null) return first;
  const right = parseNext(p);
  return fold(
    p,
    start,
    { type: "binary", op, left: first, right, range: rangeFrom(p, start) },
    operator,
    parseNext,
  );
}

function parseNot(p: Parser): Expr {
  const start = peek(p).start;
  if (acceptWord(p, "NOT")) {
    const operand = parseNot(p);
    return { type: "unary", op: "NOT", operand, range: rangeFrom(p, start) };
  }
  return parseComparison(p);
}

function parseComparison(p: Parser): Expr {
  const start = peek(p).start;
  const left = parseConcat(p);
  return parsePredicate(p, start, left);
}

/** The predicates that follow a value: comparison operators, IS, IN, BETWEEN, LIKE and friends. */
function parsePredicate(p: Parser, start: number, left: Expr): Expr {
  const token = peek(p);
  if (token.kind === "op" && COMPARISON.has(token.text)) {
    advance(p);
    // `= ANY (...)` / `= ALL (...)` / `= SOME (...)` qualify the comparison; the operand still reads.
    if (atWord(p, "ANY") || atWord(p, "ALL") || atWord(p, "SOME")) advance(p);
    const right = parseConcat(p);
    return parsePredicate(p, start, {
      type: "binary",
      op: token.text,
      left,
      right,
      range: rangeFrom(p, start),
    });
  }
  if (atWord(p, "IS")) {
    advance(p);
    const not = acceptWord(p, "NOT");
    if (acceptWords(p, "DISTINCT", "FROM")) {
      const right = parseConcat(p);
      return parsePredicate(p, start, {
        type: "binary",
        op: not ? "IS NOT DISTINCT FROM" : "IS DISTINCT FROM",
        left,
        right,
        range: rangeFrom(p, start),
      });
    }
    const value = advance(p);
    if (!["NULL", "TRUE", "FALSE", "UNKNOWN"].includes(value.text) || value.kind !== "word") {
      fail(p, "Expected NULL, TRUE, FALSE or UNKNOWN after IS");
    }
    const literal = isLiteral(value.text);
    return parsePredicate(p, start, {
      type: "is",
      expr: left,
      not,
      value: literal,
      range: rangeFrom(p, start),
    });
  }
  if (atWord(p, "ISNULL") || atWord(p, "NOTNULL")) {
    const word = advance(p);
    return parsePredicate(p, start, {
      type: "is",
      expr: left,
      not: word.text === "NOTNULL",
      value: "NULL",
      range: rangeFrom(p, start),
    });
  }
  const negated =
    atWord(p, "NOT") &&
    (atWord(p, "IN", 1) || atWord(p, "BETWEEN", 1) || LIKE_WORDS.has(peek(p, 1).text));
  if (negated) advance(p);
  if (atWord(p, "IN")) {
    advance(p);
    if (acceptPunct(p, "(")) {
      if (atQueryStart(p)) {
        const query = parseQuery(p);
        expectPunct(p, ")");
        return parsePredicate(p, start, {
          type: "in",
          expr: left,
          not: negated,
          list: null,
          subquery: query,
          range: rangeFrom(p, start),
        });
      }
      const list = atPunct(p, ")") ? [] : parseExprList(p);
      expectPunct(p, ")");
      return parsePredicate(p, start, {
        type: "in",
        expr: left,
        not: negated,
        list,
        subquery: null,
        range: rangeFrom(p, start),
      });
    }
    // `position('a' IN s)` and a bare `x IN y`: one operand on the right.
    const single = parseConcat(p);
    return parsePredicate(p, start, {
      type: "in",
      expr: left,
      not: negated,
      list: [single],
      subquery: null,
      range: rangeFrom(p, start),
    });
  }
  if (atWord(p, "BETWEEN")) {
    advance(p);
    acceptWord(p, "SYMMETRIC");
    const low = parseConcat(p);
    expectWord(p, "AND");
    const high = parseConcat(p);
    return parsePredicate(p, start, {
      type: "between",
      expr: left,
      not: negated,
      low,
      high,
      range: rangeFrom(p, start),
    });
  }
  const like = peek(p);
  if (LIKE_WORDS.has(like.text) && like.kind === "word") {
    advance(p);
    if (like.text === "SIMILAR") expectWord(p, "TO");
    const pattern = parseConcat(p);
    if (acceptWord(p, "ESCAPE")) parseConcat(p);
    return parsePredicate(p, start, {
      type: "like",
      op: like.text,
      expr: left,
      not: negated,
      pattern,
      range: rangeFrom(p, start),
    });
  }
  if (negated) fail(p, "Expected IN, BETWEEN or LIKE after NOT");
  return left;
}

function parseConcat(p: Parser): Expr {
  const start = peek(p).start;
  const first = parseAdditive(p);
  return fold(
    p,
    start,
    first,
    () => {
      const token = peek(p);
      if (token.kind === "op" && OTHER_OPERATORS.has(token.text)) {
        advance(p);
        return token.text;
      }
      return null;
    },
    parseAdditive,
  );
}

function parseAdditive(p: Parser): Expr {
  const start = peek(p).start;
  const first = parseMultiplicative(p);
  return fold(
    p,
    start,
    first,
    () => (atOp(p, "+") || atOp(p, "-") ? advance(p).text : null),
    parseMultiplicative,
  );
}

function parseMultiplicative(p: Parser): Expr {
  const start = peek(p).start;
  const first = parseUnary(p);
  return fold(
    p,
    start,
    first,
    () =>
      atOp(p, "*") || atOp(p, "/") || atOp(p, "%") || atOp(p, "^") || atOp(p, "**")
        ? advance(p).text
        : null,
    parseUnary,
  );
}

function parseUnary(p: Parser): Expr {
  const start = peek(p).start;
  if (atOp(p, "-") || atOp(p, "+") || atOp(p, "~") || atOp(p, "!")) {
    const op = advance(p).text;
    const operand = parseUnary(p);
    return { type: "unary", op, operand, range: rangeFrom(p, start) };
  }
  return parsePostfix(p, start, parsePrimary(p));
}

/** `::type` casts, `[subscript]`s and `COLLATE` after a primary. */
function parsePostfix(p: Parser, start: number, expr: Expr): Expr {
  if (atOp(p, "::")) {
    advance(p);
    const to = parseTypeName(p);
    return parsePostfix(p, start, { type: "cast", expr, to, range: rangeFrom(p, start) });
  }
  if (atPunct(p, "[")) {
    advance(p);
    const index = parseOr(p);
    if (acceptPunct(p, ":")) parseOr(p);
    expectPunct(p, "]");
    return parsePostfix(p, start, {
      type: "binary",
      op: "[]",
      left: expr,
      right: index,
      range: rangeFrom(p, start),
    });
  }
  if (atWord(p, "COLLATE")) {
    advance(p);
    expectName(p, "a collation");
    return parsePostfix(p, start, expr);
  }
  return expr;
}

/** A type name as written after CAST ... AS or `::`: words, an optional `(n[, m])` and `[]`. */
function parseTypeName(p: Parser) {
  const start = peek(p).start;
  const first = advance(p);
  if (first.kind !== "word" && first.kind !== "quoted") fail(p, "Expected a type name");
  while (peek(p).kind === "word" && !RESERVED.has(peek(p).text) && !atPunct(p, ")")) advance(p);
  if (atPunct(p, "(")) {
    advance(p);
    while (!atPunct(p, ")") && peek(p).kind !== "eof") advance(p);
    expectPunct(p, ")");
  }
  while (atPunct(p, "[") && atPunct(p, "]", 1)) {
    advance(p);
    advance(p);
  }
  return p.text.slice(start, previousEnd(p)).replaceAll(/\s+/gu, " ");
}

/** The keyword after `IS`: `NULL`, `TRUE`, `FALSE`, else `UNKNOWN`. */
function isLiteral(text: string) {
  if (text === "NULL" || text === "TRUE" || text === "FALSE") return text;
  return "UNKNOWN";
}

function parseExprList(p: Parser): Expr[] {
  return [
    ...readEach(
      () => parseOr(p),
      () => acceptPunct(p, ","),
    ),
  ];
}

function atQueryStart(p: Parser) {
  return (
    atWord(p, "SELECT") ||
    atWord(p, "WITH") ||
    atWord(p, "VALUES") ||
    (atPunct(p, "(") && atQueryStartAt(p, 1))
  );
}

function atQueryStartAt(p: Parser, ahead: number): boolean {
  if (atWord(p, "SELECT", ahead) || atWord(p, "WITH", ahead) || atWord(p, "VALUES", ahead)) {
    return true;
  }
  return atPunct(p, "(", ahead) ? atQueryStartAt(p, ahead + 1) : false;
}

function parsePrimary(p: Parser): Expr {
  const token = peek(p);
  const start = token.start;
  if (token.kind === "string") {
    advance(p);
    return { type: "literal", kind: "string", value: token.text, range: rangeFrom(p, start) };
  }
  if (token.kind === "number") {
    advance(p);
    return { type: "literal", kind: "number", value: token.text, range: rangeFrom(p, start) };
  }
  if (token.kind === "param") {
    advance(p);
    return { type: "param", placeholder: token.text, range: rangeFrom(p, start) };
  }
  if (token.kind === "punct" && token.text === "(") {
    advance(p);
    if (atQueryStart(p)) {
      const query = parseQuery(p);
      expectPunct(p, ")");
      return { type: "subquery", query, range: rangeFrom(p, start) };
    }
    const items = parseExprList(p);
    expectPunct(p, ")");
    const single = items[0];
    return items.length === 1 && single !== undefined
      ? single
      : { type: "list", items, range: rangeFrom(p, start) };
  }
  if (token.kind === "op" && token.text === "*") {
    advance(p);
    return { type: "star", table: null, range: rangeFrom(p, start) };
  }
  if (token.kind === "word") {
    switch (token.text) {
      case "NULL":
        advance(p);
        return { type: "literal", kind: "null", value: "NULL", range: rangeFrom(p, start) };
      case "TRUE":
      case "FALSE":
        advance(p);
        return {
          type: "literal",
          kind: "boolean",
          value: token.text.toLowerCase(),
          range: rangeFrom(p, start),
        };
      case "CASE":
        return parseCase(p);
      case "CAST":
        return parseCast(p);
      case "EXISTS": {
        advance(p);
        expectPunct(p, "(");
        const query = parseQuery(p);
        expectPunct(p, ")");
        return { type: "exists", not: false, query, range: rangeFrom(p, start) };
      }
      case "NOT": {
        advance(p);
        const operand = parseUnary(p);
        return { type: "unary", op: "NOT", operand, range: rangeFrom(p, start) };
      }
      case "INTERVAL":
      case "DATE":
      case "TIME":
      case "TIMESTAMP":
        // `DATE '2024-01-01'`, `INTERVAL '1 day'`: a typed literal.
        if (peek(p, 1).kind === "string") {
          advance(p);
          const literal = advance(p);
          return {
            type: "cast",
            expr: {
              type: "literal",
              kind: "string",
              value: literal.text,
              range: { start: literal.start, end: literal.end },
            },
            to: token.raw,
            range: rangeFrom(p, start),
          };
        }
        break;
      case "ARRAY":
        if (atPunct(p, "[", 1)) {
          advance(p);
          advance(p);
          const items = atPunct(p, "]") ? [] : parseExprList(p);
          expectPunct(p, "]");
          return {
            type: "call",
            name: "array",
            args: items,
            distinct: false,
            over: null,
            range: rangeFrom(p, start),
          };
        }
        break;
      default:
        break;
    }
  }
  if (isNameToken(token) || (token.kind === "word" && !RESERVED.has(token.text))) {
    return parseNameExpr(p);
  }
  return fail(p, `Unexpected ${token.kind === "eof" ? "end of statement" : `"${token.raw}"`}`);
}

/** `a`, `a.b`, `a.b.c`, `a.*` or a function call `f(...)`. */
function parseNameExpr(p: Parser): Expr {
  const start = peek(p).start;
  const parts = [
    nameOf(advance(p)),
    // `a.b.c`: each `.` is followed by a name, unless it is the `.*` of `a.*`.
    ...readWhile(
      () => atPunct(p, ".") && !atOp(p, "*", 1),
      () => {
        advance(p);
        const next = advance(p);
        if (next.kind !== "word" && next.kind !== "quoted") fail(p, 'Expected a name after "."');
        return nameOf(next);
      },
    ),
  ];
  if (atPunct(p, ".")) {
    advance(p);
    advance(p);
    return { type: "star", table: parts.join("."), range: rangeFrom(p, start) };
  }
  if (atPunct(p, "(")) return parseCall(p, start, parts.join("."));
  const name = parts.at(-1) ?? "";
  const qualifier = parts.length > 1 ? parts.slice(0, -1).join(".") : null;
  return { type: "column", table: qualifier, name, range: rangeFrom(p, start) };
}

function parseCall(p: Parser, start: number, name: string): Expr {
  expectPunct(p, "(");
  const distinct = acceptWord(p, "DISTINCT");
  if (!distinct) acceptWord(p, "ALL");
  const args = atPunct(p, ")") ? [] : parseCallArgs(p, start);
  expectPunct(p, ")");
  if (acceptWord(p, "FILTER")) {
    expectPunct(p, "(");
    expectWord(p, "WHERE");
    parseOr(p);
    expectPunct(p, ")");
  }
  if (acceptWord(p, "WITHIN")) {
    expectWord(p, "GROUP");
    expectPunct(p, "(");
    expectWord(p, "ORDER");
    expectWord(p, "BY");
    parseOrderItems(p);
    expectPunct(p, ")");
  }
  const over = acceptWord(p, "OVER") ? parseWindow(p) : null;
  return { type: "call", name, args, distinct, over, range: rangeFrom(p, start) };
}

/** The arguments of a call that has some: `*`, or expressions with their separators. */
function parseCallArgs(p: Parser, start: number): Expr[] {
  const args: Expr[] = atOp(p, "*")
    ? [parseCallStar(p, start)]
    : [
        ...readEach(
          () => parseOr(p),
          // `extract(year FROM d)`, `substring(s FROM 1 FOR 2)`, `trim(both 'x' FROM s)`
          () => acceptPunct(p, ",") || acceptWord(p, "FROM") || acceptWord(p, "FOR"),
        ),
      ];
  // `ORDER BY` inside an aggregate (`string_agg(x, ',' ORDER BY x)`) narrows nothing here.
  if (acceptWords(p, "ORDER", "BY")) parseOrderItems(p);
  if (acceptWord(p, "SEPARATOR")) parseOr(p);
  return args;
}

function parseCallStar(p: Parser, start: number): Expr {
  advance(p);
  return { type: "star", table: null, range: rangeFrom(p, start) };
}

/** `OVER (PARTITION BY ... ORDER BY ... [frame])` or `OVER name`. */
function parseWindow(p: Parser): WindowSpec {
  const start = peek(p).start;
  if (!atPunct(p, "(")) {
    expectName(p, "a window name");
    return { partitionBy: [], orderBy: [], range: rangeFrom(p, start) };
  }
  advance(p);
  if (
    isNameToken(peek(p)) &&
    !atWord(p, "PARTITION") &&
    !atWord(p, "ORDER") &&
    !atWord(p, "ROWS") &&
    !atWord(p, "RANGE") &&
    !atWord(p, "GROUPS")
  ) {
    advance(p);
  }
  const partitionBy = acceptWords(p, "PARTITION", "BY") ? parseExprList(p) : [];
  const orderBy = acceptWords(p, "ORDER", "BY") ? parseOrderItems(p) : [];
  // The frame clause narrows nothing the picture shows; skip to the closing parenthesis.
  skipNested(p, ")", false);
  expectPunct(p, ")");
  return { partitionBy, orderBy, range: rangeFrom(p, start) };
}

function parseCase(p: Parser): Expr {
  const start = peek(p).start;
  expectWord(p, "CASE");
  const operand = atWord(p, "WHEN") ? null : parseOr(p);
  const whens: CaseBranch[] = [
    ...readWhile(
      () => acceptWord(p, "WHEN"),
      () => {
        const when = parseOr(p);
        expectWord(p, "THEN");
        return { when, result: parseOr(p) };
      },
    ),
  ];
  if (whens.length === 0) fail(p, "Expected WHEN");
  const otherwise = acceptWord(p, "ELSE") ? parseOr(p) : null;
  expectWord(p, "END");
  return { type: "case", operand, whens, otherwise, range: rangeFrom(p, start) };
}

function parseCast(p: Parser): Expr {
  const start = peek(p).start;
  expectWord(p, "CAST");
  expectPunct(p, "(");
  const expr = parseOr(p);
  expectWord(p, "AS");
  const to = parseTypeName(p);
  expectPunct(p, ")");
  return { type: "cast", expr, to, range: rangeFrom(p, start) };
}

function parseOrderItems(p: Parser): OrderItem[] {
  return [
    ...readEach(
      () => parseOrderItem(p),
      () => acceptPunct(p, ","),
    ),
  ];
}

function parseOrderItem(p: Parser): OrderItem {
  const start = peek(p).start;
  const expr = parseOr(p);
  const direction = parseDirection(p);
  if (acceptWord(p, "NULLS") && !acceptWord(p, "FIRST") && !acceptWord(p, "LAST")) {
    fail(p, "Expected FIRST or LAST");
  }
  return { expr, direction, range: rangeFrom(p, start) };
}

function parseDirection(p: Parser) {
  if (acceptWord(p, "ASC")) return "ASC";
  if (acceptWord(p, "DESC")) return "DESC";
  return null;
}

// --- queries ----------------------------------------------------------------------------------

function parseQuery(p: Parser): Query {
  const start = peek(p).start;
  const { ctes, recursive } = parseWith(p);
  const body = parseSetOperation(p);
  const orderBy = acceptWords(p, "ORDER", "BY") ? parseOrderItems(p) : [];
  const { limit, offset } = parseLimit(p);
  return {
    type: "query",
    ctes,
    recursive,
    body,
    orderBy,
    limit,
    offset,
    range: rangeFrom(p, start),
  };
}

function parseWith(p: Parser): { readonly ctes: readonly Cte[]; readonly recursive: boolean } {
  if (!acceptWord(p, "WITH")) return { ctes: [], recursive: false };
  const recursive = acceptWord(p, "RECURSIVE");
  const ctes: Cte[] = [
    ...readEach(
      () => parseCte(p),
      () => acceptPunct(p, ","),
    ),
  ];
  return { ctes, recursive };
}

function parseCte(p: Parser): Cte {
  const start = peek(p).start;
  const name = expectName(p, "a CTE name");
  const columns = atPunct(p, "(") ? parseNameList(p) : null;
  expectWord(p, "AS");
  if (acceptWord(p, "NOT")) expectWord(p, "MATERIALIZED");
  else acceptWord(p, "MATERIALIZED");
  expectPunct(p, "(");
  const query = parseQuery(p);
  expectPunct(p, ")");
  return { name, columns, query, range: rangeFrom(p, start) };
}

function parseNameList(p: Parser) {
  expectPunct(p, "(");
  const names = [
    ...readEach(
      () => expectName(p, "a column name"),
      () => acceptPunct(p, ","),
    ),
  ];
  expectPunct(p, ")");
  return names;
}

function parseLimit(p: Parser): { readonly limit: Expr | null; readonly offset: Expr | null } {
  if (acceptWord(p, "LIMIT")) {
    const first = acceptWord(p, "ALL") ? null : parseOr(p);
    if (acceptPunct(p, ",")) {
      // MySQL's `LIMIT offset, count`.
      const count = parseOr(p);
      return { limit: count, offset: first };
    }
    const offset = acceptWord(p, "OFFSET") ? parseOffsetValue(p) : null;
    return { limit: first, offset };
  }
  if (acceptWord(p, "OFFSET")) {
    const offset = parseOffsetValue(p);
    if (acceptWord(p, "FETCH")) {
      if (!acceptWord(p, "FIRST") && !acceptWord(p, "NEXT")) fail(p, "Expected FIRST or NEXT");
      const limit = atWord(p, "ROW") || atWord(p, "ROWS") ? null : parseOr(p);
      if (!acceptWord(p, "ROWS") && !acceptWord(p, "ROW")) fail(p, "Expected ROWS");
      expectWord(p, "ONLY");
      return { limit, offset };
    }
    const limit = acceptWord(p, "LIMIT") ? parseOr(p) : null;
    return { limit, offset };
  }
  if (acceptWord(p, "FETCH")) {
    if (!acceptWord(p, "FIRST") && !acceptWord(p, "NEXT")) fail(p, "Expected FIRST or NEXT");
    const limit = atWord(p, "ROW") || atWord(p, "ROWS") ? null : parseOr(p);
    if (!acceptWord(p, "ROWS") && !acceptWord(p, "ROW")) fail(p, "Expected ROWS");
    expectWord(p, "ONLY");
    return { limit, offset: null };
  }
  return { limit: null, offset: null };
}

function parseOffsetValue(p: Parser) {
  const value = parseOr(p);
  if (!acceptWord(p, "ROWS")) acceptWord(p, "ROW");
  return value;
}

function parseSetOperation(p: Parser): QueryBody {
  const start = peek(p).start;
  const left = parseQueryTerm(p);
  const token = peek(p);
  if (token.kind !== "word" || !SET_OPERATORS.has(token.text)) return left;
  advance(p);
  const all = acceptWord(p, "ALL");
  if (!all) acceptWord(p, "DISTINCT");
  const op = setOperator(token.text);
  const right = parseSetOperation(p);
  return { type: "setop", op, all, left, right, range: rangeFrom(p, start) };
}

function setOperator(text: string) {
  if (text === "UNION" || text === "INTERSECT") return text;
  return "EXCEPT";
}

/** `(a, b), (c, d)`: the rows of a VALUES list; `empty` lets a row be `()`. */
function parseValuesRows(p: Parser, empty: boolean): (readonly Expr[])[] {
  return [
    ...readEach(
      () => {
        expectPunct(p, "(");
        const row = empty && atPunct(p, ")") ? [] : parseExprList(p);
        expectPunct(p, ")");
        return row;
      },
      () => acceptPunct(p, ","),
    ),
  ];
}

function parseQueryTerm(p: Parser): QueryBody {
  const start = peek(p).start;
  if (atPunct(p, "(")) {
    advance(p);
    const body = parseSetOperation(p);
    expectPunct(p, ")");
    return body;
  }
  if (atWord(p, "VALUES")) {
    advance(p);
    const rows = parseValuesRows(p, false);
    return { type: "values", rows, range: rangeFrom(p, start) };
  }
  return parseSelectCore(p);
}

function parseSelectCore(p: Parser): SelectCore {
  const start = peek(p).start;
  expectWord(p, "SELECT");
  const distinct = acceptWord(p, "DISTINCT");
  if (!distinct) acceptWord(p, "ALL");
  if (distinct && acceptWord(p, "ON")) {
    expectPunct(p, "(");
    parseExprList(p);
    expectPunct(p, ")");
  }
  const columns = parseSelectItems(p);
  const from = acceptWord(p, "FROM") ? parseFromList(p) : [];
  const where = acceptWord(p, "WHERE") ? parseOr(p) : null;
  const groupBy = acceptWords(p, "GROUP", "BY") ? parseGroupBy(p) : [];
  const having = acceptWord(p, "HAVING") ? parseOr(p) : null;
  if (acceptWord(p, "WINDOW")) {
    do {
      expectName(p, "a window name");
      expectWord(p, "AS");
      parseWindow(p);
    } while (acceptPunct(p, ","));
  }
  return {
    type: "select",
    distinct,
    columns,
    from,
    where,
    groupBy,
    having,
    range: rangeFrom(p, start),
  };
}

function parseGroupBy(p: Parser): Expr[] {
  if (acceptWord(p, "ALL")) return [];
  const items = [
    ...readEach(
      () => parseGroupItem(p),
      () => acceptPunct(p, ","),
    ),
  ].flat();
  if (acceptWord(p, "WITH")) expectWord(p, "ROLLUP");
  return items;
}

/** One item of GROUP BY: an expression, or the expressions of `ROLLUP (...)`, `CUBE (...)`, `GROUPING SETS (...)`. */
function parseGroupItem(p: Parser): Expr[] {
  if (!(atWord(p, "ROLLUP") || atWord(p, "CUBE") || atWords(p, "GROUPING", "SETS"))) {
    return [parseOr(p)];
  }
  const start = peek(p).start;
  while (!atPunct(p, "(")) advance(p);
  advance(p);
  const inner = parseExprList(p);
  expectPunct(p, ")");
  if (inner.length > 0) return inner;
  return [{ type: "raw", text: p.text.slice(start, previousEnd(p)), range: rangeFrom(p, start) }];
}

function atWords(p: Parser, ...words: readonly string[]) {
  return words.every((word, index) => atWord(p, word, index));
}

function parseSelectItems(p: Parser): SelectItem[] {
  return [
    ...readEach(
      () => {
        const start = peek(p).start;
        const expr = parseOr(p);
        const alias = expr.type === "star" ? null : parseAlias(p);
        return { expr, alias, range: rangeFrom(p, start) };
      },
      () => acceptPunct(p, ","),
    ),
  ];
}

function parseFromList(p: Parser): FromItem[] {
  return [
    ...readEach(
      () => parseJoins(p),
      () => acceptPunct(p, ","),
    ),
  ];
}

function parseJoins(p: Parser): FromItem {
  const start = peek(p).start;
  const first = parseFromItem(p);
  return parseJoinTail(p, start, first);
}

function parseJoinTail(p: Parser, start: number, left: FromItem): FromItem {
  const token = peek(p);
  if (token.kind !== "word" || !JOIN_WORDS.has(token.text)) return left;
  const natural = acceptWord(p, "NATURAL");
  const joinType = parseJoinType(p);
  const right = parseFromItem(p);
  const on = acceptWord(p, "ON") ? parseOr(p) : null;
  const using = on === null && acceptWord(p, "USING") ? parseNameList(p) : null;
  return parseJoinTail(p, start, {
    type: "join",
    joinType,
    natural,
    left,
    right,
    on,
    using,
    range: rangeFrom(p, start),
  });
}

function parseJoinType(p: Parser): JoinType {
  if (acceptWord(p, "JOIN")) return "INNER";
  const word = advance(p);
  const type = joinTypeOf(word.text);
  if (
    word.text !== "INNER" &&
    word.text !== "CROSS" &&
    word.text !== "LEFT" &&
    word.text !== "RIGHT" &&
    word.text !== "FULL"
  ) {
    fail(p, "Expected JOIN");
  }
  acceptWord(p, "OUTER");
  expectWord(p, "JOIN");
  return type;
}

function joinTypeOf(text: string): JoinType {
  if (text === "LEFT" || text === "RIGHT" || text === "FULL" || text === "CROSS") return text;
  return "INNER";
}

function parseFromItem(p: Parser): FromItem {
  const start = peek(p).start;
  const lateral = acceptWord(p, "LATERAL");
  if (atPunct(p, "(")) {
    if (atQueryStartAt(p, 1)) {
      advance(p);
      const query = parseQuery(p);
      expectPunct(p, ")");
      const alias = parseAlias(p);
      if (alias !== null && atPunct(p, "(")) parseNameList(p);
      return { type: "subquery", query, alias, lateral, range: rangeFrom(p, start) };
    }
    advance(p);
    const inner = parseJoins(p);
    expectPunct(p, ")");
    return inner;
  }
  if (atWord(p, "ONLY")) advance(p);
  const first = peek(p);
  if (!isNameToken(first)) fail(p, "Expected a table name");
  if (atPunct(p, "(", 1) || (atPunct(p, ".", 1) && atPunct(p, "(", 3))) {
    const call = parseNameExpr(p);
    const alias = parseAlias(p);
    if (alias !== null && atPunct(p, "(")) parseNameList(p);
    return { type: "function", call, alias, range: rangeFrom(p, start) };
  }
  const table = parseTableName(p);
  const alias = parseAlias(p);
  if (alias !== null && atPunct(p, "(")) parseNameList(p);
  return { type: "table", table, alias, range: rangeFrom(p, start) };
}

function parseTableName(p: Parser): TableName {
  const start = peek(p).start;
  const parts = [
    expectName(p, "a table name"),
    ...readWhile(
      () => acceptPunct(p, "."),
      () => expectName(p, "a table name"),
    ),
  ];
  const name = parts.at(-1) ?? "";
  const schema = parts.length > 1 ? parts.slice(0, -1).join(".") : null;
  return { schema, name, range: rangeFrom(p, start) };
}

// --- statements -------------------------------------------------------------------------------

function parseReturning(p: Parser) {
  return acceptWord(p, "RETURNING") ? parseSelectItems(p) : null;
}

function parseInsert(p: Parser, start: number, ctes: readonly Cte[]): Statement {
  advance(p);
  if (acceptWord(p, "OR")) advance(p);
  acceptWord(p, "IGNORE");
  acceptWord(p, "INTO");
  const table = parseTableName(p);
  const alias =
    atWord(p, "AS") ||
    (isNameToken(peek(p)) &&
      !atWord(p, "VALUES") &&
      !atWord(p, "SELECT") &&
      !atWord(p, "DEFAULT") &&
      !atPunct(p, "("))
      ? parseAlias(p)
      : null;
  const columns = atPunct(p, "(") && !atQueryStartAt(p, 1) ? parseNameList(p) : null;
  const sourceStart = peek(p).start;
  const source: InsertSource = (() => {
    if (acceptWords(p, "DEFAULT", "VALUES")) {
      return { type: "default", range: rangeFrom(p, sourceStart) };
    }
    if (atWord(p, "VALUES")) {
      advance(p);
      const rows = parseValuesRows(p, true);
      return { type: "values", rows, range: rangeFrom(p, sourceStart) };
    }
    if (atQueryStart(p)) {
      return { type: "query", query: parseQuery(p), range: rangeFrom(p, sourceStart) };
    }
    return fail(p, "Expected VALUES, SELECT or DEFAULT VALUES");
  })();
  const conflictStart = peek(p).start;
  const onConflict = atWord(p, "ON") ? skipConflictClause(p, conflictStart) : null;
  const returning = parseReturning(p);
  return {
    type: "insert",
    ctes,
    table,
    alias,
    columns,
    source,
    onConflict,
    returning,
    range: rangeFrom(p, start),
  };
}

/** `ON CONFLICT ... DO NOTHING | DO UPDATE SET ...` and MySQL's `ON DUPLICATE KEY UPDATE ...`, kept as a range. */
function skipConflictClause(p: Parser, start: number): Range {
  while (!atWord(p, "RETURNING") && !atPunct(p, ";") && peek(p).kind !== "eof") {
    if (atPunct(p, "(")) {
      advance(p);
      skipNested(p, ")", false);
      advance(p);
    } else {
      advance(p);
    }
  }
  return rangeFrom(p, start);
}

function parseUpdate(p: Parser, start: number, ctes: readonly Cte[]): Statement {
  advance(p);
  if (acceptWord(p, "OR")) advance(p);
  acceptWord(p, "ONLY");
  const table = parseTableName(p);
  const alias = atWord(p, "SET") ? null : parseAlias(p);
  expectWord(p, "SET");
  const set = [
    ...readEach(
      () => parseSetItem(p),
      () => acceptPunct(p, ","),
    ),
  ];
  const from = acceptWord(p, "FROM") ? parseFromList(p) : [];
  const where = acceptWord(p, "WHERE") ? parseOr(p) : null;
  if (acceptWords(p, "ORDER", "BY")) parseOrderItems(p);
  if (acceptWord(p, "LIMIT")) parseOr(p);
  const returning = parseReturning(p);
  return {
    type: "update",
    ctes,
    table,
    alias,
    set,
    from,
    where,
    returning,
    range: rangeFrom(p, start),
  };
}

/** `column = value` (or `t.column = DEFAULT`) of an UPDATE's SET. */
function parseSetItem(p: Parser): {
  readonly column: string;
  readonly value: Expr;
  readonly range: Range;
} {
  const itemStart = peek(p).start;
  const column = expectName(p, "a column name");
  while (atPunct(p, ".")) {
    advance(p);
    expectName(p, "a column name");
  }
  if (!atOp(p, "=")) fail(p, 'Expected "="');
  advance(p);
  const value: Expr = acceptWord(p, "DEFAULT")
    ? { type: "raw", text: "DEFAULT", range: rangeFrom(p, itemStart) }
    : parseOr(p);
  return { column, value, range: rangeFrom(p, itemStart) };
}

function parseDelete(p: Parser, start: number, ctes: readonly Cte[]): Statement {
  advance(p);
  expectWord(p, "FROM");
  acceptWord(p, "ONLY");
  const table = parseTableName(p);
  const alias =
    atWord(p, "USING") || atWord(p, "WHERE") || atWord(p, "RETURNING") ? null : parseAlias(p);
  const using = acceptWord(p, "USING") ? parseFromList(p) : [];
  const where = acceptWord(p, "WHERE") ? parseOr(p) : null;
  if (acceptWords(p, "ORDER", "BY")) parseOrderItems(p);
  if (acceptWord(p, "LIMIT")) parseOr(p);
  const returning = parseReturning(p);
  return {
    type: "delete",
    ctes,
    table,
    alias,
    using,
    where,
    returning,
    range: rangeFrom(p, start),
  };
}

function parseStatement(p: Parser): Statement {
  const start = peek(p).start;
  const first = peek(p);
  if (
    isWord(first, "WITH") ||
    isWord(first, "SELECT") ||
    isWord(first, "VALUES") ||
    atPunct(p, "(")
  ) {
    // A WITH may lead a SELECT or a DML statement; peek past it to tell which.
    const { ctes, recursive } = parseWith(p);
    if (ctes.length > 0 && (atWord(p, "INSERT") || atWord(p, "REPLACE"))) {
      return parseInsert(p, start, ctes);
    }
    if (ctes.length > 0 && atWord(p, "UPDATE")) return parseUpdate(p, start, ctes);
    if (ctes.length > 0 && atWord(p, "DELETE")) return parseDelete(p, start, ctes);
    const body = parseSetOperation(p);
    const orderBy = acceptWords(p, "ORDER", "BY") ? parseOrderItems(p) : [];
    const { limit, offset } = parseLimit(p);
    const query: Query = {
      type: "query",
      ctes,
      recursive,
      body,
      orderBy,
      limit,
      offset,
      range: rangeFrom(p, start),
    };
    return { type: "select", query, range: rangeFrom(p, start) };
  }
  if (isWord(first, "INSERT") || isWord(first, "REPLACE")) return parseInsert(p, start, []);
  if (isWord(first, "UPDATE")) return parseUpdate(p, start, []);
  if (isWord(first, "DELETE")) return parseDelete(p, start, []);
  // Anything else (DDL, PRAGMA, EXPLAIN, ...) is passed through whole.
  const keyword = first.kind === "word" ? first.text : first.raw;
  skipToStatementEnd(p);
  return { type: "other", keyword, range: rangeFrom(p, start) };
}

function skipToStatementEnd(p: Parser) {
  skipNested(p, ";", true);
}

/**
 * The statements from the cursor on, each followed by its `;`; empty statements are skipped.
 *
 * @yields Each statement, parsed.
 */
function* readStatements(p: Parser): Generator<Statement> {
  while (peek(p).kind !== "eof") {
    if (acceptPunct(p, ";")) continue;
    yield readStatement(p);
    acceptPunct(p, ";");
  }
}

/** One statement, or `invalid` with where it failed; the cursor is left at its `;` either way. */
function readStatement(p: Parser): Statement {
  const start = peek(p).start;
  try {
    const statement = parseStatement(p);
    if (!atPunct(p, ";") && peek(p).kind !== "eof") {
      fail(p, `Unexpected "${peek(p).raw}"`);
    }
    return statement;
  } catch (e) {
    if (!(e instanceof ParseFailure)) throw e;
    skipToStatementEnd(p);
    return {
      type: "invalid",
      message: e.message,
      offset: e.offset,
      range: { start, end: Math.max(previousEnd(p), start) },
    };
  }
}

/** Every statement of the text, in order; a statement that fails to parse is `invalid` and parsing resumes at the next `;`. */
export function parseStatements(text: string): readonly Statement[] {
  const tokenized = tokenize(text);
  if (!tokenized.ok) {
    return [
      {
        type: "invalid",
        message: tokenized.error.message,
        offset: tokenized.error.offset,
        range: { start: 0, end: text.length },
      },
    ];
  }
  const p: Parser = { text, tokens: tokenized.tokens, pos: 0 };
  return [...readStatements(p)];
}
