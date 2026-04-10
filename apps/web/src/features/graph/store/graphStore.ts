import type { SerializedCodeGraph } from '@api/parsing/types';
import { create } from 'zustand';
import type { DomainNode, GraphState, LayoutDirection, NodePositions, VisualGraph } from '@/shared/types/domain';
import { services } from '@/app/bootstrap';

type StoreState = GraphState & {
  graph: SerializedCodeGraph | null;
  layoutDirection: LayoutDirection;
};

type GraphActions = {
  loadGraph: (graph: SerializedCodeGraph) => void;
  setLayoutDirection: (direction: LayoutDirection) => void;
  explodeEntity: (entityId: string) => void;
  collapseEntity: (entityId: string) => void;
  hideEntity: (entityId: string) => void;
  showEntity: (entityId: string) => void;
  applyVisibilityMask: (visibleIds: Set<string>) => void;
  setNodePosition: (nodeId: string, position: { x: number; y: number }) => void;
  setNodePositions: (positions: NodePositions) => void;
};

type GraphStore = StoreState & GraphActions;

const isPositionDefault = (position: { x: number; y: number }): boolean => position.x === 0 && position.y === 0;

const childIdMap = (nodes: GraphState['nodes']): Map<string, string[]> => {
  const map = new Map<string, string[]>();
  for (const node of Object.values(nodes)) {
    const parentId = node.parentId;
    if (!parentId) continue;
    const list = map.get(parentId) ?? [];
    list.push(node.id);
    map.set(parentId, list);
  }
  return map;
};

const recursivelyMutateChildren = (
  nodes: GraphState['nodes'],
  rootId: string,
  mutator: (node: GraphState['nodes'][string]) => void
): void => {
  nodes[rootId]?.children.forEach((childId) => {
    mutator(nodes[childId]);
    recursivelyMutateChildren(nodes, childId, mutator);
  });
};

const collectAncestors = (nodes: GraphState['nodes'], id: string): string[] => {
  const result: string[] = [];
  let cursor = nodes[id]?.parentId;

  while (cursor) {
    result.push(cursor);
    cursor = nodes[cursor]?.parentId;
  }

  return result;
};

const cloneNodes = (nodes: GraphState['nodes']): GraphState['nodes'] => {
  const next: GraphState['nodes'] = {};
  for (const [id, node] of Object.entries(nodes)) {
    next[id] = { ...node };
  }
  return next;
};

const recomputeFolderVisibility = (nodes: GraphState['nodes']): void => {
  const byParent = childIdMap(nodes);
  const folders = Object.values(nodes)
    .filter((node) => node.kind === 'folder')
    .sort((a, b) => b.id.length - a.id.length);

  for (const folder of folders) {
    const childIds = byParent.get(folder.id) ?? [];
    const hasVisibleChildren = childIds.some((childId) => nodes[childId] && !nodes[childId].hidden);
    nodes[folder.id] = {
      ...nodes[folder.id],
      hidden: !hasVisibleChildren,
    };
  }
};

const project = (state: GraphState): VisualGraph => services.graphProjectionService.buildVisualGraph(state);

const withResolvedPositions = (
  prevNodes: GraphState['nodes'],
  nextNodes: GraphState['nodes'],
  edges: GraphState['edges'],
  direction: LayoutDirection,
  forceLayout = false
): GraphState['nodes'] => {
  const vg = project({ nodes: nextNodes, edges });
  const laidOut = services.layoutService.computePositions(vg, direction);
  const resolved = cloneNodes(nextNodes);

  for (const node of vg.nodes) {
    const previous = prevNodes[node.id]?.position;
    const fallback = laidOut[node.id] ?? previous ?? { x: 0, y: 0 };
    const shouldUseLayout = forceLayout || !previous || isPositionDefault(previous);

    resolved[node.id] = {
      ...resolved[node.id],
      position: shouldUseLayout ? fallback : previous,
    };
  }

  return resolved;
};

const setEntityVisibility = (
  nodes: Record<string, DomainNode>,
  entityId: string,
  hidden: boolean,
  directChildrenVisibility?: boolean,
  indirectChildrenVisibility?: boolean
) => {
  if (!nodes[entityId]) return nodes;

  const mutated: Record<string, DomainNode> = {};
  const directChildren = nodes[entityId].children;
  const position = nodes[entityId].position;
  if (indirectChildrenVisibility !== undefined) {
    for (const childId of directChildren) {
      if (directChildrenVisibility !== undefined && nodes[childId].hidden !== directChildrenVisibility) {
        nodes[childId] = { ...nodes[childId], hidden: directChildrenVisibility, position };
      }
      if (indirectChildrenVisibility !== undefined) {
        recursivelyMutateChildren(nodes, childId, (node) => {
          if (nodes[node.id].hidden !== indirectChildrenVisibility) {
            mutated[node.id] = { ...node, hidden: indirectChildrenVisibility, position };
          }
        });
      }
    }
  }

  mutated[entityId] = { ...nodes[entityId], hidden };

  const nextNodes = { ...nodes, ...mutated };
  return nextNodes;
};

export const useGraphStore = create<GraphStore>((set, get) => ({
  graph: null,
  nodes: {},
  edges: {},
  layoutDirection: 'TB',

  loadGraph: (graph) => {
    const draft = services.graphProjectionService.buildGraphState(graph);
    const nodes = withResolvedPositions(draft.nodes, draft.nodes, draft.edges, get().layoutDirection, true);
    console.log('Loaded graph with', Object.keys(draft.nodes).length, 'nodes and', Object.keys(draft.edges).length, 'edges');
    console.log(nodes, draft.edges)
    set({
      graph,
      nodes,
      edges: draft.edges,
    });
  },

  setLayoutDirection: (direction) => {
    const state = get();
    const nodes = withResolvedPositions(state.nodes, state.nodes, state.edges, direction, true);

    set({
      layoutDirection: direction,
      nodes,
    });
  },

  collapseEntity: (entityId) => {
    const state = get();
    if (!state.nodes[entityId]) return;
    const nextNodes = setEntityVisibility(state.nodes, entityId, false, true, true);
    set({ nodes: nextNodes });
  },

  explodeEntity: (entityId) => {
    const state = get();
    if (!state.nodes[entityId]) return;
    const nextNodes = setEntityVisibility(state.nodes, entityId, true, false, true);
    if (nextNodes === state.nodes) return;
    set({ nodes: nextNodes });
  },

  hideEntity: (entityId) => {
    const state = get();
    if (!state.nodes[entityId]) return;
    const nextNodes = setEntityVisibility(state.nodes, entityId, true, true, true);
    set({ nodes: nextNodes });
  },

  showEntity: (entityId) => {
    const state = get();
    if (!state.nodes[entityId]) return;
    const nextNodes = setEntityVisibility(state.nodes, entityId, false, true, true);
    set({ nodes: nextNodes });
  },

  applyVisibilityMask: (visibleIds) => {
    const state = get();
    const nodes = cloneNodes(state.nodes);

    for (const node of Object.values(nodes)) {
      if (node.kind === 'folder') continue;
      nodes[node.id] = { ...node, hidden: !visibleIds.has(node.id) };
    }

    for (const id of visibleIds) {
      if (!nodes[id]) continue;
      nodes[id] = { ...nodes[id], hidden: false };
      for (const ancestorId of collectAncestors(nodes, id)) {
        nodes[ancestorId] = { ...nodes[ancestorId], hidden: false };
      }
    }

    recomputeFolderVisibility(nodes);
    const resolved = withResolvedPositions(state.nodes, nodes, state.edges, state.layoutDirection);

    set({ nodes: resolved });
  },

  setNodePosition: (nodeId, position) => {
    set((state) => {
      const node = state.nodes[nodeId];
      if (!node) return {};

      return {
        nodes: {
          ...state.nodes,
          [nodeId]: {
            ...node,
            position,
          },
        },
      };
    });
  },

  setNodePositions: (positions) => {
    set((state) => {
      const nodes = cloneNodes(state.nodes);

      for (const [id, position] of Object.entries(positions)) {
        const node = nodes[id];
        if (!node) continue;
        nodes[id] = { ...node, position };
      }

      return { nodes };
    });
  },
}));

export const selectGraphData = (state: GraphStore) => state.graph;
export const selectLayoutDirection = (state: GraphStore) => state.layoutDirection;
export const selectNodes = (state: GraphStore) => state.nodes;
export const selectEdges = (state: GraphStore) => state.edges;
export const selectNodesList = (state: GraphStore) => Object.values(state.nodes);