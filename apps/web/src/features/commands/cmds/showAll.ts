import { Eye } from 'lucide-react';
import type { Command } from '../types';
import { useGraphStore } from '@/features/graph/store/graphStore';

export const showAllCommand: Command = {
  id: 'showAll',
  title: 'Show all',
  description: 'Un-hide this item and all descendants',
  icon: Eye,

  predicate: (ctx) => {
    if (ctx.activeSurface !== 'explorer' || !ctx.selectedEntityId) return false;
    const { nodes } = useGraphStore.getState();
    const anyHidden = (nodeId: string): boolean => {
      const node = nodes[nodeId];
      if (!node) return false;
      if (node.hidden) return true;
      return node.children.some(anyHidden);
    };
    return anyHidden(ctx.selectedEntityId);
  },

  run: (ctx) => {
    if (!ctx.selectedEntityId) return;

    const graphStore = useGraphStore.getState();
    const { nodes } = graphStore;

    // Rule applied top-down recursively:
    // - Node has NO visible descendants → show the node as packed (it absorbs its children)
    // - Node HAS visible descendants → it's in exploded state, keep it hidden, recurse into children
    const hasVisibleDescendant = (nodeId: string): boolean => {
      const node = nodes[nodeId];
      if (!node) return false;
      return node.children.some((childId) => {
        const child = nodes[childId];
        return child && (!child.hidden || hasVisibleDescendant(childId));
      });
    };

    const showNode = (nodeId: string) => {
      const node = nodes[nodeId];
      if (!node) return;

      if (!hasVisibleDescendant(nodeId)) {
        // Nothing inside is visible — show this node as a packed single node
        graphStore.showEntity(nodeId);
      } else {
        // Some descendants are already visible — this node is exploded,
        // keep it hidden and recurse so each child gets the same treatment
        for (const childId of node.children) {
          showNode(childId);
        }
      }
    };

    showNode(ctx.selectedEntityId);
  },
};
