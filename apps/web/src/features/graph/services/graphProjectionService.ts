import type { CodeDefinition, CodeEntity, EntityId, SerializedCodeGraph } from "@api/parsing/types";
import type { DomainEdge, DomainNode, VisualGraph } from "@/shared/types/domain";

export class GraphProjectionService {
  buildVisualGraph(data: SerializedCodeGraph | null, exploded: Set<string>, hidden: Set<string>): VisualGraph {
    if (!data) {
      return { nodes: [], edges: [], topLinks: [] };
    }

    const visible = new Set<string>();
    const visitVisible = (id: string) => {
      if (hidden.has(id) || visible.has(id)) return;
      visible.add(id);
      const entity = data.entities[id];
      if (!entity || !exploded.has(id)) return;
      for (const childId of entity.children) visitVisible(childId);
    };

    for (const modId of data.modules) {
      if (data.entities[modId]) visitVisible(modId);
    }

    const getModuleAncestor = (id: string): string | null => {
      let current: string | null = id;
      while (current) {
        const entity: CodeEntity | undefined = data.entities[current];
        if (!entity) return null;
        if (entity.kind === "module") return entity.id;
        current = entity.parent;
      }
      return null;
    };

    const nodes: DomainNode[] = Array.from(visible).map((id) => {
      const entity = data.entities[id]!;
      const parent = entity.parent ? data.entities[entity.parent] : undefined;
      const displayName = parent?.kind === "class" ? `${parent.name}.${entity.name}` : entity.name;

      return {
        id,
        label: displayName,
        kind: entity.kind,
        filePath: entity.kind === "module" ? entity.id : displayName,
      };
    });

    for (const ext of data.externalModules) {
      const id = `external:${ext.moduleSpecifier}`;
      if (hidden.has(id)) continue;
      nodes.push({
        id,
        label: ext.moduleSpecifier,
        kind: "module",
        filePath: ext.moduleSpecifier,
        isExternal: true,
      });
    }

    const nodeIds = new Set(nodes.map((n) => n.id));

    const visibleNode = (id: EntityId): EntityId => {
      let cur: EntityId = id;
      while (true) {
        if (nodeIds.has(cur)) return cur;
        const e = data.entities[cur];
        if (!e?.parent) return cur;
        cur = e.parent as EntityId;
      }
    };

    const resolveImportedMemberTarget = (moduleId: EntityId, symbolName: string): EntityId | null => {
      const moduleEntity = data.entities[moduleId];
      if (!moduleEntity || moduleEntity.kind !== "module") return null;

      for (const childId of moduleEntity.children) {
        const child = data.entities[childId];
        if (!child) continue;
        if (!child.exported) continue;
        if (child.name !== symbolName) continue;
        if (!nodeIds.has(child.id)) continue;
        return child.id;
      }

      return null;
    };

    const visibleTarget = (dep: (typeof data.dependencies)[number]): EntityId => {
      const targetEntity = data.entities[dep.target];
      if (
        targetEntity?.kind === "module" &&
        !dep.importedSymbol.isDefault &&
        !dep.importedSymbol.isNamespace &&
        dep.importedSymbol.symbolName !== "*"
      ) {
        const mappedMember = resolveImportedMemberTarget(targetEntity.id, dep.importedSymbol.symbolName);
        if (mappedMember) return mappedMember;
      }

      return visibleNode(dep.target);
    };

    const contexts: Record<string, string> = {
      call: "call",
      instantiation: "new",
      "type-annotation": "type",
      reference: "ref",
      extends: "extends",
      implements: "impl",
    };

    const edgeMap = new Map<string, { edge: DomainEdge; contexts: Set<string> }>();
    for (const dep of data.dependencies) {
      const srcId = visibleNode(dep.source);
      const tgtId = visibleTarget(dep);
      if (!nodeIds.has(srcId) || !nodeIds.has(tgtId) || srcId === tgtId) continue;

      const key = `${srcId}→${tgtId}`;
      const ctxs = dep.usages.map((u) => contexts[u.context] ?? u.context);
      if (!edgeMap.has(key)) {
        const firstUsageLoc: CodeDefinition | undefined = dep.usages[0]?.location;
        edgeMap.set(key, {
          edge: {
            id: key,
            source: srcId,
            target: tgtId,
            firstUsageLoc,
          },
          contexts: new Set(ctxs),
        });
      } else {
        ctxs.forEach((ctx) => edgeMap.get(key)!.contexts.add(ctx));
      }
    }

    const edges = Array.from(edgeMap.values()).map(({ edge, contexts }) => ({
      ...edge,
      label: Array.from(contexts).filter(Boolean).join(" • ") || undefined,
    }));

    const originEdges: DomainEdge[] = [];
    const seenOrigin = new Set<string>();

    for (const id of visible) {
      const entity = data.entities[id];
      if (!entity || entity.kind === "module") continue;
      const moduleId = getModuleAncestor(id);
      if (!moduleId || !nodeIds.has(moduleId)) continue;

      const key = `${moduleId}→${id}`;
      if (seenOrigin.has(key)) continue;
      seenOrigin.add(key);
      originEdges.push({
        id: `origin:${moduleId}->${id}`,
        source: moduleId,
        target: id,
        isOriginEdge: true,
      });
    }

    const allEdges = [...edges, ...originEdges];
    const topIds = new Set(nodes.map((n) => n.id));
    const seenTop = new Set<string>();
    const topLinks: Array<{ source: EntityId; target: EntityId }> = [];

    for (const edge of allEdges) {
      if (edge.source === edge.target || !topIds.has(edge.source) || !topIds.has(edge.target)) continue;
      const key = `${edge.source}→${edge.target}`;
      if (seenTop.has(key)) continue;
      seenTop.add(key);
      topLinks.push({ source: edge.source, target: edge.target });
    }

    return { nodes, edges: allEdges, topLinks };
  }
}
