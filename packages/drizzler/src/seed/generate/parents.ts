import type { SeedRow } from "../config.js";
import { SeedGenerationError } from "../errors.js";
import type { Result } from "../result.js";
import { fail, ok } from "../result.js";
import type { ForeignKey, ModelTable } from "../schema.js";
import type { Context, RowInput } from "./context.js";
import {
  describeValue,
  isKeyObject,
  keyOf,
  modelTable,
  parentKey,
  specifies,
  uniqueKey,
} from "./context.js";

/** The parent the given key values name; fails when no such row exists. */
function findParent(
  input: RowInput,
  fk: ForeignKey,
  given: SeedRow,
): Result<SeedRow | null, SeedGenerationError> {
  const { context, table, index, own } = input;
  const parents = fk.self ? own : (context.rowsByModel.get(fk.toModel) ?? []);
  const wanted = fk.fromFields.map((field) => given[field] ?? null);
  if (wanted.every((value) => value === null)) {
    if (!fk.required) return ok(null);
    return fail(
      new SeedGenerationError({
        message: `${table.name} data[${index}].${fk.field}: the relation is required, but ${fk.fromFields.join(", ")} is null.`,
      }),
    );
  }
  const key = wanted.map(keyOf).join(" ");
  const parent = parents.find((row) => parentKey(row, fk.toFields) === key);
  if (parent !== undefined) return ok(parent);
  return fail(
    new SeedGenerationError({
      message: `${table.name} data[${index}].${fk.field}: no ${fk.toModel} has ${fk.toFields.join(", ")} = ${wanted.map(describeValue).join(", ")}.\n   Give ${fk.toModel} that row, or let the seeder pick one.`,
    }),
  );
}

/** The one parent a unique key names (`{ email: "..." }`); fails when none or several do. */
function findParentByKey(
  input: RowInput,
  fk: ForeignKey,
  key: SeedRow,
): Result<SeedRow | null, SeedGenerationError> {
  const { context, table, index, own } = input;
  const parents = fk.self ? own : (context.rowsByModel.get(fk.toModel) ?? []);
  const wanted = Object.entries(key);
  const matches = parents.filter((row) =>
    wanted.every(([field, value]) => keyOf(row[field] ?? null) === keyOf(value)),
  );
  const shown = wanted.map(([field, value]) => `${field} = ${describeValue(value)}`).join(", ");
  if (matches.length === 1) return ok(matches[0] ?? null);
  return fail(
    new SeedGenerationError({
      message:
        matches.length === 0
          ? `${table.name} data[${index}].${fk.field}: no ${fk.toModel} has ${shown}.\n   Give ${fk.toModel} that row.`
          : `${table.name} data[${index}].${fk.field}: ${matches.length} ${fk.toModel} rows have ${shown}; name the row by a unique key.`,
    }),
  );
}

/** The rule the parent model sets on the `r.many` relation this key is the other end of. */
function parentBound(context: Context, table: ModelTable, fk: ForeignKey) {
  const side = modelTable(context.tables, fk.toModel)?.parents.find(
    (parent) => parent.child === table.name && parent.key === fk.field,
  );
  const rule =
    side === undefined ? undefined : context.config.models[fk.toModel]?.relations?.[side.name];
  return { field: side?.name ?? null, min: rule?.min ?? null, max: rule?.max ?? null };
}

/**
 * The parent row a key of the row points at, or null for a nullable key left empty. A real row
 * names its parent by the key columns or by a unique key; a required key it leaves out is linked
 * to a row that exists, like a faker row's.
 */
export function pickParent(
  input: RowInput,
  fk: ForeignKey,
  self: SeedRow,
): Result<SeedRow | null, SeedGenerationError> {
  const { context, table, own, pools, slots } = input;
  if (input.given !== null) {
    const reference = input.given[fk.field];
    if (isKeyObject(reference)) return findParentByKey(input, fk, reference);
    if (specifies(input.given, fk)) return findParent(input, fk, input.given);
    if (!fk.required) return ok(null);
  }
  const parents = fk.self ? own : (context.rowsByModel.get(fk.toModel) ?? []);
  if (fk.oneToOne && !fk.self) {
    const parent = pools.get(fk.field)?.[slots.get(fk.field) ?? 0];
    if (parent !== undefined) return ok(parent);
    if (!fk.required) return ok(null);
    return fail(
      new SeedGenerationError({
        message: `${table.name}.${fk.field} is a one-to-one relation to ${fk.toModel}, so at most ${parents.length} ${table.name} rows can be seeded (${fk.toModel} has ${parents.length}).`,
      }),
    );
  }
  const bound = parentBound(context, table, fk);
  const counts = context.linkCounts.get(`${table.name}.${fk.field}`);
  function counted(parent: SeedRow) {
    return counts?.get(parentKey(parent, fk.toFields)) ?? 0;
  }
  // Parents still under the rule's `min` come first, so every one of them is served; none above
  // its `max` is offered at all. With no rule there is nothing to count: every parent is open.
  const { min, max } = bound;
  const open = max === null ? parents : parents.filter((parent) => counted(parent) < max);
  const behind = min === null ? [] : open.filter((parent) => counted(parent) < min);
  // The parents furthest from their `min` come first, so the rows are spread before any is spent.
  const fewest = Math.min(...behind.map(counted));
  const short = behind.filter((parent) => counted(parent) === fewest);
  // The key column's own `nullRate` wins over the config's.
  const rule = context.config.models[table.name]?.fields?.[fk.fromFields[0] ?? ""];
  const nullRate =
    (typeof rule === "object" ? rule.nullRate : undefined) ?? context.config.nullRate ?? 0;
  if (
    !fk.required &&
    short.length === 0 &&
    nullRate > 0 &&
    context.faker.datatype.boolean({ probability: nullRate })
  ) {
    return ok(null);
  }
  if (short.length > 0) return ok(context.faker.helpers.arrayElement(short));
  if (open.length > 0) return ok(context.faker.helpers.arrayElement(open));
  if (parents.length > 0 && bound.max !== null) {
    return fail(
      new SeedGenerationError({
        message: `${table.name}.${fk.field}: every ${fk.toModel} already has ${bound.max} ${table.name} rows (models.${fk.toModel}.relations.${bound.field ?? ""}.max).\n   Lower models.${table.name}.count or raise the max.`,
      }),
    );
  }
  if (fk.self) return ok(fk.required ? self : null);
  if (!fk.required) return ok(null);
  return fail(
    new SeedGenerationError({
      message: `${table.name}.${fk.field} requires a ${fk.toModel} row, but ${fk.toModel} has none. Give ${fk.toModel} a count.`,
    }),
  );
}

/** How a real row claims a parent of a one-to-one key: by its columns, by unique key, or not at all. */
export function claimOf(fk: ForeignKey, given: SeedRow, parents: readonly SeedRow[]) {
  const reference = given[fk.field];
  if (isKeyObject(reference)) {
    const wanted = Object.entries(reference);
    const parent = parents.find((row) =>
      wanted.every(([field, value]) => keyOf(row[field] ?? null) === keyOf(value)),
    );
    return parent === undefined ? null : uniqueKey(parent, fk.toFields);
  }
  return specifies(given, fk)
    ? fk.fromFields.map((field) => keyOf(given[field] ?? null)).join(" ")
    : null;
}
