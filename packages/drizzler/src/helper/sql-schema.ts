import type { Cardinality, RelationOrigin, SchemaField, SchemaRelation } from "../types/index.js";
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

/** One end of a relation, by the names the database knows the table and columns by. */
type SqlRelationEnd = {
  /** The table, with its schema when it has one of its own: `auth.users`. */
  readonly table: string;
  /** The table's schema, or null for the default one. */
  readonly schema: string | null;
  /** The table without its schema: `users`. */
  readonly bareTable: string;
  /** The column, or the first of a composite key's. */
  readonly column: string;
  /** Every column of the key: one, or several for a composite key. */
  readonly columns: readonly string[];
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
  // A table in a schema of its own (`pgSchema("auth").table("users")`) is `auth.users`, so it is
  // not taken for a `users` table of the default schema.
  const bareNames = new Map(models.map((m) => [m.name, m.dbName ?? m.name]));
  const schemas = new Map(models.map((m) => [m.name, m.schema ?? null]));
  const tableNames = new Map(
    models.map((m) => {
      const bare = m.dbName ?? m.name;
      return [m.name, m.schema === undefined || m.schema === null ? bare : `${m.schema}.${bare}`];
    }),
  );
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
        ? [
            {
              kind: "pk" as const,
              columns: model.primaryKey,
              name: null,
              using: null,
              expression: null,
            },
          ]
        : []),
      ...(model.indexes ?? []).flatMap((index) =>
        index.type === "id"
          ? []
          : [
              {
                kind: index.type,
                columns: index.fields,
                name: index.name ?? null,
                using: index.using ?? null,
                expression: index.expression ?? null,
              },
            ],
      ),
    ].map((index) => ({
      ...index,
      columns: index.columns.map((c) => columnOf(model.name, c)),
      // An index on an expression, each column it reads by its SQL name.
      expression:
        index.expression === null
          ? null
          : index.expression
              .map((part) => (typeof part === "string" ? part : columnOf(model.name, part.field)))
              .join(""),
    }));
    return {
      name: tableNames.get(model.name) ?? model.name,
      schema: model.schema ?? null,
      bareName: bareNames.get(model.name) ?? model.name,
      note: model.documentation ?? null,
      columns: model.fields.map((field) => ({
        name: field.dbName ?? field.name,
        type: sqlType(field, enumTypes),
        primaryKey: field.isId,
        increment: field.type.includes("serial") || field.isIncrement === true,
        // A primary key column is NOT NULL whether or not it says so.
        notNull: field.isRequired || keyColumns.has(field.name),
        unique: field.isUnique ?? false,
        foreignKey: field.isForeignKey,
        note: field.documentation,
      })),
      indexes,
    };
  });

  function sqlEnd(end: SchemaRelation["from"]): SqlRelationEnd {
    return {
      table: tableNames.get(end.model) ?? end.model,
      schema: schemas.get(end.model) ?? null,
      bareTable: bareNames.get(end.model) ?? end.model,
      column: columnOf(end.model, end.field),
      columns: (end.fields ?? [end.field]).map((field) => columnOf(end.model, field)),
      cardinality: end.cardinality,
    };
  }

  const sqlRelations = relations.map((r) => ({
    origin: r.origin satisfies RelationOrigin,
    onDelete: r.onDelete,
    onUpdate: r.onUpdate ?? null,
    constraintName: r.constraintName ?? null,
    from: sqlEnd(r.from),
    to: sqlEnd(r.to),
  }));

  return { tables, relations: sqlRelations };
}
