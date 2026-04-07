import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useGraphCallbacks } from "./graphContext";

export type FileNodeData = {
  label: string;
  kind: string;
  sourceText?: string;
  filePath?: string;
  isExpanded?: boolean;
  isExternal?: boolean;
};

const KIND_COLOR: Record<string, string> = {
  module:       "#6366f1",
  class:        "#0ea5e9",
  function:     "#10b981",
  "type-alias": "#f59e0b",
  interface:    "#8b5cf6",
  enum:         "#ef4444",
  variable:     "#14b8a6",
  "code-block": "#64748b",
  method:       "#06b6d4",
  property:     "#a78bfa",
};

const KIND_BADGE: Record<string, string> = {
  module:       "module",
  class:        "class",
  function:     "func",
  "type-alias": "type",
  interface:    "interface",
  enum:         "enum",
  variable:     "var",
  "code-block": "{}",
  method:       "method",
  property:     "property",
};

export default function FileNode({ id, data }: NodeProps) {
  const d = data as unknown as FileNodeData;
  const { onToggleCode } = useGraphCallbacks();

  const color = KIND_COLOR[d.kind] ?? "#64748b";
  const badge = KIND_BADGE[d.kind] ?? d.kind;
  const hasCode = Boolean(d.sourceText?.trim());
  const isOpen = Boolean(d.isExpanded);

  return (
    <div
      style={{
        background: "#ffffff",
        borderRadius: 8,
        border: `1.5px solid ${isOpen ? color + "88" : "#e2e8f0"}`,
        fontFamily: "Inter, system-ui, sans-serif",
        width: "100%",
        boxShadow: "0 2px 10px rgba(0,0,0,0.07)",
        overflow: "hidden",
        transition: "border-color 0.15s",
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
          background: isOpen ? "#f1f5f9" : "#f8fafc",
          borderBottom: isOpen ? `1px solid ${color}33` : undefined,
          transition: "background 0.15s",
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
        {hasCode && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onToggleCode(id);
            }}
            style={{
              background: isOpen ? color + "22" : "none",
              border: isOpen ? `1px solid ${color}44` : "1px solid transparent",
              cursor: "pointer",
              color: isOpen ? color : "#94a3b8",
              fontSize: 11,
              lineHeight: 1,
              padding: "2px 5px",
              borderRadius: 4,
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              transition: "all 0.15s",
            }}
            title={isOpen ? "Collapse code" : "Show code"}
          >
            {isOpen ? "▴" : "▾"}
          </button>
        )}
      </div>

      {/* Code block */}
      {hasCode && isOpen && (
        <div
          style={{
            background: "#1e1e2e",
            overflow: "auto",
          }}
        >
          <pre
            style={{
              margin: 0,
              padding: "10px 14px",
              fontSize: 10,
              lineHeight: 1.65,
              color: "#cdd6f4",
              fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
              whiteSpace: "pre",
              minWidth: "max-content",
            }}
          >
            {d.sourceText!.length > 2000
              ? d.sourceText!.slice(0, 2000) + "\n… (truncated)"
              : d.sourceText}
          </pre>
        </div>
      )}

      <Handle type="source" position={Position.Bottom} style={{ opacity: 0, pointerEvents: "none" }} />
    </div>
  );
}
