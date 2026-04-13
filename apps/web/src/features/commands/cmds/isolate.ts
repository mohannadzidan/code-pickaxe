import { Target } from 'lucide-react';
import type { Command } from '../types';
import { useGraphStore } from '@/features/graph/store/graphStore';

export const isolateCommand: Command = {
  id: 'isolate',
  title: 'Isolate',
  description: 'Show only this node and its direct dependency neighbors',
  icon: Target,
  keybinding: { key: 's', modifiers: { shift: false } },

  predicate: (ctx) => {
    if (ctx.activeSurface !== 'graph' && ctx.activeSurface !== 'explorer') return false;
    if (!ctx.selectedEntityId) return false;
    const { nodes } = useGraphStore.getState();
    const visibleCount = Object.values(nodes).filter((n) => !n.hidden).length;
    return visibleCount > 1;
  },

  run: (ctx) => {
    if (!ctx.selectedEntityId) return;

    const graphStore = useGraphStore.getState();
    const { graph, edges, nodes } = graphStore;
    if (!graph) return;

    // Resolve a node to its nearest visible ancestor.
    // Edges reference raw entity IDs (e.g. a class inside a packed module).
    // We want the packed module, not the class, so we walk up until we find
    // a node that is actually visible in the graph.
    const nearestVisible = (nodeId: string): string | null => {
      const node = nodes[nodeId];
      if (!node) return null;
      if (!node.hidden) return nodeId;
      return node.parentId ? nearestVisible(node.parentId) : null;
    };

    console.log('Isolating', ctx.selectedEntityId, nodes[ctx.selectedEntityId]);

    // Collect all IDs in a node's subtree so we can match edges that reference
    // sub-entities (e.g. a class inside the selected module).

    const collectAllRelatedNodes = (nodeId: string, collected = [] as string[]) => {
      const node = nodes[nodeId];
      if (!node) return collected;
      node.outEdgeIds.forEach((id) => collected.push(edges[id].target === nodeId ? edges[id].source : edges[id].target));
      node.inEdgeIds.forEach((id) => collected.push(edges[id].source === nodeId ? edges[id].target : edges[id].source));
      node.children.forEach((childId) => collectAllRelatedNodes(childId, collected));
      return collected;
    };
    const selectedSubtree = new Set(collectAllRelatedNodes(ctx.selectedEntityId).map(n => nearestVisible(n) ?? n));
    selectedSubtree.add(ctx.selectedEntityId);
    graphStore.applyVisibilityMask(selectedSubtree);
  },
};
