import type React from "react";

export type ContextMenuAction = {
  id: string;
  label: string;
  icon?: React.ReactNode;
  onSelect: () => void;
  disabled?: boolean;
};

type Props = {
  top: number | false;
  left: number | false;
  right: number | false;
  bottom: number | false;
  actions: ContextMenuAction[];
  minWidth?: number;
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
  top,
  left,
  right,
  bottom,
  actions,
  minWidth = 155,
  onClose,
}: Props) {
  const visibleActions = actions.filter((action) => !action.disabled);

  if (visibleActions.length === 0) return null;

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
        minWidth,
        boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
      }}
    >
      {visibleActions.map((action) => (
        <button
          key={action.id}
          style={item}
          onMouseDown={() => {
            action.onSelect();
            onClose();
          }}
        >
          {action.icon ?? <span style={{ width: 13 }} />} {action.label}
        </button>
      ))}
    </div>
  );
}
