import { createContext, useContext } from "react";
import type { CodeDefinition } from "@api/parsing/types";

export interface GraphCallbacks {
  onSelectNode: (entityId: string | null) => void;
  onNavigateTo: (loc: CodeDefinition) => void;
}

export const GraphCallbacksContext = createContext<GraphCallbacks>({
  onSelectNode: () => {},
  onNavigateTo: () => {},
});

export function useGraphCallbacks() {
  return useContext(GraphCallbacksContext);
}
