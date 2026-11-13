import { Effect } from "effect";
import type { SeedRow } from "../config.js";
import { SeedGenerationError } from "../errors.js";
import type { ModelTable, ParentSide } from "../schema.js";
import type { Context } from "./context.js";
import { childKey, describeValue, keyOf, modelTable } from "./context.js";

/** `user[1] { email: "bob@example.com" }`: the row by index and by the key that says most about it. */
function labelOf(table: ModelTable, index: number, row: SeedRow) {
  const ids = new Set(table.columns.filter((c) => c.isId).map((c) => c.field));
  const key = [...table.uniques]
    .toSorted((a, b) => Number(a.some((f) => ids.has(f))) - Number(b.some((f) => ids.has(f))))
    .find((fields) => fields.every((field) => row[field] !== undefined && row[field] !== null));
  const shown =
    key === undefined
      ? ""
      : ` { ${key.map((field) => `${field}: ${describeValue(row[field] ?? null)}`).join(", ")} }`;
  return `${table.name}[${index}]${shown}`;
}

/** How many child rows of the relation each row of the table has, by the table row's index. */
function relatedCounts(context: Context, side: ParentSide, rows: readonly SeedRow[]) {
  const fk = childKey(context.tables, side);
  if (fk === undefined) return rows.map(() => 0);
  // The children by the key they point at, all its columns joined.
  const children = Map.groupBy(context.rowsByModel.get(side.child) ?? [], (child) =>
    JSON.stringify(fk.fromFields.map((f) => keyOf(child[f] ?? null))),
  );
  return rows.map(
    (row) =>
      children.get(JSON.stringify(fk.toFields.map((t) => keyOf(row[t] ?? null))))?.length ?? 0,
  );
}

/** Every relation rule against the rows made: each row must have between `min` and `max` children. */
export function checkCardinality(context: Context) {
  return Effect.gen(function* () {
    const problems = Object.entries(context.config.models).flatMap(([name, rule]) => {
      const table = modelTable(context.tables, name);
      const rows = context.rowsByModel.get(name) ?? [];
      if (table === undefined) return [];
      return Object.entries(rule.relations ?? {}).flatMap(([relation, bound]) => {
        const side = table.parents.find((parent) => parent.name === relation);
        if (side === undefined) return [];
        const counts = relatedCounts(context, side, rows);
        return counts.flatMap((count, index) => {
          const row = rows[index];
          if (row === undefined) return [];
          const where = `${labelOf(table, index, row)}.${relation}: ${count} row${count === 1 ? "" : "s"}`;
          if (bound.min !== undefined && count < bound.min) {
            return [
              `${where}, at least ${bound.min} expected (models.${name}.relations.${relation}.min)`,
            ];
          }
          if (bound.max !== undefined && count > bound.max) {
            return [
              `${where}, at most ${bound.max} expected (models.${name}.relations.${relation}.max)`,
            ];
          }
          return [];
        });
      });
    });
    if (problems.length > 0) {
      const shown = problems.slice(0, 20);
      const more = problems.length - shown.length;
      yield* new SeedGenerationError({
        message: `Relations out of bounds, nothing was inserted.\n   ${shown.join("\n   ")}${more > 0 ? `\n   ... and ${more} more` : ""}`,
      });
    }
  });
}
