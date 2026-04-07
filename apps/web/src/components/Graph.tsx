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
import type { CodeDefinition, CodeEntity, EntityId, SerializedCodeGraph } from "@api/parsing/types";
import FileNode from "./FileNode";
import FloatingEdge from "./FloatingEdge";
import GroupNode from "./GroupNode";
import ContextMenu from "./ContextMenu";
import CodePane from "./CodePane";
import { GraphCallbacksContext } from "./graphContext";

// ── Type registrations ────────────────────────────────────────────────────────

const nodeTypes: NodeTypes = { file: FileNode, container: GroupNode };
const edgeTypes: EdgeTypes = { floating: FloatingEdge };

// ── Layout constants ──────────────────────────────────────────────────────────

const NODE_W       = "auto";
const NODE_W_SIM   = 240;
const NODE_H       = 36;
const CHILD_PAD    = 20;   // minimum gap between sibling nodes inside a container
const GROUP_PAD_T  = 48;   // room for label chip
const GROUP_PAD_S  = 16;   // sides
const GROUP_PAD_B  = 16;   // bottom

// ── AABB force (for global sim) ───────────────────────────────────────────────

interface SimNode extends d3Force.SimulationNodeDatum { id: string; w: number; h: number; }

function forceRectCollide(padding = 20) {
  let sns: SimNode[];
  function force(alpha: number) {
    for (let i = 0; i < sns.length; i++) {
      for (let j = i + 1; j < sns.length; j++) {
        const a = sns[i], b = sns[j];
        const ax = a.x ?? 0, ay = a.y ?? 0, bx = b.x ?? 0, by = b.y ?? 0;
        const ox = (a.w + b.w) / 2 + padding - Math.abs(bx - ax);
        const oy = (a.h + b.h) / 2 + padding - Math.abs(by - ay);
        if (ox > 0 && oy > 0) {
          if (ox < oy) {
            const d = ox * alpha * (bx >= ax ? 1 : -1);
            a.vx = (a.vx ?? 0) - d; b.vx = (b.vx ?? 0) + d;
          } else {
            const d = oy * alpha * (by >= ay ? 1 : -1);
            a.vy = (a.vy ?? 0) - d; b.vy = (b.vy ?? 0) + d;
          }
        }
      }
    }
  }
  force.initialize = (nodes: SimNode[]) => { sns = nodes; };
  return force;
}

// ── Static child layout helpers ───────────────────────────────────────────────

interface ChildRect { id: string; x: number; y: number; w: number; h: number; }

/** Iterative AABB separation — returns shifted copies, does NOT mutate input. */
function resolveChildCollisions(input: ChildRect[], padding: number): ChildRect[] {
  const r = input.map(n => ({ ...n }));
  for (let iter = 0; iter < 40; iter++) {
    let any = false;
    for (let i = 0; i < r.length; i++) {
      for (let j = i + 1; j < r.length; j++) {
        const a = r[i], b = r[j];
        const cax = a.x + a.w / 2, cay = a.y + a.h / 2;
        const cbx = b.x + b.w / 2, cby = b.y + b.h / 2;
        const ox = (a.w + b.w) / 2 + padding - Math.abs(cbx - cax);
        const oy = (a.h + b.h) / 2 + padding - Math.abs(cby - cay);
        if (ox > 0 && oy > 0) {
          any = true;
          if (ox < oy) {
            const d = ox / 2;
            if (cbx >= cax) { a.x -= d; b.x += d; } else { a.x += d; b.x -= d; }
          } else {
            const d = oy / 2;
            if (cby >= cay) { a.y -= d; b.y += d; } else { a.y += d; b.y -= d; }
          }
        }
      }
    }
    if (!any) break;
  }
  return r;
}

/** Normalize resolved children so min x = GROUP_PAD_S, min y = GROUP_PAD_T.
 *  Returns children (shifted) and the shift applied (dx, dy).
 *  Caller should subtract (dx, dy) from the container's global position to preserve visuals. */
function normalizeChildren(children: ChildRect[]): { children: ChildRect[]; dx: number; dy: number } {
  if (children.length === 0) return { children: [], dx: 0, dy: 0 };
  const minX = Math.min(...children.map(c => c.x));
  const minY = Math.min(...children.map(c => c.y));
  const dx = GROUP_PAD_S - minX;
  const dy = GROUP_PAD_T - minY;
  if (dx === 0 && dy === 0) return { children, dx: 0, dy: 0 };
  return { children: children.map(c => ({ ...c, x: c.x + dx, y: c.y + dy })), dx, dy };
}

/** Compute container width/height to just-fit given children. */
function containerSize(children: ChildRect[]): { w: number; h: number } {
  if (children.length === 0) return { w: NODE_W_SIM + GROUP_PAD_S * 2, h: GROUP_PAD_T + 60 };
  const maxX = Math.max(...children.map(c => c.x + c.w));
  const maxY = Math.max(...children.map(c => c.y + c.h));
  return { w: Math.max(maxX + GROUP_PAD_S, 240), h: Math.max(maxY + GROUP_PAD_B, 120) };
}

// ── Visual graph builder ──────────────────────────────────────────────────────

type VisualGraph = {
  nodes: Node[];
  edges: Edge[];
  topLinks: Array<{ source: string; target: string }>;
  childLinks: Map<string, Array<{ source: string; target: string }>>;
};

function addChildNodes(
  ids: EntityId[], parentId: EntityId,
  exploded: Set<string>,
  entities: Record<string, CodeEntity>, out: Node[],
): void {
  ids.forEach((id, i) => {
    const e = entities[id];
    if (!e) return;
    if (exploded.has(id) && e.children.length > 0) {
      out.push({
        id, type: "container", parentId,
        position: { x: GROUP_PAD_S + i * 8, y: GROUP_PAD_T + i * 8 },
        style: { width: NODE_W_SIM + GROUP_PAD_S * 2, height: 150 },
        data: { label: e.name, kind: e.kind },
      });
      addChildNodes(e.children as EntityId[], id, exploded, entities, out);
    } else {
      out.push({
        id, type: "file", parentId,
        position: { x: GROUP_PAD_S + i * 8, y: GROUP_PAD_T + i * 8 },
        style: { width: NODE_W, height: NODE_H },
        data: { label: e.name, kind: e.kind, filePath: e.name },
      });
    }
  });
}

function buildVisualGraph(data: SerializedCodeGraph, exploded: Set<string>): VisualGraph {
  const nodes: Node[] = [];

  for (const modId of data.modules) {
    const m = data.entities[modId];
    if (!m) continue;
    if (exploded.has(modId)) {
      nodes.push({
        id: modId, type: "container",
        position: { x: 0, y: 0 },
        style: { width: NODE_W_SIM + GROUP_PAD_S * 2, height: 200 },
        data: { label: m.name, kind: "module" },
      });
      addChildNodes(m.children as EntityId[], modId, exploded, data.entities, nodes);
    } else {
      nodes.push({
        id: modId, type: "file",
        position: { x: 0, y: 0 },
        style: { width: NODE_W, height: NODE_H },
        data: { label: m.name, kind: "module", filePath: modId },
      });
    }
  }

  for (const ext of data.externalModules) {
    const id = `external:${ext.moduleSpecifier}`;
    nodes.push({
      id, type: "file", position: { x: 0, y: 0 }, style: { width: NODE_W, height: NODE_H },
      data: { label: ext.moduleSpecifier, kind: "module", filePath: ext.moduleSpecifier, isExternal: true },
    });
  }

  const nodeIds = new Set(nodes.map(n => n.id));
  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  function topAncestor(id: string): string {
    let cur = id;
    while (true) { const n = nodeMap.get(cur); if (!n?.parentId) return cur; cur = n.parentId; }
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
    call: "call", instantiation: "new", "type-annotation": "type",
    reference: "ref", extends: "extends", implements: "impl",
  };
  const edgeMap = new Map<string, { edge: Edge; contexts: Set<string> }>();
  for (const dep of data.dependencies) {
    const srcId = visibleSrc(dep.source), tgtId = dep.target;
    if (!nodeIds.has(srcId) || !nodeIds.has(tgtId) || srcId === tgtId) continue;
    const key = `${srcId}→${tgtId}`;
    const ctxs = dep.usages.map(u => CTX[u.context] ?? u.context);
    if (!edgeMap.has(key)) {
      const firstUsageLoc: CodeDefinition | undefined = dep.usages[0]?.location;
      edgeMap.set(key, {
        edge: { id: key, source: srcId, target: tgtId, type: "floating",
          markerEnd: { type: MarkerType.ArrowClosed, color: "#94a3b8", width: 14, height: 14 },
          style: { stroke: "#94a3b8", strokeWidth: 1.5 }, label: "",
          data: { firstUsageLoc } },
        contexts: new Set(ctxs),
      });
    } else ctxs.forEach(c => edgeMap.get(key)!.contexts.add(c));
  }
  const edges = Array.from(edgeMap.values()).map(({ edge, contexts }) => ({
    ...edge, label: Array.from(contexts).filter(Boolean).join(" • ") || undefined,
  }));

  const topIds = new Set(nodes.filter(n => !n.parentId).map(n => n.id));
  const seenTop = new Set<string>();
  const topLinks: Array<{ source: string; target: string }> = [];
  for (const e of edges) {
    const src = topAncestor(e.source), tgt = topAncestor(e.target);
    if (src === tgt || !topIds.has(src) || !topIds.has(tgt)) continue;
    const k = `${src}→${tgt}`;
    if (!seenTop.has(k)) { seenTop.add(k); topLinks.push({ source: src, target: tgt }); }
  }

  const childLinks = new Map<string, Array<{ source: string; target: string }>>();
  for (const n of nodes.filter(n => n.type === "container")) {
    const directChildIds = new Set(nodes.filter(c => c.parentId === n.id).map(c => c.id));
    const seen = new Set<string>();
    const links: Array<{ source: string; target: string }> = [];
    for (const e of edges) {
      if (!directChildIds.has(e.source) || !directChildIds.has(e.target) || e.source === e.target) continue;
      const k = `${e.source}→${e.target}`;
      if (!seen.has(k)) { seen.add(k); links.push({ source: e.source, target: e.target }); }
    }
    childLinks.set(n.id, links);
  }

  return { nodes, edges, topLinks, childLinks };
}

// ── Simulation factory ────────────────────────────────────────────────────────

type Sim = d3Force.Simulation<SimNode, d3Force.SimulationLinkDatum<SimNode>>;

function createSim(nodes: SimNode[], links: Array<{ source: string; target: string }>,
  charge: number, distExtra: number, decay: number): Sim {
  return d3Force.forceSimulation<SimNode>(nodes)
    .force("link",
      d3Force.forceLink<SimNode, d3Force.SimulationLinkDatum<SimNode>>(links)
        .id(d => d.id)
        .distance(l => {
          const s = l.source as unknown as SimNode, t = l.target as unknown as SimNode;
          return (s.w + t.w) / 2 + distExtra;
        })
        .strength(0.1))
    .force("charge", d3Force.forceManyBody<SimNode>().strength(charge))
    .force("collide", forceRectCollide(20))
    .force("x", d3Force.forceX<SimNode>(0).strength(0.05))
    .force("y", d3Force.forceY<SimNode>(0).strength(0.05))
    .alphaDecay(decay)
    .stop();
}

// ── Context menu type ─────────────────────────────────────────────────────────

type MenuState = { nodeId: string; top: number|false; left: number|false; right: number|false; bottom: number|false; };

// ── LayoutFlow ────────────────────────────────────────────────────────────────

type LayoutFlowProps = {
  data: SerializedCodeGraph;
  selectedEntityId: string | null;
  onSelectNode: (id: string | null) => void;
  onNavigateTo: (loc: CodeDefinition) => void;
};

function LayoutFlow({ data, selectedEntityId, onSelectNode, onNavigateTo }: LayoutFlowProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [explodedIds, setExplodedIds] = useState<Set<string>>(() => new Set());
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [showControls, setShowControls] = useState(false);
  const [charge, setCharge] = useState(-900);
  const [distExtra, setDistExtra] = useState(80);
  const [decay, setDecay] = useState(0.02);
  const flowRef = useRef<HTMLDivElement>(null);
  const isFirstLayout = useRef(true);
  const { fitView } = useReactFlow();

  // ── Mutable refs (no re-render) ───────────────────────────────────────────
  const globalSimRef     = useRef<Sim | null>(null);
  const globalNodeMapRef = useRef<Map<string, SimNode>>(new Map());
  /** Per-container: child rects in local container space */
  const childRects       = useRef<Map<string, Map<string, ChildRect>>>(new Map());
  const rafRef           = useRef<number | null>(null);
  // Mirror state into refs so callbacks can read without stale closures
  const explodedRef      = useRef<Set<string>>(new Set());

  // ── Animation loop (global sim only) ──────────────────────────────────────

  const startAnimation = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);

    function frame() {
      const sim = globalSimRef.current;
      if (!sim) { rafRef.current = null; return; }
      sim.tick();

      setNodes(prev => prev.map(n => {
        if (n.parentId) return n; // children managed statically
        const sn = globalNodeMapRef.current.get(n.id);
        if (!sn || sn.fx !== undefined) return n;
        return { ...n, position: { x: sn.x ?? 0, y: sn.y ?? 0 } };
      }));

      if (sim.alpha() > sim.alphaMin()) {
        rafRef.current = requestAnimationFrame(frame);
      } else {
        rafRef.current = null;
        if (isFirstLayout.current) {
          isFirstLayout.current = false;
          requestAnimationFrame(() => fitView({ padding: 0.18 }));
        }
      }
    }
    rafRef.current = requestAnimationFrame(frame);
  }, [setNodes, fitView]);

  const reheat = useCallback((alpha = 0.8) => {
    globalSimRef.current?.alpha(alpha);
    startAnimation();
  }, [startAnimation]);

  // Keep a stable ref to reheat so effects can call it without re-running
  const reheatRef = useRef(reheat);
  useEffect(() => { reheatRef.current = reheat; }, [reheat]);

  // ── Container child layout ─────────────────────────────────────────────────
  /**
   * Resolve collisions for a container's children, normalize positions,
   * resize the container, and call setNodes. Then walk up the parent chain.
   *
   * `batch` is an optional NodeUpdate accumulator — if provided, updates are
   * collected but setNodes is NOT called (caller does it once at the end).
   */
  type NodeUpdate = { position?: { x: number; y: number }; style?: Partial<React.CSSProperties>; data?: Record<string, unknown> };

  const applyContainerLayout = useCallback((containerId: string, batch?: Map<string, NodeUpdate>): Map<string, NodeUpdate> => {
    const updates = batch ?? new Map<string, NodeUpdate>();
    const childMap = childRects.current.get(containerId);
    if (!childMap || childMap.size === 0) return updates;

    let children = Array.from(childMap.values());
    children = resolveChildCollisions(children, CHILD_PAD);
    const { children: normalized, dx, dy } = normalizeChildren(children);

    // Persist resolved positions
    for (const c of normalized) childMap.set(c.id, c);

    // If positions shifted, compensate the container's global sim position
    if (dx !== 0 || dy !== 0) {
      const sn = globalNodeMapRef.current.get(containerId);
      if (sn) { sn.x = (sn.x ?? 0) - dx; sn.y = (sn.y ?? 0) - dy; }
    }

    const { w, h } = containerSize(normalized);
    const containerSn = globalNodeMapRef.current.get(containerId);
    if (containerSn) { containerSn.w = w; containerSn.h = h; }

    // Collect container update
    updates.set(containerId, {
      position: containerSn ? { x: containerSn.x ?? 0, y: containerSn.y ?? 0 } : undefined,
      style: { width: w, height: h },
    });

    // Collect child updates
    for (const c of normalized) {
      updates.set(c.id, { position: { x: c.x, y: c.y }, style: { height: c.h } });
    }

    // If this container is itself inside another container, update its entry there
    const entity = data.entities[containerId];
    const parentContId = entity?.parent;
    if (parentContId && explodedRef.current.has(parentContId)) {
      const outerMap = childRects.current.get(parentContId);
      const entry = outerMap?.get(containerId);
      if (entry) outerMap!.set(containerId, { ...entry, w, h });
      // Recurse up
      applyContainerLayout(parentContId, updates);
    }

    return updates;
  }, [data.entities]);

  const flushContainerLayout = useCallback((containerId: string) => {
    const updates = applyContainerLayout(containerId);
    if (updates.size > 0) {
      setNodes(prev => prev.map(n => {
        const u = updates.get(n.id);
        if (!u) return n;
        return {
          ...n,
          ...(u.position ? { position: u.position } : {}),
          style: u.style ? { ...n.style, ...u.style } : n.style,
          ...(u.data ? { data: { ...n.data, ...u.data } } : {}),
        };
      }));
      reheat(0.2);
    }
  }, [applyContainerLayout, setNodes, reheat]);

  // ── Initialize simulations & child layout ──────────────────────────────────

  const initSims = useCallback((vg: VisualGraph) => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    globalSimRef.current?.stop();

    // Prune stale container entries
    const liveContainerIds = new Set(vg.nodes.filter(n => n.type === "container").map(n => n.id));
    for (const id of Array.from(childRects.current.keys())) {
      if (!liveContainerIds.has(id)) childRects.current.delete(id);
    }

    // Initialize / update child rects for each container
    const newContainerIds: string[] = [];
    for (const container of vg.nodes.filter(n => n.type === "container")) {
      const children = vg.nodes.filter(c => c.parentId === container.id);
      const existing = childRects.current.get(container.id);

      if (!existing) {
        // Brand-new container: stacked initial layout
        const childMap = new Map<string, ChildRect>();
        let y = GROUP_PAD_T;
        for (const c of children) {
          const h = typeof c.style?.height === "number" ? c.style.height : NODE_H;
          childMap.set(c.id, { id: c.id, x: GROUP_PAD_S, y, w: NODE_W_SIM, h });
          y += h + CHILD_PAD;
        }
        childRects.current.set(container.id, childMap);
        newContainerIds.push(container.id);
      } else {
        // Update existing: sync heights, handle added/removed children
        const knownIds = new Set(existing.keys());
        const liveIds = new Set(children.map(c => c.id));
        // Remove gone children
        for (const id of knownIds) if (!liveIds.has(id)) existing.delete(id);
        // Find the bottom of existing layout for appending new children
        let appendY = GROUP_PAD_T;
        for (const r of existing.values()) appendY = Math.max(appendY, r.y + r.h + CHILD_PAD);
        // Add new / update heights
        for (const c of children) {
          const h = typeof c.style?.height === "number" ? c.style.height : NODE_H;
          if (existing.has(c.id)) {
            const r = existing.get(c.id)!;
            existing.set(c.id, { ...r, h });
          } else {
            existing.set(c.id, { id: c.id, x: GROUP_PAD_S, y: appendY, w: NODE_W_SIM, h });
            appendY += h + CHILD_PAD;
          }
        }
      }
    }

    // Build global sim
    const prevMap = globalNodeMapRef.current;
    const topLevel = vg.nodes.filter(n => !n.parentId);
    const globalSns: SimNode[] = topLevel.map(n => {
      const prev = prevMap.get(n.id);
      return {
        id: n.id,
        w: typeof n.style?.width === "number" ? n.style.width : NODE_W_SIM,
        h: typeof n.style?.height === "number" ? n.style.height : NODE_H,
        x: prev?.x ?? (Math.random() - 0.5) * 600,
        y: prev?.y ?? (Math.random() - 0.5) * 400,
      };
    });
    globalNodeMapRef.current = new Map(globalSns.map(n => [n.id, n]));
    globalSimRef.current = createSim(globalSns, vg.topLinks, charge, distExtra, decay);

    // Sort containers deepest-first for bottom-up finalization
    const containerDepth = (id: string): number => {
      const e = data.entities[id];
      return e?.parent ? 1 + containerDepth(e.parent) : 0;
    };
    const sortedContainers = [...liveContainerIds].sort((a, b) => containerDepth(b) - containerDepth(a));

    // Finalize all containers (deepest first) and collect updates
    const updates = new Map<string, NodeUpdate>();
    for (const id of sortedContainers) {
      applyContainerLayout(id, updates);
    }

    // Push all layout updates + node positions to ReactFlow
    setNodes(vg.nodes.map(n => {
      const u = updates.get(n.id);
      if (!u) return n;
      return {
        ...n,
        ...(u.position ? { position: u.position } : {}),
        style: u.style ? { ...n.style, ...u.style } : n.style,
      };
    }));

    startAnimation();
  }, [charge, distExtra, decay, data.entities, applyContainerLayout, setNodes, startAnimation]);

  // ── Rebuild (on structure change) ─────────────────────────────────────────

  const rebuild = useCallback((exploded: Set<string>) => {
    explodedRef.current = exploded;
    const vg = buildVisualGraph(data, exploded);
    setEdges(vg.edges);
    requestAnimationFrame(() => initSims(vg));
  }, [data, setEdges, initSims]);

  // Initial render
  useEffect(() => {
    rebuild(new Set());
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      globalSimRef.current?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync sim params when sliders change
  useEffect(() => {
    const sim = globalSimRef.current;
    if (!sim) return;
    (sim.force("charge") as d3Force.ForceManyBody<SimNode> | null)?.strength(charge);
    (sim.force("link") as d3Force.ForceLink<SimNode, d3Force.SimulationLinkDatum<SimNode>> | null)
      ?.distance(l => {
        const s = l.source as unknown as SimNode, t = l.target as unknown as SimNode;
        return (s.w + t.w) / 2 + distExtra;
      });
    sim.alphaDecay(decay);
    reheatRef.current(0.4);
  }, [charge, distExtra, decay]);

  // ── Explode / collapse ────────────────────────────────────────────────────

  const onExplode = useCallback((nodeId: string) => {
    setExplodedIds(prev => {
      const next = new Set([...prev, nodeId]);
      rebuild(next);
      return next;
    });
  }, [rebuild]);

  const onCollapse = useCallback((nodeId: string) => {
    setExplodedIds(prev => {
      const next = new Set(prev);
      next.delete(nodeId);
      for (const id of Array.from(next)) {
        let cur: string | null = id;
        while (cur) { const e = data.entities[cur]; if (!e) break; if (e.parent === nodeId) { next.delete(id); break; } cur = e.parent; }
      }
      rebuild(next);
      return next;
    });
  }, [rebuild, data.entities]);

  // ── Drag ─────────────────────────────────────────────────────────────────

  const onNodeDragStart = useCallback(() => {
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    globalSimRef.current?.stop();
  }, []);

  const onNodeDrag = useCallback((_: React.MouseEvent, node: Node) => {
    if (node.parentId) {
      // Keep childRects in sync so layout after drop is accurate
      const childMap = childRects.current.get(node.parentId);
      const cr = childMap?.get(node.id);
      if (cr) childMap!.set(node.id, { ...cr, x: node.position.x, y: node.position.y });
    } else {
      const sn = globalNodeMapRef.current.get(node.id);
      if (sn) { sn.x = node.position.x; sn.y = node.position.y; sn.vx = 0; sn.vy = 0; }
    }
  }, []);

  const onNodeDragStop = useCallback((_: React.MouseEvent, node: Node) => {
    if (node.parentId) {
      // Resolve collisions & resize container after drop
      flushContainerLayout(node.parentId);
    }
    reheat(0.3);
  }, [flushContainerLayout, reheat]);

  // ── Context menu ──────────────────────────────────────────────────────────

  const closeMenu = useCallback(() => setMenu(null), []);
  const onNodeContextMenu = useCallback((event: React.MouseEvent, node: Node) => {
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
  }, []);

  // Sync isSelected on nodes when selectedEntityId changes
  useEffect(() => {
    setNodes(prev => prev.map(n => {
      const want = n.id === selectedEntityId;
      const has = Boolean((n.data as Record<string, unknown>).isSelected);
      if (want === has) return n;
      return { ...n, data: { ...n.data, isSelected: want } };
    }));
  }, [selectedEntityId, setNodes]);

  const menuEntity = menu ? data.entities[menu.nodeId] : null;
  const callbacksCtx = useMemo(() => ({ onSelectNode, onNavigateTo }), [onSelectNode, onNavigateTo]);

  // ── Styles ────────────────────────────────────────────────────────────────

  const btnStyle: React.CSSProperties = {
    background: "#fff", color: "#334155", border: "1px solid #e2e8f0",
    borderRadius: 6, padding: "5px 12px", fontSize: 12, cursor: "pointer",
    boxShadow: "0 1px 4px rgba(0,0,0,0.06)", fontFamily: "Inter, system-ui, sans-serif",
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 11, color: "#64748b", fontFamily: "Inter, system-ui, sans-serif",
    display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2,
  };

  return (
    <GraphCallbacksContext.Provider value={callbacksCtx}>
      <div ref={flowRef} style={{ width: "100%", height: "100%" }}>
        <ReactFlow
          nodes={nodes} edges={edges}
          nodeTypes={nodeTypes} edgeTypes={edgeTypes}
          onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
          onNodeContextMenu={onNodeContextMenu}
          onPaneClick={closeMenu} onNodeClick={closeMenu}
          onNodeDragStart={onNodeDragStart}
          onNodeDrag={onNodeDrag}
          onNodeDragStop={onNodeDragStop}
          nodesDraggable nodesConnectable={false} fitView
        >
          <Background color="#e8edf2" gap={24} />
          <Controls />
          <MiniMap zoomable pannable />

          <Panel position="top-right">
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
              {/* Toolbar row */}
              <div style={{ display: "flex", gap: 6 }}>
                <button style={btnStyle} onClick={() => setShowControls(v => !v)}>
                  ⚙ Controls
                </button>
                <button style={btnStyle} onClick={() => reheat(1.0)}>
                  ↺ Re-layout
                </button>
              </div>

              {/* Slider panel */}
              {showControls && (
                <div style={{
                  background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8,
                  padding: "10px 14px", boxShadow: "0 2px 12px rgba(0,0,0,0.08)",
                  display: "flex", flexDirection: "column", gap: 8, minWidth: 220,
                  fontFamily: "Inter, system-ui, sans-serif",
                }}>
                  <div>
                    <div style={labelStyle}>
                      <span>Repulsion</span>
                      <span style={{ fontVariantNumeric: "tabular-nums" }}>{charge}</span>
                    </div>
                    <input type="range" min={-2000} max={-100} step={50}
                      value={charge} onChange={e => setCharge(+e.target.value)}
                      style={{ width: "100%" }} />
                  </div>
                  <div>
                    <div style={labelStyle}>
                      <span>Link distance</span>
                      <span style={{ fontVariantNumeric: "tabular-nums" }}>{distExtra}</span>
                    </div>
                    <input type="range" min={20} max={400} step={10}
                      value={distExtra} onChange={e => setDistExtra(+e.target.value)}
                      style={{ width: "100%" }} />
                  </div>
                  <div>
                    <div style={labelStyle}>
                      <span>Alpha decay</span>
                      <span style={{ fontVariantNumeric: "tabular-nums" }}>{decay.toFixed(3)}</span>
                    </div>
                    <input type="range" min={0.005} max={0.05} step={0.001}
                      value={decay} onChange={e => setDecay(+e.target.value)}
                      style={{ width: "100%" }} />
                  </div>
                </div>
              )}
            </div>
          </Panel>

          {menu && (
            <ContextMenu
              {...menu}
              canExplode={menuEntity?.canExplode ?? false}
              isExploded={explodedIds.has(menu.nodeId)}
              onExplode={onExplode} onCollapse={onCollapse} onClose={closeMenu}
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
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [navigateTarget, setNavigateTarget] = useState<CodeDefinition | null>(null);
  const [paneWidth, setPaneWidth] = useState(50); // percent
  const isDraggingDivider = useRef(false);

  const onSelectNode = useCallback((id: string | null) => {
    setSelectedEntityId(id);
    setNavigateTarget(null);
  }, []);

  const onNavigateTo = useCallback((loc: CodeDefinition) => {
    setNavigateTarget(loc);
  }, []);

  const onDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingDivider.current = true;
    const onMove = (me: MouseEvent) => {
      if (!isDraggingDivider.current) return;
      const pct = (me.clientX / window.innerWidth) * 100;
      setPaneWidth(Math.min(80, Math.max(20, pct)));
    };
    const onUp = () => {
      isDraggingDivider.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  if (query.isLoading) return (
    <div className="flex items-center justify-center w-screen h-screen bg-slate-100 text-slate-500 text-base">
      Parsing…
    </div>
  );

  if (query.error) return (
    <div className="flex flex-col items-center justify-center w-screen h-screen bg-slate-100 text-red-500 gap-3">
      <span className="text-lg font-semibold">Parse error</span>
      <pre className="text-sm text-slate-500 max-w-xl text-center whitespace-pre-wrap">{query.error.message}</pre>
    </div>
  );

  if (!query.data) return null;

  const graph = query.data as SerializedCodeGraph;

  return (
    <div style={{ display: "flex", width: "100vw", height: "100vh", background: "#0f172a", overflow: "hidden" }}>
      {/* Left: diagram */}
      <div style={{ width: `${paneWidth}%`, height: "100%", flexShrink: 0, background: "#f1f5f9" }}>
        <ReactFlowProvider>
          <LayoutFlow
            data={graph}
            selectedEntityId={selectedEntityId}
            onSelectNode={onSelectNode}
            onNavigateTo={onNavigateTo}
          />
        </ReactFlowProvider>
      </div>

      {/* Divider */}
      <div
        onMouseDown={onDividerMouseDown}
        style={{
          width: 4, height: "100%", flexShrink: 0,
          background: "#1e293b", cursor: "col-resize",
          transition: "background 0.1s",
        }}
        onMouseEnter={e => (e.currentTarget.style.background = "#334155")}
        onMouseLeave={e => (e.currentTarget.style.background = "#1e293b")}
      />

      {/* Right: code pane */}
      <div style={{ flex: 1, height: "100%", overflow: "hidden" }}>
        <CodePane
          selectedEntityId={selectedEntityId}
          navigateTarget={navigateTarget}
          graph={graph}
        />
      </div>
    </div>
  );
}
