// The schema as the diagram canvas draws it, and the React Flow nodes and edges it is drawn with.
// Kept here, not in src/types, so the library and the server never reach for React Flow.
import type { Edge, Node } from "@xyflow/react";
import type { z } from "@hono/zod-openapi";
import type { CanvasSchemaSchema } from "../../../server/routes/index.js";
import type { SchemaEnum, SchemaField, SchemaModel } from "../../../../types/index.js";

/** The schema as `POST /diagram/schema` answers it: each table also knows the lines it is declared on. */
export type CanvasSchema = z.infer<typeof CanvasSchemaSchema>;

/**
 * The tables a query touches, by exported name, each with the columns it names; null leaves every
 * card as it is.
 */
export type SchemaHighlight = ReadonlyMap<string, ReadonlySet<string>>;

/** What a card shows of a query: dimmed when the query leaves it alone, its named columns marked. */
export type ModelHighlight = {
  readonly dim: boolean;
  readonly used: ReadonlySet<string>;
};

export type ModelNodeType = Node<
  {
    readonly model: SchemaModel;
    readonly fields: readonly SchemaField[];
    readonly highlight: ModelHighlight | null;
  },
  "model"
>;

export type EnumNodeType = Node<{ readonly value: SchemaEnum }, "enum">;

export type DiagramNodeType = ModelNodeType | EnumNodeType;

export type RelationEdgeType = Edge<
  {
    /** The caption lines, as the exported diagram writes them; empty for an enum link. */
    readonly caption: readonly string[];
    readonly dimmed?: boolean;
  },
  "relation"
>;
