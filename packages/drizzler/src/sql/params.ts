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
  return [...bindEach(placeholders, params)];
}

/**
 * The values of each statement in turn: the `?` of each statement take the values after those
 * the statements before it took.
 *
 * @yields The values one statement binds.
 */
function* bindEach<T>(
  placeholders: readonly { readonly highest: number | null; readonly positional: number }[],
  params: readonly T[],
): Generator<readonly T[]> {
  // oxlint-disable-next-line custom/no-let -- the running offset into the values; carrying it through a reduce would copy the lists once per statement
  let next = 0;
  for (const { highest, positional } of placeholders) {
    if (highest === null) {
      yield params.slice(next, next + positional);
      next += positional;
    } else {
      yield params.slice(0, highest);
    }
  }
}
