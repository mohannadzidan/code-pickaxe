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
      className="w-full h-full rounded-[10px] relative box-border font-sans"
      style={{
        border: `2px solid ${color}55`,
        background: `${color}08`,
      }}
    >
      {/* Resize handle — always visible in corner */}
      <NodeResizer
        minWidth={220}
        minHeight={100}
        lineStyle={{ border: `1.5px solid ${color}66`, cursor: "nwse-resize" }}
        handleStyle={{ display: "none" }}
      />

      <Handle type="target" position={Position.Top} className="opacity-0 pointer-events-none" />

      {/* Label chip — top-right corner */}
      <div
        className="absolute top-[8px] right-[10px] flex items-center gap-[5px] rounded-[6px] px-[8px] py-[3px] select-none pointer-events-none"
        style={{ background: `${color}22`, border: `1px solid ${color}44` }}
      >
        <span className="text-[12px]">{icon}</span>
        <span className="text-[11px] font-extrabold" style={{ color, letterSpacing: 0.3 }}>
          {d.label}
        </span>
      </div>

      <Handle type="source" position={Position.Bottom} className="opacity-0 pointer-events-none" />
    </div>
  );
}
