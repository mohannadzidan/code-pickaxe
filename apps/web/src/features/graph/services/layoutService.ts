import dagre from "@dagrejs/dagre";
import type { LayoutDirection, NodePositions, VisualGraph } from "@/shared/types/domain";

const FILE_NODE_W = 120;
const FILE_NODE_H = 36;

export class LayoutService {
  computePositions(vg: VisualGraph, direction: LayoutDirection): NodePositions {
    const dagreGraph = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
    dagreGraph.setGraph({ rankdir: direction, nodesep: 40, ranksep: 50 });

    for (const node of vg.nodes) {
      dagreGraph.setNode(node.id, { width: FILE_NODE_W, height: FILE_NODE_H });
    }

    for (const edge of vg.topLinks) {
      dagreGraph.setEdge(edge.source, edge.target);
    }

    dagre.layout(dagreGraph);

    const positions: NodePositions = {};
    for (const node of vg.nodes) {
      const nodeWithPos = dagreGraph.node(node.id);
      positions[node.id] = {
        x: nodeWithPos.x - FILE_NODE_W / 2,
        y: nodeWithPos.y - FILE_NODE_H / 2,
      };
    }

    return positions;
  }
}
