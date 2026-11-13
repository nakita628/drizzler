import type { Faker } from "@faker-js/faker";
import type { SeedRow, SeedValue } from "../config.js";
import type { ResolvedSeedConfig } from "../options.js";
import type { ForeignKey, ModelTable, ParentSide } from "../schema.js";

export const MAX_ATTEMPTS = 20;

/** A stable text form of a value, so unique keys can be checked through a Set. */
/** The return type is spelled out: the function calls itself for lists. */
export function keyOf(value: SeedValue): string {
  if (value === null) return "null";
  if (typeof value === "bigint") return `${value.toString()}n`;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return Buffer.from(value).toString("hex");
  if (Array.isArray(value)) return JSON.stringify(value.map(keyOf));
  if (typeof value === "object") {
    return JSON.stringify(Object.entries(value).map(([k, v]) => [k, keyOf(v)]));
  }
  return JSON.stringify(value);
}

/**
 * Whether the row takes part in the unique key: a row with a null in it does not, as the
 * database lets any number of such rows be.
 */
export function holdsKey(row: SeedRow, fields: readonly string[]) {
  return fields.every((field) => row[field] !== null && row[field] !== undefined);
}

/** A row's values for a unique key, joined into one string to compare. */
export function uniqueKey(row: SeedRow, fields: readonly string[]) {
  return fields.map((field) => keyOf(row[field] ?? null)).join(" ");
}

// Keys by the key's fields, then by row. A parent is keyed again for every child row that picks
// one, and a key is costly to make (JSON per value); a row is never changed once made, so its key
// never goes stale.
const parentKeys = new WeakMap<readonly string[], WeakMap<SeedRow, string>>();

/** `uniqueKey` of a parent row, made once per row and key. */
export function parentKey(row: SeedRow, fields: readonly string[]) {
  const byRow = parentKeys.get(fields) ?? new WeakMap<SeedRow, string>();
  if (!parentKeys.has(fields)) parentKeys.set(fields, byRow);
  const known = byRow.get(row);
  if (known !== undefined) return known;
  const key = uniqueKey(row, fields);
  byRow.set(row, key);
  return key;
}

/** Whether a value is a plain object naming a row by its key. */
export function isKeyObject(value: SeedValue | undefined): value is SeedRow {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date) &&
    !(value instanceof Uint8Array)
  );
}

/** Whether a value is a list. */
export function isSeedList(value: SeedValue): value is readonly SeedValue[] {
  return Array.isArray(value);
}

/** The table of a model, by name. */
export function modelTable(tables: readonly ModelTable[], name: string) {
  return tables.find((t) => t.name === name);
}

/** The key of the child model a parent-side relation is the other end of. */
export function childKey(tables: readonly ModelTable[], parent: ParentSide) {
  return modelTable(tables, parent.child)?.foreignKeys.find((fk) => fk.field === parent.key);
}

/** A value as an error message shows it. */
export function describeValue(value: SeedValue) {
  if (typeof value === "bigint") return `${value.toString()}n`;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return `<${value.length} bytes>`;
  return JSON.stringify(value);
}

export type Context = {
  readonly faker: Faker;
  readonly config: ResolvedSeedConfig;
  readonly tables: readonly ModelTable[];
  readonly rowsByModel: ReadonlyMap<string, readonly SeedRow[]>;
  /** Real rows nested under a parent, per child model, their key to the parent already filled. */
  readonly pending: Map<string, readonly SeedRow[]>;
  /** Per key (`post.author`), how many rows already point at each parent, by the parent's key. */
  readonly linkCounts: Map<string, Map<string, number>>;
};

export type RowInput = {
  readonly context: Context;
  readonly table: ModelTable;
  readonly index: number;
  readonly own: readonly SeedRow[];
  /** The given row to complete, when this index is one of `data`. */
  readonly given: SeedRow | null;
  /** Per one-to-one key, the parents not claimed by a given row, in the order they are handed out. */
  readonly pools: ReadonlyMap<string, readonly SeedRow[]>;
  /** Per one-to-one key, which parent of the pool this row takes. */
  readonly slots: ReadonlyMap<string, number>;
};

/** Whether a given row names the key's columns itself (`authorId: 3`). */
export function specifies(given: SeedRow | null, fk: ForeignKey) {
  return given !== null && fk.fromFields.every((field) => field in given);
}
