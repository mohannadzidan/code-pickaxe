import { FolderOpen } from 'lucide-react';
import type { Command } from '../types';
import { useGraphStore } from '@/features/graph/store/graphStore';

export const unpackAllToEntitiesCommand: Command = {
  id: 'unpackAllToEntities',
  title: 'Unpack all to entities',
  description: 'Recursively expand everything until only leaf entities are visible',
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

    // Recursively explode every node that has children.
    // explodeEntity(x) → x.hidden=true, direct children hidden=false, indirect hidden=true.
    // Going top-down ensures each level is exploded in order.
    const explodeAll = (nodeId: string) => {
      const node = nodes[nodeId];
      if (!node) return;
      if (node.children.length > 0) {
        graphStore.explodeEntity(nodeId);
        for (const childId of node.children) explodeAll(childId);
      }
    };

    explodeAll(ctx.selectedEntityId);
  },
};
