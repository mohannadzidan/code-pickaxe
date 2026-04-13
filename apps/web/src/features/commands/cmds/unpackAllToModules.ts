import { FolderOpen } from 'lucide-react';
import type { Command } from '../types';
import { useGraphStore } from '@/features/graph/store/graphStore';

export const unpackAllToModulesCommand: Command = {
  id: 'unpackAllToModules',
  title: 'Unpack all to modules',
  description: 'Expand folder layers only — modules remain as single nodes',
  icon: FolderOpen,

  predicate: (ctx) => {
    if (ctx.activeSurface !== 'explorer' || !ctx.selectedEntityId) return false;
    const { nodes } = useGraphStore.getState();
    return nodes[ctx.selectedEntityId]?.kind === 'folder';
  },

  run: (ctx) => {
    if (!ctx.selectedEntityId) return;

    const graphStore = useGraphStore.getState();
    const { nodes } = graphStore;

    // Explode folder nodes (hidden, children visible) and collapse module nodes
    // (visible as single packed node, children hidden). Stop recursing into modules.
    const process = (nodeId: string) => {
      const node = nodes[nodeId];
      if (!node) return;

      if (node.kind === 'folder') {
        graphStore.explodeEntity(nodeId); // folder disappears, its children appear
        for (const childId of node.children) process(childId);
      } else if (node.kind === 'module') {
        graphStore.collapseEntity(nodeId); // module shows as single node, children hidden
      }
    };

    process(ctx.selectedEntityId);
  },
};
