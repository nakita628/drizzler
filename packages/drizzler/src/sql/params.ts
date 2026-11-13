import { tokenize } from "./tokenize.js";

/**
 * The values each statement of a text binds, when they are given once for the whole text: the
 * `?` placeholders take the next values in turn, statement after statement, and a statement of
 * `$1`, `$2`, ... takes the values up to the highest number it uses. A statement without a
 * placeholder binds nothing, which is what a driver asks of it.
 *
 * @param statements - the statements of the text, in order
 * @param params - the values, in the order the placeholders of the whole text ask for them
 * @returns one list of values per statement
 */
export function paramsByStatement<T>(statements: readonly string[], params: readonly T[]) {
  const placeholders = statements.map((statement) => {
    const result = tokenize(statement);
    const found = result.ok ? result.tokens.filter((token) => token.kind === "param") : [];
    const numbered = found.flatMap((token) => {
      const match = /^\$(\d+)$/u.exec(token.raw);
      return match === null ? [] : [Number(match[1])];
    });
    return {
      highest: numbered.length > 0 ? Math.max(...numbered) : null,
      positional: found.filter((token) => token.raw === "?").length,
    };
  });
  // The `?` of each statement take the values after those the statements before it took.
  return placeholders.reduce<{ readonly next: number; readonly lists: readonly (readonly T[])[] }>(
    (state, { highest, positional }) =>
      highest === null
        ? {
            next: state.next + positional,
            lists: [...state.lists, params.slice(state.next, state.next + positional)],
          }
        : { next: state.next, lists: [...state.lists, params.slice(0, highest)] },
    { next: 0, lists: [] },
  ).lists;
}
