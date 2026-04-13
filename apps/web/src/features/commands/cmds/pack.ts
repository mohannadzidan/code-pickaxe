import { Box } from 'lucide-react';
import type { Command } from '../types';
import { useGraphStore } from '@/features/graph/store/graphStore';

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
    if (!node || node.children.length === 0) return false;

    // Unpacked = node is hidden (exploded), its children are visible
    return node.hidden && node.children.some((childId) => !nodes[childId]?.hidden);
  },

  run: (ctx) => {
    if (!ctx.selectedEntityId) return;
    useGraphStore.getState().collapseEntity(ctx.selectedEntityId);
  },
};
