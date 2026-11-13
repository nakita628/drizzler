import * as z from "zod";
import type { SchemaEnum, SchemaModel, SchemaRelation } from "../../../types/index.js";
import { makePosition } from "./parse.js";

const MakeCanvasSchemaInput = z
  .object({
    source: z
      .string()
      .meta({ description: "The whole schema file, imports included, as the editor numbers it" }),
    models: z.array(z.custom<SchemaModel>()).readonly().meta({ description: "The tables" }),
    relations: z
      .array(z.custom<SchemaRelation>())
      .readonly()
      .meta({ description: "The relations between them" }),
    enums: z.array(z.custom<SchemaEnum>()).readonly().meta({ description: "The enums" }),
    spans: z
      .array(
        z
          .object({
            name: z.string().meta({ description: "The table's exported name", example: "user" }),
            start: z.number().meta({ description: "The offset of its `export` keyword" }),
            end: z.number().meta({ description: "The offset just past its statement" }),
          })
          .readonly(),
      )
      .readonly()
      .meta({ description: "Where each table is declared in the source" }),
  })
  .readonly()
  .meta({ description: "A parsed schema and where its tables sit in the file" });

/**
 * The schema as the diagram canvas draws it: the cards and edges of the parsed schema, each
 * relation keyed for its edge, and each table with the lines it is declared on, so the editor
 * can say which card the cursor is in.
 *
 * @param input - The parsed `models`, `relations` and `enums`, the `source` they came from, and
 *   the `spans` where each table is declared in it.
 * @returns The `models` (each with its `lines`), the `relations` (each with an `id`) and the `enums`.
 * @example
 * ```ts
 * makeCanvasSchema({ source: "", models: [], relations: [], enums: [], spans: [] });
 * // => { models: [], relations: [], enums: [] }
 * ```
 */
export function makeCanvasSchema(input: z.infer<typeof MakeCanvasSchemaInput>) {
  const { source, models, relations, enums } = input;
  const lines = new Map(
    input.spans.map(({ name, start, end }) => [
      name,
      {
        start: makePosition({ source, offset: start }).line,
        end: makePosition({ source, offset: end }).line,
      },
    ]),
  );
  return {
    models: models.map((model) => ({
      name: model.name,
      dbName: model.dbName,
      documentation: model.documentation ?? null,
      primaryKey: model.primaryKey === null ? null : [...model.primaryKey],
      fields: model.fields.map((field) => ({
        name: field.name,
        dbName: field.dbName ?? null,
        kind: field.kind === "enum" ? ("enum" as const) : ("scalar" as const),
        type: field.type,
        isList: field.isList,
        isRequired: field.isRequired,
        isId: field.isId,
        isUnique: field.isUnique ?? false,
        isForeignKey: field.isForeignKey,
        documentation: field.documentation,
        attributes: [...(field.attributes ?? [])],
      })),
      indexes: (model.indexes ?? []).map((index) => ({
        type: index.type,
        fields: [...index.fields],
      })),
      lines: lines.get(model.name) ?? { start: 1, end: 1 },
    })),
    relations: relations.map((relation) => ({
      id: `${relation.from.model}.${relation.from.field}->${relation.to.model}.${relation.to.field}`,
      origin: relation.origin,
      name: relation.name ?? null,
      onDelete: relation.onDelete,
      onUpdate: relation.onUpdate ?? null,
      from: { ...relation.from },
      to: { ...relation.to },
    })),
    enums: enums.map((value) => ({
      name: value.name,
      dbName: value.dbName,
      documentation: value.documentation ?? null,
      values: value.values.map((v) => ({ name: v.name, dbName: v.dbName })),
    })),
  };
}
