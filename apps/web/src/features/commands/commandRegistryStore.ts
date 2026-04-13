import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Command, CommandContext, CommandId, Keybinding } from './types';
import { keybindingsMatch } from './types';

type CommandRegistryState = {
  commands: Map<CommandId, Command>;
  keybindings: Record<string, Keybinding>;
};

type CommandRegistryActions = {
  register(command: Command): CommandRegistryActions & CommandRegistryState;
  setKeybinding(commandId: CommandId, keybinding: Keybinding): CommandRegistryActions & CommandRegistryState;
  query(ctx: CommandContext, keybinding?: Keybinding): Command[];
  getAll(): Command[];
};

export type CommandRegistryStore = CommandRegistryState & CommandRegistryActions;

export const useCommandRegistryStore = create<CommandRegistryStore>()(
  persist(
    (set, get) => ({
      commands: new Map(),
      keybindings: {},

      register: (command) => {
        set((state) => {
          const commands = new Map(state.commands);
          commands.set(command.id, command);
          return { commands };
        });
        return get();
      },

      setKeybinding: (commandId, keybinding) => {
        set((state) => ({
          keybindings: { ...state.keybindings, [commandId]: keybinding },
        }));
        return get();
      },

      query: (ctx, keybinding) => {
        const { commands, keybindings: customBindings } = get();

        let filtered = Array.from(commands.values());

        // Filter by keybinding if provided
        if (keybinding) {
          filtered = filtered.filter((cmd) => {
            const binding = customBindings[cmd.id] ?? cmd.keybinding;
            return binding && keybindingsMatch(binding, keybinding);
          });
        }

        // Filter by predicate
        return filtered.filter((cmd) => cmd.predicate(ctx));
      },

      getAll: () => Array.from(get().commands.values()),
    }),
    {
      name: 'code-pickaxe:command-keybindings',
      partialize: (state) => ({ keybindings: state.keybindings }),
    }
  )
);
