import { PackageOpen } from 'lucide-react';
import type { Command } from '../types';
import { useGraphStore } from '@/features/graph/store/graphStore';

export const packAllCommand: Command = {
  id: 'packAll',
  title: 'Pack all',
  description: 'Collapse entire subtree into this single folder node',
  icon: PackageOpen,

  predicate: (ctx) => {
    if (ctx.activeSurface !== 'explorer' || !ctx.selectedEntityId) return false;
    const { nodes } = useGraphStore.getState();
    return nodes[ctx.selectedEntityId]?.kind === 'folder';
  },

  // collapseEntity(folder) = folder.hidden=false (visible), ALL descendants hidden=true.
  // One call collapses the entire subtree into the folder node.
  run: (ctx) => {
    if (!ctx.selectedEntityId) return;
    useGraphStore.getState().collapseEntity(ctx.selectedEntityId);
  },
};
