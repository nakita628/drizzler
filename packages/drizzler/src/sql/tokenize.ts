/**
 * The SQL tokenizer: source text in, a flat list of tokens with their offsets out. Every token
 * remembers where it came from, so the analysis can point the editor at a clause, and every
 * bare word is a `word` — the parser decides which ones are keywords in the position they sit
 * in, because `first`, `rows` or `window` are keywords in one clause and column names in another.
 */

type TokenKind = "word" | "quoted" | "string" | "number" | "param" | "op" | "punct" | "eof";

export type Token = {
  readonly kind: TokenKind;
  /** The token as written, quotes included. */
  readonly raw: string;
  /** The value: a word uppercased, a quoted identifier or string unquoted, an operator as is. */
  readonly text: string;
  readonly start: number;
  readonly end: number;
};

type TokenizeError = { readonly message: string; readonly offset: number };

type TokenizeResult =
  | { readonly ok: true; readonly tokens: readonly Token[] }
  | { readonly ok: false; readonly error: TokenizeError };

// Longest first, so `->>` wins over `->` and `<=` over `<`.
const OPERATORS = [
  "->>",
  "#>>",
  "!~*",
  "<=>",
  "||",
  "::",
  "->",
  "#>",
  "@>",
  "<@",
  "<>",
  "!=",
  "<=",
  ">=",
  "~*",
  "!~",
  "<<",
  ">>",
  "**",
  "+",
  "-",
  "*",
  "/",
  "%",
  "<",
  ">",
  "=",
  "~",
  "^",
  "&",
  "|",
  "!",
  "#",
] as const;

const PUNCTUATION = new Set(["(", ")", ",", ";", ".", "[", "]"]);

const WORD_START = /[A-Za-z_À-￿]/u;
// Read per UTF-16 unit, as the characters of a word are: no `u` flag, so the two halves of an
// astral character each fall in the range.
const WORD_RUN = /^[A-Za-z0-9_$\u00C0-\uFFFF]*/;
const NUMBER = /^(?:0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/u;
const DOLLAR_TAG = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/u;

function isDigit(char: string) {
  return char >= "0" && char <= "9";
}

function isSpace(char: string) {
  return char === " " || char === "\n" || char === "\t" || char === "\r" || char === "\f";
}

// A delimited run from its opening character to its close. The body is matched inside a
// lookahead and taken back by reference, so it is never given back: `'a''` is unterminated, not
// `'a'` followed by a stray quote.
const DELIMITED_RUNS = {
  "'": /^[\s\S](?=((?:[^']|'')*))\1'/u,
  '"': /^[\s\S](?=((?:[^"]|"")*))\1"/u,
  "`": /^[\s\S](?=((?:[^`]|``)*))\1`/u,
  "]": /^[\s\S][^\]]*\]/u,
} as const;

/** The end of a delimited run (`'...'` with `''` escapes, `"..."`, backticks, `[...]`); null when unterminated. */
function readDelimited(text: string, from: number, close: keyof typeof DELIMITED_RUNS) {
  const match = DELIMITED_RUNS[close].exec(text.slice(from));
  return match === null ? null : from + match[0].length;
}

function readNumber(text: string, from: number) {
  const match = NUMBER.exec(text.slice(from))?.[0] ?? "";
  return from + match.length;
}

function readWord(text: string, from: number) {
  return from + (WORD_RUN.exec(text.slice(from))?.[0].length ?? 0);
}

/** `$$...$$` or `$tag$...$tag$`: PostgreSQL's dollar quoting. Null when this `$` is not one. */
function readDollarQuoted(text: string, from: number) {
  const tag = DOLLAR_TAG.exec(text.slice(from))?.[0];
  if (tag === undefined) return null;
  const close = text.indexOf(tag, from + tag.length);
  return close === -1 ? null : { end: close + tag.length, tag };
}

function unquote(raw: string, close: string, doubled: boolean) {
  const inner = raw.slice(1, -1);
  return doubled ? inner.replaceAll(close + close, close) : inner;
}

/** Whether a `[` opens a quoted identifier (`[name]`) rather than subscripting the expression before it. */
function isBracketIdentifier(previous: Token | null) {
  if (previous === null) return true;
  if (previous.kind === "word" || previous.kind === "quoted" || previous.kind === "param") {
    return false;
  }
  return previous.raw !== ")" && previous.raw !== "]";
}

type Step =
  | { readonly token: Token; readonly next: number }
  | { readonly skip: number }
  | { readonly error: TokenizeError };

function token(kind: TokenKind, raw: string, text: string, start: number, end: number): Step {
  return { token: { kind, raw, text, start, end }, next: end };
}

function step(text: string, at: number, previous: Token | null): Step {
  const char = text[at] ?? "";
  if (isSpace(char)) return { skip: at + 1 };
  if (char === "-" && text[at + 1] === "-") {
    const end = text.indexOf("\n", at);
    return { skip: end === -1 ? text.length : end + 1 };
  }
  if (char === "/" && text[at + 1] === "*") {
    const end = text.indexOf("*/", at + 2);
    if (end === -1) return { error: { message: "Unterminated block comment", offset: at } };
    return { skip: end + 2 };
  }
  if (char === "'") {
    const end = readDelimited(text, at, "'");
    if (end === null) return { error: { message: "Unterminated string literal", offset: at } };
    const raw = text.slice(at, end);
    return token("string", raw, unquote(raw, "'", true), at, end);
  }
  if (char === '"' || char === "`") {
    const end = readDelimited(text, at, char);
    if (end === null) return { error: { message: "Unterminated quoted identifier", offset: at } };
    const raw = text.slice(at, end);
    return token("quoted", raw, unquote(raw, char, true), at, end);
  }
  if (char === "[" && isBracketIdentifier(previous)) {
    const end = readDelimited(text, at, "]");
    if (end === null) return { error: { message: "Unterminated quoted identifier", offset: at } };
    const raw = text.slice(at, end);
    return token("quoted", raw, unquote(raw, "]", false), at, end);
  }
  if (char === "$") {
    const dollar = readDollarQuoted(text, at);
    if (dollar !== null) {
      const raw = text.slice(at, dollar.end);
      return token("string", raw, raw.slice(dollar.tag.length, -dollar.tag.length), at, dollar.end);
    }
    const end = readWord(text, at + 1);
    if (end > at + 1) return token("param", text.slice(at, end), text.slice(at, end), at, end);
  }
  if (char === "?") {
    const end = readWord(text, at + 1);
    return token("param", text.slice(at, end), text.slice(at, end), at, end);
  }
  // `:name` / `@name` are named placeholders; `::` is a cast and `@>` an operator.
  if (
    (char === ":" || char === "@") &&
    previous?.raw !== ":" &&
    text[at + 1] !== ":" &&
    WORD_START.test(text[at + 1] ?? "")
  ) {
    const end = readWord(text, at + 1);
    return token("param", text.slice(at, end), text.slice(at, end), at, end);
  }
  if (isDigit(char) || (char === "." && isDigit(text[at + 1] ?? ""))) {
    const end = readNumber(text, at);
    return token("number", text.slice(at, end), text.slice(at, end), at, end);
  }
  if (WORD_START.test(char)) {
    const end = readWord(text, at);
    const raw = text.slice(at, end);
    return token("word", raw, raw.toUpperCase(), at, end);
  }
  if (PUNCTUATION.has(char)) return token("punct", char, char, at, at + 1);
  const operator = OPERATORS.find((candidate) => text.startsWith(candidate, at));
  if (operator !== undefined) {
    return token("op", operator, operator, at, at + operator.length);
  }
  return { error: { message: `Unexpected character "${char}"`, offset: at } };
}

/** Splits SQL text into tokens; comments and whitespace are dropped, offsets are kept. */
export function tokenize(text: string): TokenizeResult {
  // A scanner walks the text once with a cursor and a growing list: rebuilding the list for each
  // token would make a long script quadratic, and recursion would run out of stack on it.
  const tokens: Token[] = [];
  // oxlint-disable-next-line custom/no-let -- the scanner's cursor, see above
  let at = 0;
  while (at < text.length) {
    const result = step(text, at, tokens.at(-1) ?? null);
    if ("error" in result) return { ok: false, error: result.error };
    if ("token" in result) {
      // oxlint-disable-next-line custom/no-array-mutation -- the scanner's list, see above
      tokens.push(result.token);
    }
    at = "skip" in result ? result.skip : result.next;
  }
  const eof: Token = { kind: "eof", raw: "", text: "", start: text.length, end: text.length };
  return { ok: true, tokens: [...tokens, eof] };
}
