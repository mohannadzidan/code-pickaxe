import { EyeOff } from 'lucide-react';
import type { Command } from '../types';
import { useGraphStore } from '@/features/graph/store/graphStore';

export const hideCommand: Command = {
  id: 'hide',
  title: 'Hide',
  description: 'Hide selected node and its children',
  icon: EyeOff,
  keybinding: { key: 'h', modifiers: { shift: false } },

  predicate: (ctx) => {
    return (
      (ctx.activeSurface === 'graph' || ctx.activeSurface === 'explorer') &&
      ctx.selectedEntityId !== null
    );
  },

  run: (ctx) => {
    if (!ctx.selectedEntityId) return;
    useGraphStore.getState().hideEntity(ctx.selectedEntityId);
  },
};
