import { NodeResizer, Handle, Position, type NodeProps } from "@xyflow/react";

export type GroupNodeData = {
  label: string;
  kind: string;
};

const KIND_COLOR: Record<string, string> = {
  module: "#6366f1",
  class:  "#0ea5e9",
};

const KIND_ICON: Record<string, string> = {
  module: "📁",
  class:  "◈",
};

export default function GroupNode({ data }: NodeProps) {
  const d = data as unknown as GroupNodeData;
  const color = KIND_COLOR[d.kind] ?? "#64748b";
  const icon = KIND_ICON[d.kind] ?? "⬜";

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        borderRadius: 10,
        border: `2px solid ${color}55`,
        background: `${color}08`,
        position: "relative",
        boxSizing: "border-box",
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      {/* Resize handle — always visible in corner */}
      <NodeResizer
        minWidth={220}
        minHeight={100}
        lineStyle={{ border: `1.5px solid ${color}66`, cursor: "nwse-resize" }}
        handleStyle={{ display: "none" }}
      />

      <Handle type="target" position={Position.Top} style={{ opacity: 0, pointerEvents: "none" }} />

      {/* Label chip — top-right corner */}
      <div
        style={{
          position: "absolute",
          top: 8,
          right: 10,
          display: "flex",
          alignItems: "center",
          gap: 5,
          background: `${color}22`,
          border: `1px solid ${color}44`,
          borderRadius: 6,
          padding: "3px 8px",
          userSelect: "none",
          pointerEvents: "none",
        }}
      >
        <span style={{ fontSize: 12 }}>{icon}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color, letterSpacing: 0.3 }}>
          {d.label}
        </span>
      </div>

      <Handle type="source" position={Position.Bottom} style={{ opacity: 0, pointerEvents: "none" }} />
    </div>
  );
}
