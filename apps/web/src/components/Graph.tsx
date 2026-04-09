import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type EdgeTypes,
  type Node,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { trpc } from "@/utils/trpc";
import type { CodeDefinition } from "@api/parsing/types";
import FileNode, { type FileNodeData } from "./FileNode";
import FloatingEdge from "./FloatingEdge";
import ContextMenu from "./ContextMenu";
import CodePane from "./CodePane";
import {
  useGraphStore,
  selectExplodedIds,
  selectGraphData,
  selectHiddenIds,
  selectLayoutDirection,
  selectNodePositions,
} from "@/features/graph/store/graphStore";
import { selectSelectedEntityId, useSelectionStore } from "@/features/selection/store/selectionStore";
import { selectPaneWidth, useUiStore } from "@/shared/store/uiStore";
import { services } from "@/app/bootstrap";
import { loadGraph } from "@/orchestrators/loadGraph";
import { selectEntity } from "@/orchestrators/selectEntity";
import { navigateToEdgeSource } from "@/orchestrators/navigateToEdgeSource";

const nodeTypes: NodeTypes = { file: FileNode };
const edgeTypes: EdgeTypes = { floating: FloatingEdge };

type MenuState = {
  nodeId: string;
  top: number | false;
  left: number | false;
  right: number | false;
  bottom: number | false;
};

function LayoutFlow() {
  const graphData = useGraphStore(selectGraphData);
  const hiddenIds = useGraphStore(selectHiddenIds);
  const explodedIds = useGraphStore(selectExplodedIds);
  const visualGraph = useMemo(
    () => services.graphProjectionService.buildVisualGraph(graphData, explodedIds, hiddenIds),
    [graphData, explodedIds, hiddenIds]
  );
  const positions = useGraphStore(selectNodePositions);
  const selectedEntityId = useSelectionStore(selectSelectedEntityId);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const flowRef = useRef<HTMLDivElement>(null);

  const explodeEntity = useGraphStore((s) => s.explodeEntity);
  const collapseEntity = useGraphStore((s) => s.collapseEntity);
  const hideEntity = useGraphStore((s) => s.hideEntity);
  const setNodePosition = useGraphStore((s) => s.setNodePosition);
  const graph = useGraphStore((s) => s.graph);
  const setNodePositions = useGraphStore((s) => s.setNodePositions);
  const simulationRef = useRef(services.simulationService);

  const nodes: Node<FileNodeData>[] = visualGraph.nodes.map((node) => ({
    id: node.id,
    type: "file",
    position: positions[node.id] ?? { x: 0, y: 0 },
    data: {
      id: node.id,
      label: node.label,
      kind: node.kind,
      subKind: node.subKind,
      filePath: node.filePath,
      isExternal: node.isExternal,
      isSelected: node.id === selectedEntityId,
      onSelectNode: (entityId: string) => selectEntity(entityId),
    },
    style: { width: "auto", height: 36 },
  }));

  const edges: Edge[] = visualGraph.edges.map((edge) => {
    if (edge.isOriginEdge) {
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: "straight",
        style: { stroke: "#94a3b8", strokeWidth: 1, strokeDasharray: "6 4", opacity: 0.75 },
        selectable: false,
      };
    }

    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: "floating",
      markerEnd: { type: MarkerType.ArrowClosed, color: "#94a3b8", width: 14, height: 14 },
      style: { stroke: "#94a3b8", strokeWidth: 1.5 },
      label: edge.label,
      data: {
        firstUsageLoc: edge.firstUsageLoc,
        onNavigateTo: (location: CodeDefinition) => navigateToEdgeSource(location),
      },
    };
  });

  const closeMenu = useCallback(() => setMenu(null), []);

  useEffect(() => {
    simulationRef.current.init((nextPositions) => {
      setNodePositions(nextPositions);
    });

    return () => {
      simulationRef.current.stop();
    };
  }, [setNodePositions]);

  useEffect(() => {
    const positionsSnapshot = useGraphStore.getState().nodePositions;
    simulationRef.current.syncGraph(
      visualGraph.nodes.map((node) => ({
        id: node.id,
        x: positionsSnapshot[node.id]?.x ?? 0,
        y: positionsSnapshot[node.id]?.y ?? 0,
      })),
      visualGraph.topLinks
    );
  }, [visualGraph]);

  const onNodeContextMenu = useCallback((event: React.MouseEvent, node: Node) => {
    event.preventDefault();
    const pane = flowRef.current?.getBoundingClientRect();
    if (!pane) return;

    setMenu({
      nodeId: node.id,
      top: event.clientY < pane.height - 160 ? event.clientY - pane.top : false,
      left: event.clientX < pane.width - 170 ? event.clientX - pane.left : false,
      right: event.clientX >= pane.width - 170 ? pane.width - (event.clientX - pane.left) : false,
      bottom: event.clientY >= pane.height - 160 ? pane.height - (event.clientY - pane.top) : false,
    });
  }, []);

  const onNodeDrag = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      simulationRef.current.dragNode(node.id, node.position);
      setNodePosition(node.id, node.position);
    },
    [setNodePosition]
  );

  const onNodeDragStop = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      simulationRef.current.releaseNode(node.id, node.position);
      simulationRef.current.reheat(0.5);
    },
    []
  );

  const onReheat = useCallback(() => {
    simulationRef.current.reheat(0.8);
  }, []);

  const menuEntity = menu && graph ? graph.entities[menu.nodeId] : null;

  return (
    <div ref={flowRef} style={{ width: "100%", height: "100%" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeContextMenu={onNodeContextMenu}
        onPaneClick={closeMenu}
        onNodeClick={closeMenu}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        nodesConnectable={false}
        fitView
      >
        <Background color="#e8edf2" gap={24} />
        <Controls />
        <MiniMap zoomable pannable />

        <Panel position="top-right">
          <LayoutButtons onReheat={onReheat} />
        </Panel>

        {menu && (
          <ContextMenu
            {...menu}
            canExplode={menuEntity?.canExplode ?? false}
            isExploded={explodedIds.has(menu.nodeId)}
            onExplode={explodeEntity}
            onCollapse={collapseEntity}
            onHide={hideEntity}
            onClose={closeMenu}
          />
        )}
      </ReactFlow>
    </div>
  );
}

type LayoutButtonsProps = {
  onReheat: () => void;
};

function LayoutButtons({ onReheat }: LayoutButtonsProps) {
  const direction = useGraphStore(selectLayoutDirection);
  const setLayoutDirection = useGraphStore((s) => s.setLayoutDirection);

  return (
    <div style={{ display: "flex", gap: 6 }}>
      <button
        style={{
          background: "#fff",
          border: `1px solid ${direction === "TB" ? "#94a3b8" : "#e2e8f0"}`,
          borderRadius: 6,
          padding: "5px 12px",
          cursor: "pointer",
        }}
        onClick={() => setLayoutDirection("TB")}
      >
        Vertical Layout
      </button>
      <button
        style={{
          background: "#fff",
          border: `1px solid ${direction === "LR" ? "#94a3b8" : "#e2e8f0"}`,
          borderRadius: 6,
          padding: "5px 12px",
          cursor: "pointer",
        }}
        onClick={() => setLayoutDirection("LR")}
      >
        Horizontal Layout
      </button>
      <button
        style={{
          background: "#fff",
          border: "1px solid #e2e8f0",
          borderRadius: 6,
          padding: "5px 12px",
          cursor: "pointer",
        }}
        onClick={onReheat}
      >
        Reheat
      </button>
    </div>
  );
}

export default function Graph() {
  const query = trpc.graph.get.useQuery();
  const paneWidth = useUiStore(selectPaneWidth);
  const setPaneWidth = useUiStore((s) => s.setPaneWidth);
  const isDraggingDivider = useRef(false);

  useEffect(() => {
    if (query.data) {
      loadGraph(query.data);
    }
  }, [query.data]);

  const onDividerMouseDown = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      isDraggingDivider.current = true;

      const onMove = (mouseEvent: MouseEvent) => {
        if (!isDraggingDivider.current) return;
        setPaneWidth((mouseEvent.clientX / window.innerWidth) * 100);
      };

      const onUp = () => {
        isDraggingDivider.current = false;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [setPaneWidth]
  );

  if (query.isLoading) {
    return <div className="flex items-center justify-center w-screen h-screen bg-slate-100 text-slate-500 text-base">Parsing…</div>;
  }

  if (query.error) {
    return (
      <div className="flex flex-col items-center justify-center w-screen h-screen bg-slate-100 text-red-500 gap-3">
        <span className="text-lg font-semibold">Parse error</span>
        <pre className="text-sm text-slate-500 max-w-xl text-center whitespace-pre-wrap">{query.error.message}</pre>
      </div>
    );
  }

  if (!query.data) return null;

  return (
    <div style={{ display: "flex", width: "100vw", height: "100vh", background: "#0f172a", overflow: "hidden" }}>
      <div style={{ width: `${paneWidth}%`, height: "100%", flexShrink: 0, background: "#f1f5f9" }}>
        <ReactFlowProvider>
          <LayoutFlow />
        </ReactFlowProvider>
      </div>
      <div
        onMouseDown={onDividerMouseDown}
        style={{
          width: 4,
          height: "100%",
          flexShrink: 0,
          background: "#1e293b",
          cursor: "col-resize",
          transition: "background 0.1s",
        }}
        onMouseEnter={(event) => (event.currentTarget.style.background = "#334155")}
        onMouseLeave={(event) => (event.currentTarget.style.background = "#1e293b")}
      />
      <div style={{ flex: 1, height: "100%", overflow: "hidden" }}>
        <CodePane />
      </div>
    </div>
  );
}
