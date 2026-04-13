import { Settings } from 'lucide-react';
import type { Command } from '../types';
import { useUiStore } from '@/shared/store/uiStore';

export const toggleSettingsCommand: Command = {
  id: 'toggleSettings',
  title: 'Settings',
  description: 'Open settings dialog',
  icon: Settings,

  predicate: () => true,

  run: () => {
    const { settingsOpen, setSettingsOpen } = useUiStore.getState();
    setSettingsOpen(!settingsOpen);
  },
};
