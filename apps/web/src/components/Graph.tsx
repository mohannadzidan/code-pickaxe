import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type EdgeTypes,
  type Node,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { trpc } from '@/utils/trpc';
import type { CodeDefinition, CodeEntity, EntityId, SerializedCodeGraph } from '@api/parsing/types';
import FileNode from './FileNode';
import FloatingEdge from './FloatingEdge';
import ContextMenu from './ContextMenu';
import CodePane from './CodePane';
import { GraphCallbacksContext } from './graphContext';
import dagre from '@dagrejs/dagre';
import * as d3Force from 'd3-force';

// ── Fixed node dimensions for dagre ──────────────────────────────────────────
const FILE_NODE_W = 120;
const FILE_NODE_H = 36;

// ── Dagre layout functions ───────────────────────────────────────────────────
function layoutGraph(nodes: Node[], edges: Array<{ source: string; target: string }>, direction: 'TB' | 'LR' = 'TB'): Node[] {
  const dagreGraph = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({ rankdir: direction, nodesep: 40, ranksep: 50 });

  nodes.forEach((node) => {
    let width = FILE_NODE_W;
    let height = FILE_NODE_H;
    if (node.type === 'container') {
      width = (node.style?.width as number) || 240;
      height = (node.style?.height as number) || 120;
    }
    dagreGraph.setNode(node.id, { width, height });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const isHorizontal = direction === 'LR';
  return nodes.map((node) => {
    const nodeWithPos = dagreGraph.node(node.id);
    return {
      ...node,
      position: {
        x: nodeWithPos.x - (nodeWithPos.width || FILE_NODE_W) / 2,
        y: nodeWithPos.y - (nodeWithPos.height || FILE_NODE_H) / 2,
      },
      targetPosition: isHorizontal ? Position.Left : Position.Top,
      sourcePosition: isHorizontal ? Position.Right : Position.Bottom,
      style: {
        ...node.style,
        width: nodeWithPos.width,
        height: nodeWithPos.height,
      },
    };
  });
}

function computeFullLayout(vg: VisualGraph, direction: 'TB' | 'LR' = 'TB'): Node[] {
  return layoutGraph(vg.nodes, vg.topLinks, direction);
}

// ── Force simulation (degree‑weighted cardinal layout) ────────────────────────

interface SimNode extends d3Force.SimulationNodeDatum {
  id: string;
  w: number;
  h: number;
}

function forceRectCollide(padding = 20) {
  let sns: SimNode[];
  function force(alpha: number) {
    for (let i = 0; i < sns.length; i++) {
      for (let j = i + 1; j < sns.length; j++) {
        const a = sns[i],
          b = sns[j];
        const ac = getSimCenter(a);
        const bc = getSimCenter(b);
        const dx = bc.x - ac.x;
        const dy = bc.y - ac.y;
        const dist = Math.hypot(dx, dy) || 0.0001;
        const minDist = getNodeRadius(a) + getNodeRadius(b) + padding;
        const overlap = minDist - dist;
        if (overlap > 0) {
          const push = overlap * alpha;
          const ux = dx / dist;
          const uy = dy / dist;
          const fx = ux * push;
          const fy = uy * push;
          a.vx = (a.vx ?? 0) - fx;
          a.vy = (a.vy ?? 0) - fy;
          b.vx = (b.vx ?? 0) + fx;
          b.vy = (b.vy ?? 0) + fy;
        }
      }
    }
  }
  force.initialize = (nodes: SimNode[]) => {
    sns = nodes;
  };
  return force;
}

function forceCardinalLayout(
  edges: Array<{ source: string; target: string }>,
  params: {
    baseCardinalStrength: number;
    baseDiagonalStrength: number;
    desiredDistance: number;
    baseCenteringStrength: number;
    maxDegreeNormalization: number;
  }
) {
  let nodes: SimNode[] = [];
  const { baseCardinalStrength, baseDiagonalStrength, desiredDistance, baseCenteringStrength, maxDegreeNormalization } = params;

  const getAdjacency = (): Map<string, string[]> => {
    const adj = new Map<string, string[]>();
    for (const e of edges) {
      const s = e.source,
        t = e.target;
      if (!adj.has(s)) adj.set(s, []);
      if (!adj.has(t)) adj.set(t, []);
      adj.get(s)!.push(t);
      adj.get(t)!.push(s);
    }
    for (const [k, v] of adj.entries()) adj.set(k, Array.from(new Set(v)));
    return adj;
  };

  let neighborOrder = new Map<string, string[]>();
  const updateNeighborOrder = () => {
    const adj = getAdjacency();
    for (const [id, neighs] of adj.entries()) {
      neighs.sort();
      neighborOrder.set(id, neighs);
    }
  };

  function getDesiredOffset(idx: number, d: number): { dx: number; dy: number } {
    if (idx === 0) return { dx: -d, dy: 0 };
    if (idx === 1) return { dx: d, dy: 0 };
    if (idx === 2) return { dx: 0, dy: -d };
    if (idx === 3) return { dx: 0, dy: d };
    const diagIdx = (idx - 4) % 4;
    const half = d * 0.7071;
    switch (diagIdx) {
      case 0:
        return { dx: -half, dy: -half };
      case 1:
        return { dx: half, dy: -half };
      case 2:
        return { dx: -half, dy: half };
      default:
        return { dx: half, dy: half };
    }
  }

  function force(alpha: number) {
    if (!nodes.length) return;
    updateNeighborOrder();

    const degrees = new Map<string, number>();
    let maxDeg = 0;
    for (const node of nodes) {
      const deg = neighborOrder.get(node.id)?.length ?? 0;
      degrees.set(node.id, deg);
      if (deg > maxDeg) maxDeg = deg;
    }

    for (const node of nodes) {
      const neighbors = neighborOrder.get(node.id);
      if (!neighbors || neighbors.length === 0) continue;

      const deg = degrees.get(node.id)!;
      let influence = maxDeg > 0 ? deg / maxDeg : 1;
      if (maxDeg > maxDegreeNormalization) influence = deg / maxDegreeNormalization;
      influence = Math.min(1.0, influence);

      const cardinalStrength = baseCardinalStrength * influence;
      const diagonalStrength = baseDiagonalStrength * influence;
      const centeringStrength = baseCenteringStrength * influence;

      for (let idx = 0; idx < neighbors.length; idx++) {
        const nid = neighbors[idx];
        const neighbor = nodes.find((n) => n.id === nid);
        if (!neighbor) continue;
        const desiredSeparation = desiredDistance + getNodeRadius(node) + getNodeRadius(neighbor);

        const strength = idx < 4 ? cardinalStrength : diagonalStrength;
        if (strength === 0) continue;

        const nodeCenter = getSimCenter(node);
        const neighborCenter = getSimCenter(neighbor);
        const dx = neighborCenter.x - nodeCenter.x;
        const dy = neighborCenter.y - nodeCenter.y;
        const desired = getDesiredOffset(idx, desiredSeparation);
        const fx = (desired.dx - dx) * strength * alpha;
        const fy = (desired.dy - dy) * strength * alpha;

        neighbor.vx = (neighbor.vx ?? 0) + fx;
        neighbor.vy = (neighbor.vy ?? 0) + fy;
        node.vx = (node.vx ?? 0) - fx;
        node.vy = (node.vy ?? 0) - fy;
      }

      if (centeringStrength > 0 && neighbors.length > 0) {
        let cx = 0,
          cy = 0,
          cnt = 0;
        for (const nid of neighbors) {
          const nb = nodes.find((n) => n.id === nid);
          if (nb) {
            const nbCenter = getSimCenter(nb);
            cx += nbCenter.x;
            cy += nbCenter.y;
            cnt++;
          }
        }
        if (cnt > 0) {
          cx /= cnt;
          cy /= cnt;
          const nodeCenter = getSimCenter(node);
          const dx = cx - nodeCenter.x;
          const dy = cy - nodeCenter.y;
          const fx = dx * centeringStrength * alpha;
          const fy = dy * centeringStrength * alpha;
          node.vx = (node.vx ?? 0) + fx;
          node.vy = (node.vy ?? 0) + fy;
        }
      }
    }
  }

  force.initialize = (initNodes: SimNode[]) => {
    nodes = initNodes;
    updateNeighborOrder();
  };
  return force;
}

function createSimulation(
  nodes: SimNode[],
  links: Array<{ source: string; target: string }>,
  charge: number,
  distExtra: number,
  decay: number,
  centerX = 0,
  centerY = 0
) {
  return d3Force
    .forceSimulation<SimNode>(nodes)
    .force(
      'link',
      d3Force
        .forceLink<SimNode, d3Force.SimulationLinkDatum<SimNode>>(links)
        .id((d) => d.id)
        .distance((l) => {
          const s = l.source as unknown as SimNode,
            t = l.target as unknown as SimNode;
          return getNodeRadius(s) + getNodeRadius(t) + distExtra;
        })
        .strength(0.1)
    )
    .force(
      'charge',
      d3Force.forceManyBody<SimNode>().strength((node) => {
        const scale = Math.max(1, Math.max(node.w, node.h) / FILE_NODE_W);
        return charge * scale;
      })
    )
    .force('collide', forceRectCollide(20))
    .force('x', d3Force.forceX<SimNode>(centerX).strength(0.05))
    .force('y', d3Force.forceY<SimNode>(centerY).strength(0.05))
    .force(
      'cardinal',
      forceCardinalLayout(links, {
        baseCardinalStrength: 0.25,
        baseDiagonalStrength: 0.12,
        desiredDistance: 180,
        baseCenteringStrength: 0.08,
        maxDegreeNormalization: 8,
      })
    )
    .alphaDecay(decay)
    .stop();
}

// ── Type registrations and visual graph builder (same as before) ──────────────

const nodeTypes: NodeTypes = { file: FileNode };
const edgeTypes: EdgeTypes = { floating: FloatingEdge };

const NODE_W = 'auto';
const NODE_H = 36;

function getNodeSize(node: Node): { width: number; height: number } {
  return {
    width: typeof node.style?.width === 'number' ? node.style.width : FILE_NODE_W,
    height: typeof node.style?.height === 'number' ? node.style.height : FILE_NODE_H,
  };
}

function getNodeRadius(node: Pick<SimNode, 'w' | 'h'>): number {
  return Math.max(node.w, node.h) / 2;
}

function getSimCenter(node: SimNode): { x: number; y: number } {
  return {
    x: (node.x ?? 0) + node.w / 2,
    y: (node.y ?? 0) + node.h / 2,
  };
}

function mergeNodesPreservingPositions(prevNodes: Node[], nextNodes: Node[]): Node[] {
  const prevById = new Map(prevNodes.map((n) => [n.id, n]));
  return nextNodes.map((node) => {
    const prev = prevById.get(node.id);
    if (!prev) return node;
    return {
      ...node,
      position: prev.position,
    };
  });
}

type VisualGraph = {
  nodes: Node[];
  edges: Edge[];
  topLinks: Array<{ source: string; target: string }>;
};

function buildVisualGraph(data: SerializedCodeGraph, exploded: Set<string>, hidden: Set<string>): VisualGraph {
  const visible = new Set<string>();
  const visitVisible = (id: string) => {
    if (hidden.has(id)) return;
    if (visible.has(id)) return;
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
      if (entity.kind === 'module') return entity.id;
      current = entity.parent;
    }
    return null;
  };

  const nodes: Node[] = Array.from(visible).map((id) => {
    const entity = data.entities[id]!;
    const parent = entity.parent ? data.entities[entity.parent] : undefined;
    const displayName = parent?.kind === 'class' ? `${parent.name}.${entity.name}` : entity.name;
    return {
      id,
      type: 'file',
      position: { x: 0, y: 0 },
      style: { width: NODE_W, height: NODE_H },
      data: {
        label: displayName,
        kind: entity.kind,
        filePath: entity.kind === 'module' ? entity.id : displayName,
      },
    };
  });

  for (const ext of data.externalModules) {
    const id = `external:${ext.moduleSpecifier}`;
    if (hidden.has(id)) continue;
    nodes.push({
      id,
      type: 'file',
      position: { x: 0, y: 0 },
      style: { width: NODE_W, height: NODE_H },
      data: { label: ext.moduleSpecifier, kind: 'module', filePath: ext.moduleSpecifier, isExternal: true },
    });
  }

  const nodeIds = new Set(nodes.map((n) => n.id));
  const topAncestor = (id: string): string => id;
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
    call: 'call',
    instantiation: 'new',
    'type-annotation': 'type',
    reference: 'ref',
    extends: 'extends',
    implements: 'impl',
  };
  const edgeMap = new Map<string, { edge: Edge; contexts: Set<string> }>();
  for (const dep of data.dependencies) {
    const srcId = visibleSrc(dep.source),
      tgtId = dep.target;
    if (!nodeIds.has(srcId) || !nodeIds.has(tgtId) || srcId === tgtId) continue;
    const key = `${srcId}→${tgtId}`;
    const ctxs = dep.usages.map((u) => CTX[u.context] ?? u.context);
    if (!edgeMap.has(key)) {
      const firstUsageLoc: CodeDefinition | undefined = dep.usages[0]?.location;
      edgeMap.set(key, {
        edge: {
          id: key,
          source: srcId,
          target: tgtId,
          type: 'floating',
          markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8', width: 14, height: 14 },
          style: { stroke: '#94a3b8', strokeWidth: 1.5 },
          label: '',
          data: { firstUsageLoc },
        },
        contexts: new Set(ctxs),
      });
    } else ctxs.forEach((c) => edgeMap.get(key)!.contexts.add(c));
  }
  const edges = Array.from(edgeMap.values()).map(({ edge, contexts }) => ({
    ...edge,
    label: Array.from(contexts).filter(Boolean).join(' • ') || undefined,
  }));

  const originEdges: Edge[] = [];
  const seenOrigin = new Set<string>();
  for (const id of visible) {
    const entity = data.entities[id];
    if (!entity || entity.kind === 'module') continue;
    const moduleId = getModuleAncestor(id);
    if (!moduleId || !nodeIds.has(moduleId)) continue;
    const key = `${moduleId}→${id}`;
    if (seenOrigin.has(key)) continue;
    seenOrigin.add(key);
    originEdges.push({
      id: `origin:${moduleId}->${id}`,
      source: moduleId,
      target: id,
      type: 'straight',
      style: { stroke: '#94a3b8', strokeWidth: 1, strokeDasharray: '6 4', opacity: 0.75 },
      selectable: false,
      data: { isOriginEdge: true },
    });
  }

  const allEdges = [...edges, ...originEdges];
  const topIds = new Set(nodes.map((n) => n.id));
  const seenTop = new Set<string>();
  const topLinks: Array<{ source: string; target: string }> = [];
  for (const e of allEdges) {
    const src = topAncestor(e.source),
      tgt = topAncestor(e.target);
    if (src === tgt || !topIds.has(src) || !topIds.has(tgt)) continue;
    const k = `${src}→${tgt}`;
    if (!seenTop.has(k)) {
      seenTop.add(k);
      topLinks.push({ source: src, target: tgt });
    }
  }

  return { nodes, edges: allEdges, topLinks };
}

// ── Context menu type ─────────────────────────────────────────────────────────

type MenuState = { nodeId: string; top: number | false; left: number | false; right: number | false; bottom: number | false };

// ── LayoutFlow component (hybrid: dagre init + continuous force) ──────────────

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
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set());
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [layoutDirection, setLayoutDirection] = useState<'TB' | 'LR'>('TB');
  const flowRef = useRef<HTMLDivElement>(null);
  const { fitView, setCenter } = useReactFlow();

  // Simulation refs
  const simRef = useRef<d3Force.Simulation<SimNode, d3Force.SimulationLinkDatum<SimNode>> | null>(null);
  const simNodesMap = useRef<Map<string, SimNode>>(new Map());
  const nodesRef = useRef<Node[]>([]);
  const rafRef = useRef<number | null>(null);
  const isDraggingRef = useRef(false);

  // Store current visual graph structure
  const vgRef = useRef<VisualGraph | null>(null);

  // Helper: update ReactFlow nodes from simulation
  const updatePositionsFromSim = useCallback(() => {
    setNodes((prev) => {
      const projected = prev.map((n) => {
        const simNode = simNodesMap.current.get(n.id);
        if (!simNode) return n;
        return { ...n, position: { x: simNode.x ?? 0, y: simNode.y ?? 0 } };
      });
      nodesRef.current = projected;
      return projected;
    });
  }, [setNodes]);

  // Animation loop
  const startAnimation = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    function tick() {
      if (!simRef.current || isDraggingRef.current) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      simRef.current.tick();
      updatePositionsFromSim();
      if (simRef.current.alpha() > simRef.current.alphaMin()) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
      }
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [updatePositionsFromSim]);

  const reheat = useCallback(
    (alpha = 0.8) => {
      if (simRef.current) {
        simRef.current.alpha(alpha);
        if (!rafRef.current) startAnimation();
      }
    },
    [startAnimation]
  );

  const syncTopLevelSimSizes = useCallback((candidateNodes: Node[]) => {
    let changed = false;
    for (const node of candidateNodes) {
      const simNode = simNodesMap.current.get(node.id);
      if (!simNode) continue;
      const { width, height } = getNodeSize(node);
      if (simNode.w !== width || simNode.h !== height) {
        simNode.w = width;
        simNode.h = height;
        changed = true;
      }
    }
    return changed;
  }, []);

  const getAbsoluteNodeCenter = useCallback((targetId: string, graphNodes: Node[]) => {
    const byId = new Map(graphNodes.map((n) => [n.id, n]));
    const target = byId.get(targetId);
    if (!target) return null;

    const { width, height } = getNodeSize(target);
    return { x: target.position.x + width / 2, y: target.position.y + height / 2 };
  }, []);

  // Update simulation with new graph structure while preserving positions
  const updateSimulationStructure = useCallback(
    (newVg: VisualGraph, preservedPositions: Map<string, { x: number; y: number }>) => {
      if (!simRef.current) return;

      // Get current simulation nodes
      const currentSimNodes = simNodesMap.current;

      // Build new simulation nodes list
      const newSimNodes: SimNode[] = [];
      for (const node of newVg.nodes) {
        const existing = currentSimNodes.get(node.id);
        const { width, height } = getNodeSize(node);
        if (existing) {
          // Keep existing node (position preserved)
          existing.w = width;
          existing.h = height;
          newSimNodes.push(existing);
        } else {
          // New node - place near existing top-level graph centroid (or at origin)
          let x = 0;
          let y = 0;
          if (preservedPositions.has(node.id)) {
            const pos = preservedPositions.get(node.id)!;
            x = pos.x;
            y = pos.y;
          } else if (preservedPositions.size > 0) {
            const seed = preservedPositions.values().next().value as { x: number; y: number };
            x = seed.x + (Math.random() - 0.5) * 160;
            y = seed.y + (Math.random() - 0.5) * 160;
          }

          newSimNodes.push({
            id: node.id,
            w: width,
            h: height,
            x,
            y,
            vx: 0,
            vy: 0,
          });
        }
      }

      // Update simNodesMap
      simNodesMap.current = new Map(newSimNodes.map((sn) => [sn.id, sn]));

      // Stop current simulation
      simRef.current.stop();

      // Create new simulation with updated nodes and links
      const newSim = createSimulation(newSimNodes, newVg.topLinks, -1200, 100, 0.02);
      simRef.current = newSim;

      // Restart animation
      startAnimation();
      reheat(0.5);
    },
    [startAnimation, reheat]
  );

  // Incremental explode: show descendants
  const onExplode = useCallback(
    (nodeId: string) => {
      setExplodedIds((prev) => {
        if (prev.has(nodeId)) return prev;
        const next = new Set(prev);
        next.add(nodeId);

        // Build new visual graph with this node exploded
        const rawVg = buildVisualGraph(data, next, hiddenIds);

        // Preserve positions of existing top-level nodes from current simulation
        const preservedPositions = new Map<string, { x: number; y: number }>();
        for (const [id, sn] of simNodesMap.current.entries()) {
          preservedPositions.set(id, { x: sn.x ?? 0, y: sn.y ?? 0 });
        }

        const mergedNodes = mergeNodesPreservingPositions(nodesRef.current, rawVg.nodes);
        const newVg: VisualGraph = { ...rawVg, nodes: mergedNodes };

        // Update ReactFlow nodes
        nodesRef.current = mergedNodes;
        setNodes(mergedNodes);
        setEdges(newVg.edges);

        // Update simulation structure
        updateSimulationStructure(newVg, preservedPositions);
        vgRef.current = newVg;

        // Focus on exploded node after a short delay to ensure graph state is committed
        setTimeout(() => {
          const center = getAbsoluteNodeCenter(nodeId, mergedNodes);
          if (center) {
            setCenter(center.x, center.y, { duration: 2020 });
          } else {
            fitView({ padding: 0.18, duration: 2000 });
          }
        }, 100);

        return next;
      });
    },
    [data, hiddenIds, setNodes, setEdges, updateSimulationStructure, fitView, getAbsoluteNodeCenter, setCenter]
  );

  // Incremental collapse: hide descendants
  const onCollapse = useCallback(
    (nodeId: string) => {
      setExplodedIds((prev) => {
        if (!prev.has(nodeId)) return prev;
        const next = new Set(prev);
        next.delete(nodeId);

        // Remove all descendants from exploded set
        for (const id of Array.from(next)) {
          let cur: string | null = id;
          while (cur) {
            const entity: CodeEntity | undefined = data.entities[cur];
            if (!entity) break;
            if (entity.parent === nodeId) {
              next.delete(id);
              break;
            }
            cur = entity.parent ?? null;
          }
        }

        // Build new visual graph with node collapsed
        const rawVg = buildVisualGraph(data, next, hiddenIds);

        // Preserve positions of remaining top-level nodes
        const preservedPositions = new Map<string, { x: number; y: number }>();
        for (const [id, sn] of simNodesMap.current.entries()) {
          // Only keep positions for nodes that still exist
          if (rawVg.nodes.some((n) => n.id === id)) {
            preservedPositions.set(id, { x: sn.x ?? 0, y: sn.y ?? 0 });
          }
        }

        const mergedNodes = mergeNodesPreservingPositions(nodesRef.current, rawVg.nodes);
        const newVg: VisualGraph = { ...rawVg, nodes: mergedNodes };

        // Update ReactFlow nodes
        nodesRef.current = mergedNodes;
        setNodes(mergedNodes);
        setEdges(newVg.edges);

        // Update simulation structure
        updateSimulationStructure(newVg, preservedPositions);
        vgRef.current = newVg;

        return next;
      });
    },
    [data, hiddenIds, setNodes, setEdges, updateSimulationStructure]
  );

  const onHide = useCallback(
    (nodeId: string) => {
      setHiddenIds((prevHidden) => {
        if (prevHidden.has(nodeId)) return prevHidden;
        const nextHidden = new Set(prevHidden);

        const stack = [nodeId];
        while (stack.length) {
          const cur = stack.pop()!;
          if (nextHidden.has(cur)) continue;
          nextHidden.add(cur);
          const entity = data.entities[cur];
          if (!entity) continue;
          for (const childId of entity.children) stack.push(childId);
        }

        const nextExploded = new Set(explodedIds);
        for (const id of nextHidden) nextExploded.delete(id);
        setExplodedIds(nextExploded);

        const rawVg = buildVisualGraph(data, nextExploded, nextHidden);
        const preservedPositions = new Map<string, { x: number; y: number }>();
        for (const [id, sn] of simNodesMap.current.entries()) {
          if (rawVg.nodes.some((n) => n.id === id)) {
            preservedPositions.set(id, { x: sn.x ?? 0, y: sn.y ?? 0 });
          }
        }

        const mergedNodes = mergeNodesPreservingPositions(nodesRef.current, rawVg.nodes);
        const newVg: VisualGraph = { ...rawVg, nodes: mergedNodes };

        nodesRef.current = mergedNodes;
        setNodes(mergedNodes);
        setEdges(newVg.edges);
        updateSimulationStructure(newVg, preservedPositions);
        vgRef.current = newVg;

        return nextHidden;
      });
    },
    [data, explodedIds, setNodes, setEdges, updateSimulationStructure]
  );

  // Full rebuild from scratch (dagre + force) - used for initial load and layout direction changes
  const fullRebuild = useCallback(
    (exploded: Set<string>, hidden: Set<string>) => {
      const vg = buildVisualGraph(data, exploded, hidden);
      const dagreNodes = computeFullLayout(vg, layoutDirection);
      const resolvedVg: VisualGraph = { ...vg, nodes: dagreNodes };

      setEdges(vg.edges);
      nodesRef.current = dagreNodes;
      setNodes(dagreNodes);

      // Initialize simulation with dagre positions
      const simNodes: SimNode[] = dagreNodes.map((n) => ({
        id: n.id,
        w: typeof n.style?.width === 'number' ? n.style.width : FILE_NODE_W,
        h: typeof n.style?.height === 'number' ? n.style.height : FILE_NODE_H,
        x: n.position.x,
        y: n.position.y,
        vx: 0,
        vy: 0,
      }));

      simNodesMap.current = new Map(simNodes.map((sn) => [sn.id, sn]));
      if (simRef.current) simRef.current.stop();

      const sim = createSimulation(simNodes, resolvedVg.topLinks, -1200, 100, 0.02);
      simRef.current = sim;
      vgRef.current = resolvedVg;

      startAnimation();
      setTimeout(() => fitView({ padding: 0.18 }), 100);
    },
    [data, setEdges, setNodes, fitView, layoutDirection, startAnimation]
  );

  // Direction change triggers full rebuild
  const onLayoutChange = useCallback(
    (dir: 'TB' | 'LR') => {
      setLayoutDirection(dir);
      fullRebuild(explodedIds, hiddenIds);
    },
    [fullRebuild, explodedIds, hiddenIds]
  );

  // Initial load
  useEffect(() => {
    fullRebuild(new Set(), new Set());
    return () => {
      if (simRef.current) simRef.current.stop();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [fullRebuild]);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    if (!simRef.current) return;
    if (syncTopLevelSimSizes(nodes) && !isDraggingRef.current) {
      reheat(0.35);
    }
  }, [nodes, reheat, syncTopLevelSimSizes]);

  // Drag handlers
  const onNodeDragStart = useCallback((_event: React.MouseEvent, _node: Node) => {
    isDraggingRef.current = true;
    if (simRef.current) simRef.current.stop();
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, []);

  const onNodeDrag = useCallback((_event: React.MouseEvent, node: Node) => {
    const simNode = simNodesMap.current.get(node.id);
    if (simNode) {
      simNode.x = node.position.x;
      simNode.y = node.position.y;
      simNode.vx = 0;
      simNode.vy = 0;
      simNode.fx = node.position.x;
      simNode.fy = node.position.y;
    }

    const updated = nodesRef.current.map((n) => (n.id === node.id ? { ...n, position: node.position } : n));
    nodesRef.current = updated;
    setNodes(updated);
  }, [setNodes]);

  const onNodeDragStop = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      isDraggingRef.current = false;
      const simNode = simNodesMap.current.get(node.id);
      if (simNode) {
        simNode.fx = undefined;
        simNode.fy = undefined;
        simNode.x = node.position.x;
        simNode.y = node.position.y;
      }
      if (simRef.current) {
        simRef.current.alpha(0.5);
        startAnimation();
      }
    },
    [startAnimation]
  );

  // Context menu handlers (unchanged)
  const closeMenu = useCallback(() => setMenu(null), []);
  const onNodeContextMenu = useCallback((event: React.MouseEvent, node: Node) => {
    event.preventDefault();
    const pane = flowRef.current?.getBoundingClientRect();
    if (!pane) return;
    setMenu({
      nodeId: node.id,
      top: event.clientY < pane.height - 160 ? event.clientY - pane.top : false,
      left: event.clientX < pane.width - 170 ? event.clientX - pane.left : false,
      right: event.clientX >= pane.width - 170 ? pane.width - (event.clientX - pane.left) : false,
      bottom: event.clientY >= pane.height - 160 ? pane.height - (event.clientY - pane.top) : false,
    });
  }, []);

  // Sync selected node highlight
  useEffect(() => {
    setNodes((prev) =>
      prev.map((n) => {
        const want = n.id === selectedEntityId;
        const has = Boolean((n.data as Record<string, unknown>).isSelected);
        if (want === has) return n;
        return { ...n, data: { ...n.data, isSelected: want } };
      })
    );
  }, [selectedEntityId, setNodes]);

  const menuEntity = menu ? data.entities[menu.nodeId] : null;
  const callbacksCtx = useMemo(() => ({ onSelectNode, onNavigateTo }), [onSelectNode, onNavigateTo]);

  return (
    <GraphCallbacksContext.Provider value={callbacksCtx}>
      <div ref={flowRef} style={{ width: '100%', height: '100%' }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeContextMenu={onNodeContextMenu}
          onPaneClick={closeMenu}
          onNodeClick={closeMenu}
          onNodeDragStart={onNodeDragStart}
          onNodeDrag={onNodeDrag}
          onNodeDragStop={onNodeDragStop}
          nodesDraggable={true}
          nodesConnectable={false}
          fitView
        >
          <Background color="#e8edf2" gap={24} />
          <Controls />
          <MiniMap zoomable pannable />

          <Panel position="top-right">
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                style={{
                  background: '#fff',
                  border: '1px solid #e2e8f0',
                  borderRadius: 6,
                  padding: '5px 12px',
                  cursor: 'pointer',
                }}
                onClick={() => onLayoutChange('TB')}
              >
                Vertical Layout
              </button>
              <button
                style={{
                  background: '#fff',
                  border: '1px solid #e2e8f0',
                  borderRadius: 6,
                  padding: '5px 12px',
                  cursor: 'pointer',
                }}
                onClick={() => onLayoutChange('LR')}
              >
                Horizontal Layout
              </button>
              <button
                style={{
                  background: '#fff',
                  border: '1px solid #e2e8f0',
                  borderRadius: 6,
                  padding: '5px 12px',
                  cursor: 'pointer',
                }}
                onClick={() => reheat(0.8)}
              >
                Reheat
              </button>
            </div>
          </Panel>

          {menu && (
            <ContextMenu
              {...menu}
              canExplode={menuEntity?.canExplode ?? false}
              isExploded={explodedIds.has(menu.nodeId)}
              onExplode={onExplode}
              onCollapse={onCollapse}
              onHide={onHide}
              onClose={closeMenu}
            />
          )}
        </ReactFlow>
      </div>
    </GraphCallbacksContext.Provider>
  );
}
// ── Root Graph component (unchanged) ──────────────────────────────────────────
export default function Graph() {
  const query = trpc.graph.get.useQuery();
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [navigateTarget, setNavigateTarget] = useState<CodeDefinition | null>(null);
  const [paneWidth, setPaneWidth] = useState(50);
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
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  if (query.isLoading)
    return <div className="flex items-center justify-center w-screen h-screen bg-slate-100 text-slate-500 text-base">Parsing…</div>;

  if (query.error)
    return (
      <div className="flex flex-col items-center justify-center w-screen h-screen bg-slate-100 text-red-500 gap-3">
        <span className="text-lg font-semibold">Parse error</span>
        <pre className="text-sm text-slate-500 max-w-xl text-center whitespace-pre-wrap">{query.error.message}</pre>
      </div>
    );

  if (!query.data) return null;

  const graph = query.data as SerializedCodeGraph;

  return (
    <div style={{ display: 'flex', width: '100vw', height: '100vh', background: '#0f172a', overflow: 'hidden' }}>
      <div style={{ width: `${paneWidth}%`, height: '100%', flexShrink: 0, background: '#f1f5f9' }}>
        <ReactFlowProvider>
          <LayoutFlow data={graph} selectedEntityId={selectedEntityId} onSelectNode={onSelectNode} onNavigateTo={onNavigateTo} />
        </ReactFlowProvider>
      </div>
      <div
        onMouseDown={onDividerMouseDown}
        style={{
          width: 4,
          height: '100%',
          flexShrink: 0,
          background: '#1e293b',
          cursor: 'col-resize',
          transition: 'background 0.1s',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = '#334155')}
        onMouseLeave={(e) => (e.currentTarget.style.background = '#1e293b')}
      />
      <div style={{ flex: 1, height: '100%', overflow: 'hidden' }}>
        <CodePane selectedEntityId={selectedEntityId} navigateTarget={navigateTarget} graph={graph} />
      </div>
    </div>
  );
}
