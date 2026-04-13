import type { SerializedCodeGraph } from '@api/parsing/types';
import { create } from 'zustand';
import type { DomainNode, GraphState } from '@/shared/types/domain';
import { services } from '@/app/bootstrap';

type StoreState = GraphState & {
  graph: SerializedCodeGraph | null;
  focusedNodes: string[];
};

type GraphActions = {
  loadGraph: (graph: SerializedCodeGraph) => void;
  explodeEntity: (entityId: string) => void;
  collapseEntity: (entityId: string) => void;
  hideEntity: (entityId: string) => void;
  showEntity: (entityId: string) => void;
  applyVisibilityMask: (visibleIds: Set<string>) => void;
  setFocusedNodes: (nodeIds: string[]) => void;
};

type GraphStore = StoreState & GraphActions;

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

const setEntityVisibility = (
  nodes: Record<string, DomainNode>,
  entityId: string,
  hidden: boolean,
  hideDirectChildren?: boolean,
  hideIndirectChildren?: boolean
) => {
  if (!nodes[entityId]) return nodes;

  const mutated: Record<string, DomainNode> = {};
  const directChildren = nodes[entityId].children;
  if (hideIndirectChildren !== undefined) {
    for (const childId of directChildren) {
      if (hideDirectChildren !== undefined && nodes[childId].hidden !== hideDirectChildren) {
        nodes[childId] = { ...nodes[childId], hidden: hideDirectChildren };
      }
      if (hideIndirectChildren !== undefined) {
        recursivelyMutateChildren(nodes, childId, (node) => {
          if (nodes[node.id].hidden !== hideIndirectChildren) {
            mutated[node.id] = { ...node, hidden: hideIndirectChildren };
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
  focusedNodes: [],
  loadGraph: (graph) => {
    const draft = services.graphProjectionService.buildGraphState(graph);

    set({
      graph,
      nodes: draft.nodes,
      edges: draft.edges,
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
    const mutated: Record<string, DomainNode> = {};
    Object.values(state.nodes).forEach((node) => {
      if (visibleIds.has(node.id) && node.hidden) {
        mutated[node.id] = { ...node, hidden: false };
      } else if (!visibleIds.has(node.id) && !node.hidden) {
        mutated[node.id] = { ...node, hidden: true };
      }
    });
    console.log({ mutated });
    set({ nodes: { ...state.nodes, ...mutated } });
  },

  setFocusedNodes: (nodeIds) => {
    set({ focusedNodes: nodeIds });
  },
}));

export const selectGraphData = (state: GraphStore) => state.graph;
export const selectNodes = (state: GraphStore) => state.nodes;
export const selectEdges = (state: GraphStore) => state.edges;
export const selectNodesList = (state: GraphStore) => Object.values(state.nodes);
export const selectFocusedNodes = (state: GraphStore) => state.focusedNodes;