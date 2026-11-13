/**
 * What the statement splitter steps over as a whole: a `--` comment to the end of its line, a
 * block comment, and a quoted run (`''`, `""` or doubled backticks escape the quote inside it),
 * each to the end of the text when it is not closed; and the `;` it splits at.
 */
const STATEMENT_PARTS =
  /--[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|'(?:[^']|'')*(?:'|$)|"(?:[^"]|"")*(?:"|$)|`(?:[^`]|``)*(?:`|$)|;/gu;

/**
 * Splits SQL text into statements at the `;` that sit outside quotes and comments. A driver runs
 * one statement per call, and the result a console shows belongs to the last one.
 */
export function splitStatements(text: string): readonly string[] {
  const ends = [...text.matchAll(STATEMENT_PARTS)]
    .filter((match) => match[0] === ";")
    .map((match) => match.index);
  const bounds = [...ends, text.length];
  return bounds
    .map((end, index) => text.slice(index === 0 ? 0 : (bounds[index - 1] ?? 0) + 1, end).trim())
    .filter((statement) => statement !== "");
}

/** A quoted run (to the end of the text when it is not closed), a parenthesis or a comma. */
const LIST_PARTS = /'[^']*(?:'|$)|"[^"]*(?:"|$)|`[^`]*(?:`|$)|[(),]/gu;

/** How far into parentheses a part leads: one level for `(`, back one for `)`. */
function depthChange(part: string) {
  if (part === "(") return 1;
  if (part === ")") return -1;
  return 0;
}

/**
 * Splits at the commas outside parentheses and quotes: the clauses of an ALTER TABLE, the items
 * of a list.
 */
export function splitTopLevel(text: string): readonly string[] {
  const { cuts } = [...text.matchAll(LIST_PARTS)].reduce<{
    readonly depth: number;
    readonly cuts: readonly number[];
  }>(
    (state, match) =>
      match[0] === "," && state.depth === 0
        ? // oxlint-disable-next-line custom/no-accumulator-copy -- copied only at a top-level comma
          { depth: state.depth, cuts: [...state.cuts, match.index] }
        : { depth: state.depth + depthChange(match[0]), cuts: state.cuts },
    { depth: 0, cuts: [] },
  );
  const bounds = [...cuts, text.length];
  return bounds
    .map((end, index) => text.slice(index === 0 ? 0 : (bounds[index - 1] ?? 0) + 1, end).trim())
    .filter((part) => part !== "");
}
