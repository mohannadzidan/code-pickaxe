import { PackageOpen } from 'lucide-react';
import type { Command } from '../types';
import { useGraphStore } from '@/features/graph/store/graphStore';

export const packAllToModulesCommand: Command = {
  id: 'packAllToModules',
  title: 'Pack all to modules',
  description: 'Collapse every module to a single node, leave folder structure visible',
  icon: PackageOpen,

  predicate: (ctx) => {
    if (ctx.activeSurface !== 'explorer' || !ctx.selectedEntityId) return false;
    const { nodes } = useGraphStore.getState();
    return nodes[ctx.selectedEntityId]?.kind === 'folder';
  },

  run: (ctx) => {
    if (!ctx.selectedEntityId) return;

    const graphStore = useGraphStore.getState();
    const { nodes } = graphStore;

    // Collapse every module in the subtree. Folder nodes are not touched —
    // they stay in whatever exploded/packed state they're in.
    const process = (nodeId: string) => {
      const node = nodes[nodeId];
      if (!node) return;

      if (node.kind === 'module') {
        graphStore.collapseEntity(nodeId); // module visible, children hidden
      } else {
        for (const childId of node.children) process(childId);
      }
    };

    process(ctx.selectedEntityId);
  },
};
