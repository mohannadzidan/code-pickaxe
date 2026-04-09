import { create } from "zustand";

type UiState = {
  explorerPaneWidth: number;
  paneWidth: number;
};

type UiActions = {
  setExplorerPaneWidth: (width: number) => void;
  setPaneWidth: (width: number) => void;
};

type UiStore = UiState & UiActions;

export const useUiStore = create<UiStore>((set) => ({
  explorerPaneWidth: 24,
  paneWidth: 50,
  setExplorerPaneWidth: (width) => set({ explorerPaneWidth: Math.min(40, Math.max(12, width)) }),
  setPaneWidth: (width) => set({ paneWidth: Math.min(80, Math.max(20, width)) }),
}));

export const selectExplorerPaneWidth = (state: UiStore) => state.explorerPaneWidth;
export const selectPaneWidth = (state: UiStore) => state.paneWidth;
