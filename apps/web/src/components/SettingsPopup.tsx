import { useEffect, useMemo, useState } from "react";
import {
  defaultShortcutConfig,
  selectKeyboardShortcuts,
  selectSetShortcuts,
  shortcutLabels,
  shortcutOrder,
  type ShortcutAction,
  type ShortcutBinding,
  type ShortcutConfig,
  useKeyboardShortcutStore,
} from "@/shared/store/keyboardShortcutStore";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type SettingsPopupProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type SettingsSection = "general" | "shortcuts";

const shortcutDescriptions: Record<ShortcutAction, string> = {
  showAllHiddenExceptExternal: "Global shortcut; reveals hidden non-external graph nodes.",
  hideNode: "When graph view is focused and a node is selected.",
  showMoreRelationships: "When graph view is focused and a node is selected.",
  isolateNode: "When graph view is focused and a node is selected.",
  revealInExplorer: "When graph view is focused and a node is selected.",
  showDependenciesOnly: "When graph view is focused and a node is selected.",
  showDependentsOnly: "When graph view is focused and a node is selected.",
  unpackNode: "When graph view is focused and selected node is packed/unpackable.",
  packNode: "When graph view is focused and selected node is unpacked/packable.",
};

const bindingToDisplay = (binding: ShortcutBinding): string => {
  const keyText = binding.key ? binding.key.toUpperCase() : "";
  return binding.shift ? `Shift + ${keyText}` : keyText;
};

export default function SettingsPopup({ open, onOpenChange }: SettingsPopupProps) {
  const shortcuts = useKeyboardShortcutStore(selectKeyboardShortcuts);
  const setShortcuts = useKeyboardShortcutStore(selectSetShortcuts);
  const [activeSection, setActiveSection] = useState<SettingsSection>("shortcuts");
  const [draft, setDraft] = useState<ShortcutConfig>(shortcuts);

  useEffect(() => {
    if (!open) return;
    setDraft(shortcuts);
  }, [open, shortcuts]);

  const hasChanges = useMemo(() => JSON.stringify(draft) !== JSON.stringify(shortcuts), [draft, shortcuts]);

  const updateBinding = (action: ShortcutAction, next: ShortcutBinding) => {
    setDraft((prev) => ({
      ...prev,
      [action]: {
        key: next.key.trim().toLowerCase(),
        shift: next.shift,
      },
    }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Configure graph behavior and keyboard shortcuts.</DialogDescription>
        </DialogHeader>

        <div className="grid h-140 grid-cols-[220px_1fr] border-y border-slate-100">
          <aside className="border-r border-slate-100 bg-slate-50/70 p-3">
            <nav className="space-y-1">
              <button
                type="button"
                onClick={() => setActiveSection("general")}
                className={`w-full rounded-md px-3 py-2 text-left text-sm ${
                  activeSection === "general" ? "bg-slate-200/70 font-medium text-slate-900" : "text-slate-600 hover:bg-slate-200/40"
                }`}
              >
                General
              </button>
              <button
                type="button"
                onClick={() => setActiveSection("shortcuts")}
                className={`w-full rounded-md px-3 py-2 text-left text-sm ${
                  activeSection === "shortcuts" ? "bg-slate-200/70 font-medium text-slate-900" : "text-slate-600 hover:bg-slate-200/40"
                }`}
              >
                Shortcuts
              </button>
            </nav>
          </aside>

          <section className="overflow-auto p-4">
            {activeSection === "general" ? (
              <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                Additional settings will be added here.
              </div>
            ) : (
              <div className="space-y-3">
                {shortcutOrder.map((action) => {
                  const binding = draft[action];
                  return (
                    <div key={action} className="rounded-lg border border-slate-200 p-3">
                      <div className="mb-2 text-sm font-medium text-slate-900">{shortcutLabels[action]}</div>
                      <div className="mb-3 text-xs text-slate-500">{shortcutDescriptions[action]}</div>
                      <div className="flex items-center gap-3">
                        <input
                          className="w-44 rounded-md border border-slate-200 px-3 py-2 text-sm outline-none ring-offset-2 transition focus:border-slate-300 focus:ring-2 focus:ring-slate-300"
                          value={bindingToDisplay(binding)}
                          placeholder="Press a key"
                          onKeyDown={(event) => {
                            event.preventDefault();
                            if (event.key === "Backspace" || event.key === "Delete") {
                              updateBinding(action, { key: "", shift: false });
                              return;
                            }
                            if (event.key.length !== 1) return;
                            updateBinding(action, {
                              key: event.key,
                              shift: event.shiftKey,
                            });
                          }}
                          onChange={() => {
                          }}
                        />
                        <span className="text-xs text-slate-500">Press key combo to update</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <DialogFooter>
          {activeSection === "shortcuts" && (
            <button
              type="button"
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
              onClick={() => setDraft(defaultShortcutConfig)}
            >
              Defaults
            </button>
          )}
          <button
            type="button"
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
            onClick={() => {
              setDraft(shortcuts);
              onOpenChange(false);
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded-md border border-slate-900 bg-slate-900 px-3 py-1.5 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!hasChanges}
            onClick={() => {
              setShortcuts(draft);
              onOpenChange(false);
            }}
          >
            Save changes
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
