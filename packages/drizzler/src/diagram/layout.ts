import { graphlib, layout } from "@dagrejs/dagre";

import {
  ENUM_WIDTH,
  GRID,
  NODE_CONSTRAINT_HEIGHT,
  NODE_DESCRIPTION_HEIGHT,
  NODE_HEADER_HEIGHT,
  NODE_PADDING,
  NODE_ROW_HEIGHT,
  NODE_WIDTH,
} from "../constants/index.js";
import type {
  DiagramEnum,
  DiagramField,
  DiagramIndex,
  DiagramModel,
  DiagramSchema,
  LayoutPositions,
} from "../types/index.js";

/** The fields a model node shows: everything but the relation fields. */
export function diagramFields<Field extends { readonly kind: string }>(model: {
  readonly fields: readonly Field[];
}) {
  return model.fields.filter((f) => f.kind !== "object");
}

/** The first line of a text, trimmed; empty for none. */
export function firstLine(text: string | null | undefined) {
  return text?.split("\n")[0]?.trim() ?? "";
}

// The notes worth spelling out under a field: its default and how it is generated. The drawing
// shows `.primaryKey()`, `.unique()`, `.notNull()` and `.references()` in its own language already.
const FIELD_NOTE =
  /^\.(?:default|defaultNow|defaultRandom|\$defaultFn|\$onUpdate|generatedAlwaysAs)\(/u;

/**
 * The faint second line of a field row: the notes the drawing does not show another way,
 * then the prose of its doc comment. Empty when the field has neither.
 */
export function fieldDetail(field: DiagramField) {
  const notes = (field.attributes ?? []).filter((attribute) => FIELD_NOTE.test(attribute));
  const documentation = firstLine(field.documentation);
  return [notes.join(" "), documentation].filter((part) => part !== "").join(" · ");
}

/** The height of a field's row on a card: taller when it has a note or description. */
export function fieldRowHeight(field: DiagramField) {
  return NODE_ROW_HEIGHT + (fieldDetail(field) === "" ? 0 : NODE_DESCRIPTION_HEIGHT);
}

// The order a node lists its block attributes in: the key, then what is unique, then the plain
// indexes. Prisma hands them over grouped by kind and keeps no trace of the order they were
// written in, and the group it happens to list first puts `@@index` above `@@unique`.
const CONSTRAINT_ORDER = { id: 0, unique: 1, normal: 2, fulltext: 2 } as const;

/**
 * The block attributes a model node lists under its fields: the key, the unique constraints, then
 * the indexes. Two schemas that declare the same attributes in a different order draw the same
 * node, because the order they were written in does not reach here.
 *
 * Every `@@` attribute gets a row, a single-column `@@unique` included — the row is the attribute,
 * the `UK` beside the field is the column, the same two things `@@id` says with its row and the
 * key beside each of its columns.
 */
export function diagramConstraints(model: { readonly indexes?: readonly DiagramIndex[] }) {
  return (model.indexes ?? []).toSorted(
    (a, b) => CONSTRAINT_ORDER[a.type] - CONSTRAINT_ORDER[b.type],
  );
}

/**
 * Every column a unique constraint covers: its own `@unique`, and each column of a `@@unique` it
 * takes part in — so a composite constraint marks its columns the way a composite key marks its
 * own. Whether the mark is drawn is the node's call; a column of the primary key wears the key.
 */
export function uniqueColumns(model: {
  readonly fields: readonly { readonly name: string; readonly isUnique?: boolean }[];
  readonly indexes?: readonly DiagramIndex[];
}): ReadonlySet<string> {
  return new Set([
    ...model.fields.filter((field) => field.isUnique === true).map((field) => field.name),
    ...(model.indexes ?? [])
      .filter((index) => index.type === "unique")
      .flatMap((index) => index.fields),
  ]);
}

/** The height of a model's card: its header, field rows and constraint rows. */
export function nodeHeight(model: DiagramModel) {
  const constraints = diagramConstraints(model);
  return (
    NODE_HEADER_HEIGHT +
    NODE_PADDING +
    diagramFields(model).reduce((sum, field) => sum + fieldRowHeight(field), 0) +
    NODE_PADDING +
    (constraints.length === 0 ? 0 : constraints.length * NODE_CONSTRAINT_HEIGHT + NODE_PADDING)
  );
}

/** An enum card is the same shape as a model card, one row per member. */
export function enumHeight(value: DiagramEnum) {
  return NODE_HEADER_HEIGHT + NODE_PADDING + value.values.length * NODE_ROW_HEIGHT + NODE_PADDING;
}

/** What dagre leaves on a node once it has laid the graph out. */
function isLaidOut(value: unknown): value is {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
} {
  if (typeof value !== "object" || value === null) return false;
  return ["x", "y", "width", "height"].every((key) => typeof Reflect.get(value, key) === "number");
}

/** The enums a model's fields hold, as edges from the model to the enum card. */
function enumEdges(schema: DiagramSchema) {
  const names = new Set((schema.enums ?? []).map((value) => value.name));
  return schema.models.flatMap((model) =>
    diagramFields(model).flatMap((field) => {
      const type = field.type ?? "";
      return field.kind === "enum" && names.has(type) ? [{ from: model.name, to: type }] : [];
    }),
  );
}

// The gap between ranks carries the edges and their captions. The edges a model sends across it
// run down tracks next to it, and the captions stand in front of the rank they come into, on the
// stretch from each edge's track into its target — two deep where neighbouring rows are nearer
// each other than a chip is tall, so the gap holds the tracks and two chips named and set side by
// side.
const RANK_GAP = GRID * 20;
const NODE_GAP = GRID * 3;
const MARGIN = GRID * 2;

function onGrid(value: number) {
  return Math.round(value / GRID) * GRID;
}

/**
 * Places the blocks left to right along their relations, the way Studio lays a diagram out: on the
 * grid, and flush left in each rank, since every edge comes into its target from the left.
 */
export function autoLayout(schema: DiagramSchema): LayoutPositions {
  const graph = new graphlib.Graph();
  graph.setGraph({
    rankdir: "LR",
    nodesep: NODE_GAP,
    ranksep: RANK_GAP,
    marginx: MARGIN,
    marginy: MARGIN,
  });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const model of schema.models) {
    graph.setNode(model.name, { width: NODE_WIDTH, height: nodeHeight(model) });
  }
  for (const value of schema.enums ?? []) {
    graph.setNode(value.name, { width: ENUM_WIDTH, height: enumHeight(value) });
  }
  const names = new Set([
    ...schema.models.map((m) => m.name),
    ...(schema.enums ?? []).map((e) => e.name),
  ]);
  const edges = [
    ...schema.relations.map((relation) => ({ from: relation.from.model, to: relation.to.model })),
    ...enumEdges(schema),
  ];
  const seen = new Set<string>();
  for (const edge of edges) {
    const key = `${edge.from}->${edge.to}`;
    if (edge.from === edge.to || !names.has(edge.from) || !names.has(edge.to) || seen.has(key)) {
      continue;
    }
    seen.add(key);
    graph.setEdge(edge.from, edge.to);
  }
  layout(graph);
  const placed = [...names].map((name) => {
    const node: unknown = graph.node(name);
    return { name, node: isLaidOut(node) ? node : null };
  });
  const nodes = placed.flatMap(({ node }) => (node === null ? [] : [node]));
  // A rank is the blocks dagre centres on one line; its left edge is its widest block's.
  const rankWidth = new Map(
    [...Map.groupBy(nodes, (node) => node.x)].map(([x, rank]) => [
      x,
      Math.max(...rank.map((node) => node.width)),
    ]),
  );
  return Object.fromEntries(
    placed.map(({ name, node }) => {
      if (node === null) return [name, { x: 0, y: 0 }];
      const { x, y, height } = node;
      const width = rankWidth.get(x) ?? 0;
      return [name, { x: onGrid(x - width / 2), y: onGrid(y - height / 2) }];
    }),
  );
}
