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
  PackageOpen,
  Shapes,
  Sigma,
} from "lucide-react";
import { selectEntity } from "@/orchestrators/selectEntity";
import { getFolderPathForModule, getParentFolderPath, normalizePath } from "@/features/graph/services/folderPath";
import { selectSelectedEntityId, useSelectionStore } from "@/features/selection/store/selectionStore";
import { useGraphStore } from "@/features/graph/store/graphStore";
import type { GraphState } from "@/shared/types/domain";
import ContextMenu from "./ContextMenu";
import type { ContextMenuAction } from "./ContextMenu";
import { useCommands } from "@/features/commands/useCommands";

type Props = {
  graph: SerializedCodeGraph | null;
  graphNodes: GraphState["nodes"];
  onFocusInGraph: (nodeId: string) => void;
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
    canExplode: entity.children.length > 0,
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
  childByParent: Map<string, string[]>,
  hiddenById: Record<string, boolean>
): boolean => {
  const entity = graph.entities[entityId];
  if (!entity || entity.children.length === 0) return false;

  const directChildren = childByParent.get(entityId) ?? [];
  if (directChildren.length === 0) return true;

  return directChildren.every((childId) => hiddenById[childId]);
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
  graphNodes,
  onFocusInGraph,
  revealRequest,
}: Props) {
  const selectedGraphId = useSelectionStore(selectSelectedEntityId);
  const availableCommands = useCommands('explorer');

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

  const collectSubtreeItems = useCallback((item: ExplorerItem): ExplorerItem[] => {
    const result: ExplorerItem[] = [];
    const visit = (current: ExplorerItem) => {
      result.push(current);
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

    const graphNodeId = menuItem.type === "folder" ? menuItem.id : menuItem.entityId;
    const ctx = { activeSurface: 'explorer' as const, selectedEntityId: graphNodeId };

    // Commands that map to this item type
    const commandIds = new Set([
      'unpack', 'pack',
      'packAll', 'unpackAllToModules', 'packAllToModules', 'unpackAllToEntities',
      'hide', 'showAll',
      'isolate', 'showDependenciesOnly', 'showDependentsOnly', 'showMoreRelationships',
    ]);

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

    // Tree fold/unfold — not graph commands, purely UI tree state
    const subtreeItems = collectSubtreeItems(menuItem);
    const expandableItems = subtreeItems.filter((item) => item.children.length > 0);
    const hasExpandedInTree = expandableItems.some((item) => expandedIds.has(item.id));
    const hasCollapsedInTree = expandableItems.some((item) => !expandedIds.has(item.id));

    if (hasExpandedInTree) {
      actions.push({
        id: "fold-all",
        label: "Fold all",
        icon: <ChevronsUp size={13} />,
        onSelect: () => collapseRecursively(menuItem),
      });
    }

    if (hasCollapsedInTree) {
      actions.push({
        id: "unfold-all",
        label: "Unfold all",
        icon: <ChevronsDown size={13} />,
        onSelect: () => expandRecursively(menuItem),
      });
    }

    // Focus in graph — not a command
    const isVisibleInGraph = !hiddenById[graphNodeId];
    if (isVisibleInGraph) {
      actions.push({
        id: "focus-in-graph",
        label: "Focus in graph",
        icon: <Crosshair size={13} />,
        onSelect: () => onFocusInGraph(graphNodeId),
      });
    }

    return actions;
  }, [
    availableCommands,
    collapseRecursively,
    collectSubtreeItems,
    expandRecursively,
    expandedIds,
    hiddenById,
    menuItem,
    onFocusInGraph,
  ]);

  const renderItem = (item: ExplorerItem, depth: number): JSX.Element => {
    const hasChildren = item.children.length > 0;
    const isExpanded = expandedIds.has(item.id);
    const graphNodeId = item.type === "folder" ? item.id : item.entityId;
    const isSelected = selectedGraphId === graphNodeId;
    const isFlashing = flashItemId === item.id;
    const visibilityTargets = collectVisibilityTargets(item);

    const isPacked = item.type === "entity" && graph
      ? isEntityPacked(item.entityId, graph, childByParent, hiddenById)
      : false;
    const isHidden = visibilityTargets.length > 0 && visibilityTargets.every((id) => hiddenById[id]);
    const canToggleVisibility = item.type === "folder" || !isPacked;

    const hasExplodable = hasChildren && (item.type === "folder" || item.canExplode);
    const hasExploded = item.type === "folder"
      ? (() => {
        const children = childByParent.get(item.id) ?? [];
        return children.some((id) => !hiddenById[id]);
      })()
      : (() => {
        const children = childByParent.get(item.entityId) ?? [];
        return children.some((id) => !hiddenById[id]);
      })();

    const onToggleVisibility = () => {
      const store = useGraphStore.getState();
      if (isHidden) {
        for (const id of visibilityTargets) store.showEntity(id);
      } else {
        for (const id of visibilityTargets) store.hideEntity(id);
      }
    };

    const onToggleExplode = () => {
      if (!hasExplodable) return;
      const store = useGraphStore.getState();
      if (item.type === "folder") {
        if (hasExploded) store.collapseEntity(item.id);
        else store.explodeEntity(item.id);
        return;
      }
      if (hasExploded) store.collapseEntity(item.entityId);
      else store.explodeEntity(item.entityId);
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
          className="flex items-center gap-2 px-2 py-1 rounded-[6px] text-[12px] select-none transition-colors duration-200"
          style={{
            paddingLeft: 4 + depth * 8,
            color: isSelected ? "#e2e8f0" : "#cbd5e1",
            background: isSelected ? "#1e293b" : isFlashing ? "#334155" : "transparent",
            boxShadow: isSelected ? "inset 0 0 0 1px #334155" : "none",
          }}
        >
          {hasChildren ? (
            <button
              onClick={(event) => {
                event.stopPropagation();
                toggleExpanded(item.id);
              }}
              className="w-4 h-4 bg-transparent border-0 p-0 leading-[16px] text-[#94a3b8] cursor-pointer"
              aria-label={isExpanded ? "Collapse" : "Expand"}
            >
              {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>
          ) : (
            <span className="w-4" />
          )}

          <span className="w-[14px] text-[#94a3b8] inline-flex justify-center">{itemIcon}</span>

          <button
            className="border-0 bg-transparent text-inherit text-[12px] p-0 m-0 text-left flex-1 overflow-hidden truncate"
            style={{ cursor: item.type === "entity" ? "pointer" : "default" }}
            title={item.type === "folder" ? item.path : item.entityId}
          >
            {item.name}
          </button>

          <div className="flex items-center gap-1 ml-auto">
            {canToggleVisibility && visibilityTargets.length > 0 && (
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleVisibility();
                }}
                className="border-0 bg-transparent text-[12px] px-1 py-[2px] cursor-pointer"
                style={{ color: isHidden ? "#f59e0b" : "#94a3b8" }}
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
                className="border-0 bg-transparent text-[12px] px-1 py-[2px] cursor-pointer"
                style={{ color: hasExploded ? "#38bdf8" : "#94a3b8" }}
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
    <div ref={paneRef} onClick={closeMenu} className="relative w-full h-full bg-[#0f172a] text-[#e2e8f0] border-r border-[#1e293b] overflow-auto p-[10px_8px]">
      <div className="text-[12px] uppercase tracking-[0.7px] text-[#94a3b8] px-[6px] pb-[8px]">Files Explorer</div>
      <div>{explorerItems.map((item) => renderItem(item, 0))}</div>
      {menu && <ContextMenu {...menu} actions={menuActions} minWidth={210} onClose={closeMenu} />}
    </div>
  );
}
