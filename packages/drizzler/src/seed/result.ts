// What the seeder's pure steps answer: a value, or the failure that stopped them, as a value the
// caller looks at (seed/run.ts turns a failure into the Effect's). The same shape as the SQL
// tokenizer's (`{ ok: true, ... } | { ok: false, error }`).

/** A value, or the failure that stopped the step. */
export type Result<A, E> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: E };

/** A step that gave its value. */
export function ok<A>(value: A): { readonly ok: true; readonly value: A } {
  return { ok: true, value };
}

/** A step that failed. */
export function fail<E>(error: E): { readonly ok: false; readonly error: E } {
  return { ok: false, error };
}

/** Each item's value in order, or the first failure; the items after it are not tried. */
export function forEach<T, A, E>(
  items: readonly T[],
  step: (item: T, index: number) => Result<A, E>,
): Result<readonly A[], E> {
  // A loop, not a map: it stops at the first failure, as the steps after it must not run (they
  // draw from the seeded faker, and a later draw would shift every value after it).
  const values: A[] = [];
  for (const [index, item] of items.entries()) {
    const result = step(item, index);
    if (!result.ok) return result;
    // oxlint-disable-next-line custom/no-array-mutation -- this function's own list, returned only when done; a copy per item would be quadratic
    values.push(result.value);
  }
  return ok(values);
}
