import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  NodeChange,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type EdgeTypes,
  type Node,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import * as d3Force from "d3-force";
import { trpc } from "@/utils/trpc";
import type { CodeEntity, EntityId, SerializedCodeGraph } from "@api/parsing/types";
import FileNode from "./FileNode";
import FloatingEdge from "./FloatingEdge";
import GroupNode from "./GroupNode";
import ContextMenu from "./ContextMenu";
import { GraphCallbacksContext } from "./graphContext";

// ── Type registrations ────────────────────────────────────────────────────────

const nodeTypes: NodeTypes = { file: FileNode, container: GroupNode };
const edgeTypes: EdgeTypes = { floating: FloatingEdge };

// ── Layout constants ──────────────────────────────────────────────────────────

const NODE_W = 'auto';
const NODE_H = 36;           // collapsed header height
const GROUP_PAD_TOP = 48;    // room for the label chip
const GROUP_PAD_SIDES = 16;
const GROUP_PAD_BOTTOM = 12;
const CHILD_GAP = 10;

// ── Expanded node height ──────────────────────────────────────────────────────

function expandedHeight(sourceText: string | undefined): number {
  if (!sourceText) return NODE_H;
  const lines = sourceText.split("\n").length;
  const codeH = Math.min(lines * 16 + 20, 220); // max 220px for code
  return NODE_H + codeH;
}

function nodeHeight(
  entityId: string,
  expandedCodes: Set<string>,
  entities: Record<string, CodeEntity>,
): number {
  if (!expandedCodes.has(entityId)) return NODE_H;
  const e = entities[entityId];
  return expandedHeight(e?.sourceText);
}

// ── Group sizing ──────────────────────────────────────────────────────────────

function childrenStackHeight(
  ids: EntityId[],
  explodedIds: Set<string>,
  expandedCodes: Set<string>,
  entities: Record<string, CodeEntity>,
): number {
  let h = 0;
  for (const id of ids) {
    const e = entities[id];
    if (!e) continue;
    if (explodedIds.has(id) && e.children.length > 0) {
      h +=
        GROUP_PAD_TOP +
        childrenStackHeight(e.children as EntityId[], explodedIds, expandedCodes, entities) +
        GROUP_PAD_BOTTOM +
        CHILD_GAP;
    } else {
      h += nodeHeight(id, expandedCodes, entities) + CHILD_GAP;
    }
  }
  return h;
}

function groupDims(
  ids: EntityId[],
  explodedIds: Set<string>,
  expandedCodes: Set<string>,
  entities: Record<string, CodeEntity>,
) {
  return {
    w: NODE_W + GROUP_PAD_SIDES * 2,
    h:
      GROUP_PAD_TOP +
      childrenStackHeight(ids, explodedIds, expandedCodes, entities) +
      GROUP_PAD_BOTTOM,
  };
}

// ── Build child nodes (recursive) ─────────────────────────────────────────────

function buildChildren(
  ids: EntityId[],
  parentId: EntityId,
  explodedIds: Set<string>,
  expandedCodes: Set<string>,
  entities: Record<string, CodeEntity>,
  out: Node[],
  startY: number,
): void {
  let y = startY;
  for (const id of ids) {
    const e = entities[id];
    if (!e) continue;

    if (explodedIds.has(id) && e.children.length > 0) {
      const { w, h } = groupDims(
        e.children as EntityId[],
        explodedIds,
        expandedCodes,
        entities,
      );
      out.push({
        id,
        type: "container",
        parentId,
        extent: "parent",
        position: { x: GROUP_PAD_SIDES, y },
        style: { width: w, height: h },
        data: { label: e.name, kind: e.kind },
      });
      buildChildren(
        e.children as EntityId[],
        id,
        explodedIds,
        expandedCodes,
        entities,
        out,
        GROUP_PAD_TOP,
      );
      y += h + CHILD_GAP;
    } else {
      const h = nodeHeight(id, expandedCodes, entities);
      out.push({
        id,
        type: "file",
        parentId,
        extent: "parent",
        position: { x: GROUP_PAD_SIDES, y },
        style: { width: NODE_W, height: h },
        data: {
          label: e.name,
          kind: e.kind,
          sourceText: e.sourceText,
          filePath: e.name,
          isExpanded: expandedCodes.has(id),
        },
      });
      y += h + CHILD_GAP;
    }
  }
}

// ── Build visual graph ─────────────────────────────────────────────────────────

function buildVisualGraph(
  data: SerializedCodeGraph,
  explodedIds: Set<string>,
  expandedCodes: Set<string>,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];

  // Internal modules — parents must appear before children
  for (const moduleId of data.modules) {
    const m = data.entities[moduleId];
    if (!m) continue;
    const members = m.children as EntityId[];

    if (explodedIds.has(moduleId)) {
      const { w, h } = groupDims(members, explodedIds, expandedCodes, data.entities);
      nodes.push({
        id: moduleId,
        type: "container",
        position: { x: 0, y: 0 },
        style: { width: w, height: h },
        data: { label: m.name, kind: "module" },
      });
      buildChildren(
        members,
        moduleId,
        explodedIds,
        expandedCodes,
        data.entities,
        nodes,
        GROUP_PAD_TOP,
      );
    } else {
      const h = nodeHeight(moduleId, expandedCodes, data.entities);
      nodes.push({
        id: moduleId,
        type: "file",
        position: { x: 0, y: 0 },
        style: { width: NODE_W, height: h },
        data: {
          label: m.name,
          kind: "module",
          filePath: moduleId,
          sourceText: m.sourceText,
          isExpanded: expandedCodes.has(moduleId),
        },
      });
    }
  }

  // External modules
  for (const ext of data.externalModules) {
    const id = `external:${ext.moduleSpecifier}`;
    nodes.push({
      id,
      type: "file",
      position: { x: 0, y: 0 },
      style: { width: NODE_W, height: NODE_H },
      data: {
        label: ext.moduleSpecifier,
        kind: "module",
        filePath: ext.moduleSpecifier,
        isExternal: true,
      },
    });
  }

  // Edges
  const nodeIds = new Set(nodes.map((n) => n.id));
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  function topAncestor(id: string): string {
    let cur = id;
    while (true) {
      const n = nodeMap.get(cur);
      if (!n?.parentId) return cur;
      cur = n.parentId;
    }
  }

  function visibleSrc(id: EntityId): EntityId {
    let cur: EntityId = id;
    while (true) {
      if (nodeIds.has(cur)) return cur;
      const e = data.entities[cur];
      if (!e?.parent) return cur;
      cur = e.parent as EntityId;
    }
  }

  const CTX: Record<string, string> = {
    call: "call",
    instantiation: "new",
    "type-annotation": "type",
    reference: "ref",
    extends: "extends",
    implements: "impl",
  };

  const edgeMap = new Map<string, { edge: Edge; contexts: Set<string> }>();
  for (const dep of data.dependencies) {
    const srcId = visibleSrc(dep.source);
    const tgtId = dep.target;
    if (!nodeIds.has(srcId) || !nodeIds.has(tgtId)) continue;
    if (srcId === tgtId) continue;

    const key = `${srcId}→${tgtId}`;
    const ctxs = dep.usages.map((u) => CTX[u.context] ?? u.context);
    if (!edgeMap.has(key)) {
      edgeMap.set(key, {
        edge: {
          id: key,
          source: srcId,
          target: tgtId,
          type: "floating",
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: "#94a3b8",
            width: 14,
            height: 14,
          },
          style: { stroke: "#94a3b8", strokeWidth: 1.5 },
          label: "",
        },
        contexts: new Set(ctxs),
      });
    } else {
      ctxs.forEach((c) => edgeMap.get(key)!.contexts.add(c));
    }
  }

  const edges = Array.from(edgeMap.values()).map(({ edge, contexts }) => ({
    ...edge,
    label: Array.from(contexts).filter(Boolean).join(" • ") || undefined,
  }));

  return { nodes, edges };
}

// ── d3-force layout ───────────────────────────────────────────────────────────

interface SimNode extends d3Force.SimulationNodeDatum {
  id: string;
  w: number;
  h: number;
}

function runForceLayout(
  nodes: Node[],
  edges: Edge[],
  startPositions: Map<string, { x: number; y: number }>,
  iterations: number,
): Node[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  function topAncestor(id: string): string {
    let cur = id;
    while (true) {
      const n = nodeMap.get(cur);
      if (!n?.parentId) return cur;
      cur = n.parentId;
    }
  }

  const topLevel = nodes.filter((n) => !n.parentId);
  const topIds = new Set(topLevel.map((n) => n.id));

  const simNodes: SimNode[] = topLevel.map((n) => ({
    id: n.id,
    w: (n.style?.width as number) ?? NODE_W,
    h: (n.style?.height as number) ?? NODE_H,
    x: startPositions.get(n.id)?.x ?? Math.random() * 800 - 400,
    y: startPositions.get(n.id)?.y ?? Math.random() * 800 - 400,
  }));

  const idToIndex = new Map(simNodes.map((n, i) => [n.id, i]));

  const linkSet = new Set<string>();
  const simLinks: d3Force.SimulationLinkDatum<SimNode>[] = [];
  for (const e of edges) {
    const src = topAncestor(e.source);
    const tgt = topAncestor(e.target);
    if (src === tgt || !topIds.has(src) || !topIds.has(tgt)) continue;
    const k = `${src}-${tgt}`;
    if (linkSet.has(k)) continue;
    linkSet.add(k);
    simLinks.push({
      source: idToIndex.get(src)!,
      target: idToIndex.get(tgt)!,
    });
  }

  const sim = d3Force
    .forceSimulation<SimNode>(simNodes)
    .force(
      "link",
      d3Force.forceLink<SimNode, d3Force.SimulationLinkDatum<SimNode>>(simLinks)
        .distance(320)
        .strength(0.08),
    )
    .force("charge", d3Force.forceManyBody<SimNode>().strength(-900))
    .force(
      "collide",
      d3Force
        .forceCollide<SimNode>()
        .radius((n) => Math.sqrt(n.w ** 2 + n.h ** 2) / 2 + 24)
        .strength(1),
    )
    .force("x", d3Force.forceX<SimNode>(0).strength(0.04))
    .force("y", d3Force.forceY<SimNode>(0).strength(0.04))
    .stop();

  for (let i = 0; i < iterations; i++) sim.tick();

  const posMap = new Map(sim.nodes().map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }]));

  return nodes.map((n) => {
    if (n.parentId) return n;
    const pos = posMap.get(n.id);
    return pos ? { ...n, position: pos } : n;
  });
}

// ── Context menu state ────────────────────────────────────────────────────────

type MenuState = {
  nodeId: string;
  top: number | false;
  left: number | false;
  right: number | false;
  bottom: number | false;
};

// ── Inner flow ────────────────────────────────────────────────────────────────

function LayoutFlow({ data }: { data: SerializedCodeGraph }) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [explodedIds, setExplodedIds] = useState<Set<string>>(() => new Set());
  const [expandedCodes, setExpandedCodes] = useState<Set<string>>(() => new Set());
  const [menu, setMenu] = useState<MenuState | null>(null);
  const flowRef = useRef<HTMLDivElement>(null);
  const isFirstLayout = useRef(true);
  const nodePositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const { fitView } = useReactFlow();

  // ── Rebuild + layout ────────────────────────────────────────────────────────
  const rebuild = useCallback(
    (exploded: Set<string>, expanded: Set<string>, iterations: number) => {
      const { nodes: raw, edges: rawEdges } = buildVisualGraph(data, exploded, expanded);
      const positioned = runForceLayout(raw, rawEdges, nodePositionsRef.current, iterations);

      // Persist new top-level positions
      positioned.filter((n) => !n.parentId).forEach((n) => {
        nodePositionsRef.current.set(n.id, n.position);
      });

      setNodes(positioned);
      setEdges(rawEdges);

      if (isFirstLayout.current) {
        isFirstLayout.current = false;
        requestAnimationFrame(() => fitView({ padding: 0.18 }));
      }
    },
    [data, setNodes, setEdges, fitView],
  );

  // Initial render
  useEffect(() => {
    rebuild(explodedIds, expandedCodes, 300);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Toggle code expansion ────────────────────────────────────────────────────
  const onToggleCode = useCallback(
    (nodeId: string) => {
      setExpandedCodes((prev) => {
        const next = new Set(prev);
        if (next.has(nodeId)) next.delete(nodeId);
        else next.add(nodeId);
        rebuild(explodedIds, next, 80); // gentle re-layout to fix overlaps
        return next;
      });
    },
    [explodedIds, rebuild],
  );

  // ── Explode / collapse ───────────────────────────────────────────────────────
  const onExplode = useCallback(
    (nodeId: string) => {
      setExplodedIds((prev) => {
        const next = new Set([...prev, nodeId]);
        rebuild(next, expandedCodes, 200);
        return next;
      });
    },
    [expandedCodes, rebuild],
  );

  const onCollapse = useCallback(
    (nodeId: string) => {
      setExplodedIds((prev) => {
        const next = new Set(prev);
        next.delete(nodeId);
        // Also collapse any exploded descendants
        for (const id of Array.from(next)) {
          let cur: string | null = id;
          while (cur) {
            const e = data.entities[cur];
            if (!e) break;
            if (e.parent === nodeId) { next.delete(id); break; }
            cur = e.parent;
          }
        }
        rebuild(next, expandedCodes, 200);
        return next;
      });
    },
    [expandedCodes, rebuild, data.entities],
  );

  // ── Track dragged positions ──────────────────────────────────────────────────
  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      onNodesChange(changes);
      for (const c of changes) {
        if (c.type === "position" && c.position) {
          nodePositionsRef.current.set(c.id, c.position);
        }
      }
    },
    [onNodesChange],
  );

  // ── Context menu ─────────────────────────────────────────────────────────────
  const closeMenu = useCallback(() => setMenu(null), []);

  const onNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: Node) => {
      event.preventDefault();
      const pane = flowRef.current?.getBoundingClientRect();
      if (!pane) return;
      setMenu({
        nodeId: node.id,
        top:    event.clientY < pane.height - 160 ? event.clientY - pane.top   : false,
        left:   event.clientX < pane.width  - 170 ? event.clientX - pane.left  : false,
        right:  event.clientX >= pane.width - 170  ? pane.width  - (event.clientX - pane.left) : false,
        bottom: event.clientY >= pane.height - 160 ? pane.height - (event.clientY - pane.top)  : false,
      });
    },
    [],
  );

  const menuEntity = menu ? data.entities[menu.nodeId] : null;

  // ── Callbacks context value (stable) ─────────────────────────────────────────
  const callbacksCtx = useMemo(
    () => ({ onToggleCode }),
    [onToggleCode],
  );

  const btnStyle: React.CSSProperties = {
    background: "#fff",
    color: "#334155",
    border: "1px solid #e2e8f0",
    borderRadius: 6,
    padding: "5px 12px",
    fontSize: 12,
    cursor: "pointer",
    boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
    fontFamily: "Inter, system-ui, sans-serif",
  };

  return (
    <GraphCallbacksContext.Provider value={callbacksCtx}>
      <div ref={flowRef} style={{ width: "100%", height: "100%" }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={handleNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeContextMenu={onNodeContextMenu}
          onPaneClick={closeMenu}
          onNodeClick={closeMenu}
          nodesDraggable
          nodesConnectable={false}
          fitView
        >
          <Background color="#e8edf2" gap={24} />
          <Controls />
          <MiniMap zoomable pannable />
          <Panel position="top-right" style={{ display: "flex", gap: 8 }}>
            <button
              style={btnStyle}
              onClick={() => rebuild(explodedIds, expandedCodes, 300)}
            >
              ↺ Re-layout
            </button>
          </Panel>
          {menu && (
            <ContextMenu
              {...menu}
              canExplode={menuEntity?.canExplode ?? false}
              isExploded={explodedIds.has(menu.nodeId)}
              onExplode={onExplode}
              onCollapse={onCollapse}
              onClose={closeMenu}
            />
          )}
        </ReactFlow>
      </div>
    </GraphCallbacksContext.Provider>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

export default function Graph() {
  const query = trpc.graph.get.useQuery();

  if (query.isLoading) {
    return (
      <div className="flex items-center justify-center w-screen h-screen bg-slate-100 text-slate-500 text-base">
        Parsing…
      </div>
    );
  }

  if (query.error) {
    return (
      <div className="flex flex-col items-center justify-center w-screen h-screen bg-slate-100 text-red-500 gap-3">
        <span className="text-lg font-semibold">Parse error</span>
        <pre className="text-sm text-slate-500 max-w-xl text-center whitespace-pre-wrap">
          {query.error.message}
        </pre>
      </div>
    );
  }

  if (!query.data) return null;

  return (
    <div style={{ width: "100vw", height: "100vh", background: "#f1f5f9" }}>
      <ReactFlowProvider>
        <LayoutFlow data={query.data as SerializedCodeGraph} />
      </ReactFlowProvider>
    </div>
  );
}
