import { tokenize } from "../sql/tokenize.js";

type Token = Extract<ReturnType<typeof tokenize>, { ok: true }>["tokens"][number];

// The clauses a statement's top level starts a line with.
const CLAUSES = new Set([
  "FROM",
  "WHERE",
  "LIMIT",
  "OFFSET",
  "VALUES",
  "SET",
  "RETURNING",
  "HAVING",
  "UNION",
]);
// What may come before JOIN in one clause.
const JOIN_LEADS = new Set(["LEFT", "RIGHT", "INNER", "FULL", "CROSS", "OUTER"]);

// Whether a line starts at this token: a clause at the statement's own level, not inside parentheses.
function startsLine(tokens: readonly Token[], at: number, depth: number) {
  const token = tokens[at];
  if (token === undefined || token.kind !== "word" || depth !== 0 || at === 0) return false;
  const next = tokens[at + 1]?.text;
  const previous = tokens[at - 1]?.text;
  if (token.text === "FROM") return previous !== "DELETE";
  if (CLAUSES.has(token.text)) return true;
  if (JOIN_LEADS.has(token.text)) return next === "JOIN" || next === "OUTER";
  if (token.text === "JOIN") return !JOIN_LEADS.has(previous ?? "");
  if (token.text === "GROUP" || token.text === "ORDER") return next === "BY";
  if (token.text === "ON") return next === "CONFLICT";
  return false;
}

/**
 * The SQL drizzle-orm builds, a clause to a line: its top-level FROM, JOINs, WHERE, GROUP BY,
 * ORDER BY, LIMIT, VALUES, SET and RETURNING each start one, and a subquery stays on its line.
 * The words are kept as written; SQL that does not tokenize is returned as it is.
 *
 * @param sql - the statement on one line
 * @returns the same statement broken into lines
 * @example
 * layoutSql('select "id" from "users" where "id" = $1 limit $2')
 * // => 'select "id"\nfrom "users"\nwhere "id" = $1\nlimit $2'
 */
export function layoutSql(sql: string) {
  const result = tokenize(sql);
  if (!result.ok) return sql;
  const { tokens } = result;
  // Walked once, keeping the parenthesis depth in front of each token.
  const { starts } = tokens.reduce<{ readonly depth: number; readonly starts: readonly number[] }>(
    (state, token, at) => ({
      depth: state.depth + depthChange(token),
      // oxlint-disable-next-line custom/no-accumulator-copy -- copied only where a line starts
      starts: startsLine(tokens, at, state.depth) ? [...state.starts, token.start] : state.starts,
    }),
    { depth: 0, starts: [] },
  );
  const bounds = [0, ...starts, sql.length];
  return bounds
    .slice(0, -1)
    .map((start, i) => sql.slice(start, bounds[i + 1]).trim())
    .join("\n");
}

function depthChange(token: Token | undefined) {
  if (token?.kind !== "punct") return 0;
  if (token.text === "(") return 1;
  return token.text === ")" ? -1 : 0;
}
