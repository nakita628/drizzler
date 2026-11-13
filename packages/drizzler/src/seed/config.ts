import type { Faker } from "@faker-js/faker";

/** What a `json` column holds. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/** What a generated cell may hold before it is mapped to the driver. */
export type SeedValue =
  | string
  | number
  | bigint
  | boolean
  | Date
  | Uint8Array
  | null
  | readonly SeedValue[]
  | { readonly [key: string]: SeedValue };

/** A generated row keyed by the schema's property names (`authorId`, not `author_id`). */
export type SeedRow = Readonly<Record<string, SeedValue>>;

// The schema is read by the shape of what Drizzle exports, not by its classes: those have
// protected members, so a schema built with another copy of drizzle-orm would match none of them.

/** A Drizzle table: its name and columns, and the rows it reads and writes. */
type TableLike = {
  readonly _: { readonly name: string; readonly columns: object };
  readonly $inferInsert: object;
  readonly $inferSelect: object;
};

/** A Drizzle column: the value it holds, whether it may be null, its broad type. */
type ColumnLike = {
  readonly _: { readonly data: unknown; readonly notNull: boolean; readonly dataType: string };
};

/**
 * A `defineRelations` or `defineRelationsPart` export: per table, the table and the relations it
 * declares, each an `r.one` or `r.many` with the table it points at.
 */
type RelationalLike = {
  readonly [key: string]: {
    readonly table: { readonly _: { readonly name: string } };
    readonly relations: object;
  };
};

/** A relation as `defineRelations` types it. */
type RelationLike = {
  readonly relationType: "one" | "many";
  readonly targetTableName: string;
};

/** The export names of a schema module that are tables: what `models` is keyed by. */
export type ModelName<S> = {
  [K in keyof S]: S[K] extends TableLike ? K : never;
}[keyof S] &
  string;

type TableOf<S, M> = M extends keyof S ? (S[M] extends TableLike ? S[M] : never) : never;

type ColumnsOf<S, M> = TableOf<S, M>["_"]["columns"];

/** The relations one relational export declares for the table of the database name `N`. */
type RelationsIn<C, N> = {
  [T in keyof C]: C[T] extends {
    readonly table: { readonly _: { readonly name: N } };
    readonly relations: infer R;
  }
    ? R
    : never;
}[keyof C];

/** The relations every relational export declares for the model, by name. */
type DeclaredRelations<S, M> = {
  [K in keyof S]: S[K] extends RelationalLike
    ? RelationsIn<S[K], TableOf<S, M>["_"]["name"]>
    : never;
}[keyof S];

type RelationsOf<S, M> = [DeclaredRelations<S, M>] extends [never]
  ? {}
  : UnionToIntersection<DeclaredRelations<S, M>>;

type UnionToIntersection<U> = (U extends unknown ? (union: U) => void : never) extends (
  intersection: infer I,
) => void
  ? I
  : never;

/** The export name of the table a relation points at; `targetTableName` is that export's name. */
type TargetOf<S, R> = R extends { readonly targetTableName: infer T }
  ? T extends ModelName<S>
    ? T
    : never
  : never;

/** What a rule may put in a column: its data type, or null when the column is nullable. */
export type FieldValue<C extends ColumnLike> =
  | C["_"]["data"]
  | (C["_"]["notNull"] extends true ? never : null);

/** The columns of the row generated so far, as a rule function sees them. */
export type RowOf<S, M> = {
  readonly [K in keyof ColumnsOf<S, M>]?: ColumnsOf<S, M>[K] extends ColumnLike
    ? FieldValue<ColumnsOf<S, M>[K]>
    : never;
};

/** One row of the model named by one of its unique keys: `{ email: "..." }` or `{ id: 1 }`. */
export type KeyOf<S, M> = {
  readonly [K in keyof TableOf<S, M>["$inferSelect"]]?: TableOf<S, M>["$inferSelect"][K];
};

/**
 * A real row as the config gives it. Any column may be there; one left out takes its default, a
 * key to a parent is picked from the rows that exist, and a required column with neither is
 * reported before anything is inserted. Relations need no ids: an `r.many` relation nests the child
 * rows (`posts: [{ title }]`) and an `r.one` relation names its parent by a unique key
 * (`author: { email }`).
 */
export type DataRow<S, M> = {
  readonly [K in keyof TableOf<S, M>["$inferInsert"]]?: TableOf<S, M>["$inferInsert"][K];
} & {
  readonly [R in keyof RelationsOf<S, M>]?: RelationsOf<S, M>[R] extends RelationLike
    ? RelationsOf<S, M>[R]["relationType"] extends "one"
      ? KeyOf<S, TargetOf<S, RelationsOf<S, M>[R]>> | DataRow<S, TargetOf<S, RelationsOf<S, M>[R]>>
      : readonly DataRow<S, TargetOf<S, RelationsOf<S, M>[R]>>[]
    : never;
};

/** One real row of the named model, for a row kept in its own variable. */
export type Row<S, M extends ModelName<S>> = DataRow<S, M>;

/** The real rows of the named model, for `data` kept in its own variable or file. */
export type Data<S, M extends ModelName<S>> = readonly Row<S, M>[];

/**
 * Types real rows of one model outside `defineConfig`, so `data` can live in its own variable or
 * file: `export const users = defineData(schema, "user", [{ email: "...", name: "..." }])`. The
 * rows are returned as they are.
 */
export function defineData<const S, M extends ModelName<S>>(
  schema: S,
  model: M,
  rows: NoInfer<Data<S, M>>,
) {
  return rows;
}

type LengthRule = { readonly length?: number | { readonly min: number; readonly max: number } };

// Drizzle names a column's type as its broad type and what it narrows to: `number int32`,
// `object date`, `string uuid`. An array column holds its element's type with a list as data.
type Bounds<C extends ColumnLike> = (C["_"]["data"] extends readonly unknown[]
  ? { readonly min?: number; readonly max?: number } & LengthRule
  : C["_"]["dataType"] extends `number${string}` | `bigint${string}`
    ? { readonly min?: number; readonly max?: number }
    : C["_"]["dataType"] extends "object date"
      ? { readonly from?: Date | string; readonly to?: Date | string }
      : C["_"]["dataType"] extends `string${string}`
        ? LengthRule
        : unknown) &
  (C["_"]["notNull"] extends true ? unknown : { readonly nullRate?: number });

/**
 * How one column is filled: a function of the seeded faker and the row so far, or bounds that fit
 * the column's type. `value` fixes it, `values` draws from a list.
 */
export type FieldRule<S, M, C extends ColumnLike> =
  | ((
      faker: Faker,
      context: { readonly index: number; readonly row: RowOf<S, M> },
    ) => FieldValue<C>)
  | ({
      readonly value?: FieldValue<C>;
      readonly values?: readonly FieldValue<C>[];
    } & Bounds<C>);

/**
 * How many child rows each row must have, per `r.many` relation (`min: 1` makes one required).
 * Real rows are checked against it; faker rows are dealt out to satisfy it.
 */
export type RelationRule = {
  readonly min?: number;
  readonly max?: number;
};

/** The `r.many` relations of the model. */
type ManyNames<S, M> = {
  [R in keyof RelationsOf<S, M>]: RelationsOf<S, M>[R] extends { readonly relationType: "many" }
    ? R
    : never;
}[keyof RelationsOf<S, M>];

type FieldRules<S, M> = {
  readonly [K in keyof ColumnsOf<S, M>]?: ColumnsOf<S, M>[K] extends ColumnLike
    ? FieldRule<S, M, ColumnsOf<S, M>[K]>
    : never;
};

/**
 * One model is seeded from real rows or from faker, never both: `data` names the rows to insert
 * as written, `count` and `fields` shape the rows faker makes.
 */
export type ModelRule<S, M> =
  | {
      /** Real rows, inserted as written; a column left out takes its default, relations need no ids. */
      readonly data: readonly DataRow<S, M>[];
      readonly count?: never;
      readonly fields?: never;
      /** How many child rows each real row must have, per `r.many` relation. */
      readonly relations?: { readonly [R in ManyNames<S, M>]?: RelationRule };
    }
  | {
      readonly data?: never;
      /** Rows to generate for the model. */
      readonly count?: number;
      /** Rules per column. */
      readonly fields?: FieldRules<S, M>;
      /** How many child rows each faker row gets, per `r.many` relation (`posts`). */
      readonly relations?: { readonly [R in ManyNames<S, M>]?: RelationRule };
    };

export type CommonOptions = {
  /** The faker seed: the same seed yields the same rows. Left out, every run differs. */
  readonly seed?: number;
  /** The faker locale, or a list tried in order (`["ja", "en"]`). Left out, faker's English. */
  readonly locale?: string | readonly string[];
  /** Rows for every model that has no rule of its own. Left out, only the models in `models` are seeded. */
  readonly count?: number;
  /** How often a nullable column is null, from 0 to 1. Left out, nullable columns are filled. */
  readonly nullRate?: number;
  /** The window every date falls in. Left out, faker's: the year before the run. */
  readonly dates?: { readonly from?: string | Date; readonly to?: string | Date };
  /** Where to write the SQL instead of inserting into the database. */
  readonly output?: string;
  /** The database URL; `--url`, then DATABASE_URL, when omitted. */
  readonly url?: string;
  /** Delete every row of the seeded tables before inserting. */
  readonly reset?: boolean;
};

/** The config checked against a schema module: only its tables, columns and relations are accepted. */
export type TypedSeedConfig<S> = CommonOptions & {
  readonly models?: { readonly [M in ModelName<S>]?: ModelRule<S, M> };
};

/** A rule as the seeder reads it once the config is loaded, with no schema to check names against. */
export type LooseFieldRule =
  | ((faker: Faker, context: { readonly index: number; readonly row: SeedRow }) => SeedValue)
  | ({
      readonly value?: SeedValue;
      readonly values?: readonly SeedValue[];
      readonly min?: number;
      readonly max?: number;
      readonly from?: Date | string;
      readonly to?: Date | string;
      readonly nullRate?: number;
    } & LengthRule);

export type LooseModelRule = {
  readonly count?: number;
  readonly data?: readonly SeedRow[];
  readonly fields?: Readonly<Record<string, LooseFieldRule>>;
  readonly relations?: Readonly<Record<string, RelationRule>>;
};

/** The config as `drizzler seed` reads it: the schema module and the rules, unchecked. */
export type SeedConfig = CommonOptions & {
  /** The Drizzle schema module the rows are made for: `import * as schema from "./db/schema"`. */
  readonly schema: Readonly<Record<string, unknown>>;
  readonly models?: Readonly<Record<string, LooseModelRule>>;
};

/**
 * Types the seed config for `drizzler.config.ts` against the Drizzle schema module: every model
 * (the table's export name), column, relation and bound is checked, and rule functions know the
 * row they see. The schema is kept: the rows are made from its tables.
 */
export function defineConfig<const S extends Readonly<Record<string, unknown>>>(
  schema: S,
  config: NoInfer<TypedSeedConfig<S>>,
): SeedConfig {
  // The typed rules are a narrowing of the loose ones the seeder reads, but TypeScript reads each
  // optional key of the typed form as `| undefined`, which the loose records do not take; the
  // loader checks the shape again at runtime.
  // oxlint-disable-next-line custom/no-type-assertion, typescript/no-unsafe-type-assertion -- typed config to the loose form the seeder reads
  return { ...(config as Omit<SeedConfig, "schema">), schema };
}
