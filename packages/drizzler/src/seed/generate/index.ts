import type { Faker } from "@faker-js/faker";
import type { SeedRow } from "../config.js";
import type { SeedGenerationError } from "../errors.js";
import type { ResolvedSeedConfig } from "../options.js";
import type { Result } from "../result.js";
import { forEach, ok } from "../result.js";
import type { ModelTable, SeedTableRows } from "../schema.js";
import { validateRows } from "../validate.js";
import { checkCardinality } from "./cardinality.js";
import type { Context } from "./context.js";
import { holdsKey, uniqueKey } from "./context.js";
import { nestChildren } from "./nest.js";
import { claimOf } from "./parents.js";
import { attemptRow } from "./rows.js";
import { checkRules } from "./rules.js";

function makeModelRows(
  context: Context,
  table: ModelTable,
): Result<readonly SeedRow[], SeedGenerationError> {
  const rule = context.config.models[table.name];
  // The real rows: the model's own, then the ones nested under parents made before it. A self
  // relation nests rows into this very queue while it is being walked.
  const queue: readonly SeedRow[] = [
    ...(rule?.data ?? []),
    ...(context.pending.get(table.name) ?? []),
  ];
  context.pending.set(table.name, queue);
  const oneToOne = table.foreignKeys.filter((fk) => fk.oneToOne && !fk.self);
  const parentCounts = oneToOne
    .filter((fk) => fk.required)
    .map((fk) => (context.rowsByModel.get(fk.toModel) ?? []).length);
  // Faker rows come after the real ones: as many as the rule says, or the config's count for a
  // model with no rule, never more one-to-one children than there are parents left.
  const generated =
    rule?.data !== undefined
      ? 0
      : (rule?.count ??
        (context.config.count === null ? 0 : Math.min(context.config.count, ...parentCounts)));
  // A parent a real row points at is spoken for; the others are dealt out to the rest.
  const pools = new Map(
    oneToOne.map((fk) => {
      const parents = context.rowsByModel.get(fk.toModel) ?? [];
      const claimed = new Set(queue.flatMap((given) => claimOf(fk, given, parents) ?? []));
      return [
        fk.field,
        context.faker.helpers.shuffle(
          parents.filter((parent) => !claimed.has(uniqueKey(parent, fk.toFields))),
        ),
      ] as const;
    }),
  );
  const slots = new Map<string, number>(oneToOne.map((fk) => [fk.field, 0]));
  const seen = new Map(
    table.uniques.map((fields) => [fields.join(" "), new Set<string>()] as const),
  );
  // Rows accumulate in place: a spread per row would be quadratic.
  const rows: SeedRow[] = [];
  // The queue is read again on every turn, since a self relation lengthens it as rows are made.
  while (rows.length < (context.pending.get(table.name) ?? []).length + generated) {
    const index = rows.length;
    const given = context.pending.get(table.name)?.[index] ?? null;
    const attempted = attemptRow(
      { context, table, index, own: rows, given, pools, slots: new Map(slots) },
      seen,
    );
    if (!attempted.ok) return attempted;
    const row = attempted.value;
    if (given !== null) {
      const nested = nestChildren(context, table, given, row);
      if (!nested.ok) return nested;
    }
    for (const fk of oneToOne) {
      if (
        given === null ||
        claimOf(fk, given, context.rowsByModel.get(fk.toModel) ?? []) === null
      ) {
        slots.set(fk.field, (slots.get(fk.field) ?? 0) + 1);
      }
    }
    for (const fields of table.uniques) {
      if (holdsKey(row, fields)) seen.get(fields.join(" "))?.add(uniqueKey(row, fields));
    }
    for (const fk of table.foreignKeys) {
      const parent = uniqueKey(row, fk.fromFields);
      if (fk.fromFields.some((field) => row[field] !== null && row[field] !== undefined)) {
        const counts =
          context.linkCounts.get(`${table.name}.${fk.field}`) ?? new Map<string, number>();
        counts.set(parent, (counts.get(parent) ?? 0) + 1);
        context.linkCounts.set(`${table.name}.${fk.field}`, counts);
      }
    }
    // oxlint-disable-next-line custom/no-array-mutation -- a copy per row would make seeding quadratic in the row count
    rows.push(row);
  }
  const valid = validateRows(table, rows);
  if (!valid.ok) return valid;
  const all: readonly SeedRow[] = rows;
  return ok(all);
}

/**
 * Rows for every table of the plan, in plan order, from one seeded faker: given rows first and
 * as written, parents before children, each key pointing at a row that exists, every unique key
 * honoured, every value validated.
 */
export function generateSeedRows(input: {
  readonly tables: readonly ModelTable[];
  readonly config: ResolvedSeedConfig;
  readonly faker: Faker;
}): Result<readonly SeedTableRows<SeedRow>[], SeedGenerationError> {
  const rules = checkRules(input.tables, input.config);
  if (!rules.ok) return rules;
  const rowsByModel = new Map<string, readonly SeedRow[]>();
  const context: Context = {
    faker: input.faker,
    config: input.config,
    tables: input.tables,
    rowsByModel,
    pending: new Map(),
    linkCounts: new Map(),
  };
  const entries = forEach(input.tables, (table) => {
    const made = makeModelRows(context, table);
    if (!made.ok) return made;
    rowsByModel.set(table.name, made.value);
    const entry: SeedTableRows<SeedRow> = { table, rows: made.value };
    return ok(entry);
  });
  if (!entries.ok) return entries;
  const cardinality = checkCardinality(context);
  if (!cardinality.ok) return cardinality;
  return entries;
}
