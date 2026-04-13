import { ScanLine } from 'lucide-react';
import type { Command } from '../types';
import { useGraphStore } from '@/features/graph/store/graphStore';

export const showDependenciesOnlyCommand: Command = {
  id: 'showDependenciesOnly',
  title: 'Show dependencies only',
  description: 'Show only this node and the nodes it depends on (outgoing edges)',
  icon: ScanLine,
  keybinding: { key: 'd', modifiers: { shift: false } },

  predicate: (ctx) => {
    if (ctx.activeSurface !== 'graph' && ctx.activeSurface !== 'explorer') return false;
    if (!ctx.selectedEntityId) return false;
    const { edges } = useGraphStore.getState();
    return Object.values(edges).some((e) => e.source === ctx.selectedEntityId);
  },

  run: (ctx) => {
    if (!ctx.selectedEntityId) return;

    const graphStore = useGraphStore.getState();
    const { graph, edges, nodes } = graphStore;
    if (!graph) return;

    const nearestVisible = (nodeId: string): string | null => {
      const node = nodes[nodeId];
      if (!node) return null;
      if (!node.hidden) return nodeId;
      return node.parentId ? nearestVisible(node.parentId) : null;
    };

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

    const selfVisible = nearestVisible(ctx.selectedEntityId);
    if (selfVisible) keepIds.add(selfVisible);

    for (const edge of Object.values(edges)) {
      if (selectedSubtree.has(edge.source)) {
        const visible = nearestVisible(edge.target);
        if (visible) keepIds.add(visible);
      }
    }

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
