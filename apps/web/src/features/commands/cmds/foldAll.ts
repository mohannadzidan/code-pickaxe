import { ChevronsUp } from 'lucide-react';
import type { Command } from '../types';
import { useUiStore } from '@/shared/store/uiStore';

export const foldAllCommand: Command = {
  id: 'foldAll',
  title: 'Fold all',
  description: 'Collapse all tree nodes in explorer (UI only, no graph effect)',
  icon: ChevronsUp,

  predicate: (ctx) => ctx.activeSurface === 'explorer',

  run: () => {
    useUiStore.getState().requestExplorerFoldAll();
  },
};
