import type { Result } from "../result.js";
import { fail, forEach, ok } from "../result.js";
import type { SeedRow } from "../config.js";
import { SeedGenerationError } from "../errors.js";
import type { ModelTable, ParentSide } from "../schema.js";
import type { Context } from "./context.js";
import { childKey, describeValue, isKeyObject, isSeedList } from "./context.js";

/** Queues the rows nested under one `r.many` relation, each with its key to the parent filled. */
function nestRelation(
  context: Context,
  table: ModelTable,
  side: ParentSide,
  given: SeedRow,
  row: SeedRow,
): Result<void, SeedGenerationError> {
  const fk = childKey(context.tables, side);
  const nested = given[side.name];
  if (fk === undefined || nested === undefined || nested === null) return ok(undefined);
  const children = isSeedList(nested) ? nested : [nested];
  const link = Object.fromEntries(
    fk.fromFields.map((from, i) => [from, row[fk.toFields[i] ?? ""] ?? null]),
  );
  for (const child of children) {
    if (!isKeyObject(child)) {
      return fail(
        new SeedGenerationError({
          message: `${table.name}.${side.name}: expected rows of ${side.child}, got ${describeValue(child)}.`,
        }),
      );
    }
    if (fk.field in child || Object.keys(link).some((from) => from in child)) {
      // The nesting already says which parent this is; a second answer could only disagree.
      return fail(
        new SeedGenerationError({
          message: `${table.name}.${side.name}: a nested ${side.child} row already points at its ${table.name} through ${fk.field}; leave out ${[...new Set([fk.field, ...Object.keys(link)])].join(" and ")}.`,
        }),
      );
    }
  }
  // The queue is the child model's, walked when its rows are made.
  const queued = children.filter(isKeyObject).map((child) => ({ ...child, ...link }));
  context.pending.set(side.child, [...(context.pending.get(side.child) ?? []), ...queued]);
  return ok(undefined);
}

/**
 * The rows nested under a real row, each with its key to the parent filled from the parent as it
 * was made; queued for the child model, or for this model itself under a self relation.
 */
export function nestChildren(
  context: Context,
  table: ModelTable,
  given: SeedRow,
  row: SeedRow,
): Result<unknown, SeedGenerationError> {
  return forEach(table.parents, (side) => nestRelation(context, table, side, given, row));
}
