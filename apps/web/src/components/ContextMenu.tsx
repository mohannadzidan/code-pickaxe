import type React from "react";

type Props = {
  nodeId: string;
  top: number | false;
  left: number | false;
  right: number | false;
  bottom: number | false;
  canExplode: boolean;
  isExploded: boolean;
  onExplode: (id: string) => void;
  onCollapse: (id: string) => void;
  onClose: () => void;
};

const item: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  width: "100%",
  padding: "7px 14px",
  background: "none",
  border: "none",
  color: "#e2e8f0",
  fontSize: 12,
  textAlign: "left",
  cursor: "pointer",
  borderRadius: 5,
  fontFamily: "Inter, system-ui, sans-serif",
};

export default function ContextMenu({
  nodeId,
  top, left, right, bottom,
  canExplode, isExploded,
  onExplode, onCollapse, onClose,
}: Props) {
  return (
    <div
      style={{
        position: "absolute",
        top:    top    !== false ? top    : undefined,
        left:   left   !== false ? left   : undefined,
        right:  right  !== false ? right  : undefined,
        bottom: bottom !== false ? bottom : undefined,
        background: "#1e293b",
        border: "1px solid #334155",
        borderRadius: 8,
        padding: "4px",
        zIndex: 1000,
        minWidth: 155,
        boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
      }}
    >
      {canExplode && !isExploded && (
        <button
          style={item}
          onMouseDown={() => { onExplode(nodeId); onClose(); }}
        >
          <span>🔍</span> Explode
        </button>
      )}
      {isExploded && (
        <button
          style={item}
          onMouseDown={() => { onCollapse(nodeId); onClose(); }}
        >
          <span>⊟</span> Collapse
        </button>
      )}
      {!canExplode && !isExploded && (
        <div style={{ ...item, color: "#64748b", cursor: "default" }}>
          No actions
        </div>
      )}
    </div>
  );
}
