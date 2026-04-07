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

function nodeRadius(node: Pick<SimNode, "w" | "h">): number {
  return Math.max(node.w, node.h) / 2;
}

function forceRectCollide(padding = 20) {
  let sns: SimNode[] = [];

  function force(alpha: number) {
    for (let i = 0; i < sns.length; i++) {
      for (let j = i + 1; j < sns.length; j++) {
        const a = sns[i];
        const b = sns[j];

        const ax = (a.x ?? 0) + a.w / 2;
        const ay = (a.y ?? 0) + a.h / 2;
        const bx = (b.x ?? 0) + b.w / 2;
        const by = (b.y ?? 0) + b.h / 2;

        const dx = bx - ax;
        const dy = by - ay;
        const dist = Math.hypot(dx, dy) || 0.0001;
        const minDist = nodeRadius(a) + nodeRadius(b) + padding;
        const overlap = minDist - dist;
        if (overlap <= 0) continue;

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

  force.initialize = (nodes: SimNode[]) => {
    sns = nodes;
  };

  return force;
}

export class SimulationService {
  private simulation: d3Force.Simulation<SimNode, d3Force.SimulationLinkDatum<SimNode>> | null = null;
  private nodesById = new Map<string, SimNode>();
  private rafId: number | null = null;
  private onTick: ((positions: Record<string, { x: number; y: number }>) => void) | null = null;

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

    this.nodesById = new Map(nextNodes.map((node) => [node.id, node]));

    this.simulation?.stop();
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
      .force("collide", forceRectCollide(18))
      .force("x", d3Force.forceX<SimNode>(0).strength(0.04))
      .force("y", d3Force.forceY<SimNode>(0).strength(0.04))
      .alphaDecay(0.02)
      .stop();

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
    const positions: Record<string, { x: number; y: number }> = {};
    for (const [id, node] of this.nodesById.entries()) {
      positions[id] = { x: node.x ?? 0, y: node.y ?? 0 };
    }
    this.onTick(positions);
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
