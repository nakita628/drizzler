import type { Column, TablesRelationalConfig } from "drizzle-orm";
import { getTableColumns, is, Many, Relation, SQL, Table } from "drizzle-orm";
import { getTableConfig as mysqlTableConfig, MySqlTable } from "drizzle-orm/mysql-core";
import { getTableConfig as pgTableConfig, PgTable } from "drizzle-orm/pg-core";
import { getTableConfig as sqliteTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core";
import { Effect } from "effect";
import { SeedConfigError } from "./errors.js";

export type Dialect = "postgresql" | "mysql" | "sqlite";

/**
 * What a column holds, as the seeder makes and checks it. `date` is a `Date`, `dateString` the
 * text a `mode: "string"` date or timestamp column takes, `unknown` a type the seeder cannot make
 * (a geometry, a custom type) and leaves to a rule.
 */
export type ColumnKind =
  | "string"
  | "uuid"
  | "enum"
  | "int"
  | "bigint"
  | "float"
  | "decimal"
  | "boolean"
  | "date"
  | "dateString"
  | "json"
  | "bytes"
  | "inet"
  | "cidr"
  | "mac"
  | "interval"
  | "unknown";

/** How a column fills itself when an insert leaves it out. */
export type ColumnDefault =
  | { readonly kind: "value"; readonly value: unknown }
  | { readonly kind: "fn"; readonly fn: () => unknown }
  | { readonly kind: "sql" }
  | null;

/** One insertable column: the property it is read from and the database column it is written to. */
export type SeedColumn = {
  readonly field: string;
  readonly column: string;
  /** The Drizzle column type (`PgVarchar`, `SQLiteInteger`), for messages and literal forms. */
  readonly type: string;
  readonly kind: ColumnKind;
  /** For a `dateString` column, which part of a date it holds. */
  readonly format: "date" | "time" | "timestamp" | null;
  readonly isList: boolean;
  readonly isRequired: boolean;
  readonly isId: boolean;
  readonly enumValues: readonly string[] | null;
  /** The most characters a `varchar` / `char` holds. */
  readonly length: number | null;
  readonly precision: number | null;
  readonly scale: number | null;
  /** The range an integer column stores. */
  readonly range: { readonly min: number; readonly max: number } | null;
  /** The database numbers it: serial, identity, autoincrement, or SQLite's integer primary key. */
  readonly autoincrement: boolean;
  /** A PostgreSQL `generated always as identity` column, which takes a value only when told to. */
  readonly identityAlways: boolean;
  readonly default: ColumnDefault;
  /**
   * The database fills it from a SQL default (`sql\`CURRENT_TIMESTAMP\``) when a row leaves it
   * out: faker rows do, and the INSERT names it only for the rows that give it.
   */
  readonly databaseFills: boolean;
  /** `$onUpdate()`: the value a write stamps. */
  readonly onUpdate: (() => unknown) | null;
  /** The value as the driver takes it: Drizzle's own mapping of the column. */
  readonly toDriver: (value: unknown) => unknown;
};

/** A key of a model to another: the columns it is stored in and the columns it points at. */
export type ForeignKey = {
  /** The `r.one` relation that names it (`author`), else its first column (`authorId`). */
  readonly field: string;
  readonly fromFields: readonly string[];
  readonly toModel: string;
  readonly toFields: readonly string[];
  readonly required: boolean;
  /** The from-fields are a unique key of the model, so every parent may be used once. */
  readonly oneToOne: boolean;
  readonly self: boolean;
  /** A foreign key in the database; false for a relation only `defineRelations` declares. */
  readonly enforced: boolean;
};

/** A relation from the parent side (`posts: r.many.post()`): the child model and the key it points back by. */
export type ParentSide = {
  readonly name: string;
  readonly child: string;
  /** The `field` of the child's foreign key. */
  readonly key: string;
  readonly isList: boolean;
};

export type ModelTable = {
  /** The export name: what `models` and `defineData` are keyed by. */
  readonly name: string;
  readonly table: string;
  readonly schema: string | null;
  readonly columns: readonly SeedColumn[];
  readonly foreignKeys: readonly ForeignKey[];
  readonly parents: readonly ParentSide[];
  /** Every way to name one row: the primary key, each unique column, constraint and unique index. */
  readonly uniques: readonly (readonly string[])[];
};

/** The rows made for one table of the plan. */
export type SeedTableRows<Row> = { readonly table: ModelTable; readonly rows: readonly Row[] };

type AnyColumn = Column & {
  readonly autoIncrement?: boolean;
  readonly generatedIdentity?: { readonly type: "always" | "byDefault" };
  readonly length?: number;
  readonly precision?: number;
  readonly scale?: number;
  readonly unsigned?: boolean;
  readonly dimensions?: number;
};

const INT = 2_147_483_647;
const SAFE = Number.MAX_SAFE_INTEGER;

/** The broad type of a column and what it narrows to: `number int32`, `string uuid`, `object date`. */
function dataTypeOf(column: Column) {
  const [type = "", constraint = ""] = column.dataType.split(" ");
  return { type, constraint };
}

/** The bound of each signed integer width Drizzle names (`int8`, `int16`, `int24`, `int32`). */
const INT_BITS: ReadonlyMap<string, number> = new Map([
  ["int8", 127],
  ["int16", 32_767],
  ["int24", 8_388_607],
  ["int32", INT],
]);

/** The range of an integer column, by the width its data type names; a `u` width starts at 0. */
function intRange(column: AnyColumn) {
  const { constraint } = dataTypeOf(column);
  const unsigned = constraint.startsWith("u") || column.unsigned === true;
  const bits = INT_BITS.get(unsigned ? constraint.slice(1) : constraint) ?? SAFE;
  if (unsigned) return { min: 0, max: bits === SAFE ? SAFE : bits * 2 + 1 };
  return { min: bits === SAFE ? -SAFE : -bits - 1, max: bits };
}

/** What an `object` column holds, by the constraint of its data type. */
const OBJECT_KINDS: ReadonlyMap<string, ColumnKind> = new Map([
  ["date", "date"],
  ["json", "json"],
  ["buffer", "bytes"],
]);

function plain(kind: ColumnKind) {
  return { kind, format: null };
}

function kindOf(column: AnyColumn): {
  readonly kind: ColumnKind;
  readonly format: SeedColumn["format"];
} {
  const { type, constraint } = dataTypeOf(column);
  if ((column.enumValues ?? []).length > 0 && type === "string") return plain("enum");
  switch (type) {
    case "boolean":
      return plain("boolean");
    case "bigint":
      return plain("bigint");
    case "number":
      return plain(
        ["float", "ufloat", "double", "udouble"].includes(constraint) ||
          /Real|Double|Float|Numeric|Decimal/u.test(column.columnType)
          ? "float"
          : "int",
      );
    case "object":
      return plain(OBJECT_KINDS.get(constraint) ?? "unknown");
    case "string":
      switch (constraint) {
        case "uuid":
          return plain("uuid");
        case "numeric":
        case "unumeric":
          return plain("decimal");
        case "inet":
          return plain("inet");
        case "cidr":
          return plain("cidr");
        case "macaddr":
        case "macaddr8":
          return plain("mac");
        case "interval":
          return plain("interval");
        case "timestamp":
        case "datetime":
          return { kind: "dateString", format: "timestamp" };
        case "date":
          return { kind: "dateString", format: "date" };
        case "time":
          return { kind: "dateString", format: "time" };
        default:
          // Text, and what the driver takes as text: a binary string, a 64-bit integer string.
          return plain("string");
      }
    default:
      return plain("unknown");
  }
}

function defaultOf(column: AnyColumn): ColumnDefault {
  if (column.defaultFn !== undefined) {
    const fn = column.defaultFn;
    return { kind: "fn", fn: () => fn() };
  }
  if (column.default === undefined) return null;
  return is(column.default, SQL) ? { kind: "sql" } : { kind: "value", value: column.default };
}

function isAutoincrement(column: AnyColumn, onlyKey: boolean) {
  return (
    /Serial/u.test(column.columnType) ||
    column.generatedIdentity !== undefined ||
    column.autoIncrement === true ||
    // SQLite numbers an INTEGER PRIMARY KEY itself: the column is the rowid.
    (column.columnType === "SQLiteInteger" && column.primary && onlyKey)
  );
}

/** The column as the seeder reads it: its kind, bounds, defaults and the driver's mapping. */
function makeColumn(field: string, column: AnyColumn, onlyKey: boolean): SeedColumn {
  // A PostgreSQL array is its element's column with `dimensions`: one is a list, more the
  // seeder cannot make.
  const dimensions = column.dimensions ?? 0;
  const list = dimensions === 1;
  const { kind, format } = kindOf(column);
  return {
    field,
    column: column.name,
    type: column.columnType,
    kind: dimensions > 1 ? "unknown" : kind,
    format,
    isList: list,
    isRequired: column.notNull,
    isId: column.primary,
    enumValues: (column.enumValues ?? []).length > 0 ? (column.enumValues ?? []) : null,
    length: typeof column.length === "number" && column.length > 0 ? column.length : null,
    precision: typeof column.precision === "number" ? column.precision : null,
    scale: typeof column.scale === "number" ? column.scale : null,
    range: kind === "int" ? intRange(column) : null,
    autoincrement: kind === "int" && isAutoincrement(column, onlyKey),
    identityAlways: column.generatedIdentity?.type === "always",
    default: defaultOf(column),
    databaseFills: false,
    onUpdate: column.onUpdateFn ?? null,
    toDriver: (value) => column.mapToDriverValue(value),
  };
}

/** A foreign key as every dialect reports it: its columns, and the table and columns it points at. */
type Reference = {
  readonly columns: readonly Column[];
  readonly foreignColumns: readonly Column[];
  readonly foreignTable: Table;
};

function dialectOf(table: Table): Dialect | null {
  if (is(table, PgTable)) return "postgresql";
  if (is(table, MySqlTable)) return "mysql";
  if (is(table, SQLiteTable)) return "sqlite";
  return null;
}

function dialectTableConfig(table: Table) {
  if (is(table, PgTable)) return pgTableConfig(table);
  if (is(table, SQLiteTable)) return sqliteTableConfig(table);
  return mysqlTableConfig(table);
}

/** The parts of a table the seeder needs, as each dialect's `getTableConfig` reports them. */
function tableConfig(table: Table) {
  const config = dialectTableConfig(table);
  const uniqueIndexes = config.indexes.flatMap((index) =>
    index.config.unique === true ? [index.config.columns] : [],
  );
  return {
    name: config.name,
    schema: "schema" in config && typeof config.schema === "string" ? config.schema : null,
    primaryKeys: config.primaryKeys.map((key) => key.columns),
    uniques: [...config.uniqueConstraints.map((unique) => unique.columns), ...uniqueIndexes],
    foreignKeys: config.foreignKeys.map((fk): Reference => {
      const reference = fk.reference();
      return {
        columns: reference.columns,
        foreignColumns: reference.foreignColumns,
        foreignTable: reference.foreignTable,
      };
    }),
  };
}

function sameKey(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((field, i) => field === b[i]);
}

function sameSet(a: readonly string[], b: readonly string[]) {
  // oxlint-disable-next-line custom/no-lookup-in-loop -- a unique constraint holds a few fields
  return a.length === b.length && a.every((field) => b.includes(field));
}

/**
 * The tables of a Drizzle schema module as the seeder reads them: every exported table with its
 * insertable columns, its foreign keys (in the database, or declared by `defineRelations` alone),
 * its unique keys and the relations other models point back by. All tables must be of
 * one dialect.
 */
export function readSchema(schema: Readonly<Record<string, unknown>>) {
  return Effect.gen(function* () {
    const entries = Object.entries(schema).flatMap(([name, value]) =>
      is(value, Table) ? [{ name, table: value }] : [],
    );
    if (entries.length === 0) {
      return yield* new SeedConfigError({
        message:
          "The schema exports no tables.\n   Pass the module itself: `import * as schema from './db/schema'`.",
      });
    }
    const dialects = new Set(entries.map((entry) => dialectOf(entry.table)));
    const [dialect] = [...dialects];
    if (dialects.size !== 1 || dialect === undefined || dialect === null) {
      return yield* new SeedConfigError({
        message:
          "The schema mixes dialects, or uses one the seeder does not know (pg, mysql or sqlite).",
      });
    }
    const nameOf = new Map(entries.map((entry) => [entry.table, entry.name] as const));
    // Every column object by the table and property it belongs to, for keys and relations.
    const fieldOf = new Map<Column, string>(
      entries.flatMap((entry) =>
        Object.entries(getTableColumns(entry.table)).map(
          ([field, column]) => [column, field] as const,
        ),
      ),
    );
    // A table's extra config (`primaryKey()`, `foreignKey()`) holds stand-ins for its columns,
    // not the columns themselves, so a column not known by identity is found by its name.
    function fields(columns: readonly Column[], table?: Table) {
      return columns.flatMap((column) => {
        const known = fieldOf.get(column);
        if (known !== undefined) return [known];
        const named =
          table === undefined
            ? undefined
            : Object.entries(getTableColumns(table)).find(([, c]) => c.name === column.name)?.[0];
        return named === undefined ? [] : [named];
      });
    }
    const links = relationLinks(schema, nameOf);

    const shapes = entries.map((entry) => {
      const config = tableConfig(entry.table);
      const columns: readonly (readonly [string, AnyColumn])[] = Object.entries(
        getTableColumns(entry.table),
      );
      const primary = columns.filter(([, column]) => column.primary).map(([field]) => field);
      const uniqueSets = [
        ...(primary.length === 1 ? [primary] : []),
        ...config.primaryKeys.map((key) => fields(key, entry.table)),
        ...columns.filter(([, column]) => column.isUnique).map(([field]) => [field]),
        ...config.uniques.map((set) => indexFields(set, columns)),
      ].filter((set) => set.length > 0);
      const uniques = uniqueSets.filter(
        (set, at) => uniqueSets.findIndex((other) => sameSet(other, set)) === at,
      );
      return { entry, config, columns, uniques };
    });

    const shapeOf = new Map(shapes.map((shape) => [shape.entry.name, shape] as const));
    function uniquesOf(model: string) {
      return shapeOf.get(model)?.uniques ?? [];
    }
    // Whether the database has a foreign key from `child`'s fields to `parent`'s.
    function constrained(
      child: string,
      from: readonly string[],
      parent: string,
      to: readonly string[],
    ) {
      const shape = shapeOf.get(child);
      return (shape?.config.foreignKeys ?? []).some(
        (fk) =>
          nameOf.get(fk.foreignTable) === parent &&
          sameKey(fields(fk.columns, shape?.entry.table), from) &&
          sameKey(fields(fk.foreignColumns, fk.foreignTable), to),
      );
    }
    const keys = keysOf(links, { constrained, uniquesOf });

    // Columns other models' keys point at must hold the values the seeder hands out.
    const referenced = new Set<Column>([
      ...shapes.flatMap((shape) => shape.config.foreignKeys.flatMap((fk) => fk.foreignColumns)),
      ...keys.flatMap((key) => {
        const parent = shapeOf.get(key.parent)?.entry.table;
        const columns = parent === undefined ? {} : getTableColumns(parent);
        return key.parentFields.flatMap((field) => {
          const column = Object.entries(columns).find(([name]) => name === field)?.[1];
          return column === undefined ? [] : [column];
        });
      }),
    ]);

    const keysOfChild = Map.groupBy(keys, (key) => key.child);
    const tables = shapes.map((shape): ModelTable => {
      const { entry, config, columns, uniques } = shape;
      const columnOf = new Map(columns);
      function required(keys: readonly string[]) {
        return keys.every((key) => columnOf.get(key)?.notNull === true);
      }
      function oneToOne(keys: readonly string[]) {
        return uniques.some((set) => sameSet(set, keys));
      }
      // The `one` relation of this model that names a key: `author` for `authorId`.
      function nameOfKey(
        fromFields: readonly string[],
        toModel: string,
        toFields: readonly string[],
      ) {
        return links.find(
          (link) =>
            link.owner === entry.name &&
            link.kind === "one" &&
            link.through === null &&
            link.target === toModel &&
            sameKey(link.from, fromFields) &&
            sameKey(link.to, toFields),
        )?.name;
      }
      const enforced = config.foreignKeys.flatMap((fk): ForeignKey[] => {
        const toModel = nameOf.get(fk.foreignTable);
        if (toModel === undefined) return [];
        const fromFields = fields(fk.columns, entry.table);
        const toFields = fields(fk.foreignColumns, fk.foreignTable);
        return [
          {
            field: nameOfKey(fromFields, toModel, toFields) ?? fromFields[0] ?? "",
            fromFields,
            toModel,
            toFields,
            required: required(fromFields),
            oneToOne: oneToOne(fromFields),
            self: toModel === entry.name,
            enforced: true,
          },
        ];
      });
      const enforcedTo = Map.groupBy(enforced, (fk) => fk.toModel);
      const logical = (keysOfChild.get(entry.name) ?? [])
        .filter(
          (key) =>
            !(enforcedTo.get(key.parent) ?? []).some((fk) =>
              sameKey(fk.fromFields, key.childFields),
            ),
        )
        .map((key): ForeignKey => ({
          field:
            nameOfKey(key.childFields, key.parent, key.parentFields) ?? key.childFields[0] ?? "",
          fromFields: key.childFields,
          toModel: key.parent,
          toFields: key.parentFields,
          required: required(key.childFields),
          oneToOne: oneToOne(key.childFields),
          self: key.parent === entry.name,
          enforced: false,
        }));
      const keyed = new Set(primaryColumnsOf(columns));
      const seedColumns = columns.flatMap(([field, column]) => {
        // A generated column is the database's. A SQL default the database fills, unless the
        // column is a key or something points at it, or it is a date or a uuid worth spreading.
        if (column.generated !== undefined) return [];
        const made = makeColumn(field, column, keyed.size === 1);
        const databaseFills =
          made.default?.kind === "sql" &&
          !made.isId &&
          !referenced.has(column) &&
          !["date", "dateString", "uuid"].includes(made.kind);
        return [{ ...made, databaseFills }];
      });
      return {
        name: entry.name,
        table: config.name,
        schema: config.schema,
        columns: seedColumns,
        foreignKeys: [...enforced, ...logical],
        parents: [],
        uniques,
      };
    });

    // The parent side of each key: `posts: r.many.post()` on user, matched to post's key back to
    // user by its columns, which Drizzle has filled in on both sides of the pair.
    const tableByName = new Map(tables.map((table) => [table.name, table] as const));
    const linksByOwner = Map.groupBy(links, (link) => link.owner);
    const withParents = tables.map((table): ModelTable => {
      const parents = (linksByOwner.get(table.name) ?? []).flatMap((link): ParentSide[] => {
        if (link.through !== null) return [];
        const child = tableByName.get(link.target);
        const key = child?.foreignKeys.find(
          (fk) =>
            fk.toModel === table.name &&
            sameKey(fk.fromFields, link.to) &&
            sameKey(fk.toFields, link.from),
        );
        if (child === undefined || key === undefined) return [];
        return [
          { name: link.name, child: child.name, key: key.field, isList: link.kind === "many" },
        ];
      });
      return { ...table, parents };
    });

    return { dialect, tables: withParents };
  });
}

/** A relation as `defineRelations` builds it: on which model, to which, by which fields. */
type Link = {
  readonly owner: string;
  readonly name: string;
  readonly kind: "one" | "many";
  readonly target: string;
  readonly from: readonly string[];
  readonly to: readonly string[];
  /** A many-to-many kept in a junction model: its fields matching `from` and `to`. */
  readonly through: {
    readonly model: string;
    readonly from: readonly string[];
    readonly to: readonly string[];
  } | null;
  /** Written in the schema, not the reverse side Drizzle filled in from the other. */
  readonly declared: boolean;
};

/** A key from a child model's fields to a parent model's, as relations alone may declare it. */
type Key = {
  readonly child: string;
  readonly childFields: readonly string[];
  readonly parent: string;
  readonly parentFields: readonly string[];
};

/**
 * The `defineRelations` and `defineRelationsPart` results a schema module exports, whatever they
 * are named: objects of `{ table, name, relations }` per table.
 */
function relationalConfigs(schema: Readonly<Record<string, unknown>>) {
  return Object.values(schema).filter(
    (value): value is TablesRelationalConfig =>
      typeof value === "object" &&
      value !== null &&
      !is(value, Table) &&
      Object.values(value).length > 0 &&
      Object.values(value).every(
        (entry: unknown) =>
          typeof entry === "object" &&
          entry !== null &&
          "table" in entry &&
          "relations" in entry &&
          is(entry.table, Table) &&
          typeof entry.relations === "object",
      ),
  );
}

// The model a table is exported as; undefined for a view, or a table the module does not export.
function modelNameOf(nameOf: ReadonlyMap<Table, string>, table: unknown) {
  return is(table, Table) ? nameOf.get(table) : undefined;
}

// The property names of a relation's columns, as Drizzle keys them.
function columnKeys(columns: readonly { readonly _: { readonly key: string } }[] | undefined) {
  return (columns ?? []).map((column) => column._.key);
}

/**
 * Every relation the module's relational configs declare, each once: a main config and its parts
 * may name the same table, and their relations are read together.
 */
function relationLinks(
  schema: Readonly<Record<string, unknown>>,
  nameOf: ReadonlyMap<Table, string>,
) {
  const all = relationalConfigs(schema).flatMap((config) =>
    Object.values(config).flatMap((tableConfig) =>
      Object.entries(tableConfig.relations).flatMap(([name, relation]): Link[] => {
        if (!is(relation, Relation)) return [];
        const owner = modelNameOf(nameOf, tableConfig.table);
        const target = modelNameOf(nameOf, relation.targetTable);
        if (owner === undefined || target === undefined) return [];
        const junction = modelNameOf(nameOf, relation.throughTable);
        return [
          {
            owner,
            name,
            kind: is(relation, Many) ? "many" : "one",
            target,
            from: columnKeys(relation.sourceColumns),
            to: columnKeys(relation.targetColumns),
            through:
              junction === undefined || relation.through === undefined
                ? null
                : {
                    model: junction,
                    from: columnKeys(relation.through.source),
                    to: columnKeys(relation.through.target),
                  },
            // Drizzle sets this only on a side it reversed from the other.
            declared: relation.isFilterReversed === undefined,
          },
        ];
      }),
    ),
  );
  // The first link of each owner and name, in the order they came.
  return [...Map.groupBy(all, (link) => JSON.stringify([link.owner, link.name])).values()].flatMap(
    ([first]) => (first === undefined ? [] : [first]),
  );
}

function isKeyLikeName(name: string) {
  const lower = name.toLowerCase();
  return (lower.endsWith("id") && lower !== "id") || lower.endsWith("_id");
}

/**
 * The keys the relations declare, each once. In v2 `from` is not always the side that holds the
 * key (`profile: r.one.profile({ from: r.user.id, to: r.profile.userId })`), so the child is the
 * side a database foreign key starts from; else the target of a `many`, or the source of a `one`
 * a `many` answers; else the side that is not a unique key; else the one with an `...Id` name;
 * else the source of the side written in the schema. A many-to-many is a key from the junction
 * to each end.
 */
function keysOf(
  links: readonly Link[],
  schema: {
    readonly constrained: (
      child: string,
      from: readonly string[],
      parent: string,
      to: readonly string[],
    ) => boolean;
    readonly uniquesOf: (model: string) => readonly (readonly string[])[];
  },
) {
  function keyed(model: string, fields: readonly string[]) {
    return schema.uniquesOf(model).some((set) => sameSet(set, fields));
  }
  function sourceIsChild(link: Link) {
    const { owner, target, from, to } = link;
    if (schema.constrained(owner, from, target, to)) return true;
    if (schema.constrained(target, to, owner, from)) return false;
    if (link.kind === "many") return false;
    const answered = links.some(
      (other) =>
        other.kind === "many" &&
        other.owner === target &&
        other.target === owner &&
        sameKey(other.from, to) &&
        sameKey(other.to, from),
    );
    if (answered) return true;
    const sourceKeyed = keyed(owner, from);
    if (sourceKeyed !== keyed(target, to)) return !sourceKeyed;
    const sourceNamed = from.some(isKeyLikeName);
    if (sourceNamed !== to.some(isKeyLikeName)) return sourceNamed;
    return link.declared;
  }
  const found = links
    .toSorted((a, b) => Number(b.declared) - Number(a.declared))
    .flatMap((link): Key[] => {
      if (link.from.length === 0 || link.to.length === 0) return [];
      if (link.through !== null) {
        return [
          {
            child: link.through.model,
            childFields: link.through.from,
            parent: link.owner,
            parentFields: link.from,
          },
          {
            child: link.through.model,
            childFields: link.through.to,
            parent: link.target,
            parentFields: link.to,
          },
        ];
      }
      return sourceIsChild(link)
        ? [
            {
              child: link.owner,
              childFields: link.from,
              parent: link.target,
              parentFields: link.to,
            },
          ]
        : [
            {
              child: link.target,
              childFields: link.to,
              parent: link.owner,
              parentFields: link.from,
            },
          ];
    });
  // The first key of each child, parent and fields, in the order they came.
  return [
    ...Map.groupBy(found, (key) =>
      JSON.stringify([key.child, key.parent, key.childFields, key.parentFields]),
    ).values(),
  ].flatMap(([first]) => (first === undefined ? [] : [first]));
}

/**
 * The fields of a unique constraint or index, or nothing when one of its parts is not a plain
 * column (an expression): such an index says nothing the seeder can check.
 */
function indexFields(set: readonly unknown[], columns: readonly (readonly [string, AnyColumn])[]) {
  const found = set.map((part) => {
    if (is(part, SQL)) return null;
    // oxlint-disable-next-line custom/no-lookup-in-loop -- an index has a few parts
    const own = columns.find(([, column]) => column === part);
    if (own !== undefined) return own[0];
    // A PostgreSQL index holds its columns as IndexedColumn, which carries the column's name.
    const name = typeof part === "object" && part !== null && "name" in part ? part.name : null;
    // oxlint-disable-next-line custom/no-lookup-in-loop -- an index has a few parts
    return columns.find(([, column]) => column.name === name)?.[0] ?? null;
  });
  return found.every((field): field is string => field !== null) ? found : [];
}

function primaryColumnsOf(columns: readonly (readonly [string, AnyColumn])[]) {
  return columns.filter(([, column]) => column.primary).map(([field]) => field);
}
