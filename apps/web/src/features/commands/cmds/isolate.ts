import { Target } from 'lucide-react';
import type { Command } from '../types';
import { useGraphStore } from '@/features/graph/store/graphStore';

export const isolateCommand: Command = {
  id: 'isolate',
  title: 'Isolate',
  description: 'Show only this node and its direct dependency neighbors',
  icon: Target,
  keybinding: { key: 's', modifiers: { shift: false } },

  predicate: (ctx) => {
    const {  nodes } = useGraphStore.getState();
    return !!ctx.selectedEntityId && !nodes[ctx.selectedEntityId].hidden;
  },

  run: (ctx) => {
    if (!ctx.selectedEntityId) return;

    const graphStore = useGraphStore.getState();
    const { graph, edges, nodes, setFocusedNodes } = graphStore;
    if (!graph) return;

    // Resolve a node to its nearest visible ancestor.
    // Edges reference raw entity IDs (e.g. a class inside a packed module).
    // We want the packed module, not the class, so we walk up until we find
    // a node that is actually visible in the graph.
    const nearestVisible = (nodeId: string): string | null => {
      const node = nodes[nodeId];
      if (!node) return null;
      if (!node.hidden) return nodeId;
      // search both the children and the parent, since we could have hidden nodes in either direction (e.g. a packed module or a hidden class with an exploded method) and pick the first visible node we find in either direction. This isn't guaranteed to be the "closest" visible node in terms of graph distance, but it's a simple heuristic that seems to work well in practice.
      const q: string[] = [];
      if (!node.parentId) return null;
      q.push(node.parentId);
      while (q.length > 0) {
        const currentId = q.shift()!;
        const currentNode = nodes[currentId];
        if (!currentNode) continue;
        if (!currentNode.hidden) return currentId;
        if (currentNode.parentId) q.push(currentNode.parentId);
      }
      return null;
    };
    
    const nearestContainer = (nodeId: string): string | null => {
      const node = nodes[nodeId];
      if (!node) return null;
      if (node.kind === 'module' || node.kind === 'folder') return nodeId;
      if (!node.parentId) return null;
      return nearestContainer(node.parentId);
    };
    console.log('Isolating', ctx.selectedEntityId, nodes[ctx.selectedEntityId]);

    // Collect all IDs in a node's subtree so we can match edges that reference
    // sub-entities (e.g. a class inside the selected module).

    const collectAllRelatedNodes = (nodeId: string, collected = [] as string[]) => {
      const node = nodes[nodeId];
      if (!node) return collected;
      node.outEdgeIds.forEach((id) => collected.push(edges[id].target === nodeId ? edges[id].source : edges[id].target));
      node.inEdgeIds.forEach((id) => collected.push(edges[id].source === nodeId ? edges[id].target : edges[id].source));
      node.children.forEach((childId) => collectAllRelatedNodes(childId, collected));
      return collected;
    };
    const selectedSubtree = new Set(collectAllRelatedNodes(ctx.selectedEntityId).map((n) => nearestVisible(n) ?? nearestContainer(n) ?? n));
    selectedSubtree.add(ctx.selectedEntityId);
    graphStore.applyVisibilityMask(selectedSubtree);
    console.log(nearestVisible(ctx.selectedEntityId), ctx.selectedEntityId, selectedSubtree);
    setFocusedNodes([...selectedSubtree]);
  },
};
