import { Button } from "@heroui/react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import type { Edge, OnSelectionChangeParams } from "@xyflow/react";
import type { InferResponseType } from "hono/client";
import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import type { ComponentProps } from "react";
import { LuLayoutGrid } from "react-icons/lu";

import { PALETTES } from "../../../../constants/index.js";
import type { dbClient } from "../../api/index.js";
import { useUiStore } from "../../lib/store.js";
import { autoLayout } from "./flow-layout.js";
import { FlowNode } from "./flow-node.js";
import type { FlowNodeType } from "./flow-node.js";

const nodeTypes = { flow: FlowNode } as const;

function highlightEdges(edges: readonly Edge[], selected: string | null): Edge[] {
  if (selected === null) return [...edges];
  return edges.map((edge) => {
    const touched = edge.source === selected || edge.target === selected;
    return {
      ...edge,
      className: `${edge.className ?? ""}${touched ? " is-highlighted" : " is-dimmed"}`,
    };
  });
}

function Canvas({
  nodes: graphNodes,
  edges: graphEdges,
  selected,
  onSelect,
}: {
  readonly nodes: InferResponseType<
    typeof dbClient.db.analyze.$post,
    200
  >["statements"][number]["nodes"];
  readonly edges: InferResponseType<
    typeof dbClient.db.analyze.$post,
    200
  >["statements"][number]["edges"];
  readonly selected: string | null;
  readonly onSelect: (id: string | null) => void;
}) {
  const noNodes: FlowNodeType[] = [];
  const noEdges: Edge[] = [];
  const [nodes, setNodes, onNodesChange] = useNodesState(noNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(noEdges);
  const { fitView } = useReactFlow();
  const theme = useUiStore((s) => s.theme);

  // The nodes are rebuilt only when the picture changed: a re-analysis with the same result keeps
  // the positions someone dragged into place.
  const structure = useMemo(
    () => JSON.stringify({ graphNodes, graphEdges }),
    [graphNodes, graphEdges],
  );
  const built = useRef<string | null>(null);
  useEffect(() => {
    if (built.current === structure) return;
    built.current = structure;
    const positions = autoLayout(graphNodes, graphEdges);
    setNodes(
      graphNodes.map((node) => ({
        id: node.id,
        type: "flow",
        position: positions[node.id] ?? { x: 0, y: 0 },
        data: { node },
      })),
    );
    setEdges(
      graphEdges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: "smoothstep",
        className: `flow-edge flow-edge--${edge.kind}`,
        label: edge.label ?? undefined,
        labelBgPadding: [4, 2],
        labelBgBorderRadius: 3,
      })),
    );
    async function fitAll() {
      try {
        await fitView({ padding: 0.15, duration: 300 });
      } catch {
        // Nothing to fit yet.
      }
    }
    setTimeout(() => {
      void fitAll();
    }, 30);
  }, [graphNodes, graphEdges, structure, setNodes, setEdges, fitView]);

  const relayout = useCallback(() => {
    const positions = autoLayout(graphNodes, graphEdges);
    setNodes((current) =>
      current.map((node) => ({ ...node, position: positions[node.id] ?? node.position })),
    );
    async function fitAll() {
      try {
        await fitView({ padding: 0.15, duration: 300 });
      } catch {
        // Nothing to fit yet.
      }
    }
    setTimeout(() => {
      void fitAll();
    }, 30);
  }, [graphNodes, graphEdges, setNodes, fitView]);

  const onSelectionChange = useCallback(
    (params: OnSelectionChangeParams) => {
      onSelect(params.nodes[0]?.id ?? null);
    },
    [onSelect],
  );

  const styledEdges = useMemo(() => highlightEdges(edges, selected), [edges, selected]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={styledEdges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onSelectionChange={onSelectionChange}
      nodesConnectable={false}
      fitView
      fitViewOptions={{ padding: 0.15 }}
      minZoom={0.15}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
      colorMode={theme}
    >
      <Background
        variant={BackgroundVariant.Dots}
        gap={20}
        size={1.2}
        color={PALETTES[theme].dots}
      />
      <Controls showInteractive={false} position="bottom-left" />
      <Panel position="top-right" className="flex gap-2">
        <Button variant="outline" size="sm" className="bg-surface" onPress={relayout}>
          <LuLayoutGrid size={15} />
          Auto layout
        </Button>
      </Panel>
    </ReactFlow>
  );
}

function FlowViewComponent(props: ComponentProps<typeof Canvas>) {
  if (props.nodes.length === 0) {
    return (
      <div className="p-6 text-muted">
        Nothing to draw: type a SELECT, INSERT, UPDATE or DELETE.
      </div>
    );
  }
  return (
    <div className="relative min-h-0 flex-1">
      <ReactFlowProvider>
        <Canvas {...props} />
      </ReactFlowProvider>
    </div>
  );
}

/**
 * The data-flow graph of one statement: sources on the left, the result on the right. Memoized,
 * so typing in the editor above does not redraw the graph of a statement that has not changed.
 */
export const FlowView = memo(FlowViewComponent);
