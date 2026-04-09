import type { CodeDefinition, EntityId, SerializedCodeGraph } from "@api/parsing/types";

export type LayoutDirection = "TB" | "LR";

export type DomainNode = {
  id: EntityId;
  label: string;
  kind: string;
  subKind?: string;
  filePath: string;
  modulePath?: string;
  isExternal?: boolean;
  canExplode?: boolean;
  parentContainerId?: string;
  parentContainerLabel?: string;
};

export type DomainEdge = {
  id: string;
  source: EntityId;
  target: EntityId;
  label?: string;
  isOriginEdge?: boolean;
  firstUsageLoc?: CodeDefinition;
};

export type VisualGraph = {
  nodes: DomainNode[];
  edges: DomainEdge[];
  topLinks: Array<{ source: EntityId; target: EntityId }>;
};

export type NodePositions = Record<string, { x: number; y: number }>;

export type GraphData = SerializedCodeGraph;
