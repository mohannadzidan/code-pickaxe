import type { SerializedCodeGraph } from "@api/parsing/types";
import { create } from "zustand";
import type { LayoutDirection, NodePositions, VisualGraph } from "@/shared/types/domain";
import { services } from "@/app/bootstrap";

type GraphState = {
  graph: SerializedCodeGraph | null;
  explodedIds: Set<string>;
  hiddenIds: Set<string>;
  layoutDirection: LayoutDirection;
  nodePositions: NodePositions;
};

type GraphActions = {
  loadGraph: (graph: SerializedCodeGraph) => void;
  setLayoutDirection: (direction: LayoutDirection) => void;
  explodeEntity: (entityId: string) => void;
  collapseEntity: (entityId: string) => void;
  hideEntity: (entityId: string) => void;
  setNodePosition: (nodeId: string, position: { x: number; y: number }) => void;
  setNodePositions: (positions: NodePositions) => void;
};

type GraphStore = GraphState & GraphActions;

const project = (state: GraphState): VisualGraph => {
  return services.graphProjectionService.buildVisualGraph(state.graph, state.explodedIds, state.hiddenIds);
};

const resolvePositions = (vg: VisualGraph, direction: LayoutDirection, previous: NodePositions): NodePositions => {
  const laidOut = services.layoutService.computePositions(vg, direction);
  const next: NodePositions = {};

  for (const node of vg.nodes) {
    next[node.id] = previous[node.id] ?? laidOut[node.id] ?? { x: 0, y: 0 };
  }

  return next;
};

export const useGraphStore = create<GraphStore>((set, get) => ({
  graph: null,
  explodedIds: new Set<string>(),
  hiddenIds: new Set<string>(),
  layoutDirection: "TB",
  nodePositions: {},

  loadGraph: (graph) => {
    const draft: GraphState = {
      graph,
      explodedIds: new Set<string>(),
      hiddenIds: new Set<string>(),
      layoutDirection: get().layoutDirection,
      nodePositions: {},
    };

    const vg = project(draft);
    set({
      graph,
      explodedIds: draft.explodedIds,
      hiddenIds: draft.hiddenIds,
      nodePositions: services.layoutService.computePositions(vg, draft.layoutDirection),
    });
  },

  setLayoutDirection: (direction) => {
    const state = get();
    const nextState: GraphState = {
      ...state,
      layoutDirection: direction,
    };
    const vg = project(nextState);
    set({
      layoutDirection: direction,
      nodePositions: services.layoutService.computePositions(vg, direction),
    });
  },

  explodeEntity: (entityId) => {
    const state = get();
    if (state.explodedIds.has(entityId)) return;

    const explodedIds = new Set(state.explodedIds);
    explodedIds.add(entityId);

    const nextState: GraphState = { ...state, explodedIds };
    const vg = project(nextState);

    set({
      explodedIds,
      nodePositions: resolvePositions(vg, state.layoutDirection, state.nodePositions),
    });
  },

  collapseEntity: (entityId) => {
    const state = get();
    if (!state.explodedIds.has(entityId) || !state.graph) return;

    const explodedIds = new Set(state.explodedIds);
    explodedIds.delete(entityId);

    for (const id of Array.from(explodedIds)) {
      let current: string | null = id;
      while (current) {
        const entity = state.graph.entities[current] as { parent?: string | null } | undefined;
        if (!entity) break;
        if (entity.parent === entityId) {
          explodedIds.delete(id);
          break;
        }
        current = entity.parent ?? null;
      }
    }

    const nextState: GraphState = { ...state, explodedIds };
    const vg = project(nextState);

    set({
      explodedIds,
      nodePositions: resolvePositions(vg, state.layoutDirection, state.nodePositions),
    });
  },

  hideEntity: (entityId) => {
    const state = get();
    if (!state.graph || state.hiddenIds.has(entityId)) return;

    const hiddenIds = new Set(state.hiddenIds);
    const stack = [entityId];

    while (stack.length) {
      const current = stack.pop()!;
      if (hiddenIds.has(current)) continue;
      hiddenIds.add(current);

      const entity = state.graph.entities[current];
      if (!entity) continue;
      for (const childId of entity.children) stack.push(childId);
    }

    const explodedIds = new Set(state.explodedIds);
    for (const id of hiddenIds) explodedIds.delete(id);

    const nextState: GraphState = { ...state, hiddenIds, explodedIds };
    const vg = project(nextState);

    set({
      hiddenIds,
      explodedIds,
      nodePositions: resolvePositions(vg, state.layoutDirection, state.nodePositions),
    });
  },

  setNodePosition: (nodeId, position) => {
    set((state) => ({
      nodePositions: {
        ...state.nodePositions,
        [nodeId]: position,
      },
    }));
  },

  setNodePositions: (positions) => {
    set(() => ({
      nodePositions: positions,
    }));
  },
}));

export const selectGraphData = (state: GraphStore) => state.graph;
export const selectLayoutDirection = (state: GraphStore) => state.layoutDirection;
export const selectExplodedIds = (state: GraphStore) => state.explodedIds;
export const selectHiddenIds = (state: GraphStore) => state.hiddenIds;
export const selectNodePositions = (state: GraphStore) => state.nodePositions;
