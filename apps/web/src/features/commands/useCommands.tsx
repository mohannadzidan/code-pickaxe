import { useEffect, useMemo } from 'react';
import { useSelectionStore } from '@/features/selection/store/selectionStore';
import { useCommandRegistryStore } from './commandRegistryStore';
import type { CommandContext } from './types';
import { keybindingFromEvent } from './types';

export function useCommands(activeSurface: 'graph' | 'explorer' | 'code' | 'global') {
  const selectedEntityId = useSelectionStore((s) => s.selectedEntityId);
  const { query } = useCommandRegistryStore();

  // Minimal context
  const ctx = useMemo<CommandContext>(
    () => ({
      activeSurface,
      selectedEntityId,
    }),
    [activeSurface, selectedEntityId]
  );

  // Handle keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Skip if typing in input
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }

      const keybinding = keybindingFromEvent(event);
      const matchingCommands = query(ctx, keybinding);

      if (matchingCommands.length > 0) {
        event.preventDefault();
        matchingCommands[0].run(ctx);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [ctx, query]);

  // Return available commands (for context menus)
  return useMemo(() => query(ctx), [ctx, query]);
}
