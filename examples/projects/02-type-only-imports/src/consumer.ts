import type { LayoutDirection, NodeMeta } from "./types";

export type GraphConfig = {
  direction: LayoutDirection;
  selected: NodeMeta | null;
};
