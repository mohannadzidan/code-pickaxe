import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type EdgeTypes,
  type Node,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { trpc } from '@/utils/trpc';
import type { CodeDefinition } from '@api/parsing/types';
import FileNode, { type FileNodeData } from './FileNode';
import FloatingEdge from './FloatingEdge';
import ContextMenu from './ContextMenu';
import type { ContextMenuAction } from './ContextMenu';
import CodePane from './CodePane';
import FileExplorer from './FileExplorer';
import { useGraphStore, selectGraphData, selectEdges, selectNodes, selectFocusedNodes } from '@/features/graph/store/graphStore';
import { selectSelectedEntityId, useSelectionStore } from '@/features/selection/store/selectionStore';
import { selectExplorerPaneWidth, selectPaneWidth, useUiStore } from '@/shared/store/uiStore';
import { services } from '@/app/bootstrap';
import { loadGraph } from '@/orchestrators/loadGraph';
import { selectEntity } from '@/orchestrators/selectEntity';
import { navigateToEdgeSource } from '@/orchestrators/navigateToEdgeSource';
import SettingsPopup from './SettingsPopup';
import { Crosshair } from 'lucide-react';
import { useCommands } from '@/features/commands/useCommands';
import { NodePositions } from '@/shared/types/domain';

const nodeTypes: NodeTypes = { file: FileNode };
const edgeTypes: EdgeTypes = { floating: FloatingEdge };

type MenuState = {
  nodeId: string;
  top: number | false;
  left: number | false;
  right: number | false;
  bottom: number | false;
};

type LayoutFlowProps = {
  onRevealInExplorer: (nodeId: string) => void;
  onOpenSettings: () => void;
};

function LayoutFlow({ onRevealInExplorer, onOpenSettings }: LayoutFlowProps) {
  const reactFlow = useReactFlow();
  const graphNodes = useGraphStore(selectNodes);
  const graphEdges = useGraphStore(selectEdges);
  const selectedEntityId = useSelectionStore(selectSelectedEntityId);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const flowRef = useRef<HTMLDivElement>(null);
  const setNodePositions = useGraphStore((s) => s.setNodePositions);
  const focusedNodes = useGraphStore(selectFocusedNodes);
  const availableCommands = useCommands('graph');
  const simulationRef = useRef(services.simulationService);

  const nearestVisibleParent = (nodeId: string): string | null => {
    const node = graphNodes[nodeId];
    if (!node) return null;
    if (!node.hidden) return node.id;
    if (!node.parentId) return null;
    return nearestVisibleParent(node.parentId);
  };

  const nodes: Node<FileNodeData>[] = Object.values(graphNodes).map((node) => ({
    id: node.id,
    type: 'file',
    position: node.position,

    data: {
      ...node,
      modulePath: node.showParentLabel ? node.parentLabel : undefined,
      isSelected: node.id === selectedEntityId,
      onSelectNode: (entityId: string) => {
        selectEntity(entityId);
        onRevealInExplorer(entityId);
      },
    },
    style: { width: 'auto', height: node.showParentLabel ? 48 : 36 },
  }));

  const edges: Edge[] = Object.values(graphEdges).map((edge) => {
    // nearest visible parent
    return {
      id: edge.id,
      source: nearestVisibleParent(edge.source) ?? edge.source,
      target: nearestVisibleParent(edge.target) ?? edge.target,
      type: 'floating',
      markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8', width: 14, height: 14 },
      style: { stroke: '#94a3b8', strokeWidth: 1.5 },
      label: edge.label,
      data: {
        firstUsageLoc: edge.code,
        onNavigateTo: (location: CodeDefinition) => navigateToEdgeSource(location),
      },
    };
  });
  // .filter((a) => a.source && a.target && a.source !== a.target) as Edge[];
  // console.log(edges)

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
    simulationRef.current.syncGraph(
      nodes.map((node) => ({
        id: node.id,
        x: node.position.x,
        y: node.position.y,
      })),
      edges.map((edge) => ({
        source: edge.source,
        target: edge.target,
      }))
    );
  }, [nodes, edges]);

  useEffect(() => {
    if (!selectedEntityId) return;
    reactFlow.fitView({
      nodes: focusedNodes.map((id) => ({ id })),
      padding: 0.35,
      duration: 250,
      maxZoom: 1.2,
    });
  }, [selectedEntityId, reactFlow, focusedNodes]);

  const onNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: Node) => {
      event.preventDefault();
      selectEntity(node.id);
      onRevealInExplorer(node.id);
      const pane = flowRef.current?.getBoundingClientRect();
      if (!pane) return;

      setMenu({
        nodeId: node.id,
        top: event.clientY < pane.height - 160 ? event.clientY - pane.top : false,
        left: event.clientX < pane.width - 170 ? event.clientX - pane.left : false,
        right: event.clientX >= pane.width - 170 ? pane.width - (event.clientX - pane.left) : false,
        bottom: event.clientY >= pane.height - 160 ? pane.height - (event.clientY - pane.top) : false,
      });
    },
    [onRevealInExplorer]
  );

  const onNodeDrag = useCallback((_event: React.MouseEvent, node: Node) => {
    simulationRef.current.dragNode(node.id, node.position);
  }, []);

  const onNodeDragStop = useCallback((_event: React.MouseEvent, node: Node) => {
    simulationRef.current.releaseNode(node.id, node.position);
    simulationRef.current.reheat(0.5);
  }, []);

  const onReheat = useCallback(() => {
    simulationRef.current.reheat(0.8);
  }, []);

  const menuActions = useMemo<ContextMenuAction[]>(() => {
    if (!menu) return [];

    const commandIds = new Set([
      'unpack',
      'pack',
      'hide',
      'isolate',
      'showMoreRelationships',
      'showDependenciesOnly',
      'showDependentsOnly',
    ]);
    const ctx = { activeSurface: 'graph' as const, selectedEntityId: menu.nodeId };

    const actions: ContextMenuAction[] = availableCommands
      .filter((cmd) => commandIds.has(cmd.id))
      .map((cmd) => {
        const Icon = cmd.icon;
        return {
          id: cmd.id,
          label: cmd.title,
          icon: Icon ? <Icon size={13} /> : undefined,
          onSelect: () => cmd.run(ctx),
        };
      });

    actions.push({
      id: 'reveal-explorer',
      label: 'Reveal in explorer',
      icon: <Crosshair size={13} />,
      onSelect: () => onRevealInExplorer(menu.nodeId),
    });

    return actions;
  }, [menu, availableCommands, onRevealInExplorer]);
  // console.log(nodes.filter((node) => !node.data.hidden), edges, graphEdges)
  return (
    <div ref={flowRef} className="w-full h-full">
      <ReactFlow
        nodes={nodes.filter((node) => !node.data.hidden)}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeContextMenu={onNodeContextMenu}
        onPaneClick={closeMenu}
        onNodeClick={closeMenu}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onNodesChange={(changes) => {
          if (changes.some((c) => c.type === 'position')) {
            setNodePositions(
              Object.fromEntries(changes.filter((c) => c.type === 'position').map((a) => [a.id, a.position])) as NodePositions
            );
            console.log(Object.fromEntries(changes.filter((c) => c.type === 'position').map((a) => [a.id, a.position])));
          }
        }}
        nodesConnectable={false}
        fitView
      >
        <Background color="#e8edf2" gap={24} />
        <Controls />
        <MiniMap zoomable pannable />

        <Panel position="top-right">
          <LayoutButtons onReheat={onReheat} onOpenSettings={onOpenSettings} />
        </Panel>

        {menu && <ContextMenu {...menu} actions={menuActions} onClose={closeMenu} />}
      </ReactFlow>
    </div>
  );
}

type LayoutButtonsProps = {
  onReheat: () => void;
  onOpenSettings: () => void;
};

function LayoutButtons({ onReheat, onOpenSettings }: LayoutButtonsProps) {
  return (
    <div className="flex gap-1.5">
      <button className="rounded-md px-3 py-1.5 bg-white border border-[#e2e8f0] cursor-pointer" onClick={onReheat}>
        Reheat
      </button>
      <button className="rounded-md px-3 py-1.5 bg-white border border-[#e2e8f0] cursor-pointer" onClick={onOpenSettings}>
        Settings
      </button>
    </div>
  );
}

export default function Graph() {
  const query = trpc.graph.get.useQuery();
  const explorerPaneWidth = useUiStore(selectExplorerPaneWidth);
  const setExplorerPaneWidth = useUiStore((s) => s.setExplorerPaneWidth);
  const paneWidth = useUiStore(selectPaneWidth);
  const setPaneWidth = useUiStore((s) => s.setPaneWidth);
  const graph = useGraphStore(selectGraphData);
  const graphNodes = useGraphStore(selectNodes);
  const [revealInExplorerRequest, setRevealInExplorerRequest] = useState<{ nodeId: string; token: number } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isGraphViewFocused, setIsGraphViewFocused] = useState(false);
  const isDraggingDivider = useRef(false);
  const isDraggingExplorerDivider = useRef(false);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const graphViewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (query.data) {
      loadGraph(query.data);
    }
  }, [query.data]);

  const onFocusInGraph = useCallback((nodeId: string) => {
    selectEntity(nodeId);
  }, []);

  const onRevealInExplorer = useCallback((nodeId: string) => {
    setRevealInExplorerRequest({ nodeId, token: Date.now() });
  }, []);

  const onDividerMouseDown = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      isDraggingDivider.current = true;

      const onMove = (mouseEvent: MouseEvent) => {
        if (!isDraggingDivider.current) return;
        const workspaceRect = workspaceRef.current?.getBoundingClientRect();
        if (!workspaceRect || workspaceRect.width <= 0) return;
        const relativeX = mouseEvent.clientX - workspaceRect.left;
        setPaneWidth((relativeX / workspaceRect.width) * 100);
      };

      const onUp = () => {
        isDraggingDivider.current = false;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [setPaneWidth]
  );

  const onExplorerDividerMouseDown = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      isDraggingExplorerDivider.current = true;

      const onMove = (mouseEvent: MouseEvent) => {
        if (!isDraggingExplorerDivider.current) return;
        const rootRect = rootRef.current?.getBoundingClientRect();
        if (!rootRect || rootRect.width <= 0) return;
        const relativeX = mouseEvent.clientX - rootRect.left;
        setExplorerPaneWidth((relativeX / rootRect.width) * 100);
      };

      const onUp = () => {
        isDraggingExplorerDivider.current = false;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [setExplorerPaneWidth]
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
    <div ref={rootRef} className="flex w-screen h-screen bg-[#0f172a] overflow-hidden">
      <SettingsPopup open={settingsOpen} onOpenChange={setSettingsOpen} />
      <div style={{ width: `${explorerPaneWidth}%` }} className="h-full shrink-0 min-w-55">
        <FileExplorer graph={graph} graphNodes={graphNodes} onFocusInGraph={onFocusInGraph} revealRequest={revealInExplorerRequest} />
      </div>
      <div
        onMouseDown={onExplorerDividerMouseDown}
        className="w-1 h-full shrink-0 bg-[#1e293b] cursor-col-resize transition-colors duration-100 hover:bg-[#334155]"
      />
      <div ref={workspaceRef} className="flex flex-1 min-w-0 h-full">
        <div
          ref={graphViewportRef}
          tabIndex={0}
          onMouseDown={() => graphViewportRef.current?.focus()}
          onFocusCapture={() => setIsGraphViewFocused(true)}
          onBlurCapture={(event) => {
            if (event.currentTarget.contains(event.relatedTarget as globalThis.Node | null)) return;
            setIsGraphViewFocused(false);
          }}
          style={{
            width: `${paneWidth}%`,
            outline: isGraphViewFocused ? '2px solid #93c5fd' : 'none',
            outlineOffset: -2,
          }}
          className="h-full shrink-0 bg-[#f1f5f9]"
        >
          <ReactFlowProvider>
            <LayoutFlow onRevealInExplorer={onRevealInExplorer} onOpenSettings={() => setSettingsOpen(true)} />
          </ReactFlowProvider>
        </div>
        <div
          onMouseDown={onDividerMouseDown}
          className="w-1 h-full shrink-0 bg-[#1e293b] cursor-col-resize transition-colors duration-100 hover:bg-[#334155]"
        />
        <div className="flex-1 h-full overflow-hidden">
          <CodePane />
        </div>
      </div>
    </div>
  );
}
