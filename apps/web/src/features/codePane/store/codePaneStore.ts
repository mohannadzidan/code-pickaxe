import type { CodeDefinition } from "@api/parsing/types";
import { create } from "zustand";

type CodePaneState = {
  activeFilePath: string | null;
  sourceCode: string | null;
  navigateTarget: CodeDefinition | null;
};

type CodePaneActions = {
  openSourceFile: (payload: { path: string; code: string }) => void;
  navigateToSource: (target: CodeDefinition) => void;
  clearNavigation: () => void;
  clearContent: () => void;
};

type CodePaneStore = CodePaneState & CodePaneActions;

export const useCodePaneStore = create<CodePaneStore>((set) => ({
  activeFilePath: null,
  sourceCode: null,
  navigateTarget: null,
  openSourceFile: ({ path, code }) => set({ activeFilePath: path, sourceCode: code }),
  navigateToSource: (target) => set({ navigateTarget: target }),
  clearNavigation: () => set({ navigateTarget: null }),
  clearContent: () => set({ activeFilePath: null, sourceCode: null, navigateTarget: null }),
}));

export const selectActiveFilePath = (state: CodePaneStore) => state.activeFilePath;
export const selectSourceCode = (state: CodePaneStore) => state.sourceCode;
export const selectNavigateTarget = (state: CodePaneStore) => state.navigateTarget;
