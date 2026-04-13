import { create } from "zustand";

type UiState = {
  explorerPaneWidth: number;
  paneWidth: number;
  settingsOpen: boolean;
  explorerFoldRequest: number;
  explorerUnfoldRequest: number;
};

type UiActions = {
  setExplorerPaneWidth: (width: number) => void;
  setPaneWidth: (width: number) => void;
  setSettingsOpen: (open: boolean) => void;
  requestExplorerFoldAll: () => void;
  requestExplorerUnfoldAll: () => void;
};

type UiStore = UiState & UiActions;

export const useUiStore = create<UiStore>((set) => ({
  explorerPaneWidth: 24,
  paneWidth: 50,
  settingsOpen: false,
  explorerFoldRequest: 0,
  explorerUnfoldRequest: 0,
  setExplorerPaneWidth: (width) => set({ explorerPaneWidth: Math.min(40, Math.max(12, width)) }),
  setPaneWidth: (width) => set({ paneWidth: Math.min(80, Math.max(20, width)) }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  requestExplorerFoldAll: () => set((s) => ({ explorerFoldRequest: s.explorerFoldRequest + 1 })),
  requestExplorerUnfoldAll: () => set((s) => ({ explorerUnfoldRequest: s.explorerUnfoldRequest + 1 })),
}));

export const selectExplorerPaneWidth = (state: UiStore) => state.explorerPaneWidth;
export const selectPaneWidth = (state: UiStore) => state.paneWidth;
export const selectSettingsOpen = (state: UiStore) => state.settingsOpen;
