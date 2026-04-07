import { create } from "zustand";

type UiState = {
  paneWidth: number;
};

type UiActions = {
  setPaneWidth: (width: number) => void;
};

type UiStore = UiState & UiActions;

export const useUiStore = create<UiStore>((set) => ({
  paneWidth: 50,
  setPaneWidth: (width) => set({ paneWidth: Math.min(80, Math.max(20, width)) }),
}));

export const selectPaneWidth = (state: UiStore) => state.paneWidth;
