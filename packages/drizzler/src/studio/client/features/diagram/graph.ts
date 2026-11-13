import type { Edge } from "@xyflow/react";

import { MODEL_HANDLE } from "../../../../constants/index.js";
import { edgeCaption } from "../../../../diagram/caption-text.js";
import type { Cardinality, LayoutPositions } from "../../../../types/index.js";
import type { CanvasSchema, DiagramNodeType, ModelHighlight, SchemaHighlight } from "./types.js";
import { diagramFields } from "./layout.js";

/** The id of the handle an edge leaves a field from. */
export function sourceHandle(field: string) {
  return `${field}-source`;
}

/** The id of the handle an edge enters a field at. */
export function targetHandle(field: string) {
  return `${field}-target`;
}

/** A self relation comes back into the right-hand side of the model it left, as a loop. */
export function loopTargetHandle(field: string) {
  return `${field}-loop`;
}

/** What the card of a table shows of a query: nothing while none is drawn, its part otherwise. */
export function highlightOf(
  touched: SchemaHighlight | null,
  model: { readonly name: string },
): ModelHighlight | null {
  if (touched === null) return null;
  const used = touched.get(model.name);
  return used === undefined ? { dim: true, used: new Set() } : { dim: false, used };
}

/** The canvas nodes of a schema: a card per model and per enum, at their positions, with the touched tables lit. */
export function buildNodes(
  schema: CanvasSchema,
  positions: LayoutPositions,
  touched: SchemaHighlight | null = null,
): readonly DiagramNodeType[] {
  return [
    ...schema.models.map<DiagramNodeType>((model) => ({
      id: model.name,
      type: "model",
      position: positions[model.name] ?? { x: 0, y: 0 },
      data: { model, fields: diagramFields(model), highlight: highlightOf(touched, model) },
    })),
    ...schema.enums.map<DiagramNodeType>((value) => ({
      id: value.name,
      type: "enum",
      position: positions[value.name] ?? { x: 0, y: 0 },
      data: { value },
    })),
  ];
}

/** The id of the IE (crow's foot) marker an end is drawn with; React Flow turns it into `url(#id)`. */
function cardinalityMarker(cardinality: Cardinality) {
  return `er-${cardinality}`;
}

/** A dotted link from every enum-typed field to the card that lists the values it may hold. */
function enumEdges(schema: CanvasSchema): readonly Edge[] {
  const names = new Set(schema.enums.map((value) => value.name));
  return schema.models.flatMap((model) =>
    diagramFields(model)
      .filter((field) => field.kind === "enum" && names.has(field.type))
      .map((field) => ({
        id: `${model.name}.${field.name}->${field.type}`,
        source: model.name,
        target: field.type,
        sourceHandle: sourceHandle(field.name),
        targetHandle: targetHandle(MODEL_HANDLE),
        type: "relation",
        className: "enum-edge",
        selectable: false,
        data: { caption: [] },
      })),
  );
}

/** The canvas edges of a schema: one per relation, between the handles of the fields it joins. */
export function buildEdges(schema: CanvasSchema): readonly Edge[] {
  const scalarFields = new Map(
    schema.models.map((m) => [m.name, new Set(diagramFields(m).map((f) => f.name))]),
  );
  function hasField(model: string, field: string) {
    return scalarFields.get(model)?.has(field) ?? false;
  }
  const relations = schema.relations.map((relation) => {
    // An implicit many-to-many has no column at either end to meet, so both of its ends hang off
    // the card header rather than off a field row — as does any relation naming a field the card
    // does not list.
    const useHeader =
      relation.origin === "implicit-many-to-many" ||
      !hasField(relation.from.model, relation.from.field) ||
      !hasField(relation.to.model, relation.to.field);
    const target = useHeader ? MODEL_HANDLE : relation.to.field;
    return {
      id: relation.id,
      source: relation.from.model,
      target: relation.to.model,
      sourceHandle: sourceHandle(useHeader ? MODEL_HANDLE : relation.from.field),
      targetHandle:
        relation.from.model === relation.to.model ? loopTargetHandle(target) : targetHandle(target),
      type: "relation",
      className: `relation-edge relation-edge--${relation.origin}`,
      markerStart: cardinalityMarker(relation.from.cardinality),
      markerEnd: cardinalityMarker(relation.to.cardinality),
      data: { relation, caption: edgeCaption(relation) },
    };
  });
  return [...relations, ...enumEdges(schema)];
}

/** The edges with those touching a selected model brought forward and the rest dimmed. */
export function highlightEdges(edges: readonly Edge[], selected: readonly string[]) {
  const focus = new Set(selected);
  return edges.map((edge) => {
    const touched = focus.has(edge.source) || focus.has(edge.target);
    if (focus.size === 0) return edge;
    return {
      ...edge,
      className: `${edge.className ?? ""}${touched ? " is-highlighted" : " is-dimmed"}`,
      // The caption is drawn outside the edge group, so it is dimmed through its own data.
      data: { ...edge.data, dimmed: !touched },
    };
  });
}
