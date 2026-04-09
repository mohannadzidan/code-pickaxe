import { type MouseEvent as ReactMouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CodeEntity, SerializedCodeGraph } from "@api/parsing/types";
import {
  Box,
  ChevronDown,
  ChevronRight,
  Crosshair,
  ChevronsDown,
  ChevronsUp,
  Eye,
  EyeOff,
  FileCode2,
  Folder,
  FolderOpen,
  PackageOpen,
  ScanLine,
  Shapes,
  Sigma,
  Target,
} from "lucide-react";
import { selectEntity } from "@/orchestrators/selectEntity";
import { getFolderPathForModule, getParentFolderPath, normalizePath } from "@/features/graph/services/folderPath";
import { services } from "@/app/bootstrap";
import { selectSelectedEntityId, useSelectionStore } from "@/features/selection/store/selectionStore";
import ContextMenu from "./ContextMenu";
import type { ContextMenuAction } from "./ContextMenu";

type Props = {
  graph: SerializedCodeGraph | null;
  explodedIds: Set<string>;
  explodedFolderPaths: Set<string>;
  hiddenIds: Set<string>;
  onExplode: (id: string) => void;
  onCollapse: (id: string) => void;
  onExplodeFolder: (folderPath: string) => void;
  onCollapseFolder: (folderPath: string) => void;
  onHide: (id: string) => void;
  onShow: (id: string) => void;
  onFocusInGraph: (nodeId: string) => void;
  onIsolate: (nodeId: string) => void;
  onShowDependenciesOnly: (nodeId: string) => void;
  onShowDependentsOnly: (nodeId: string) => void;
  onShowMoreRelationships: (nodeId: string) => void;
  revealRequest: { nodeId: string; token: number } | null;
};

type FolderItem = {
  id: string;
  type: "folder";
  name: string;
  path: string;
  children: ExplorerItem[];
};

type EntityItem = {
  id: string;
  type: "entity";
  name: string;
  entityId: string;
  kind: string;
  canExplode: boolean;
  children: ExplorerItem[];
};

type ExplorerItem = FolderItem | EntityItem;

type ExplorerMenuState = {
  itemId: string;
  top: number | false;
  left: number | false;
  right: number | false;
  bottom: number | false;
};

const collectVisibilityTargets = (item: ExplorerItem): string[] => {
  if (item.type === "entity") return [item.entityId];

  const targets: string[] = [];
  const visit = (next: ExplorerItem) => {
    if (next.type === "entity") {
      targets.push(next.entityId);
      return;
    }
    for (const child of next.children) visit(child);
  };

  for (const child of item.children) visit(child);
  return targets;
};

const KIND_ICON: Record<string, JSX.Element> = {
  module: <FileCode2 size={12} />,
  class: <Shapes size={12} />,
  function: <Sigma size={12} />,
  variable: <Sigma size={12} />,
  method: <Sigma size={12} />,
  property: <Sigma size={12} />,
  "code-block": <Box size={12} />,
};

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

const getBaseName = (modulePath: string): string => {
  const normalized = normalizePath(modulePath);
  const idx = normalized.lastIndexOf("/");
  return idx >= 0 ? normalized.slice(idx + 1) : normalized;
};

const getEntityDisplayName = (entity: CodeEntity): string => entity.subKind ? `${entity.name} (${entity.subKind})` : entity.name;

const sortedItems = (items: ExplorerItem[]): ExplorerItem[] => {
  return [...items].sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return collator.compare(a.name, b.name);
  });
};

const buildEntityTree = (entityId: string, graph: SerializedCodeGraph): EntityItem | null => {
  const entity = graph.entities[entityId];
  if (!entity) return null;

  const children = entity.children
    .map((childId) => buildEntityTree(childId, graph))
    .filter((child): child is EntityItem => Boolean(child));

  return {
    id: `entity:${entity.id}`,
    type: "entity",
    name: getEntityDisplayName(entity),
    entityId: entity.id,
    kind: entity.kind,
    canExplode: entity.canExplode,
    children: sortedItems(children),
  };
};

const buildTree = (graph: SerializedCodeGraph | null): ExplorerItem[] => {
  if (!graph) return [];

  const folderRoot: FolderItem = {
    id: "folder:root",
    type: "folder",
    name: "root",
    path: "",
    children: [],
  };

  const folderByPath = new Map<string, FolderItem>([["", folderRoot]]);

  const ensureFolder = (path: string): FolderItem => {
    const normalized = path.replace(/\\/g, "/");
    const cached = folderByPath.get(normalized);
    if (cached) return cached;

    const parentPath = getParentFolderPath(normalized);
    const parent = ensureFolder(parentPath);
    const folder: FolderItem = {
      id: `folder:${normalized}`,
      type: "folder",
      name: normalized === "" ? "root" : getBaseName(normalized),
      path: normalized,
      children: [],
    };

    parent.children.push(folder);
    folderByPath.set(normalized, folder);
    return folder;
  };

  for (const moduleId of graph.modules) {
    const moduleTree = buildEntityTree(moduleId, graph);
    if (!moduleTree) continue;

    const folderPath = getFolderPathForModule(moduleId);
    const folder = ensureFolder(folderPath);
    folder.children.push(moduleTree);
  }

  const sortRecursively = (items: ExplorerItem[]): ExplorerItem[] => {
    const sorted = sortedItems(items);
    for (const item of sorted) {
      if (item.children.length > 0) {
        item.children = sortRecursively(item.children);
      }
    }
    return sorted;
  };

  return sortRecursively(folderRoot.children);
};

const isEntityPacked = (
  entityId: string,
  graph: SerializedCodeGraph,
  explodedIds: Set<string>,
  explodedFolderPaths: Set<string>
): boolean => {
  const entity = graph.entities[entityId];
  if (entity?.children.length && !explodedIds.has(entityId)) return true;

  let current = graph.entities[entityId];

  while (current?.parent) {
    if (!explodedIds.has(current.parent)) return true;
    current = graph.entities[current.parent];
  }

  const folderPath = getFolderPathForModule(entityId);
  let cursor = folderPath;
  while (cursor) {
    if (!explodedFolderPaths.has(cursor)) return true;
    cursor = getParentFolderPath(cursor);
  }

  return false;
};

const getDefaultExpanded = (items: ExplorerItem[]): Set<string> => {
  const expanded = new Set<string>();

  const visit = (item: ExplorerItem) => {
    if (item.type === "folder") {
      expanded.add(item.id);
    }

    for (const child of item.children) {
      visit(child);
    }
  };

  for (const item of items) {
    visit(item);
  }

  return expanded;
};

export default function FileExplorer({
  graph,
  explodedIds,
  explodedFolderPaths,
  hiddenIds,
  onExplode,
  onCollapse,
  onExplodeFolder,
  onCollapseFolder,
  onHide,
  onShow,
  onFocusInGraph,
  onIsolate,
  onShowDependenciesOnly,
  onShowDependentsOnly,
  onShowMoreRelationships,
  revealRequest,
}: Props) {
  const selectedGraphId = useSelectionStore(selectSelectedEntityId);

  const tree = useMemo(() => buildTree(graph), [graph]);
  const builtinsAndExternalsFolder = useMemo<FolderItem | null>(() => {
    if (!graph || graph.externalModules.length === 0) return null;

    const externalChildren: EntityItem[] = [...graph.externalModules]
      .sort((a, b) => {
        if (a.isNodeBuiltin !== b.isNodeBuiltin) return a.isNodeBuiltin ? -1 : 1;
        return a.moduleSpecifier.localeCompare(b.moduleSpecifier);
      })
      .map((ext) => ({
        id: `entity:external:${ext.moduleSpecifier}`,
        type: "entity",
        name: ext.isNodeBuiltin ? `${ext.moduleSpecifier} (builtin)` : ext.moduleSpecifier,
        entityId: `external:${ext.moduleSpecifier}`,
        kind: "module",
        canExplode: false,
        children: [],
      }));

    return {
      id: "folder:builtins-externals",
      type: "folder",
      name: "builtins & externals",
      path: "__builtins_externals__",
      children: externalChildren,
    };
  }, [graph]);

  const explorerItems = useMemo(
    () => (builtinsAndExternalsFolder ? [...tree, builtinsAndExternalsFolder] : tree),
    [builtinsAndExternalsFolder, tree]
  );

  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => getDefaultExpanded(explorerItems));
  const [flashItemId, setFlashItemId] = useState<string | null>(null);
  const [menu, setMenu] = useState<ExplorerMenuState | null>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<string, HTMLDivElement>());

  const visualGraph = useMemo(
    () => services.graphProjectionService.buildVisualGraph(graph, explodedIds, explodedFolderPaths, hiddenIds),
    [graph, explodedIds, explodedFolderPaths, hiddenIds]
  );
  const relationGraph = useMemo(
    () => services.graphProjectionService.buildVisualGraph(graph, explodedIds, explodedFolderPaths, new Set<string>()),
    [graph, explodedIds, explodedFolderPaths]
  );
  const visibleNodeIds = useMemo(() => new Set(visualGraph.nodes.map((node) => node.id)), [visualGraph.nodes]);
  const dependencyEdges = useMemo(() => relationGraph.edges.filter((edge) => !edge.isOriginEdge), [relationGraph.edges]);

  const { itemById, parentById } = useMemo(() => {
    const itemMap = new Map<string, ExplorerItem>();
    const parentMap = new Map<string, string | null>();

    const visit = (item: ExplorerItem, parentId: string | null) => {
      itemMap.set(item.id, item);
      parentMap.set(item.id, parentId);
      for (const child of item.children) visit(child, item.id);
    };

    for (const item of explorerItems) visit(item, null);
    return { itemById: itemMap, parentById: parentMap };
  }, [explorerItems]);

  useEffect(() => {
    if (explorerItems.length === 0) return;
    setExpandedIds((prev) => {
      if (prev.size > 0) return prev;
      const defaults = getDefaultExpanded(explorerItems);
      if (builtinsAndExternalsFolder) defaults.add(builtinsAndExternalsFolder.id);
      return defaults;
    });
  }, [builtinsAndExternalsFolder, explorerItems]);

  const scrollToItem = useCallback((itemId: string) => {
    const element = itemRefs.current.get(itemId);
    if (!element) return;

    element.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    setFlashItemId(itemId);
    window.setTimeout(() => {
      setFlashItemId((prev) => (prev === itemId ? null : prev));
    }, 1000);
  }, []);

  useEffect(() => {
    if (!revealRequest) return;

    const targetItemId = revealRequest.nodeId.startsWith("folder:") ? revealRequest.nodeId : `entity:${revealRequest.nodeId}`;
    if (!itemById.has(targetItemId)) return;

    setExpandedIds((prev) => {
      const next = new Set(prev);
      let cursor: string | null | undefined = targetItemId;
      while (cursor) {
        next.add(cursor);
        cursor = parentById.get(cursor) ?? null;
      }
      return next;
    });

    window.requestAnimationFrame(() => {
      scrollToItem(targetItemId);
    });
  }, [itemById, parentById, revealRequest, scrollToItem]);

  useEffect(() => {
    if (!selectedGraphId) return;
    const targetItemId = selectedGraphId.startsWith("folder:") ? selectedGraphId : `entity:${selectedGraphId}`;
    if (!itemById.has(targetItemId)) return;

    setExpandedIds((prev) => {
      const next = new Set(prev);
      let cursor: string | null | undefined = targetItemId;
      while (cursor) {
        next.add(cursor);
        cursor = parentById.get(cursor) ?? null;
      }
      return next;
    });

    window.requestAnimationFrame(() => {
      scrollToItem(targetItemId);
    });
  }, [itemById, parentById, scrollToItem, selectedGraphId]);

  const toggleExpanded = (itemId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  };

  const expandRecursively = useCallback((item: ExplorerItem) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      const visit = (current: ExplorerItem) => {
        if (current.children.length > 0) next.add(current.id);
        for (const child of current.children) visit(child);
      };
      visit(item);
      return next;
    });
  }, []);

  const collapseRecursively = useCallback((item: ExplorerItem) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      const visit = (current: ExplorerItem) => {
        next.delete(current.id);
        for (const child of current.children) visit(child);
      };
      visit(item);
      return next;
    });
  }, []);

  const collectDescendantFolderPaths = useCallback((item: ExplorerItem): string[] => {
    const result: string[] = [];
    const visit = (current: ExplorerItem) => {
      if (current.type === "folder") result.push(current.path);
      for (const child of current.children) visit(child);
    };
    visit(item);
    return result.filter((path) => path.length > 0);
  }, []);

  const collectExplodableEntityIds = useCallback((item: ExplorerItem): string[] => {
    const result: string[] = [];
    const visit = (current: ExplorerItem) => {
      if (current.type === "entity" && current.canExplode && current.children.length > 0) {
        result.push(current.entityId);
      }
      for (const child of current.children) visit(child);
    };
    visit(item);
    return result;
  }, []);

  const collectSubtreeItems = useCallback((item: ExplorerItem): ExplorerItem[] => {
    const result: ExplorerItem[] = [];
    const visit = (current: ExplorerItem) => {
      result.push(current);
      for (const child of current.children) visit(child);
    };
    visit(item);
    return result;
  }, []);

  const collectSubtreeModuleIds = useCallback((item: ExplorerItem): string[] => {
    const result: string[] = [];
    const visit = (current: ExplorerItem) => {
      if (current.type === "entity" && current.kind === "module") {
        result.push(current.entityId);
      }
      for (const child of current.children) visit(child);
    };
    visit(item);
    return result;
  }, []);

  const findItemById = useCallback((itemId: string): ExplorerItem | null => {
    return itemById.get(itemId) ?? null;
  }, [itemById]);

  const closeMenu = useCallback(() => setMenu(null), []);

  const onItemContextMenu = useCallback((event: ReactMouseEvent, item: ExplorerItem) => {
    event.preventDefault();
    const selectedId = item.type === "folder" ? item.id : item.entityId;
    selectEntity(selectedId);

    const pane = paneRef.current?.getBoundingClientRect();
    if (!pane) return;

    setMenu({
      itemId: item.id,
      top: event.clientY < pane.height - 210 ? event.clientY - pane.top : false,
      left: event.clientX < pane.width - 220 ? event.clientX - pane.left : false,
      right: event.clientX >= pane.width - 220 ? pane.width - (event.clientX - pane.left) : false,
      bottom: event.clientY >= pane.height - 210 ? pane.height - (event.clientY - pane.top) : false,
    });
  }, []);

  const menuItem = useMemo(() => (menu ? findItemById(menu.itemId) : null), [findItemById, menu]);

  const menuActions = useMemo<ContextMenuAction[]>(() => {
    if (!menuItem) return [];

    const actions: ContextMenuAction[] = [];
    const hasChildren = menuItem.children.length > 0;
    const subtreeItems = collectSubtreeItems(menuItem);
    const graphNodeId = menuItem.type === "folder" ? menuItem.id : menuItem.entityId;
    const isVisibleInGraph = visibleNodeIds.has(graphNodeId);
    const subtreeModules = collectSubtreeModuleIds(menuItem);
    const visibilityTargets = collectVisibilityTargets(menuItem);
    const hasVisibleTargets = visibilityTargets.some((id) => !hiddenIds.has(id));
    const hasHiddenTargets = visibilityTargets.some((id) => hiddenIds.has(id));

    const expandableItems = subtreeItems.filter((item) => item.children.length > 0);
    const hasExpandedInTree = expandableItems.some((item) => expandedIds.has(item.id));
    const hasCollapsedInTree = expandableItems.some((item) => !expandedIds.has(item.id));

    const hasDependencyEdges = menuItem.type === "entity"
      ? dependencyEdges.some((edge) => edge.source === menuItem.entityId || edge.target === menuItem.entityId)
      : false;
    const hasOutgoingEdges = menuItem.type === "entity"
      ? dependencyEdges.some((edge) => edge.source === menuItem.entityId)
      : false;
    const hasIncomingEdges = menuItem.type === "entity"
      ? dependencyEdges.some((edge) => edge.target === menuItem.entityId)
      : false;

    const moduleIsPacked = menuItem.type === "entity" && menuItem.kind === "module" && graph
      ? isEntityPacked(menuItem.entityId, graph, explodedIds, explodedFolderPaths)
      : false;
    const moduleCanPackUnpack = menuItem.type === "entity" && menuItem.kind === "module" && menuItem.children.length > 0;

    if (menuItem.type === "folder") {
      const folderPaths = collectDescendantFolderPaths(menuItem);
      const explodableEntities = collectExplodableEntityIds(menuItem);
      const allEntities = collectVisibilityTargets(menuItem);

      const folderIsPacked = menuItem.path.length > 0 && !explodedFolderPaths.has(menuItem.path);
      if (hasChildren && folderIsPacked) {
        actions.push({
          id: "unpack",
          label: "Unpack",
          icon: <FolderOpen size={13} />,
          onSelect: () => onExplodeFolder(menuItem.path),
        });
      }
      if (hasChildren && !folderIsPacked) {
        actions.push({
          id: "pack",
          label: "Pack",
          icon: <PackageOpen size={13} />,
          onSelect: () => onCollapseFolder(menuItem.path),
        });
      }

      const hasPackedModules = Boolean(
        graph && subtreeModules.some((moduleId) => isEntityPacked(moduleId, graph, explodedIds, explodedFolderPaths))
      );
      const hasUnpackedModules = subtreeModules.some((moduleId) => explodedIds.has(moduleId));
      const hasAnyUnpackedItems =
        folderPaths.some((folderPath) => explodedFolderPaths.has(folderPath)) ||
        explodableEntities.some((id) => explodedIds.has(id));

      if (hasPackedModules) {
        actions.push({
          id: "unpack-all-modules",
          label: "Unpack all to modules",
          icon: <FolderOpen size={13} />,
          onSelect: () => {
            for (const id of allEntities) onShow(id);
            for (const folderPath of folderPaths) onExplodeFolder(folderPath);
            for (const id of explodableEntities) onCollapse(id);
          },
        });
      }

      if (hasUnpackedModules) {
        actions.push({
          id: "pack-all-modules",
          label: "Pack all to modules",
          icon: <PackageOpen size={13} />,
          onSelect: () => {
            for (const id of allEntities) onShow(id);
            for (const id of explodableEntities) onCollapse(id);
          },
        });
      }

      actions.push({
        id: "unpack-all-entities",
        label: "Unpack all to entities",
        icon: <FolderOpen size={13} />,
        onSelect: () => {
          for (const id of allEntities) onShow(id);
          for (const folderPath of folderPaths) onExplodeFolder(folderPath);
          for (const id of explodableEntities) onExplode(id);
        },
      });

      if (hasAnyUnpackedItems) {
        actions.push({
          id: "pack-all",
          label: "Pack all",
          icon: <PackageOpen size={13} />,
          onSelect: () => {
            for (const id of explodableEntities) onCollapse(id);
            for (const folderPath of folderPaths) onCollapseFolder(folderPath);
          },
        });
      }

      if (hasVisibleTargets) {
        actions.push({
          id: "hide-all",
          label: "Hide all",
          icon: <EyeOff size={13} />,
          onSelect: () => {
            for (const id of allEntities) onHide(id);
          },
        });
      }

      if (hasHiddenTargets) {
        actions.push({
          id: "show-all",
          label: "Show all",
          icon: <Eye size={13} />,
          onSelect: () => {
            for (const id of allEntities) onShow(id);
          },
        });
      }
    }

    if (moduleCanPackUnpack && moduleIsPacked) {
      actions.push({
        id: "unpack",
        label: "Unpack",
        icon: <FolderOpen size={13} />,
        onSelect: () => onExplode(menuItem.entityId),
      });
    }

    if (moduleCanPackUnpack && !moduleIsPacked) {
      actions.push({
        id: "pack",
        label: "Pack",
        icon: <PackageOpen size={13} />,
        onSelect: () => onCollapse(menuItem.entityId),
      });
    }

    if (menuItem.type === "entity" && menuItem.kind === "module") {
      if (hasVisibleTargets) {
        actions.push({
          id: "hide-all",
          label: "Hide all",
          icon: <EyeOff size={13} />,
          onSelect: () => {
            for (const id of visibilityTargets) onHide(id);
          },
        });
      }

      if (hasHiddenTargets) {
        actions.push({
          id: "show-all",
          label: "Show all",
          icon: <Eye size={13} />,
          onSelect: () => {
            for (const id of visibilityTargets) onShow(id);
          },
        });
      }
    }

    if (hasExpandedInTree) {
      actions.push({
        id: "fold-all",
        label: "Fold all",
        icon: <ChevronsUp size={13} />,
        onSelect: () => {
          collapseRecursively(menuItem);
        },
      });
    }

    if (hasCollapsedInTree) {
      actions.push({
        id: "unfold-all",
        label: "Unfold all",
        icon: <ChevronsDown size={13} />,
        onSelect: () => {
          expandRecursively(menuItem);
        },
      });
    }

    if (isVisibleInGraph) {
      actions.push({
        id: "focus-in-graph",
        label: "Focus in graph",
        icon: <Crosshair size={13} />,
        onSelect: () => onFocusInGraph(graphNodeId),
      });
    }

    if (visualGraph.nodes.length > 1) {
      actions.push({
        id: "isolate",
        label: "Isolate",
        icon: <Target size={13} />,
        onSelect: () => onIsolate(graphNodeId),
      });
    }

    if (menuItem.type === "entity" && menuItem.kind !== "folder" && hasDependencyEdges && hasOutgoingEdges) {
      actions.push({
        id: "show-dependencies-only",
        label: "Show dependencies only",
        icon: <ScanLine size={13} />,
        onSelect: () => onShowDependenciesOnly(menuItem.entityId),
      });
    }

    if (menuItem.type === "entity" && menuItem.kind !== "folder" && hasDependencyEdges && hasIncomingEdges) {
      actions.push({
        id: "show-dependents-only",
        label: "Show dependents only",
        icon: <ScanLine size={13} />,
        onSelect: () => onShowDependentsOnly(menuItem.entityId),
      });
    }

    if (menuItem.type === "entity" && hasDependencyEdges) {
      actions.push({
        id: "show-more-relationships",
        label: "Show more relationships",
        icon: <ScanLine size={13} />,
        onSelect: () => onShowMoreRelationships(menuItem.entityId),
      });
    }

    return actions;
  }, [
    collapseRecursively,
    collectDescendantFolderPaths,
    collectExplodableEntityIds,
    collectSubtreeItems,
    collectSubtreeModuleIds,
    dependencyEdges,
    expandedIds,
    explodedFolderPaths,
    explodedIds,
    graph,
    hiddenIds,
    menuItem,
    onCollapse,
    onCollapseFolder,
    onExplode,
    onFocusInGraph,
    onHide,
    onIsolate,
    onExplodeFolder,
    onShowDependenciesOnly,
    onShowDependentsOnly,
    onShowMoreRelationships,
    onShow,
    visibleNodeIds,
    visualGraph.nodes.length,
    expandRecursively,
  ]);

  const renderItem = (item: ExplorerItem, depth: number): JSX.Element => {
    const hasChildren = item.children.length > 0;
    const isExpanded = expandedIds.has(item.id);
    const graphNodeId = item.type === "folder" ? item.id : item.entityId;
    const isSelected = selectedGraphId === graphNodeId;
    const isFlashing = flashItemId === item.id;
    const visibilityTargets = collectVisibilityTargets(item);

    const isPacked = item.type === "entity" && graph
      ? isEntityPacked(item.entityId, graph, explodedIds, explodedFolderPaths)
      : false;
    const isHidden = visibilityTargets.length > 0 && visibilityTargets.every((id) => hiddenIds.has(id));
    const canToggleVisibility = item.type === "folder" || !isPacked;

    const hasExplodable = hasChildren && (item.type === "folder" || item.canExplode);
    const hasExploded = item.type === "folder"
      ? explodedFolderPaths.has(item.path)
      : explodedIds.has(item.entityId);

    const onToggleVisibility = () => {
      if (isHidden) {
        for (const id of visibilityTargets) onShow(id);
      } else {
        for (const id of visibilityTargets) onHide(id);
      }
    };

    const onToggleExplode = () => {
      if (!hasExplodable) return;
      if (item.type === "folder") {
        if (hasExploded) onCollapseFolder(item.path);
        else onExplodeFolder(item.path);
        return;
      }

      if (hasExploded) onCollapse(item.entityId);
      else onExplode(item.entityId);
    };

    const itemIcon = item.type === "folder" ? <Folder size={12} /> : KIND_ICON[item.kind] ?? <Box size={12} />;

    return (
      <div key={item.id}>
        <div
          ref={(node) => {
            if (node) itemRefs.current.set(item.id, node);
            else itemRefs.current.delete(item.id);
          }}
          onContextMenu={(event) => onItemContextMenu(event, item)}
          onClick={() => {
            if (hasChildren) toggleExpanded(item.id);
            selectEntity(graphNodeId);
            onFocusInGraph(graphNodeId);
          }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "5px 8px",
            paddingLeft: 8 + depth * 16,
            borderRadius: 6,
            color: isSelected ? "#e2e8f0" : "#cbd5e1",
            fontSize: 12,
            fontFamily: "Inter, system-ui, sans-serif",
            userSelect: "none",
            background: isSelected ? "#1e293b" : isFlashing ? "#334155" : "transparent",
            boxShadow: isSelected ? "inset 0 0 0 1px #334155" : "none",
            transition: "background 0.2s, box-shadow 0.2s",
          }}
          onMouseEnter={(event) => {
            if (!isSelected) event.currentTarget.style.background = "#1e293b";
          }}
          onMouseLeave={(event) => {
            if (!isSelected) event.currentTarget.style.background = isFlashing ? "#334155" : "transparent";
          }}
        >
          {hasChildren ? (
            <button
              onClick={(event) => {
                event.stopPropagation();
                toggleExpanded(item.id);
              }}
              style={{
                width: 16,
                height: 16,
                border: "none",
                background: "transparent",
                color: "#94a3b8",
                cursor: "pointer",
                padding: 0,
                lineHeight: "16px",
              }}
              aria-label={isExpanded ? "Collapse" : "Expand"}
            >
              {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>
          ) : (
            <span style={{ width: 16 }} />
          )}

          <span style={{ width: 14, textAlign: "center", color: "#94a3b8", display: "inline-flex", justifyContent: "center" }}>{itemIcon}</span>

          <button
            style={{
              border: "none",
              background: "transparent",
              color: "inherit",
              fontSize: 12,
              padding: 0,
              margin: 0,
              cursor: item.type === "entity" ? "pointer" : "default",
              textAlign: "left",
              flex: 1,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={item.type === "folder" ? item.path : item.entityId}
          >
            {item.name}
          </button>

          <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: "auto" }}>
            {canToggleVisibility && visibilityTargets.length > 0 && (
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleVisibility();
                }}
                style={{
                  border: "none",
                  background: "transparent",
                  color: isHidden ? "#f59e0b" : "#94a3b8",
                  cursor: "pointer",
                  fontSize: 12,
                  padding: "2px 4px",
                }}
                title={isHidden ? "Show in graph" : "Hide from graph"}
                aria-label={isHidden ? "Show in graph" : "Hide from graph"}
              >
                {isHidden ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            )}

            {hasExplodable && (
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleExplode();
                }}
                style={{
                  border: "none",
                  background: "transparent",
                  color: hasExploded ? "#38bdf8" : "#94a3b8",
                  cursor: "pointer",
                  fontSize: 12,
                  padding: "2px 4px",
                }}
                title={hasExploded ? "Pack in graph" : "Extract in graph"}
                aria-label={hasExploded ? "Pack in graph" : "Extract in graph"}
              >
                {hasExploded ? <PackageOpen size={13} /> : <Box size={13} />}
              </button>
            )}
          </div>
        </div>

        {hasChildren && isExpanded && <div>{item.children.map((child) => renderItem(child, depth + 1))}</div>}
      </div>
    );
  };

  return (
    <div
      ref={paneRef}
      onClick={closeMenu}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        background: "#0f172a",
        color: "#e2e8f0",
        borderRight: "1px solid #1e293b",
        overflow: "auto",
        padding: "10px 8px",
      }}
    >
      <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.7, color: "#94a3b8", padding: "0 6px 8px" }}>
        Files Explorer
      </div>
      <div>{explorerItems.map((item) => renderItem(item, 0))}</div>
      {menu && <ContextMenu {...menu} actions={menuActions} minWidth={210} onClose={closeMenu} />}
    </div>
  );
}
