import type { Cardinality, RelationOrigin, SchemaField } from "../types/index.js";
import { diagramSchema } from "./diagram-schema.js";

// The SQL type each Drizzle column builder makes; a builder not listed is its own type.
const SQL_TYPES = {
  serial: "serial",
  smallserial: "smallserial",
  bigserial: "bigserial",
  integer: "integer",
  int: "integer",
  smallint: "smallint",
  bigint: "bigint",
  boolean: "boolean",
  text: "text",
  varchar: "varchar",
  char: "char",
  numeric: "numeric",
  decimal: "decimal",
  real: "real",
  doublePrecision: "double precision",
  json: "json",
  jsonb: "jsonb",
  timestamp: "timestamp",
  timestamptz: "timestamptz",
  date: "date",
  time: "time",
  timetz: "timetz",
  interval: "interval",
  uuid: "uuid",
  blob: "blob",
  bytea: "bytea",
} as const satisfies { readonly [builder: string]: string };

function isListed(builder: string): builder is keyof typeof SQL_TYPES {
  return Object.hasOwn(SQL_TYPES, builder);
}

// The column's SQL type: an enum's own name, `timestamptz` / `timetz` for a column with a time
// zone, or what the builder makes.
function sqlType(field: SchemaField, enums: ReadonlyMap<string, string>) {
  if (field.kind === "enum") return enums.get(field.type) ?? field.type;
  const builder =
    field.withTimezone && (field.type === "timestamp" || field.type === "time")
      ? `${field.type}tz`
      : field.type;
  return isListed(builder) ? SQL_TYPES[builder] : builder;
}

/** One end of a relation, by the names the database knows the table and column by. */
export type SqlRelationEnd = {
  readonly table: string;
  readonly column: string;
  readonly cardinality: Cardinality;
};

/**
 * The schema as the database knows it, for the outputs that name tables and columns as SQL does
 * (DBML, Mermaid): each table and column by its SQL name (a table creator's prefix and
 * `snakeCase.table` applied), its SQL type, whether it is NOT NULL, a key or unique, the
 * indexes, and the relations between the SQL names.
 */
export function sqlSchema(code: readonly string[]) {
  const { models, relations, enums } = diagramSchema(code);
  const enumTypes = new Map(enums.map((e) => [e.name, e.dbName ?? e.name]));
  const tableNames = new Map(models.map((m) => [m.name, m.dbName ?? m.name]));
  const columnNames = new Map(
    models.flatMap((m) => m.fields.map((f) => [`${m.name}.${f.name}`, f.dbName ?? f.name])),
  );
  function columnOf(model: string, field: string) {
    return columnNames.get(`${model}.${field}`) ?? field;
  }

  const tables = models.map((model) => {
    // A key of several columns (or one declared as a constraint) is the table's, not a column's.
    const tableKey = model.primaryKey !== null && !model.fields.some((f) => f.isId);
    const keyColumns = new Set(model.primaryKey ?? []);
    const indexes = [
      ...(tableKey && model.primaryKey !== null
        ? [{ kind: "pk" as const, columns: model.primaryKey, name: null }]
        : []),
      ...(model.indexes ?? []).flatMap((index) =>
        index.type === "id"
          ? []
          : [{ kind: index.type, columns: index.fields, name: index.name ?? null }],
      ),
    ].map((index) => ({ ...index, columns: index.columns.map((c) => columnOf(model.name, c)) }));
    return {
      name: tableNames.get(model.name) ?? model.name,
      note: model.documentation ?? null,
      columns: model.fields.map((field) => ({
        name: field.dbName ?? field.name,
        type: sqlType(field, enumTypes),
        primaryKey: field.isId,
        increment: field.type.includes("serial"),
        // A primary key column is NOT NULL whether or not it says so.
        notNull: field.isRequired || keyColumns.has(field.name),
        unique: field.isUnique ?? false,
        foreignKey: field.isForeignKey,
        note: field.documentation,
      })),
      indexes,
    };
  });

  const sqlRelations = relations.map((r) => ({
    origin: r.origin satisfies RelationOrigin,
    onDelete: r.onDelete,
    onUpdate: r.onUpdate ?? null,
    from: {
      table: tableNames.get(r.from.model) ?? r.from.model,
      column: columnOf(r.from.model, r.from.field),
      cardinality: r.from.cardinality,
    } satisfies SqlRelationEnd,
    to: {
      table: tableNames.get(r.to.model) ?? r.to.model,
      column: columnOf(r.to.model, r.to.field),
      cardinality: r.to.cardinality,
    } satisfies SqlRelationEnd,
  }));

  return { tables, relations: sqlRelations };
}
