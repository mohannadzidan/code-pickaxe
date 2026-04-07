import type { CodeDefinition } from "@api/parsing/types";
import { services } from "@/app/bootstrap";
import { useCodePaneStore } from "@/features/codePane/store/codePaneStore";
import { useGraphStore } from "@/features/graph/store/graphStore";

export function navigateToEdgeSource(location: CodeDefinition) {
  const graph = useGraphStore.getState().graph;
  if (!graph) return;

  const resolved = services.sourceResolverService.resolveLocationSource(location, graph);
  const codePane = useCodePaneStore.getState();

  if (resolved) {
    codePane.openSourceFile({ path: resolved.moduleId, code: resolved.code });
  }

  codePane.navigateToSource(location);
}
