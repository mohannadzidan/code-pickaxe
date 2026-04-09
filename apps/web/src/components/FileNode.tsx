import { Handle, Position, type NodeProps } from "@xyflow/react";

export type FileNodeData = {
  id: string;
  label: string;
  kind: string;
  subKind?: string;
  filePath?: string;
  modulePath?: string;
  isExternal?: boolean;
  isSelected?: boolean;
  onSelectNode: (entityId: string) => void;
};

const KIND_COLOR: Record<string, string> = {
  folder:       "#f59e0b",
  module:       "#6366f1",
  class:        "#0ea5e9",
  function:     "#10b981",
  variable:     "#14b8a6",
  "code-block": "#64748b",
  method:       "#06b6d4",
  property:     "#a78bfa",
};

const KIND_BADGE: Record<string, string> = {
  folder:       "folder",
  module:       "module",
  class:        "class",
  function:     "func",
  variable:     "var",
  "code-block": "{}",
  method:       "method",
  property:     "property",
};

export default function FileNode({ id, data }: NodeProps) {
  const d = data as unknown as FileNodeData;

  const color = KIND_COLOR[d.kind] ?? "#64748b";
  const badge = d.subKind ?? KIND_BADGE[d.kind] ?? d.kind;
  const isSelected = Boolean(d.isSelected);

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        d.onSelectNode(id);
      }}
      style={{
        background: d.isExternal ? `${color}0d` : "#ffffff",
        borderRadius: 8,
        border: `1.5px ${d.isExternal ? "dashed" : "solid"} ${isSelected ? color : d.isExternal ? color + "55" : "#e2e8f0"}`,
        fontFamily: "Inter, system-ui, sans-serif",
        width: "100%",
        boxShadow: isSelected
          ? `0 0 0 2px ${color}44, 0 2px 10px rgba(0,0,0,0.07)`
          : d.isExternal ? "none" : "0 2px 10px rgba(0,0,0,0.07)",
        opacity: d.isExternal ? 0.85 : 1,
        overflow: "hidden",
        cursor: "pointer",
        transition: "border-color 0.12s, box-shadow 0.12s",
      }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0, pointerEvents: "none" }} />
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          padding: "7px 10px 6px",
          background: isSelected ? `${color}10` : "#f8fafc",
          transition: "background 0.12s",
        }}
      >
        <span
          style={{ background: color }}
          className="text-[8px] font-mono shrink-0 px-1.5 py-0.5 rounded-sm font-bold tracking-wide text-white"
        >
          {badge}
        </span>
        <span
          style={{
            fontSize: 11,
            color: "#334155",
            fontWeight: 600,
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={d.filePath ?? d.label}
        >
          {d.filePath ?? d.label}
        </span>
      </div>

      {d.modulePath && d.kind !== "module" && (
        <div
          style={{
            padding: "0 10px 6px",
            fontSize: 10,
            color: "#64748b",
            lineHeight: 1.2,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          title={d.modulePath}
        >
          {d.modulePath}
        </div>
      )}

      <Handle type="source" position={Position.Bottom} style={{ opacity: 0, pointerEvents: "none" }} />
    </div>
  );
}
