import type { CodeDefinition, CodeEntity, EntityId, SerializedCodeGraph } from "@api/parsing/types";
import type { DomainEdge, DomainNode, VisualGraph } from "@/shared/types/domain";
import { getFolderPathForModule, getParentFolderPath, normalizePath, toFolderNodeId } from "@/features/graph/services/folderPath";

export class GraphProjectionService {
  buildVisualGraph(
    data: SerializedCodeGraph | null,
    exploded: Set<string>,
    explodedFolders: Set<string>,
    hidden: Set<string>
  ): VisualGraph {
    if (!data) {
      return { nodes: [], edges: [], topLinks: [] };
    }

    type FolderInfo = {
      path: string;
      name: string;
      parentPath: string;
      childFolders: Set<string>;
      moduleIds: Set<string>;
    };

    const folders = new Map<string, FolderInfo>();
    const ensureFolder = (folderPath: string): FolderInfo => {
      const normalized = normalizePath(folderPath);
      const cached = folders.get(normalized);
      if (cached) return cached;

      const parentPath = getParentFolderPath(normalized);
      const name = normalized.includes("/") ? normalized.slice(normalized.lastIndexOf("/") + 1) : normalized;
      const created: FolderInfo = {
        path: normalized,
        name,
        parentPath,
        childFolders: new Set<string>(),
        moduleIds: new Set<string>(),
      };

      folders.set(normalized, created);
      if (normalized) {
        const parent = ensureFolder(parentPath);
        parent.childFolders.add(normalized);
      }

      return created;
    };

    const rootFolder = ensureFolder("");

    for (const moduleId of data.modules) {
      const folderPath = getFolderPathForModule(moduleId);
      const folder = ensureFolder(folderPath);
      folder.moduleIds.add(moduleId);
    }

    const visibleEntities = new Set<string>();
    const visibleFolders = new Set<string>();

    const moduleVisibilityCache = new Map<string, boolean>();
    const hasVisibleContentInModule = (moduleId: string): boolean => {
      if (moduleVisibilityCache.has(moduleId)) return moduleVisibilityCache.get(moduleId)!;

      const entity = data.entities[moduleId];
      if (!entity || hidden.has(moduleId)) {
        moduleVisibilityCache.set(moduleId, false);
        return false;
      }

      const stack = [moduleId];
      while (stack.length > 0) {
        const currentId = stack.pop()!;
        const current = data.entities[currentId];
        if (!current) continue;
        if (!hidden.has(currentId)) {
          moduleVisibilityCache.set(moduleId, true);
          return true;
        }
        for (const childId of current.children) {
          stack.push(childId);
        }
      }

      moduleVisibilityCache.set(moduleId, false);
      return false;
    };

    const folderVisibilityCache = new Map<string, boolean>();
    const hasVisibleContentInFolder = (folderPath: string): boolean => {
      const normalized = normalizePath(folderPath);
      if (folderVisibilityCache.has(normalized)) return folderVisibilityCache.get(normalized)!;

      const folder = folders.get(normalized);
      if (!folder) {
        folderVisibilityCache.set(normalized, false);
        return false;
      }

      for (const moduleId of folder.moduleIds) {
        if (hasVisibleContentInModule(moduleId)) {
          folderVisibilityCache.set(normalized, true);
          return true;
        }
      }

      for (const childPath of folder.childFolders) {
        if (hasVisibleContentInFolder(childPath)) {
          folderVisibilityCache.set(normalized, true);
          return true;
        }
      }

      folderVisibilityCache.set(normalized, false);
      return false;
    };

    const visitEntityVisible = (id: string) => {
      const entity = data.entities[id];
      if (!entity || hidden.has(id)) return;

      const isExplodedContainer = exploded.has(id) && entity.children.length > 0;
      if (!isExplodedContainer) {
        if (visibleEntities.has(id)) return;
        visibleEntities.add(id);
      }

      if (!exploded.has(id)) return;
      for (const childId of entity.children) {
        visitEntityVisible(childId);
      }
    };

    const visitFolderVisible = (folderPath: string) => {
      const normalized = normalizePath(folderPath);
      const folder = folders.get(normalized);
      if (!folder || !hasVisibleContentInFolder(normalized)) return;

      if (normalized !== "" && !explodedFolders.has(normalized)) {
        visibleFolders.add(normalized);
        return;
      }

      for (const childPath of folder.childFolders) {
        visitFolderVisible(childPath);
      }

      for (const moduleId of folder.moduleIds) {
        if (data.entities[moduleId]) {
          visitEntityVisible(moduleId);
        }
      }
    };

    visitFolderVisible(rootFolder.path);

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

    const folderNodes: DomainNode[] = Array.from(visibleFolders).map((folderPath) => {
      const folder = folders.get(folderPath)!;
      const nodeId = toFolderNodeId(folderPath);
      const parentPath = folder.parentPath;
      const parentContainerId = parentPath ? toFolderNodeId(parentPath) : undefined;

      return {
        id: nodeId,
        label: folder.name,
        kind: "folder",
        filePath: folder.path,
        canExplode: true,
        parentContainerId,
        parentContainerLabel: parentPath ? folders.get(parentPath)?.name : undefined,
      };
    });

    const nodes: DomainNode[] = Array.from(visibleEntities).map((id) => {
      const entity = data.entities[id]!;
      const parent = entity.parent ? data.entities[entity.parent] : undefined;
      const displayName = parent?.kind === "class" ? `${parent.name}.${entity.name}` : entity.name;

      let parentContainerId: string | undefined;
      let parentContainerLabel: string | undefined;

      if (entity.parent && exploded.has(entity.parent)) {
        const parentEntity = data.entities[entity.parent];
        parentContainerId = parentEntity?.id;
        parentContainerLabel = parentEntity?.name;
      } else if (!entity.parent) {
        const folderPath = getFolderPathForModule(entity.id);
        if (folderPath && explodedFolders.has(folderPath)) {
          parentContainerId = toFolderNodeId(folderPath);
          parentContainerLabel = folders.get(folderPath)?.name;
        }
      }

      return {
        id,
        label: displayName,
        kind: entity.kind,
        subKind: entity.subKind,
        filePath: entity.kind === "module" ? entity.id : displayName,
        modulePath: entity.kind === "module" ? undefined : (getModuleAncestor(id) ?? undefined),
        canExplode: entity.canExplode,
        parentContainerId,
        parentContainerLabel,
      };
    });

    nodes.unshift(...folderNodes);

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

    const visibleContainerForModule = (moduleId: string): string => {
      if (nodeIds.has(moduleId)) return moduleId;

      let folderPath = getFolderPathForModule(moduleId);
      while (folderPath) {
        const folderNodeId = toFolderNodeId(folderPath);
        if (nodeIds.has(folderNodeId)) return folderNodeId;
        folderPath = getParentFolderPath(folderPath);
      }

      return moduleId;
    };

    const visibleNode = (id: EntityId): EntityId => {
      let cur: EntityId = id;
      while (true) {
        if (nodeIds.has(cur)) return cur;
        const e = data.entities[cur];
        if (!e?.parent) {
          return visibleContainerForModule(cur) as EntityId;
        }
        cur = e.parent as EntityId;
      }
    };

    const resolveImportedMemberTarget = (
      moduleId: EntityId,
      symbolName: string,
      isDefaultImport: boolean
    ): EntityId | null => {
      const moduleEntity = data.entities[moduleId];
      if (!moduleEntity || moduleEntity.kind !== "module") return null;

      const exportedVisibleChildren = moduleEntity.children
        .map((childId) => data.entities[childId])
        .filter((child): child is CodeEntity => Boolean(child && child.exported && nodeIds.has(child.id)));

      const namedMatch = exportedVisibleChildren.find((child) => child.name === symbolName);
      if (namedMatch) return namedMatch.id;

      if (!isDefaultImport) return null;

      const defaultMarked = exportedVisibleChildren.filter((child) => child.sourceText?.includes("export default"));
      if (defaultMarked.length === 1) return defaultMarked[0].id;

      if (exportedVisibleChildren.length === 1) return exportedVisibleChildren[0].id;

      return null;
    };

    const visibleTarget = (dep: (typeof data.dependencies)[number]): EntityId => {
      const targetEntity = data.entities[dep.target];
      if (
        targetEntity?.kind === "module" &&
        !dep.importedSymbol.isNamespace &&
        dep.importedSymbol.symbolName !== "*"
      ) {
        const mappedMember = resolveImportedMemberTarget(
          targetEntity.id,
          dep.importedSymbol.symbolName,
          dep.importedSymbol.isDefault
        );
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

    for (const id of visibleEntities) {
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
