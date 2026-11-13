import * as z from "zod";
import type { Cardinality, SchemaEnum, SchemaModel, SchemaRelation } from "../../../types/index.js";

function isMany(cardinality: Cardinality) {
  return cardinality === "many" || cardinality === "zero-many";
}

/** How a relation reads from one of its ends: the near side first. */
function relationKind(near: Cardinality, far: Cardinality) {
  return `${isMany(near) ? "many" : "one"} to ${isMany(far) ? "many" : "one"}`;
}

function columnName(model: SchemaModel, field: string) {
  return model.fields.find((f) => f.name === field)?.dbName ?? field;
}

/** The relations seen from the table that holds the foreign key. */
function referencesOf(name: string, relations: readonly SchemaRelation[]) {
  return relations
    .filter((r) => r.to.model === name)
    .map((r) => ({
      table: r.from.model,
      column: r.to.field,
      otherColumn: r.from.field,
      kind: relationKind(r.to.cardinality, r.from.cardinality),
      origin: r.origin,
      onDelete: r.onDelete,
      onUpdate: r.onUpdate ?? null,
    }));
}

/** The relations seen from the table another one points at. */
function referencedByOf(name: string, relations: readonly SchemaRelation[]) {
  return relations
    .filter((r) => r.from.model === name)
    .map((r) => ({
      table: r.to.model,
      column: r.from.field,
      otherColumn: r.to.field,
      kind: relationKind(r.from.cardinality, r.to.cardinality),
      origin: r.origin,
      onDelete: r.onDelete,
      onUpdate: r.onUpdate ?? null,
    }));
}

/**
 * Drizzle queries to start from on the Query page, written with nothing to fill in: read the
 * rows, count them, and read them through the relational API, with their relations when the
 * table has some. Every one runs as written.
 */
function makeQueries(input: {
  readonly model: SchemaModel;
  readonly relationNames: readonly string[];
}) {
  const t = input.model.name;
  return [
    { name: "Select", description: `Every row of ${t}.`, code: `db.select().from(${t})` },
    { name: "Count", description: `How many rows ${t} has.`, code: `db.$count(${t})` },
    {
      name: "Find many",
      description: `The rows of ${t}, through the relational query API.`,
      code: `db.query.${t}.findMany()`,
    },
    ...(input.relationNames.length === 0
      ? []
      : [
          {
            name: "With relations",
            description: `The rows of ${t} with what they relate to.`,
            code: `db.query.${t}.findMany({ with: { ${input.relationNames.map((name) => `${name}: true`).join(", ")} } })`,
          },
        ]),
  ];
}

const Models = z.array(z.custom<SchemaModel>()).readonly().meta({ description: "The tables" });

export const RelationFields = z
  .array(
    z
      .object({
        table: z
          .string()
          .meta({ description: "The table the relation is declared on", example: "user" }),
        name: z
          .string()
          .meta({ description: "The name `defineRelations` gives it", example: "posts" }),
        target: z.string().meta({ description: "The table it points at", example: "post" }),
      })
      .readonly(),
  )
  .readonly()
  .meta({ description: "The relations `defineRelations` declares, by the names queries use" });

const MakeDocsInput = z
  .object({
    models: Models,
    relations: z
      .array(z.custom<SchemaRelation>())
      .readonly()
      .meta({ description: "The relations between them" }),
    enums: z.array(z.custom<SchemaEnum>()).readonly().meta({ description: "The enums" }),
    relationFields: RelationFields,
  })
  .readonly()
  .meta({ description: "A parsed schema and what its queries are written against" });

/**
 * The documentation of a Drizzle schema: every table with its columns, keys, defaults, indexes
 * and relations in both directions, every enum, each with the comment written above it, and
 * Drizzle queries to start from for every table.
 *
 * @param input - The parsed `models`, `relations` and `enums`, and the `relationFields`
 *   `defineRelations` declares (the names a `with` uses).
 * @returns The documented `tables` and `enums`.
 * @example
 * ```ts
 * makeDocs({
 *   models: [],
 *   relations: [],
 *   enums: [{ name: "role", dbName: null, documentation: null, values: [{ name: "admin", dbName: null }] }],
 *   relationFields: [],
 * });
 * // => { tables: [], enums: [{ name: "role", dbName: "role", description: null, values: ["admin"] }] }
 * ```
 */
export function makeDocs(input: z.infer<typeof MakeDocsInput>) {
  const { models, relations, enums } = input;
  const tables = models.map((model) => {
    const primaryKey = new Set(model.primaryKey ?? []);
    return {
      name: model.name,
      dbName: model.dbName ?? model.name,
      description: model.documentation ?? null,
      columns: model.fields.map((field) => {
        const reference = relations.find(
          (r) => r.to.model === model.name && r.to.field === field.name,
        );
        return {
          name: field.name,
          dbName: columnName(model, field.name),
          type: field.type,
          nullable: !field.isRequired,
          primaryKey: field.isId || primaryKey.has(field.name),
          unique: field.isUnique ?? false,
          isList: field.isList,
          enumName: field.kind === "enum" ? field.type : null,
          defaults: [...(field.attributes ?? [])],
          description: field.documentation,
          references: reference
            ? { table: reference.from.model, column: reference.from.field }
            : null,
        };
      }),
      indexes: (model.indexes ?? []).map((index) => ({
        type: index.type,
        columns: [...index.fields],
      })),
      references: referencesOf(model.name, relations),
      referencedBy: referencedByOf(model.name, relations),
      queries: makeQueries({
        model,
        relationNames: input.relationFields
          .filter((f) => f.table === model.name)
          .map((f) => f.name),
      }),
    };
  });
  return {
    tables,
    enums: enums.map((e) => ({
      name: e.name,
      dbName: e.dbName ?? e.name,
      description: e.documentation ?? null,
      values: e.values.map((v) => v.name),
    })),
  };
}

const MakeDbTablesInput = z
  .object({ models: Models })
  .readonly()
  .meta({ description: "The tables of a parsed schema" });

/**
 * The tables as the data views read and write them: the database names of the table and its
 * columns, and the columns that identify a row — the primary key, else the unique columns, else
 * every column.
 *
 * @param input - The parsed `models` of the schema.
 * @returns One entry per table: its `name`, database `table`, `columns` and identifying `key`.
 * @example
 * ```ts
 * makeDbTables({
 *   models: [{ name: "user", dbName: "users", primaryKey: null, fields: [{ name: "id", dbName: null, type: "integer", isRequired: true, isId: true }] }],
 * });
 * // => [{ name: "user", table: "users", columns: [{ name: "id", column: "id", type: "integer", nullable: false }], key: ["id"] }]
 * ```
 */
export function makeDbTables(input: z.infer<typeof MakeDbTablesInput>) {
  return input.models.map((model) => {
    const ids = model.primaryKey ?? model.fields.filter((f) => f.isId).map((f) => f.name);
    const unique = model.fields.filter((f) => f.isUnique).map((f) => f.name);
    const fallback = unique.length > 0 ? unique : model.fields.map((f) => f.name);
    const key = ids.length > 0 ? ids : fallback;
    return {
      name: model.name,
      table: model.dbName ?? model.name,
      columns: model.fields.map((field) => ({
        name: field.name,
        column: columnName(model, field.name),
        type: field.type,
        nullable: !field.isRequired,
      })),
      key: [...key],
    };
  });
}
