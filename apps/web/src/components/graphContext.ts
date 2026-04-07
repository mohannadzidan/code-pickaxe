import { createContext, useContext } from "react";

export interface GraphCallbacks {
  onToggleCode: (nodeId: string) => void;
}

export const GraphCallbacksContext = createContext<GraphCallbacks>({
  onToggleCode: () => {},
});

export function useGraphCallbacks() {
  return useContext(GraphCallbacksContext);
}
