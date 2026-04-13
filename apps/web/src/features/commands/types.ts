import type { LucideIcon } from 'lucide-react';

/** Unique identifiers for all commands */
export type CommandId =
  // Visibility commands
  | 'hide'
  | 'showAll'
  | 'showAllHidden'

  // Pack/Unpack commands
  | 'unpack'
  | 'pack'
  | 'unpackAllToModules'
  | 'packAllToModules'
  | 'unpackAllToEntities'
  | 'packAll'

  // Relationship commands
  | 'isolate'
  | 'showMoreRelationships'
  | 'showDependenciesOnly'
  | 'showDependentsOnly'

  // Navigation commands
  | 'foldAll'
  | 'unfoldAll'

  // View commands
  | 'toggleSettings';

/** Minimal context - commands read from stores directly */
export interface CommandContext {
  activeSurface: 'graph' | 'explorer' | 'code' | 'global';
  selectedEntityId: string | null;
}

/** Keybinding definition */
export interface Keybinding {
  modifiers: {
    shift?: boolean;
    ctrl?: boolean;
    meta?: boolean;
  };
  key: string;
}

/** Command Definition: A plain object following Principle 7 */
export interface Command {
  id: CommandId;
  title: string; // Short label for menus
  description?: string; // Longer description for settings
  icon?: LucideIcon; // lucide-react icon component
  keybinding?: Keybinding; // Default keybinding

  // Whether the command is available based on current context
  predicate: (ctx: CommandContext) => boolean;

  // Execute the command
  run: (ctx: CommandContext) => Promise<void> | void;
}

/** Convert keybinding to string representation */
export function keybindingToString(binding: Keybinding): string {
  const parts: string[] = [];
  if (binding.modifiers.shift) parts.push('Shift');
  if (binding.modifiers.ctrl) parts.push('Ctrl');
  if (binding.modifiers.meta) parts.push('⌘');
  parts.push(binding.key.toUpperCase());
  return parts.join(' + ');
}

/** Check if two keybindings match */
export function keybindingsMatch(a: Keybinding, b: Keybinding): boolean {
  return (
    a.key.toLowerCase() === b.key.toLowerCase() &&
    Boolean(a.modifiers.shift) === Boolean(b.modifiers.shift) &&
    Boolean(a.modifiers.ctrl) === Boolean(b.modifiers.ctrl) &&
    Boolean(a.modifiers.meta) === Boolean(b.modifiers.meta)
  );
}

/** Convert keyboard event to keybinding */
export function keybindingFromEvent(event: KeyboardEvent): Keybinding {
  return {
    key: event.key.toLowerCase(),
    modifiers: {
      shift: event.shiftKey,
      ctrl: event.ctrlKey,
      meta: event.metaKey,
    },
  };
}
