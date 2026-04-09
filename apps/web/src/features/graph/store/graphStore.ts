import type { SerializedCodeGraph } from "@api/parsing/types";
import { create } from "zustand";
import type { LayoutDirection, NodePositions, VisualGraph } from "@/shared/types/domain";
import { services } from "@/app/bootstrap";
import { getFolderPathForModule, getParentFolderPath, isModuleInsideFolder, normalizePath } from "@/features/graph/services/folderPath";

type GraphState = {
  graph: SerializedCodeGraph | null;
  explodedIds: Set<string>;
  explodedFolderPaths: Set<string>;
  hiddenIds: Set<string>;
  layoutDirection: LayoutDirection;
  nodePositions: NodePositions;
};

type GraphActions = {
  loadGraph: (graph: SerializedCodeGraph) => void;
  setLayoutDirection: (direction: LayoutDirection) => void;
  explodeEntity: (entityId: string) => void;
  collapseEntity: (entityId: string) => void;
  explodeFolder: (folderPath: string) => void;
  collapseFolder: (folderPath: string) => void;
  hideEntity: (entityId: string) => void;
  showEntity: (entityId: string) => void;
  applyVisibilityMask: (visibleIds: Set<string>) => void;
  setNodePosition: (nodeId: string, position: { x: number; y: number }) => void;
  setNodePositions: (positions: NodePositions) => void;
};

type GraphStore = GraphState & GraphActions;

const project = (state: GraphState): VisualGraph => {
  return services.graphProjectionService.buildVisualGraph(
    state.graph,
    state.explodedIds,
    state.explodedFolderPaths,
    state.hiddenIds
  );
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
  explodedFolderPaths: new Set<string>(),
  hiddenIds: new Set<string>(),
  layoutDirection: "TB",
  nodePositions: {},

  loadGraph: (graph) => {
    const draft: GraphState = {
      graph,
      explodedIds: new Set<string>(),
      explodedFolderPaths: new Set<string>(),
      hiddenIds: new Set<string>(),
      layoutDirection: get().layoutDirection,
      nodePositions: {},
    };

    const vg = project(draft);
    set({
      graph,
      explodedIds: draft.explodedIds,
      explodedFolderPaths: draft.explodedFolderPaths,
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
    if (!state.graph) return;

    const explodedIds = new Set(state.explodedIds);
    const explodedFolderPaths = new Set(state.explodedFolderPaths);
    const hiddenIds = new Set(state.hiddenIds);

    let current = state.graph.entities[entityId];
    hiddenIds.delete(entityId);
    while (current?.parent) {
      explodedIds.add(current.parent);
      hiddenIds.delete(current.parent);
      current = state.graph.entities[current.parent];
    }

    // unhide all children of the exploded entity

    const stack = [entityId];
    while (stack.length) {
      const currentId = stack.pop()!;
      hiddenIds.delete(currentId);
      const entity = state.graph?.entities[currentId];
      if (!entity) continue;
      for (const childId of entity.children) stack.push(childId);
    }

    explodedIds.add(entityId);

    let moduleId: string | null = null;
    let cursor: (typeof state.graph.entities)[string] | undefined = state.graph.entities[entityId];
    while (cursor) {
      if (cursor.kind === "module") {
        moduleId = cursor.id;
        break;
      }
      cursor = cursor.parent ? state.graph.entities[cursor.parent] : undefined;
    }

    if (moduleId) {
      let folderPath = getFolderPathForModule(moduleId);
      while (folderPath) {
        explodedFolderPaths.add(folderPath);
        folderPath = getParentFolderPath(folderPath);
      }
    }

    const nextState: GraphState = { ...state, explodedIds, explodedFolderPaths, hiddenIds };
    const vg = project(nextState);

    set({
      explodedIds,
      explodedFolderPaths,
      hiddenIds,
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

  explodeFolder: (folderPath) => {
    const state = get();
    const normalized = normalizePath(folderPath);
    if (!state.graph || !normalized || state.explodedFolderPaths.has(normalized)) return;

    const explodedFolderPaths = new Set(state.explodedFolderPaths);
    const hiddenIds = new Set(state.hiddenIds);
    let currentPath: string | null = normalized;
    while (currentPath) {
      explodedFolderPaths.add(currentPath);
      currentPath = getParentFolderPath(currentPath) || null;
    }

    for (const moduleId of state.graph.modules) {
      if (!isModuleInsideFolder(moduleId, normalized)) continue;
      hiddenIds.delete(moduleId);
    }

    const nextState: GraphState = { ...state, explodedFolderPaths, hiddenIds };
    const vg = project(nextState);

    set({
      explodedFolderPaths,
      hiddenIds,
      nodePositions: resolvePositions(vg, state.layoutDirection, state.nodePositions),
    });
  },

  collapseFolder: (folderPath) => {
    const state = get();
    const normalized = normalizePath(folderPath);
    if (!state.graph || !normalized) return;

    const explodedFolderPaths = new Set(state.explodedFolderPaths);
    let changed = false;

    for (const candidate of Array.from(explodedFolderPaths)) {
      if (candidate === normalized || candidate.startsWith(`${normalized}/`)) {
        explodedFolderPaths.delete(candidate);
        changed = true;
      }
    }

    const explodedIds = new Set(state.explodedIds);
    for (const entityId of Array.from(explodedIds)) {
      let current: (typeof state.graph.entities)[string] | undefined = state.graph.entities[entityId];
      let moduleId: string | null = null;
      while (current) {
        if (current.kind === "module") {
          moduleId = current.id;
          break;
        }
        current = current.parent ? state.graph.entities[current.parent] : undefined;
      }

      if (!moduleId) continue;
      if (isModuleInsideFolder(moduleId, normalized)) {
        explodedIds.delete(entityId);
        changed = true;
      }
    }

    if (!changed) return;

    const nextState: GraphState = { ...state, explodedFolderPaths, explodedIds };
    const vg = project(nextState);

    set({
      explodedFolderPaths,
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

  showEntity: (entityId) => {
    const state = get();
    if (!state.graph || !state.hiddenIds.has(entityId)) return;

    const hiddenIds = new Set(state.hiddenIds);
    const stack = [entityId];

    while (stack.length) {
      const current = stack.pop()!;
      hiddenIds.delete(current);

      const entity = state.graph.entities[current];
      if (!entity) continue;
      for (const childId of entity.children) stack.push(childId);
    }

    const nextState: GraphState = { ...state, hiddenIds };
    const vg = project(nextState);

    set({
      hiddenIds,
      nodePositions: resolvePositions(vg, state.layoutDirection, state.nodePositions),
    });
  },

  applyVisibilityMask: (visibleIds) => {
    const state = get();
    if (!state.graph) return;

    const hiddenIds = new Set<string>();

    for (const id of Object.keys(state.graph.entities)) {
      if (!visibleIds.has(id)) {
        hiddenIds.add(id);
      }
    }

    for (const ext of state.graph.externalModules) {
      const extId = `external:${ext.moduleSpecifier}`;
      if (!visibleIds.has(extId)) {
        hiddenIds.add(extId);
      }
    }

    const nextState: GraphState = { ...state, hiddenIds };
    const vg = project(nextState);

    set({
      hiddenIds,
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
export const selectExplodedFolderPaths = (state: GraphStore) => state.explodedFolderPaths;
export const selectHiddenIds = (state: GraphStore) => state.hiddenIds;
export const selectNodePositions = (state: GraphStore) => state.nodePositions;
