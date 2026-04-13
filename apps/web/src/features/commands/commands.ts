import { useCommandRegistryStore } from './commandRegistryStore';
import { hideCommand } from './cmds/hide';
import { showAllCommand } from './cmds/showAll';
import { showAllHiddenCommand } from './cmds/showAllHidden';
import { unpackCommand } from './cmds/unpack';
import { packCommand } from './cmds/pack';
import { unpackAllToModulesCommand } from './cmds/unpackAllToModules';
import { packAllToModulesCommand } from './cmds/packAllToModules';
import { unpackAllToEntitiesCommand } from './cmds/unpackAllToEntities';
import { packAllCommand } from './cmds/packAll';
import { isolateCommand } from './cmds/isolate';
import { showMoreRelationshipsCommand } from './cmds/showMoreRelationships';
import { showDependenciesOnlyCommand } from './cmds/showDependenciesOnly';
import { showDependentsOnlyCommand } from './cmds/showDependentsOnly';
import { foldAllCommand } from './cmds/foldAll';
import { unfoldAllCommand } from './cmds/unfoldAll';
import { toggleSettingsCommand } from './cmds/toggleSettings';

export function registerAllCommands() {
  const registry = useCommandRegistryStore.getState();

  registry
    .register(hideCommand)
    .register(showAllCommand)
    .register(showAllHiddenCommand)
    .register(unpackCommand)
    .register(packCommand)
    .register(unpackAllToModulesCommand)
    .register(packAllToModulesCommand)
    .register(unpackAllToEntitiesCommand)
    .register(packAllCommand)
    .register(isolateCommand)
    .register(showMoreRelationshipsCommand)
    .register(showDependenciesOnlyCommand)
    .register(showDependentsOnlyCommand)
    .register(foldAllCommand)
    .register(unfoldAllCommand)
    .register(toggleSettingsCommand);
}
