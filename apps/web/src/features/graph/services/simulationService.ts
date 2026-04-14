import * as d3Force from "d3-force";

type SimNode = d3Force.SimulationNodeDatum & {
  id: string;
  w: number;
  h: number;
};

type LinkDatum = { source: string; target: string };

type SimInputNode = {
  id: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
};

const NODE_W = 120;
const NODE_H = 36;

// Half-diagonal of a node — used as the collision radius so d3's quadtree-based
// forceCollide (O(n log n)) can replace the old O(n²) brute-force rect check.
function nodeRadius(node: Pick<SimNode, "w" | "h">): number {
  return Math.hypot(node.w, node.h) / 2;
}

export class SimulationService {
  private simulation: d3Force.Simulation<SimNode, d3Force.SimulationLinkDatum<SimNode>> | null = null;
  private nodesById = new Map<string, SimNode>();
  private rafId: number | null = null;
  private onTick: ((positions: Record<string, { x: number; y: number }>) => void) | null = null;

  // Pre-allocated output map — reused every tick to avoid per-frame GC pressure.
  // Position entries are also reused; only their x/y values are mutated.
  private outputPositions: Record<string, { x: number; y: number }> = {};

  init(onTick: (positions: Record<string, { x: number; y: number }>) => void) {
    this.onTick = onTick;
  }

  syncGraph(nodes: SimInputNode[], links: LinkDatum[]) {
    const nextNodes: SimNode[] = nodes.map((node) => {
      const existing = this.nodesById.get(node.id);
      return {
        id: node.id,
        x: existing?.x ?? node.x,
        y: existing?.y ?? node.y,
        vx: existing?.vx ?? 0,
        vy: existing?.vy ?? 0,
        fx: existing?.fx,
        fy: existing?.fy,
        w: node.w ?? NODE_W,
        h: node.h ?? NODE_H,
      };
    });

    this.nodesById = new Map(nextNodes.map((n) => [n.id, n]));

    // Remove stale entries from the output map so we don't emit positions for
    // nodes that are no longer in the simulation.
    for (const id of Object.keys(this.outputPositions)) {
      if (!this.nodesById.has(id)) delete this.outputPositions[id];
    }

    if (this.simulation) {
      // Incrementally update the existing simulation — preserves velocities,
      // alpha state, and avoids rebuilding all force data structures from scratch.
      this.simulation.nodes(nextNodes);
      // forceLink links must be updated separately after nodes() reinitialises
      // the node index used for source/target lookups.
      (
        this.simulation.force("link") as d3Force.ForceLink<SimNode, d3Force.SimulationLinkDatum<SimNode>>
      ).links(links);
    } else {
      // First call — create the simulation once.
      this.simulation = d3Force
        .forceSimulation<SimNode>(nextNodes)
        .force(
          "link",
          d3Force
            .forceLink<SimNode, d3Force.SimulationLinkDatum<SimNode>>(links)
            .id((d) => d.id)
            .distance((link) => {
              const source = link.source as unknown as SimNode;
              const target = link.target as unknown as SimNode;
              return nodeRadius(source) + nodeRadius(target) + 110;
            })
            .strength(0.1)
        )
        .force(
          "charge",
          d3Force.forceManyBody<SimNode>().strength((node) => {
            const scale = Math.max(1, Math.max(node.w, node.h) / NODE_W);
            return -1100 * scale;
          })
        )
        // O(n log n) quadtree collision — replaces the old O(n²) brute-force loop.
        // Padding of 9 per side gives the same total gap (18px) as before since
        // forceCollide enforces radius(a) + radius(b) minimum distance.
        .force(
          "collide",
          d3Force
            .forceCollide<SimNode>((node) => nodeRadius(node) + 9)
            .strength(0.8)
        )
        .force("x", d3Force.forceX<SimNode>(0).strength(0.04))
        .force("y", d3Force.forceY<SimNode>(0).strength(0.04))
        .alphaDecay(0.02)
        .stop();
    }

    this.reheat(0.55);
  }

  dragNode(nodeId: string, position: { x: number; y: number }) {
    const node = this.nodesById.get(nodeId);
    if (!node) return;
    node.x = position.x;
    node.y = position.y;
    node.vx = 0;
    node.vy = 0;
    node.fx = position.x;
    node.fy = position.y;
  }

  releaseNode(nodeId: string, position: { x: number; y: number }) {
    const node = this.nodesById.get(nodeId);
    if (!node) return;
    node.fx = undefined;
    node.fy = undefined;
    node.x = position.x;
    node.y = position.y;
  }

  reheat(alpha = 0.8) {
    if (!this.simulation) return;
    this.simulation.alpha(alpha);
    this.startTicking();
  }

  stop() {
    this.simulation?.stop();
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private emitPositions() {
    if (!this.onTick) return;
    // Mutate pre-allocated entries rather than allocating new objects each tick.
    for (const [id, node] of this.nodesById.entries()) {
      let entry = this.outputPositions[id];
      if (!entry) {
        this.outputPositions[id] = { x: node.x ?? 0, y: node.y ?? 0 };
      } else {
        entry.x = node.x ?? 0;
        entry.y = node.y ?? 0;
      }
    }
    this.onTick(this.outputPositions);
  }

  private startTicking() {
    if (!this.simulation || this.rafId) return;

    const tick = () => {
      if (!this.simulation) return;
      this.simulation.tick();
      this.emitPositions();

      if (this.simulation.alpha() > this.simulation.alphaMin()) {
        this.rafId = requestAnimationFrame(tick);
      } else {
        this.rafId = null;
      }
    };

    this.rafId = requestAnimationFrame(tick);
  }
}
