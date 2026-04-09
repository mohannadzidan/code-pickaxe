import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ShortcutAction =
  | "showAllHiddenExceptExternal"
  | "hideNode"
  | "showMoreRelationships"
  | "isolateNode"
  | "revealInExplorer"
  | "showDependenciesOnly"
  | "showDependentsOnly"
  | "unpackNode"
  | "packNode";

export type ShortcutBinding = {
  key: string;
  shift: boolean;
};

export type ShortcutConfig = Record<ShortcutAction, ShortcutBinding>;

export const defaultShortcutConfig: ShortcutConfig = {
  showAllHiddenExceptExternal: { key: "h", shift: true },
  hideNode: { key: "h", shift: false },
  showMoreRelationships: { key: "x", shift: false },
  isolateNode: { key: "s", shift: false },
  revealInExplorer: { key: "f", shift: false },
  showDependenciesOnly: { key: "d", shift: false },
  showDependentsOnly: { key: "d", shift: true },
  unpackNode: { key: "u", shift: false },
  packNode: { key: "u", shift: true },
};

export const shortcutLabels: Record<ShortcutAction, string> = {
  showAllHiddenExceptExternal: "Show all hidden (except built-ins and externals)",
  hideNode: "Hide selected node",
  showMoreRelationships: "Show more relationships",
  isolateNode: "Isolate selected node",
  revealInExplorer: "Reveal in explorer",
  showDependenciesOnly: "Show dependencies only",
  showDependentsOnly: "Show dependents only",
  unpackNode: "Unpack selected node",
  packNode: "Pack selected node",
};

export const shortcutOrder: ShortcutAction[] = [
  "showAllHiddenExceptExternal",
  "hideNode",
  "showMoreRelationships",
  "isolateNode",
  "revealInExplorer",
  "showDependenciesOnly",
  "showDependentsOnly",
  "unpackNode",
  "packNode",
];

type KeyboardShortcutState = {
  shortcuts: ShortcutConfig;
};

type KeyboardShortcutActions = {
  setShortcut: (action: ShortcutAction, binding: ShortcutBinding) => void;
  setShortcuts: (shortcuts: ShortcutConfig) => void;
  resetShortcuts: () => void;
};

type KeyboardShortcutStore = KeyboardShortcutState & KeyboardShortcutActions;

export const normalizeShortcutBinding = (binding: ShortcutBinding): ShortcutBinding => ({
  key: binding.key.trim().toLowerCase(),
  shift: Boolean(binding.shift),
});

export const shortcutMatchesKeyboardEvent = (event: KeyboardEvent, binding: ShortcutBinding): boolean => {
  const normalized = normalizeShortcutBinding(binding);
  if (!normalized.key) return false;
  if (event.shiftKey !== normalized.shift) return false;
  if (event.ctrlKey || event.altKey || event.metaKey) return false;
  return event.key.toLowerCase() === normalized.key;
};

export const useKeyboardShortcutStore = create<KeyboardShortcutStore>()(
  persist(
    (set) => ({
      shortcuts: defaultShortcutConfig,
      setShortcut: (action, binding) => {
        const normalized = normalizeShortcutBinding(binding);
        set((state) => ({ shortcuts: { ...state.shortcuts, [action]: normalized } }));
      },
      setShortcuts: (shortcuts) => {
        const normalized: ShortcutConfig = {
          showAllHiddenExceptExternal: normalizeShortcutBinding(shortcuts.showAllHiddenExceptExternal),
          hideNode: normalizeShortcutBinding(shortcuts.hideNode),
          showMoreRelationships: normalizeShortcutBinding(shortcuts.showMoreRelationships),
          isolateNode: normalizeShortcutBinding(shortcuts.isolateNode),
          revealInExplorer: normalizeShortcutBinding(shortcuts.revealInExplorer),
          showDependenciesOnly: normalizeShortcutBinding(shortcuts.showDependenciesOnly),
          showDependentsOnly: normalizeShortcutBinding(shortcuts.showDependentsOnly),
          unpackNode: normalizeShortcutBinding(shortcuts.unpackNode),
          packNode: normalizeShortcutBinding(shortcuts.packNode),
        };
        set({ shortcuts: normalized });
      },
      resetShortcuts: () => set({ shortcuts: defaultShortcutConfig }),
    }),
    {
      name: "code-pickaxe:keyboard-shortcuts",
      partialize: (state) => ({ shortcuts: state.shortcuts }),
    }
  )
);

export const selectKeyboardShortcuts = (state: KeyboardShortcutStore) => state.shortcuts;
export const selectSetShortcuts = (state: KeyboardShortcutStore) => state.setShortcuts;
export const selectResetShortcuts = (state: KeyboardShortcutStore) => state.resetShortcuts;
