import { PackageOpen } from 'lucide-react';
import type { Command } from '../types';
import { useGraphStore } from '@/features/graph/store/graphStore';
import { useSelectionStore } from '@/features/selection/store/selectionStore';

export const unpackCommand: Command = {
  id: 'unpack',
  title: 'Unpack',
  description: 'Expand to show direct children',
  icon: PackageOpen,
  keybinding: { key: 'u', modifiers: { shift: false } },

  predicate: (ctx) => {
    if (ctx.activeSurface !== 'graph' && ctx.activeSurface !== 'explorer') return false;
    if (!ctx.selectedEntityId) return false;

    const { nodes } = useGraphStore.getState();
    const node = nodes[ctx.selectedEntityId];
    if (!node || node.children.length === 0) return false;

    // Packed = node is visible as a single node (not hidden)
    return !node.hidden;
  },

  run: (ctx) => {
    if (!ctx.selectedEntityId) return;
    const { nodes, explodeEntity } = useGraphStore.getState();
    const { selectEntity } = useSelectionStore.getState();
    explodeEntity(ctx.selectedEntityId);
    selectEntity(nodes[ctx.selectedEntityId].children[0]);
  },
};
