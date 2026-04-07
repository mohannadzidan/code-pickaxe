import { create } from "zustand";

type SelectionState = {
  selectedEntityId: string | null;
};

type SelectionActions = {
  selectEntity: (entityId: string | null) => void;
  clearSelection: () => void;
};

type SelectionStore = SelectionState & SelectionActions;

export const useSelectionStore = create<SelectionStore>((set) => ({
  selectedEntityId: null,
  selectEntity: (entityId) => set({ selectedEntityId: entityId }),
  clearSelection: () => set({ selectedEntityId: null }),
}));

export const selectSelectedEntityId = (state: SelectionStore) => state.selectedEntityId;
