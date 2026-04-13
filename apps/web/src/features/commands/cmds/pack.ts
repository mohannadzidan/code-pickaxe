import { Box } from 'lucide-react';
import type { Command } from '../types';
import { useGraphStore } from '@/features/graph/store/graphStore';
import { useSelectionStore } from '@/features/selection/store/selectionStore';

export const packCommand: Command = {
  id: 'pack',
  title: 'Pack',
  description: 'Collapse children into a single node',
  icon: Box,
  keybinding: { key: 'u', modifiers: { shift: true } },

  predicate: (ctx) => {
    if (ctx.activeSurface !== 'graph' && ctx.activeSurface !== 'explorer') return false;
    if (!ctx.selectedEntityId) return false;

    const { nodes } = useGraphStore.getState();
    const node = nodes[ctx.selectedEntityId];
   
    return  !!node.parentId && nodes[node.parentId]?.hidden ;
  },

  run: (ctx) => {
    if (!ctx.selectedEntityId) return;
    const { nodes, collapseEntity } = useGraphStore.getState();
    const { selectEntity } = useSelectionStore.getState();
    console.log('Packing', ctx.selectedEntityId);
    collapseEntity(nodes[ctx.selectedEntityId].parentId!);
    selectEntity(nodes[ctx.selectedEntityId].parentId!);
  },
};
