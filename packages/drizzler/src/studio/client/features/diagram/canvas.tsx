import { Button, Tooltip, toast } from "@heroui/react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  useStoreApi,
} from "@xyflow/react";
import type { Edge, OnSelectionChangeParams } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LuDownload, LuLayoutGrid } from "react-icons/lu";
import { GRID, PALETTES } from "../../../../constants/index.js";
import { layoutStorageKey, loadLayout, saveLayout } from "../../lib/layout.js";
import { useUiStore } from "../../lib/store.js";
import { EnumNode } from "./enum-node.js";
import { exportPng, exportSvg } from "./export.js";
import { GeometryContext, useDiagramGeometry } from "./geometry.js";
import { buildEdges, buildNodes, highlightEdges, highlightOf } from "./graph.js";
import { autoLayout, positionsFor } from "./layout.js";
import { ModelNode } from "./model-node.js";
import { RelationEdge } from "./relation-edge.js";
import type { CanvasSchema, DiagramNodeType, SchemaHighlight } from "./types.js";

const nodeTypes = { model: ModelNode, enum: EnumNode } as const;
const edgeTypes = { relation: RelationEdge } as const;

// IE (crow's foot) notation, drawn towards the table the end touches: the inner symbol is the
// maximum (a bar for one, the foot for many), the outer one the minimum (a bar for mandatory,
// a circle for optional). The marker box ends where the edge meets the card, at x = 0.
const CROW_FOOT = "M0 -8 L-12 0 L0 8 M-12 0 L0 0";
const MAX_ONE_BAR = "M-6 -6 L-6 6";
const MIN_ONE_BAR = "M-15 -6 L-15 6";

const CARDINALITIES = [
  { cardinality: "one", many: false, optional: false },
  { cardinality: "zero-one", many: false, optional: true },
  { cardinality: "many", many: true, optional: false },
  { cardinality: "zero-many", many: true, optional: true },
] as const;

/** The four end symbols, defined once per canvas; the edges name them by id. */
function RelationMarkers() {
  return (
    <svg className="er-markers" aria-hidden="true">
      <defs>
        {CARDINALITIES.map(({ cardinality, many, optional }) => (
          <marker
            key={cardinality}
            id={`er-${cardinality}`}
            viewBox="-20 -10 20 20"
            refX="0"
            refY="0"
            markerWidth="20"
            markerHeight="20"
            markerUnits="userSpaceOnUse"
            orient="auto-start-reverse"
          >
            <path className="er-symbol" d={many ? CROW_FOOT : MAX_ONE_BAR} />
            {optional ? (
              <circle className="er-symbol er-symbol-open" cx="-16" cy="0" r="3.2" />
            ) : (
              <path className="er-symbol" d={MIN_ONE_BAR} />
            )}
          </marker>
        ))}
      </defs>
    </svg>
  );
}

/**
 * What the cards and edges are built from. The lines a table is declared on are left out: typing
 * above a table moves them, and that is no reason to build the cards again.
 */
function structureOf(schema: CanvasSchema) {
  return JSON.stringify({
    models: schema.models.map(({ lines: _lines, ...model }) => model),
    relations: schema.relations,
    enums: schema.enums,
  });
}

function Canvas({
  schema,
  schemaPath,
  focus,
  highlight,
  touched,
  compact,
}: {
  readonly schema: CanvasSchema;
  readonly schemaPath: string;
  readonly focus: string | null;
  readonly highlight: string | null;
  readonly touched: SchemaHighlight | null;
  readonly compact: boolean;
}) {
  const storageKey = layoutStorageKey(schemaPath);
  const [nodes, setNodes, onNodesChange] = useNodesState<DiagramNodeType>([]);
  const noEdges: Edge[] = [];
  const [edges, setEdges, onEdgesChange] = useEdgesState(noEdges);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const { fitView } = useReactFlow();
  const store = useStoreApi();
  const theme = useUiStore((s) => s.theme);

  // A redraw while typing brings a new schema object every time; the cards are built again only
  // when the tables, relations or enums changed, and they keep where they were put.
  const structure = useMemo(() => `${storageKey}\n${structureOf(schema)}`, [schema, storageKey]);
  const built = useRef<string | null>(null);
  useEffect(() => {
    if (built.current === structure) return;
    built.current = structure;
    const positions = positionsFor(schema, loadLayout(storageKey));
    setNodes([...buildNodes(schema, positions, touched)]);
    setEdges([...buildEdges(schema)]);
  }, [schema, structure, storageKey, setNodes, setEdges, touched]);

  // A query's highlight is painted onto the cards there are, so drawing one never moves a card
  // someone dragged into place.
  useEffect(() => {
    setNodes((current) =>
      current.map((node) =>
        node.type === "model"
          ? { ...node, data: { ...node.data, highlight: highlightOf(touched, node.data.model) } }
          : node,
      ),
    );
  }, [touched, setNodes]);

  useEffect(() => {
    if (focus === null || nodes.length === 0) return undefined;
    const timer = setTimeout(() => {
      fitView({ nodes: [{ id: focus }], duration: 500, maxZoom: 1.1, padding: 0.4 }).catch(() => {
        // The card can be gone between renders when the schema changes; nothing to focus.
      });
    }, 50);
    return () => clearTimeout(timer);
  }, [focus, nodes.length, fitView]);

  // Selecting through the store replays the change through onNodesChange / onSelectionChange,
  // exactly as a click would.
  useEffect(() => {
    store.getState().addSelectedNodes(highlight === null ? [] : [highlight]);
  }, [highlight, store, nodes.length]);

  const persist = useCallback(
    (list: readonly DiagramNodeType[]) => {
      saveLayout(storageKey, Object.fromEntries(list.map((n) => [n.id, n.position])));
    },
    [storageKey],
  );

  const relayout = useCallback(() => {
    const positions = autoLayout(schema);
    const next = nodes.map((n) => ({ ...n, position: positions[n.id] ?? n.position }));
    setNodes(next);
    persist(next);
    setTimeout(() => {
      fitView({ duration: 400, padding: 0.1 }).catch(() => {
        // Nothing to fit yet.
      });
    }, 30);
  }, [schema, nodes, setNodes, persist, fitView]);

  const onSelectionChange = useCallback((params: OnSelectionChangeParams) => {
    setSelected(params.nodes.map((n) => n.id));
  }, []);

  // The export draws the cards where they are on the canvas, in the current theme.
  const diagram = useCallback(
    () => ({
      models: schema.models,
      relations: schema.relations,
      enums: schema.enums,
      positions: Object.fromEntries(nodes.map((n) => [n.id, n.position])),
      theme,
    }),
    [schema, nodes, theme],
  );
  const [exporting, setExporting] = useState(false);
  const onExportPng = useCallback(() => {
    setExporting(true);
    exportPng("schema.png", diagram())
      .catch(() => toast.danger("The diagram could not be exported."))
      .finally(() => setExporting(false));
  }, [diagram]);
  const onExportSvg = useCallback(() => {
    exportSvg("schema.svg", diagram());
  }, [diagram]);

  const styledEdges = useMemo(() => highlightEdges(edges, selected), [edges, selected]);
  // Routed once for the whole canvas: an edge cannot place its caption clear of the others
  // without knowing where they went.
  const geometry = useDiagramGeometry(edges);

  return (
    <div className="relative min-h-0 flex-1">
      <RelationMarkers />
      <GeometryContext value={geometry}>
        <ReactFlow
          nodes={nodes}
          edges={styledEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDragStop={() => persist(nodes)}
          onSelectionChange={onSelectionChange}
          nodesConnectable={false}
          fitView
          fitViewOptions={{ padding: 0.1 }}
          minZoom={0.1}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          colorMode={theme}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={GRID}
            size={1.2}
            color={PALETTES[theme].dots}
          />
          <Controls showInteractive={false} position="bottom-left" />
          {compact ? null : (
            <MiniMap
              pannable
              zoomable
              position="bottom-right"
              nodeColor={theme === "dark" ? "#3b415a" : "#c7c9d9"}
            />
          )}
          <Panel position="top-right" className="flex gap-2">
            {compact ? null : (
              <>
                <Tooltip>
                  <Button
                    variant="outline"
                    onPress={onExportPng}
                    isDisabled={exporting || nodes.length === 0}
                  >
                    <LuDownload size={15} />
                    PNG
                  </Button>
                  <Tooltip.Content>Download the diagram as a PNG image</Tooltip.Content>
                </Tooltip>
                <Tooltip>
                  <Button variant="outline" onPress={onExportSvg} isDisabled={nodes.length === 0}>
                    <LuDownload size={15} />
                    SVG
                  </Button>
                  <Tooltip.Content>Download the diagram as an SVG image</Tooltip.Content>
                </Tooltip>
              </>
            )}
            <Button variant="outline" size={compact ? "sm" : "md"} onPress={relayout}>
              <LuLayoutGrid size={15} />
              Auto layout
            </Button>
          </Panel>
        </ReactFlow>
      </GeometryContext>
    </div>
  );
}

/**
 * The ER diagram as cards on a canvas: dragged where you want them and remembered there, laid out
 * again with Auto layout, the relations of a selected card picked out. `compact` is the editor's
 * side panel: no minimap and no export.
 */
export function SchemaCanvas({
  schema,
  schemaPath,
  focus = null,
  highlight = null,
  touched = null,
  compact = false,
}: {
  readonly schema: CanvasSchema;
  /** The schema file the positions are remembered for. */
  readonly schemaPath: string;
  /** A table to bring into view. */
  readonly focus?: string | null;
  /** A table to select, as a click would. */
  readonly highlight?: string | null;
  /** The tables and columns a query touches, to light up; the rest are dimmed. */
  readonly touched?: SchemaHighlight | null;
  readonly compact?: boolean;
}) {
  return (
    <ReactFlowProvider>
      <Canvas
        schema={schema}
        schemaPath={schemaPath}
        focus={focus}
        highlight={highlight}
        touched={touched}
        compact={compact}
      />
    </ReactFlowProvider>
  );
}
