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
import {
  useGraphStore,
  selectGraphData,
  selectEdges,
  selectLayoutDirection,
  selectNodes,
  selectNodesList,
} from '@/features/graph/store/graphStore';
import { selectSelectedEntityId, useSelectionStore } from '@/features/selection/store/selectionStore';
import { selectExplorerPaneWidth, selectPaneWidth, useUiStore } from '@/shared/store/uiStore';
import { services } from '@/app/bootstrap';
import { loadGraph } from '@/orchestrators/loadGraph';
import { selectEntity } from '@/orchestrators/selectEntity';
import { navigateToEdgeSource } from '@/orchestrators/navigateToEdgeSource';
import { fromFolderNodeId, isModuleInsideFolder } from '@/features/graph/services/folderPath';
import { selectKeyboardShortcuts, shortcutMatchesKeyboardEvent, useKeyboardShortcutStore } from '@/shared/store/keyboardShortcutStore';
import SettingsPopup from './SettingsPopup';
import { Crosshair, EyeOff, PackageOpen, Search, Target } from 'lucide-react';
import { useShallow } from 'zustand/shallow';
import { GraphState } from '@/shared/types/domain';

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
  onIsolate: (nodeId: string) => void;
  onShowDependenciesOnly: (nodeId: string) => void;
  onShowDependentsOnly: (nodeId: string) => void;
  onShowMoreRelationships: (nodeId: string) => void;
  onOpenSettings: () => void;
  focusRequest: { nodeId: string; token: number } | null;
};

const isEntityPacked = (nodes: GraphState['nodes'], entityId: string): boolean => {
  const entity = nodes[entityId];
  if (!entity) return false;
  return nodes[entityId].hidden === false || nodes[entityId].children.every((childId) => nodes[childId]?.hidden === true);
};

function LayoutFlow({
  onRevealInExplorer,
  onIsolate,
  onShowDependenciesOnly,
  onShowDependentsOnly,
  onShowMoreRelationships,
  onOpenSettings,
  focusRequest,
}: LayoutFlowProps) {
  const reactFlow = useReactFlow();
  const graphNodes = useGraphStore(selectNodes);
  const graphEdges = useGraphStore(selectEdges);
  const nodesList = useGraphStore(useShallow(selectNodesList));
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

  const edges: Edge[] = Object.values(graphEdges)
    .map((edge) => {
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
    })
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
    if (!focusRequest) return;
    reactFlow.fitView({
      nodes: [{ id: focusRequest.nodeId }],
      padding: 0.35,
      duration: 250,
      maxZoom: 1.2,
    });
  }, [focusRequest, reactFlow]);

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

  const onNodeDrag = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      simulationRef.current.dragNode(node.id, node.position);
      setNodePosition(node.id, node.position);
    },
    [setNodePosition]
  );

  const onNodeDragStop = useCallback((_event: React.MouseEvent, node: Node) => {
    simulationRef.current.releaseNode(node.id, node.position);
    simulationRef.current.reheat(0.5);
  }, []);

  const onReheat = useCallback(() => {
    simulationRef.current.reheat(0.8);
  }, []);

  const menuNode = useMemo(() => (menu ? (nodesList.find((node) => node.id === menu.nodeId) ?? null) : null), [menu, nodesList]);

  const visibleNodeCount = nodesList.length;

  const menuHasChildren = useMemo(() => {
    if (!menuNode || !graph) return false;

    if (menuNode.kind === 'folder') {
      const folderPath = menuNode.id.slice('folder:'.length);
      return graph.modules.some((moduleId) => isModuleInsideFolder(moduleId, folderPath));
    }

    const entity = graph.entities[menuNode.id];
    return Boolean(entity && entity.children.length > 0);
  }, [graph, menuNode]);

  const menuIsPacked = useMemo(() => {
    if (!menuNode) return false;
    return menuNode.hidden === false || menuNode.children.every((childId) => graphNodes[childId]?.hidden === true);
  }, [graphNodes, menuNode]);

  const menuPackIntoModuleId = useMemo(() => {
    if (!graph || !menuNode || menuNode.kind === 'folder' || menuNode.kind === 'module') return null;

    // let current: (typeof graph.entities)[string] | undefined = graph.entities[menuNode.id];
    // while (current) {
    //   if (current.kind === 'module') {
    //     const moduleChildren = childByParent.get(current.id) ?? [];
    //     const isExpanded = moduleChildren.some((childId) => !hiddenById[childId]);
    //     return isExpanded ? current.id : null;
    //   }
    //   current = current.parent ? graph.entities[current.parent] : undefined;
    // }

    return null;
  }, [graph, menuNode]);

  const onMenuExplode = useCallback(
    (id: string) => {
      explodeEntity(id);
    },
    [explodeEntity]
  );

  const onMenuCollapse = useCallback(
    (id: string) => {
      collapseEntity(id);
    },
    [collapseEntity]
  );

  const onMenuHide = useCallback(
    (id: string) => {
      const folderPath = fromFolderNodeId(id);
      if (!folderPath || !graph) {
        hideEntity(id);
        return;
      }

      for (const moduleId of graph.modules) {
        if (!isModuleInsideFolder(moduleId, folderPath)) continue;
        hideEntity(moduleId);
      }
    },
    [graph, hideEntity]
  );

  const menuActions = useMemo<ContextMenuAction[]>(() => {
    if (!menu) return [];

    const actions: ContextMenuAction[] = [];

    if (menuNode && menuHasChildren && menuIsPacked) {
      actions.push({
        id: 'unpack',
        label: 'Unpack',
        icon: <Search size={13} />,
        onSelect: () => onMenuExplode(menu.nodeId),
      });
    }

    if (menuNode && menuHasChildren && !menuIsPacked) {
      actions.push({
        id: 'pack',
        label: 'Pack',
        icon: <PackageOpen size={13} />,
        onSelect: () => onMenuCollapse(menu.nodeId),
      });
    }

    if (menuPackIntoModuleId) {
      actions.push({
        id: 'pack-into-module',
        label: 'Pack',
        icon: <PackageOpen size={13} />,
        onSelect: () => onMenuCollapse(menuPackIntoModuleId),
      });
    }

    actions.push({
      id: 'hide',
      label: 'Hide',
      icon: <EyeOff size={13} />,
      onSelect: () => onMenuHide(menu.nodeId),
    });

    actions.push({
      id: 'reveal-explorer',
      label: 'Reveal in explorer',
      icon: <Crosshair size={13} />,
      onSelect: () => onRevealInExplorer(menu.nodeId),
    });

    if (visibleNodeCount > 1) {
      actions.push({
        id: 'isolate',
        label: 'Isolate',
        icon: <Target size={13} />,
        onSelect: () => onIsolate(menu.nodeId),
      });
    }

    return actions;
  }, [
    graph,
    menu,
    menuHasChildren,
    menuIsPacked,
    menuPackIntoModuleId,
    menuNode,
    onIsolate,
    onMenuCollapse,
    onMenuExplode,
    onMenuHide,
    onRevealInExplorer,
    onShowMoreRelationships,
    onShowDependenciesOnly,
    onShowDependentsOnly,
    visibleNodeCount,
  ]);
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
  const direction = useGraphStore(selectLayoutDirection);
  const setLayoutDirection = useGraphStore((s) => s.setLayoutDirection);

  return (
    <div className="flex gap-1.5">
      <button
        className="rounded-md px-3 py-1.5 bg-white cursor-pointer"
        style={{ border: `1px solid ${direction === 'TB' ? '#94a3b8' : '#e2e8f0'}` }}
        onClick={() => setLayoutDirection('TB')}
      >
        Vertical Layout
      </button>
      <button
        className="rounded-md px-3 py-1.5 bg-white cursor-pointer"
        style={{ border: `1px solid ${direction === 'LR' ? '#94a3b8' : '#e2e8f0'}` }}
        onClick={() => setLayoutDirection('LR')}
      >
        Horizontal Layout
      </button>
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
  const graphEdges = useGraphStore(selectEdges);
  const relationEdges = useMemo(() => Object.values(graphEdges), [graphEdges]);
  const selectedEntityId = useSelectionStore(selectSelectedEntityId);
  const keyboardShortcuts = useKeyboardShortcutStore(selectKeyboardShortcuts);
  const explodeEntity = useGraphStore((s) => s.explodeEntity);
  const collapseEntity = useGraphStore((s) => s.collapseEntity);
  const hideEntity = useGraphStore((s) => s.hideEntity);
  const showEntity = useGraphStore((s) => s.showEntity);
  const applyVisibilityMask = useGraphStore((s) => s.applyVisibilityMask);
  const [revealInExplorerRequest, setRevealInExplorerRequest] = useState<{ nodeId: string; token: number } | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ nodeId: string; token: number } | null>(null);
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

  const childByParent = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const node of Object.values(graphNodes)) {
      if (!node.parentId) continue;
      const children = map.get(node.parentId) ?? [];
      children.push(node.id);
      map.set(node.parentId, children);
    }
    return map;
  }, [graphNodes]);

  const hiddenById = useMemo(() => {
    const hidden: Record<string, boolean> = {};
    for (const node of Object.values(graphNodes)) {
      hidden[node.id] = node.hidden;
    }
    return hidden;
  }, [graphNodes]);

  const folderIsPacked = useCallback(
    (folderId: string) => {
      const children = childByParent.get(folderId) ?? [];
      return children.length > 0 && children.every((childId) => hiddenById[childId]);
    },
    [childByParent, hiddenById]
  );
  const resolveSeedIds = useCallback(
    (nodeId: string): Set<string> => {
      if (!graph) return new Set<string>([nodeId]);

      const folderPath = fromFolderNodeId(nodeId);
      if (!folderPath) return new Set<string>([nodeId]);

      const seeds = new Set<string>();
      for (const moduleId of graph.modules) {
        if (isModuleInsideFolder(moduleId, folderPath)) {
          seeds.add(moduleId);
        }
      }
      return seeds;
    },
    [graph]
  );

  const resolveRelatedIds = useCallback(
    (nodeId: string, direction: 'outgoing' | 'incoming' | 'both'): Set<string> => {
      const seeds = resolveSeedIds(nodeId);
      const related = new Set<string>();

      for (const edge of relationEdges) {
        const sourceMatches = seeds.has(edge.source);
        const targetMatches = seeds.has(edge.target);

        if ((direction === 'outgoing' || direction === 'both') && sourceMatches) {
          related.add(edge.target);
        }
        if ((direction === 'incoming' || direction === 'both') && targetMatches) {
          related.add(edge.source);
        }
      }

      return related;
    },
    [relationEdges, resolveSeedIds]
  );

  const addEntityAncestors = useCallback(
    (ids: Set<string>): Set<string> => {
      if (!graph) return ids;

      const next = new Set(ids);
      for (const id of Array.from(ids)) {
        if (id.startsWith('external:')) continue;
        let current = graph.entities[id];
        while (current?.parent) {
          next.add(current.parent);
          current = graph.entities[current.parent];
        }
      }

      return next;
    },
    [graph]
  );

  const setVisibilityByIds = useCallback(
    (visibleIds: Set<string>) => {
      if (!graph) return;

      const withAncestors = addEntityAncestors(visibleIds);
      applyVisibilityMask(withAncestors);
    },
    [addEntityAncestors, applyVisibilityMask, graph]
  );

  const currentlyVisibleIds = useMemo(() => {
    const ids = new Set<string>();
    for (const node of Object.values(graphNodes)) {
      if (!node.hidden && node.kind !== 'folder') {
        ids.add(node.id);
      }
    }
    return ids;
  }, [graphNodes]);

  const onIsolate = useCallback(
    (nodeId: string) => {
      const keepIds = resolveSeedIds(nodeId);
      for (const relatedId of resolveRelatedIds(nodeId, 'both')) {
        keepIds.add(relatedId);
      }

      setVisibilityByIds(keepIds);
    },
    [resolveRelatedIds, resolveSeedIds, setVisibilityByIds]
  );

  const onShowDependenciesOnly = useCallback(
    (nodeId: string) => {
      const keepIds = resolveSeedIds(nodeId);
      for (const relatedId of resolveRelatedIds(nodeId, 'outgoing')) {
        keepIds.add(relatedId);
      }
      setVisibilityByIds(keepIds);
    },
    [resolveRelatedIds, resolveSeedIds, setVisibilityByIds]
  );

  const onShowDependentsOnly = useCallback(
    (nodeId: string) => {
      const keepIds = resolveSeedIds(nodeId);
      for (const relatedId of resolveRelatedIds(nodeId, 'incoming')) {
        keepIds.add(relatedId);
      }
      setVisibilityByIds(keepIds);
    },
    [resolveRelatedIds, resolveSeedIds, setVisibilityByIds]
  );

  const onShowMoreRelationships = useCallback(
    (nodeId: string) => {
      const keepIds = new Set<string>(currentlyVisibleIds);
      keepIds.add(nodeId);
      for (const relatedId of resolveRelatedIds(nodeId, 'both')) {
        keepIds.add(relatedId);
      }
      setVisibilityByIds(keepIds);
    },
    [currentlyVisibleIds, resolveRelatedIds, setVisibilityByIds]
  );

  const onFocusInGraph = useCallback((nodeId: string) => {
    setFocusRequest({ nodeId, token: Date.now() });
    selectEntity(nodeId);
  }, []);

  const onRevealInExplorer = useCallback((nodeId: string) => {
    setRevealInExplorerRequest({ nodeId, token: Date.now() });
  }, []);

  const showAllHiddenExceptExternals = useCallback(() => {
    if (!graph) return;

    const visibleIds = new Set<string>(Object.keys(graph.entities));
    for (const ext of graph.externalModules) {
      const extId = `external:${ext.moduleSpecifier}`;
      if (!hiddenById[extId]) {
        visibleIds.add(extId);
      }
    }

    applyVisibilityMask(visibleIds);
  }, [applyVisibilityMask, graph, hiddenById]);

  const hideNodeById = useCallback(
    (nodeId: string) => {
      const folderPath = fromFolderNodeId(nodeId);
      if (!folderPath || !graph) {
        hideEntity(nodeId);
        return;
      }

      for (const moduleId of graph.modules) {
        if (!isModuleInsideFolder(moduleId, folderPath)) continue;
        hideEntity(moduleId);
      }
    },
    [graph, hideEntity]
  );

  const selectedNodeInfo = useMemo(() => {
    if (!selectedEntityId) return null;

    const folderPath = fromFolderNodeId(selectedEntityId);
    if (folderPath) {
      const hasChildren = Boolean(graph?.modules.some((moduleId) => isModuleInsideFolder(moduleId, folderPath)));
      const folderNodeId = `folder:${folderPath}`;
      return {
        id: selectedEntityId,
        kind: 'folder' as const,
        folderPath,
        hasChildren,
        isPacked: folderPath.length > 0 ? folderIsPacked(folderNodeId) : false,
      };
    }

    if (!graph) return null;
    const entity = graph.entities[selectedEntityId];
    if (!entity) return null;

    const hasChildren = entity.children.length > 0;
    return {
      id: selectedEntityId,
      kind: 'entity' as const,
      hasChildren,
      isPacked: hasChildren ? isEntityPacked(graphNodes, selectedEntityId) : false,
    };
  }, [childByParent, folderIsPacked, graph, hiddenById, selectedEntityId]);

  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }

      if (shortcutMatchesKeyboardEvent(event, keyboardShortcuts.showAllHiddenExceptExternal)) {
        event.preventDefault();
        showAllHiddenExceptExternals();
      }
    };

    window.addEventListener('keydown', onWindowKeyDown);
    return () => window.removeEventListener('keydown', onWindowKeyDown);
  }, [keyboardShortcuts.showAllHiddenExceptExternal, showAllHiddenExceptExternals]);

  const onGraphKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const target = event.target;
      if (target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }

      if (!isGraphViewFocused || !selectedEntityId) return;

      const nativeEvent = event.nativeEvent;

      if (shortcutMatchesKeyboardEvent(nativeEvent, keyboardShortcuts.hideNode)) {
        event.preventDefault();
        hideNodeById(selectedEntityId);
        return;
      }

      if (shortcutMatchesKeyboardEvent(nativeEvent, keyboardShortcuts.showMoreRelationships)) {
        event.preventDefault();
        onShowMoreRelationships(selectedEntityId);
        return;
      }

      if (shortcutMatchesKeyboardEvent(nativeEvent, keyboardShortcuts.isolateNode)) {
        event.preventDefault();
        onIsolate(selectedEntityId);
        return;
      }

      if (shortcutMatchesKeyboardEvent(nativeEvent, keyboardShortcuts.revealInExplorer)) {
        event.preventDefault();
        onRevealInExplorer(selectedEntityId);
        return;
      }

      if (shortcutMatchesKeyboardEvent(nativeEvent, keyboardShortcuts.showDependenciesOnly)) {
        event.preventDefault();
        onShowDependenciesOnly(selectedEntityId);
        return;
      }

      if (shortcutMatchesKeyboardEvent(nativeEvent, keyboardShortcuts.showDependentsOnly)) {
        event.preventDefault();
        onShowDependentsOnly(selectedEntityId);
        return;
      }

      if (shortcutMatchesKeyboardEvent(nativeEvent, keyboardShortcuts.unpackNode)) {
        if (!selectedNodeInfo?.hasChildren || !selectedNodeInfo.isPacked) return;
        event.preventDefault();

        if (selectedNodeInfo.kind === 'folder') {
          explodeEntity(selectedNodeInfo.id);
          return;
        }

        explodeEntity(selectedNodeInfo.id);
        return;
      }

      if (shortcutMatchesKeyboardEvent(nativeEvent, keyboardShortcuts.packNode)) {
        if (!selectedNodeInfo?.hasChildren || selectedNodeInfo.isPacked) return;
        event.preventDefault();

        if (selectedNodeInfo.kind === 'folder') {
          collapseEntity(selectedNodeInfo.id);
          return;
        }

        collapseEntity(selectedNodeInfo.id);
      }
    },
    [
      isGraphViewFocused,
      keyboardShortcuts.hideNode,
      keyboardShortcuts.isolateNode,
      keyboardShortcuts.packNode,
      keyboardShortcuts.revealInExplorer,
      keyboardShortcuts.showDependenciesOnly,
      keyboardShortcuts.showDependentsOnly,
      keyboardShortcuts.showMoreRelationships,
      keyboardShortcuts.unpackNode,
      collapseEntity,
      explodeEntity,
      onIsolate,
      onRevealInExplorer,
      onShowDependenciesOnly,
      onShowDependentsOnly,
      onShowMoreRelationships,
      selectedEntityId,
      selectedNodeInfo,
      hideNodeById,
    ]
  );

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
        <FileExplorer
          graph={graph}
          graphNodes={graphNodes}
          graphEdges={graphEdges}
          onExplode={explodeEntity}
          onCollapse={collapseEntity}
          onHide={hideEntity}
          onShow={showEntity}
          onFocusInGraph={onFocusInGraph}
          onIsolate={onIsolate}
          onShowDependenciesOnly={onShowDependenciesOnly}
          onShowDependentsOnly={onShowDependentsOnly}
          onShowMoreRelationships={onShowMoreRelationships}
          revealRequest={revealInExplorerRequest}
        />
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
          onKeyDown={onGraphKeyDown}
          style={{
            width: `${paneWidth}%`,
            outline: isGraphViewFocused ? '2px solid #93c5fd' : 'none',
            outlineOffset: -2,
          }}
          className="h-full shrink-0 bg-[#f1f5f9]"
        >
          <ReactFlowProvider>
            <LayoutFlow
              onRevealInExplorer={onRevealInExplorer}
              onIsolate={onIsolate}
              onShowDependenciesOnly={onShowDependenciesOnly}
              onShowDependentsOnly={onShowDependentsOnly}
              onShowMoreRelationships={onShowMoreRelationships}
              onOpenSettings={() => setSettingsOpen(true)}
              focusRequest={focusRequest}
            />
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
