import { Effect } from "effect";
import type { LooseFieldRule, SeedRow } from "../config.js";
import { toSeedValue, dateBetween, generatedDefault, makeFieldValue } from "../values.js";
import { SeedGenerationError } from "../errors.js";
import type { ModelTable, SeedColumn } from "../schema.js";
import type { RowInput } from "./context.js";
import { MAX_ATTEMPTS, describeValue, holdsKey, uniqueKey } from "./context.js";
import { normalizeGiven, normalizeValue } from "./normalize.js";
import { pickParent } from "./parents.js";

function boundsOf(input: RowInput, nullRate: number | null) {
  return { nullRate, dates: input.context.config.dates };
}

/**
 * What a real row gets for a column it leaves out: what the column fills itself with (the next
 * number, a `$defaultFn()`, a date or a uuid for a SQL default), a literal `.default()`, an
 * `$onUpdate()` stamp, or null when the column is nullable. A column the database fills is left
 * out; a required column with none of these has to be given.
 */
function defaultValue(input: RowInput, column: SeedColumn) {
  return Effect.gen(function* () {
    const { context, table, index } = input;
    const bounds = boundsOf(input, 0);
    const made = generatedDefault(context.faker, column, {}, bounds, index);
    if (made !== null) return made;
    if (column.default?.kind === "value") {
      return normalizeValue(column, toSeedValue(column.default.value));
    }
    if (column.onUpdate !== null) {
      return column.kind === "date"
        ? dateBetween(context.faker, {}, bounds)
        : toSeedValue(column.onUpdate());
    }
    if (!column.isRequired) return null;
    if (column.isList) return [];
    return yield* new SeedGenerationError({
      message: `${table.name} data[${index}].${column.field}: the column is required and has no default, so the row must give it.`,
    });
  });
}

/** The columns in declaration order, each generated with the row so far in view. */
function fillScalars(input: RowInput, skip: ReadonlySet<string>, row: SeedRow) {
  return fillFrom(input, skip, 0, row);
}

// The columns from `at` on, one at a time: each rule sees the row as it was when its column came
// up, not the row it grows into.
function fillFrom(input: RowInput, skip: ReadonlySet<string>, at: number, row: SeedRow): SeedRow {
  const { context, table, index } = input;
  const column = table.columns[at];
  if (column === undefined) return row;
  const rule = context.config.models[table.name]?.fields?.[column.field];
  // A column the database fills is left to it, unless a rule says otherwise.
  if (skip.has(column.field) || (column.databaseFills && rule === undefined)) {
    return fillFrom(input, skip, at + 1, row);
  }
  const value = makeFieldValue({
    faker: context.faker,
    column,
    rule,
    bounds: boundsOf(input, context.config.nullRate),
    index,
    row,
  });
  return fillFrom(input, skip, at + 1, { ...row, [column.field]: value });
}

/** The columns a real row leaves out, each filled with its default. */
function fillDefaults(input: RowInput, skip: ReadonlySet<string>, row: SeedRow) {
  return Effect.gen(function* () {
    const columns = input.table.columns.filter(
      (column) => !skip.has(column.field) && !column.databaseFills,
    );
    const entries = yield* Effect.forEach(columns, (column) =>
      Effect.map(defaultValue(input, column), (value) => [column.field, value] as const),
    );
    const filled: SeedRow = { ...row, ...Object.fromEntries(entries) };
    return filled;
  });
}

/** Whether a rule makes the column's values itself, rather than only saying how often it is null. */
function fillsColumn(rule: LooseFieldRule | undefined) {
  if (rule === undefined) return false;
  if (typeof rule === "function") return true;
  return Object.entries(rule).some(([name, value]) => name !== "nullRate" && value !== undefined);
}

function makeRow(input: RowInput) {
  return Effect.gen(function* () {
    const { context, table, given } = input;
    const rules = context.config.models[table.name]?.fields ?? {};
    const fitted = normalizeGiven(input);
    // A faker row gets every key picked unless a rule fills its columns (a rule that only sets
    // `nullRate` leaves the pick to the seeder); a real row's keys are read from what it gives, or
    // picked when it gives nothing for a required one.
    const keys = table.foreignKeys.filter(
      (fk) => given !== null || !fillsColumn(rules[fk.fromFields[0] ?? ""]),
    );
    const skip = new Set([...Object.keys(fitted), ...keys.flatMap((fk) => fk.fromFields)]);
    const scalars =
      given === null ? fillScalars(input, skip, fitted) : yield* fillDefaults(input, skip, fitted);
    const parents = yield* Effect.forEach(keys, (fk) => pickParent(input, fk, scalars));
    const linked: SeedRow = {
      ...scalars,
      ...Object.fromEntries(
        keys.flatMap((fk, k) =>
          fk.fromFields.map((from, i) => {
            const parent = parents[k] ?? null;
            return [from, parent === null ? null : (parent[fk.toFields[i] ?? ""] ?? null)];
          }),
        ),
      ),
    };
    // A row is updated at or after it was created: an `$onUpdate()` date follows the latest date
    // the row was stamped with on insert.
    const created = table.columns
      .filter((c) => c.kind === "date" && c.onUpdate === null && c.default !== null)
      .map((c) => linked[c.field])
      .filter((v): v is Date => v instanceof Date)
      .toSorted((a, b) => b.getTime() - a.getTime())[0];
    const updated =
      created === undefined
        ? []
        : table.columns
            .filter(
              (c) =>
                c.kind === "date" &&
                c.onUpdate !== null &&
                rules[c.field] === undefined &&
                !(c.field in fitted),
            )
            .map((c) => {
              const end =
                context.config.dates?.to ?? new Date(created.getTime() + 30 * 24 * 60 * 60 * 1000);
              const to = end > created ? end : created;
              return [c.field, context.faker.date.between({ from: created, to })] as const;
            });
    const row: SeedRow = { ...linked, ...Object.fromEntries(updated) };
    return row;
  });
}

function violated(row: SeedRow, table: ModelTable, seen: ReadonlyMap<string, ReadonlySet<string>>) {
  return table.uniques.filter(
    (fields) => holdsKey(row, fields) && seen.get(fields.join(" "))?.has(uniqueKey(row, fields)),
  );
}

/**
 * A text column that collided gets the row number worked in, so an email stays an email. A key
 * column is left alone: its value is a parent's, and changing it would break the relation.
 */
function disambiguate(row: SeedRow, fields: readonly string[], table: ModelTable, index: number) {
  const keys = new Set(table.foreignKeys.flatMap((fk) => fk.fromFields));
  const columns = Map.groupBy(table.columns, (c) => c.field);
  return fields.flatMap((field): readonly (readonly [string, string])[] => {
    const value = row[field];
    const column = columns.get(field)?.[0];
    if (keys.has(field) || typeof value !== "string" || column?.kind !== "string") return [];
    const at = value.indexOf("@");
    const suffix = String(index + 1);
    const patched =
      at > 0 ? `${value.slice(0, at)}${suffix}${value.slice(at)}` : `${value}-${suffix}`;
    return [[field, column.length === null ? patched : patched.slice(-column.length)]];
  });
}

/**
 * Rows until one meets every unique key; the last attempt is patched by hand. A given row is
 * taken as written, so a clash in it is reported, not worked around.
 */
export function attemptRow(input: RowInput, seen: ReadonlyMap<string, ReadonlySet<string>>) {
  return Effect.gen(function* () {
    if (input.given !== null) {
      const row = yield* makeRow(input);
      const clash = violated(row, input.table, seen)[0];
      if (clash === undefined) return row;
      return yield* new SeedGenerationError({
        message: `${input.table.name} data[${input.index}]: ${clash.join(", ")} = ${clash.map((field) => describeValue(row[field] ?? null)).join(", ")} repeats an earlier row.`,
      });
    }
    for (const _attempt of Array.from({ length: MAX_ATTEMPTS - 1 })) {
      const made = yield* makeRow(input);
      if (violated(made, input.table, seen).length === 0) return made;
    }
    const last = yield* makeRow(input);
    const patches = violated(last, input.table, seen).flatMap((fields) =>
      disambiguate(last, fields, input.table, input.index),
    );
    const fixed: SeedRow = Object.fromEntries([...Object.entries(last), ...patches]);
    const remaining = violated(fixed, input.table, seen);
    if (remaining.length === 0) return fixed;
    return yield* new SeedGenerationError({
      message: `${input.table.name}: cannot satisfy the unique key on ${remaining[0]?.join(", ") ?? ""} for ${input.own.length + 1} or more rows.\n   Lower models.${input.table.name}.count or widen the column's range.`,
    });
  });
}
