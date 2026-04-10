import { DomainNode } from "@/shared/types/domain";
import { Handle, Position, type NodeProps } from "@xyflow/react";

export type FileNodeData = DomainNode & {
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
      className={`w-full rounded-lg overflow-hidden cursor-pointer font-sans transition-colors duration-100 ease-in-out`}
      style={{
        background: d.isExternal ? `${color}0d` : "#ffffff",
        borderWidth: "1.5px",
        borderStyle: d.isExternal ? "dashed" : "solid",
        borderColor: isSelected ? color : d.isExternal ? color + "55" : "#e2e8f0",
        boxShadow: isSelected
          ? `0 0 0 2px ${color}44, 0 2px 10px rgba(0,0,0,0.07)`
          : d.isExternal ? "none" : "0 2px 10px rgba(0,0,0,0.07)",
        opacity: d.isExternal ? 0.85 : 1,
      }}
    >
      <Handle type="target" position={Position.Top} className="opacity-0 pointer-events-none" />
      {/* Header */}
      <div
        className="flex items-center gap-[7px] pt-[7px] pr-[10px] pb-[6px] pl-[10px]"
        style={{ background: isSelected ? `${color}10` : "#f8fafc" }}
      >
        <span
          style={{ background: color }}
          className="text-[8px] font-mono shrink-0 px-1.5 py-0.5 rounded-sm font-bold tracking-wide text-white"
        >
          {badge}
        </span>
        <span
          className="text-[11px] text-[#334155] font-semibold flex-1 overflow-hidden truncate"
          title={d.code?.file ?? d.label}
        >
          {d.label}
        </span>
      </div>


      <Handle type="source" position={Position.Bottom} className="opacity-0 pointer-events-none" />
    </div>
  );
}
