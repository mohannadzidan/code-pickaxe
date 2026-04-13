import { ChevronsDown } from 'lucide-react';
import type { Command } from '../types';
import { useUiStore } from '@/shared/store/uiStore';

export const unfoldAllCommand: Command = {
  id: 'unfoldAll',
  title: 'Unfold all',
  description: 'Expand all tree nodes in explorer (UI only, no graph effect)',
  icon: ChevronsDown,

  predicate: (ctx) => ctx.activeSurface === 'explorer',

  run: () => {
    useUiStore.getState().requestExplorerUnfoldAll();
  },
};
