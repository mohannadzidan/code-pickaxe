import { useCommandRegistryStore } from './commandRegistryStore';
import { hideCommand } from './cmds/hide';
import { unpackCommand } from './cmds/unpack';
import { packCommand } from './cmds/pack';
import { isolateCommand } from './cmds/isolate';
import { foldAllCommand } from './cmds/foldAll';
import { unfoldAllCommand } from './cmds/unfoldAll';
import { toggleSettingsCommand } from './cmds/toggleSettings';

export function registerAllCommands() {
  const registry = useCommandRegistryStore.getState();

  registry
    .register(hideCommand)
    // .register(showAllCommand)
    // .register(showAllHiddenCommand)
    .register(unpackCommand)
    .register(packCommand)
    // .register(unpackAllToModulesCommand)
    // .register(packAllToModulesCommand)
    // .register(unpackAllToEntitiesCommand)
    // .register(packAllCommand)
    .register(isolateCommand)
    // .register(showMoreRelationshipsCommand)
    // .register(showDependenciesOnlyCommand)
    // .register(showDependentsOnlyCommand)
    .register(foldAllCommand)
    .register(unfoldAllCommand)
    .register(toggleSettingsCommand);
}
