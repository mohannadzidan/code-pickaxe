import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyNodeChanges,
  Background,
  Controls,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
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
  const focusedNodes = useGraphStore(selectFocusedNodes);
  const availableCommands = useCommands('graph');
  const simulationRef = useRef(services.simulationService);

  // Positions live only in a ref — never in React state — so simulation ticks
  // don't trigger re-renders. ReactFlow's own useNodesState owns the rendered
  // positions; we push updates into it selectively.
  const positionsRef = useRef<Record<string, { x: number; y: number }>>({});

  const nearestVisibleParent = useCallback((nodeId: string): string | null => {
    const node = graphNodes[nodeId];
    if (!node) return null;
    if (!node.hidden) return node.id;
    if (!node.parentId) return null;
    return nearestVisibleParent(node.parentId);
  }, [graphNodes]);

  // Build a ReactFlow node from a domain node, reading position from the ref.
  const buildNode = useCallback((node: (typeof graphNodes)[string]): Node<FileNodeData> => ({
    id: node.id,
    type: 'file',
    position: positionsRef.current[node.id] ?? { x: 0, y: 0 },
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
  }), [selectedEntityId, onRevealInExplorer]);

  // ReactFlow owns the rendered node list. We update it on topology/selection
  // changes and on simulation ticks — but those are two separate code paths so
  // ReactFlow never loses drag/hover state during a tick.
  const [rfNodes, setRfNodes] = useNodesState<FileNodeData>([]);

  const edges: Edge[] = useMemo(
    () =>
      Object.values(graphEdges).map((edge) => ({
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
      })),
    [graphEdges, nearestVisibleParent]
  );

  const closeMenu = useCallback(() => setMenu(null), []);

  // Rebuild ReactFlow nodes when domain topology or selection changes.
  // Seed positions for newly visible nodes that have no position yet;
  // previously visible nodes reuse their last known position from the ref.
  useEffect(() => {
    const visibleDomainNodes = Object.values(graphNodes).filter((n) => !n.hidden);

    // Seed any node that has no position yet
    for (const node of visibleDomainNodes) {
      if (positionsRef.current[node.id]) continue;
      const parentPos = node.parentId ? positionsRef.current[node.parentId] : undefined;
      if (parentPos) {
        const angle = Math.random() * 2 * Math.PI;
        const radius = 100;
        positionsRef.current[node.id] = {
          x: parentPos.x + Math.cos(angle) * radius,
          y: parentPos.y + Math.sin(angle) * radius,
        };
      } else {
        positionsRef.current[node.id] = { x: 0, y: 0 };
      }
    }

    setRfNodes(visibleDomainNodes.map(buildNode));
  }, [graphNodes, buildNode, setRfNodes]);

  // Wire simulation: ticks push position updates into rfNodes without
  // rebuilding data fields, so ReactFlow keeps internal drag/hover state.
  useEffect(() => {
    simulationRef.current.init((nextPositions) => {
      // Update ref first so drag callbacks always read current positions
      Object.assign(positionsRef.current, nextPositions);
      // Patch only the position field on each node — leaves data/style untouched
      setRfNodes((nds) =>
        nds.map((n) => {
          const p = nextPositions[n.id];
          return p ? { ...n, position: p } : n;
        })
      );
    });

    return () => {
      simulationRef.current.stop();
    };
  }, [setRfNodes]);

  // Sync topology to the simulation. positionsRef is read via ref so this effect
  // only fires on real topology changes, never on position ticks.
  useEffect(() => {
    const visibleSimNodes = Object.values(graphNodes)
      .filter((node) => !node.hidden)
      .map((node) => ({
        id: node.id,
        x: positionsRef.current[node.id]?.x ?? 0,
        y: positionsRef.current[node.id]?.y ?? 0,
      }));
    const visibleNodeIds = new Set(visibleSimNodes.map((n) => n.id));
    simulationRef.current.syncGraph(
      visibleSimNodes,
      edges
        .filter((e) => visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target))
        .map((edge) => ({ source: edge.source, target: edge.target }))
    );
  }, [graphNodes, edges]);

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
    positionsRef.current[node.id] = node.position;
    simulationRef.current.dragNode(node.id, node.position);
  }, []);

  const onNodeDragStop = useCallback((_event: React.MouseEvent, node: Node) => {
    positionsRef.current[node.id] = node.position;
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
        nodes={rfNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeContextMenu={onNodeContextMenu}
        onPaneClick={closeMenu}
        onNodeClick={closeMenu}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onNodesChange={(changes) => {
          // Let ReactFlow apply all changes (select, dimensions, drag position, etc.)
          // so its internal state stays consistent — this is what keeps dragging smooth.
          setRfNodes((nds) => applyNodeChanges(changes, nds) as Node<FileNodeData>[]);
          // Mirror drag positions back into the ref so the simulation reads them.
          for (const c of changes) {
            if (c.type === 'position' && c.position) {
              positionsRef.current[c.id] = c.position;
            }
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
