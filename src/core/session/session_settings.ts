import { getSettings, updateSettings, resetSettings, type ActionType } from '../settings.ts';
import { applySettingsToDOM, renderSettingsMenu, renderMenus } from '../../rendering/ui.ts';
import { getGameState, setGameState, queuePlayerIntent } from '../game-loop.ts';
import { getPlayerId } from './session_dom.ts';
import { getActiveReplay } from '../replay.ts';
import { getSaveData, setSaveData, hasSaveGame } from '../save.ts';
import { loadCampaignRegistry } from '../loader.ts';
import { createToggleSettingsAction } from '../../actions/core.actions.ts';
import { UIMode } from '../../types/game-state.types.ts';

export let rebindingAction: ActionType | null = null;

export function setRebindingAction(action: ActionType | null): void {
  rebindingAction = action;
}

export function triggerReplayDownload(): void {
  const replay = getActiveReplay();
  if (replay) {
    const blob = new Blob([JSON.stringify(replay, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `roguelike_replay_${replay.campaignId}_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } else {
    alert('No active replay found!');
  }
}

/**
 * Binds Settings panel inputs, key rebinding overlay, save import/export, and replay download.
 */
export function bindSettingsControls(): void {
  const btnOpenSettings = document.getElementById('btn-open-settings');
  const btnCloseSettings = document.getElementById('btn-close-settings');
  const btnMainMenuSettings = document.getElementById('btn-main-menu-settings');

  if (btnOpenSettings && btnCloseSettings) {
    btnOpenSettings.addEventListener('click', () => {
      const pId = getPlayerId();
      if (pId) queuePlayerIntent(createToggleSettingsAction(pId));
    });

    btnCloseSettings.addEventListener('click', () => {
      const pId = getPlayerId();
      if (pId) {
        queuePlayerIntent(createToggleSettingsAction(pId));
      } else {
        setGameState({ ...getGameState(), uiMode: UIMode.MainMenu });
      }
    });
  }

  if (btnMainMenuSettings) {
    btnMainMenuSettings.addEventListener('click', () => {
      setGameState({ ...getGameState(), uiMode: UIMode.Settings });
    });
  }

  const bindSetting = (
    id: string,
    key: string,
    category: 'visualFeedback' | 'accessibility',
    isCheckbox = true
  ): void => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement | HTMLSelectElement;
      const value = isCheckbox ? (target as HTMLInputElement).checked : target.value;
      const current = getSettings();
      if (category === 'visualFeedback') {
        updateSettings({
          visualFeedback: { ...current.visualFeedback, [key]: value } as typeof current.visualFeedback
        });
      } else if (category === 'accessibility') {
        updateSettings({
          accessibility: { ...current.accessibility, [key]: value } as typeof current.accessibility
        });
      }
      applySettingsToDOM();
    });
  };

  bindSetting('setting-dmg-numbers', 'showDamageNumbers', 'visualFeedback');
  bindSetting('setting-status-text', 'showStatusText', 'visualFeedback');
  bindSetting('setting-danger-telegraphs', 'showDangerTelegraphs', 'visualFeedback');
  bindSetting('setting-ui-scale', 'uiScale', 'accessibility', false);
  bindSetting('setting-high-contrast', 'highContrast', 'accessibility');
  bindSetting('setting-disable-animations', 'disableAnimations', 'accessibility');

  const rebindingOverlay = document.getElementById('rebinding-overlay');
  const rebindingActionName = document.getElementById('rebinding-action-name');

  document.getElementById('keybinds-container')?.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest('.keybind-btn') as HTMLButtonElement | null;
    if (!target) return;
    const action = target.dataset.action as ActionType | undefined;
    if (action) {
      rebindingAction = action;
      if (rebindingActionName) {
        rebindingActionName.textContent = action.replace(/_/g, ' ').toUpperCase();
      }
      rebindingOverlay?.classList.remove('hidden');
    }
  });

  document.getElementById('btn-reset-keybinds')?.addEventListener('click', () => {
    resetSettings();
    renderSettingsMenu();
  });

  document.getElementById('btn-export-save')?.addEventListener('click', () => {
    const data = getSaveData();
    if (data) {
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `roguelike_save_${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }
  });

  document.getElementById('btn-download-replay-settings')?.addEventListener('click', triggerReplayDownload);
  document.getElementById('btn-download-replay-gameover')?.addEventListener('click', triggerReplayDownload);

  const fileInput = document.getElementById('file-import-save') as HTMLInputElement | null;
  document.getElementById('btn-import-save')?.addEventListener('click', () => {
    fileInput?.click();
  });

  fileInput?.addEventListener('change', (e: Event) => {
    const target = e.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const content = event.target?.result as string;
        const parsed = JSON.parse(content);

        if (!parsed.campaignId) {
          throw new Error('Save file is missing required campaign information.');
        }

        const registry = await loadCampaignRegistry();
        const exists = registry.campaigns.some((c) => c.id === parsed.campaignId);
        if (!exists) {
          throw new Error(
            `This save requires campaign "${parsed.campaignId}", which is not installed. Please install it first.`
          );
        }

        setSaveData(content);
        renderMenus(getGameState(), hasSaveGame());
        alert('Save game imported successfully!');
        target.value = '';
      } catch (err) {
        alert(`Failed to import save: ${(err as Error).message}`);
        console.error(err);
        target.value = '';
      }
    };
    reader.readAsText(file);
  });
}
