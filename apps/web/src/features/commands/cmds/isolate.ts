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

    // Collect all IDs in a node's subtree so we can match edges that reference
    // sub-entities (e.g. a class inside the selected module).
    const getSubtreeIds = (nodeId: string): Set<string> => {
      const result = new Set<string>();
      const collect = (id: string) => {
        result.add(id);
        nodes[id]?.children.forEach((childId) => collect(childId));
      };
      collect(nodeId);
      return result;
    };

    const selectedSubtree = getSubtreeIds(ctx.selectedEntityId);
    const keepIds = new Set<string>();

    // The selected node itself — add its nearest visible form so we don't
    // accidentally unpack it if it was hidden (e.g. inside a packed parent).
    const selfVisible = nearestVisible(ctx.selectedEntityId);
    if (selfVisible) keepIds.add(selfVisible);

    // Add edge neighbors, resolved to their nearest visible ancestor so that
    // pack state is preserved (a class inside a packed module → add the module,
    // not the class).
    for (const edge of Object.values(edges)) {
      if (selectedSubtree.has(edge.source)) {
        const visible = nearestVisible(edge.target);
        if (visible) keepIds.add(visible);
      }
      if (selectedSubtree.has(edge.target)) {
        const visible = nearestVisible(edge.source);
        if (visible) keepIds.add(visible);
      }
    }

    // Add ancestors so the graph renders containers correctly.
    for (const id of Array.from(keepIds)) {
      if (id.startsWith('external:')) continue;
      let current = graph.entities[id];
      while (current?.parent) {
        keepIds.add(current.parent);
        current = graph.entities[current.parent];
      }
    }

    graphStore.applyVisibilityMask(keepIds);
  },
};
