import type { SerializedCodeGraph } from "@api/parsing/types";
import { useCodePaneStore } from "@/features/codePane/store/codePaneStore";
import { useGraphStore } from "@/features/graph/store/graphStore";
import { useSelectionStore } from "@/features/selection/store/selectionStore";

export function loadGraph(graph: SerializedCodeGraph) {
  useGraphStore.getState().loadGraph(graph);
  useSelectionStore.getState().clearSelection();
  useCodePaneStore.getState().clearContent();
}
