import { services } from "@/app/bootstrap";
import { useCodePaneStore } from "@/features/codePane/store/codePaneStore";
import { useGraphStore } from "@/features/graph/store/graphStore";
import { useSelectionStore } from "@/features/selection/store/selectionStore";

export function selectEntity(entityId: string | null) {
  const selection = useSelectionStore.getState();
  const codePane = useCodePaneStore.getState();
  const graph = useGraphStore.getState().graph;

  selection.selectEntity(entityId);
  codePane.clearNavigation();

  if (!entityId || !graph) {
    codePane.clearContent();
    return;
  }

  const resolved = services.sourceResolverService.resolveEntitySource(entityId, graph);
  if (!resolved) {
    codePane.clearContent();
    return;
  }

  codePane.openSourceFile({ path: resolved.moduleId, code: resolved.code });

  const entity = graph.entities[entityId];
  if (entity?.definition && entity.kind !== "module") {
    codePane.navigateToSource(entity.definition);
  }
}
