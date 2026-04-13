import { Eye } from 'lucide-react';
import type { Command } from '../types';
import { useGraphStore } from '@/features/graph/store/graphStore';

export const showAllHiddenCommand: Command = {
  id: 'showAllHidden',
  title: 'Show all hidden',
  description: 'Reveal all hidden nodes except externals',
  icon: Eye,
  keybinding: { key: 'h', modifiers: { shift: true } },

  predicate: () => {
    const { nodes } = useGraphStore.getState();
    return Object.values(nodes).some((n) => n.hidden);
  },

  run: () => {
    const graphStore = useGraphStore.getState();
    const { graph, nodes } = graphStore;
    if (!graph) return;

    const visibleIds = new Set<string>(Object.keys(graph.entities));

    // Include externals that were already visible
    const hiddenById = Object.fromEntries(
      Object.values(nodes).map((n) => [n.id, n.hidden])
    );

    for (const ext of graph.externalModules) {
      const extId = `external:${ext.moduleSpecifier}`;
      if (!hiddenById[extId]) {
        visibleIds.add(extId);
      }
    }

    graphStore.applyVisibilityMask(visibleIds);
  },
};
