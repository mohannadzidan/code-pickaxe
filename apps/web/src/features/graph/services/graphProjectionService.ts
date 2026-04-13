import type { EntityId, SerializedCodeGraph } from "@api/parsing/types";
import type { DomainEdge, DomainNode, GraphState, VisualGraph } from "@/shared/types/domain";
import { getFolderPathForModule, getParentFolderPath, normalizePath, toFolderNodeId } from "@/features/graph/services/folderPath";

export class GraphProjectionService {
  buildGraphState(data: SerializedCodeGraph | null): GraphState {
    if (!data) {
      return { nodes: {}, edges: {} };
    }

    const nodes: Record<string, DomainNode> = {};
    const edges: Record<string, DomainEdge> = {};

    const folderByPath = new Map<string, { id: string; path: string; label: string; parentPath: string }>();

    const ensureFolder = (folderPath: string) => {
      const normalized = normalizePath(folderPath);
      if (!normalized) return null;

      const cached = folderByPath.get(normalized);
      if (cached) return cached;

      const parentPath = getParentFolderPath(normalized);
      const parent = ensureFolder(parentPath);
      const label = normalized.includes("/") ? normalized.slice(normalized.lastIndexOf("/") + 1) : normalized;
      const id = toFolderNodeId(normalized);
      const created = { id, path: normalized, label, parentPath };

      folderByPath.set(normalized, created);
      nodes[id] = {
        id,
        label,
        kind: "folder",
        showParentLabel: false,
        hidden: false,
        children: [],
        parentId: parent?.id,
        parentLabel: parent?.label,
        outEdgeIds: [],
        inEdgeIds: [],
      };

      return created;
    };

    for (const moduleId of data.modules) {
      ensureFolder(getFolderPathForModule(moduleId));
    }

    for (const entity of Object.values(data.entities)) {
      const parentId = entity.parent ?? (entity.kind === "module" ? ensureFolder(getFolderPathForModule(entity.id))?.id : undefined);
      const parentLabel = parentId ? nodes[parentId]?.label ?? data.entities[parentId]?.name : undefined;
      const showParentLabel = entity.kind !== "module" && Boolean(parentLabel);
      const label = entity.parent && data.entities[entity.parent]?.kind === "class"
        ? `${data.entities[entity.parent]!.name}.${entity.name}`
        : entity.name;

      nodes[entity.id] = {
        id: entity.id,
        label,
        kind: entity.kind,
        subKind: entity.subKind,
        code: entity.definition,
        isExternal: false,
        parentLabel,
        showParentLabel,
        hidden: true,
        children: [],
        parentId,
        outEdgeIds: [],
        inEdgeIds: [],
      };
    }

    for (const ext of data.externalModules) {
      const id = `external:${ext.moduleSpecifier}`;
      nodes[id] = {
        id,
        label: ext.moduleSpecifier,
        kind: "module",
        isExternal: true,
        showParentLabel: false,
        hidden: true,
        children: [],
        outEdgeIds: [],
        inEdgeIds: [],
      };
    }

    const contexts: Record<string, string> = {
      call: "call",
      instantiation: "new",
      "type-annotation": "type",
      reference: "ref",
      extends: "extends",
      implements: "impl",
    };

    const edgeContexts = new Map<string, Set<string>>();
    for (const dep of data.dependencies) {
      if (!nodes[dep.source] || !nodes[dep.target] || dep.source === dep.target) continue;

      const id = `${dep.source}→${dep.target}`;
      if (!edges[id]) {
        edges[id] = {
          id,
          source: dep.source,
          target: dep.target,
          code: dep.usages[0]?.location,
        };
        console.log(edges[id]);
      }

      const ctxSet = edgeContexts.get(id) ?? new Set<string>();
      for (const usage of dep.usages) {
        ctxSet.add(contexts[usage.context] ?? usage.context);
      }
      edgeContexts.set(id, ctxSet);
    }

    for (const [edgeId, ctxSet] of edgeContexts.entries()) {
      edges[edgeId].label = Array.from(ctxSet).filter(Boolean).join(" • ") || undefined;
    }

    for (const edge of Object.values(edges)) {
      nodes[edge.source]?.outEdgeIds.push(edge.id);
      nodes[edge.target]?.inEdgeIds.push(edge.id);
    }

    // Populate children arrays for every node from parentId references
    for (const node of Object.values(nodes)) {
      if (node.parentId && nodes[node.parentId]) {
        nodes[node.parentId].children.push(node.id);
      }
    }

    return { nodes, edges };
  }

  buildVisualGraph(graphState: GraphState): VisualGraph {
    const nodes = Object.values(graphState.nodes).filter((node) => !node.hidden);
    const visibleIds = new Set(nodes.map((node) => node.id));
    const edges = Object.values(graphState.edges).filter(
      (edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target)
    );

    const seen = new Set<string>();
    const topLinks: Array<{ source: EntityId; target: EntityId }> = [];

    for (const edge of edges) {
      const key = `${edge.source}→${edge.target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      topLinks.push({ source: edge.source, target: edge.target });
    }

    return { nodes, edges, topLinks };
  }
}
