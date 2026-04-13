import { useMemo, useState } from "react";
import { useCommandRegistryStore } from "@/features/commands/commandRegistryStore";
import type { Command, Keybinding } from "@/features/commands/types";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type SettingsPopupProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type SettingsSection = "general" | "shortcuts";

const bindingToDisplay = (binding: Keybinding | undefined): string => {
  if (!binding || !binding.key) return "";
  const parts: string[] = [];
  if (binding.modifiers?.shift) parts.push("Shift");
  if (binding.modifiers?.ctrl) parts.push("Ctrl");
  if (binding.modifiers?.meta) parts.push("Meta");
  parts.push(binding.key.toUpperCase());
  return parts.join(" + ");
};

export default function SettingsPopup({ open, onOpenChange }: SettingsPopupProps) {
  const commandsMap = useCommandRegistryStore((s) => s.commands);
  const allCommands = useMemo<Command[]>(() => Array.from(commandsMap.values()), [commandsMap]);
  const customKeybindings = useCommandRegistryStore((s) => s.keybindings);
  const [activeSection, setActiveSection] = useState<SettingsSection>("shortcuts");

  const { setKeybinding } = useCommandRegistryStore.getState();

  const updateBinding = (commandId: string, next: Keybinding) => {
    setKeybinding(commandId as Parameters<typeof setKeybinding>[0], next);
  };

  const resetDefaults = () => {
    useCommandRegistryStore.setState({ keybindings: {} });
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
                {allCommands.map((cmd) => {
                  const effectiveBinding = customKeybindings[cmd.id] ?? cmd.keybinding;
                  return (
                    <div key={cmd.id} className="rounded-lg border border-slate-200 p-3">
                      <div className="mb-2 text-sm font-medium text-slate-900">{cmd.title}</div>
                      {cmd.description && (
                        <div className="mb-3 text-xs text-slate-500">{cmd.description}</div>
                      )}
                      <div className="flex items-center gap-3">
                        <input
                          className="w-44 rounded-md border border-slate-200 px-3 py-2 text-sm outline-none ring-offset-2 transition focus:border-slate-300 focus:ring-2 focus:ring-slate-300"
                          value={bindingToDisplay(effectiveBinding)}
                          placeholder="Press a key"
                          onKeyDown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            if (event.key === "Escape") {
                              event.currentTarget.blur();
                              return;
                            }
                            if (event.key === "Backspace" || event.key === "Delete") {
                              updateBinding(cmd.id, { key: "", modifiers: {} });
                              return;
                            }
                            if (event.key.length !== 1) return;
                            updateBinding(cmd.id, {
                              key: event.key.toLowerCase(),
                              modifiers: {
                                shift: event.shiftKey,
                                ctrl: event.ctrlKey,
                                meta: event.metaKey,
                              },
                            });
                          }}
                          onChange={() => {}}
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
              onClick={resetDefaults}
            >
              Reset defaults
            </button>
          )}
          <button
            type="button"
            className="rounded-md border border-slate-900 bg-slate-900 px-3 py-1.5 text-sm text-white"
            onClick={() => onOpenChange(false)}
          >
            Done
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
