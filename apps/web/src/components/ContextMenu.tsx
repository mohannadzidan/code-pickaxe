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

const itemClass = `flex items-center gap-2 w-full px-3.5 py-1.5 bg-transparent border-0 text-[#e2e8f0] text-[12px] text-left cursor-pointer rounded-[5px] font-sans`;

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
      className="absolute bg-[#1e293b] border border-[#334155] rounded-md p-1 z-[1000] shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
      style={{
        top:    top    !== false ? top    : undefined,
        left:   left   !== false ? left   : undefined,
        right:  right  !== false ? right  : undefined,
        bottom: bottom !== false ? bottom : undefined,
        minWidth,
      }}
    >
      {visibleActions.map((action) => (
        <button
          key={action.id}
          className={itemClass}
          onMouseDown={() => {
            action.onSelect();
            onClose();
          }}
        >
          {action.icon ?? <span className="w-[13px] inline-block" />} {action.label}
        </button>
      ))}
    </div>
  );
}
