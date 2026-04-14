import { Crosshair } from 'lucide-react';
import type { Command } from '../types';
import { useGraphStore } from '@/features/graph/store/graphStore';

export const focusCommand: Command = {
  id: 'focus',
  title: 'Focus',
  description: 'Pan and zoom to the currently selected entity',
  icon: Crosshair,
  keybinding: { key: 'f', modifiers: { shift: false } },

  predicate: (ctx) => {
    const { nodes } = useGraphStore.getState();
    return !!ctx.selectedEntityId && !nodes[ctx.selectedEntityId]?.hidden;
  },

  run: (ctx) => {
    if (!ctx.selectedEntityId) return;
    const { setFocusedNodes } = useGraphStore.getState();
    setFocusedNodes([ctx.selectedEntityId]);
  },
};
