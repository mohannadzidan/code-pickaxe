import type { CodeDefinition, EntityId, SerializedCodeGraph } from "@api/parsing/types";

export type LayoutDirection = "TB" | "LR";

export type DomainNode = {
  id: EntityId;
  label: string;
  kind:
    | "module"
    | "class"
    | "function"
    | "variable"
    | "code-block"
    | "method"
    | "property"
    | "folder";
  subKind?: string;
  code?: CodeDefinition;
  isExternal?: boolean;
  children: EntityId[];
  parentLabel?: string;
  showParentLabel: boolean;
  hidden: boolean;
  parentId?: EntityId;
  outEdgeIds: EntityId[];
  inEdgeIds: EntityId[];
  position: {
    x: number;
    y: number;
  };
};

export type DomainEdge = {
  id: string;
  source: EntityId;
  target: EntityId;
  label?: string;
  code?: CodeDefinition;
};

export type GraphState = {
  nodes: Record<string, DomainNode>;
  edges: Record<string, DomainEdge>;
};

export type VisualGraph = {
  nodes: DomainNode[];
  edges: DomainEdge[];
  topLinks: Array<{ source: EntityId; target: EntityId }>;
};

export type NodePositions = Record<string, { x: number; y: number }>;

export type GraphData = SerializedCodeGraph;
