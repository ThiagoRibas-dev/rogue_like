import { type GameState, UIMode } from '../../types/game-state.types.ts';
import { getSettings } from '../../core/settings.ts';

/**
 * Applies the current settings to the DOM (e.g. data attributes for CSS).
 */
export function applySettingsToDOM(): void {
  const settings = getSettings();
  const acc = settings.accessibility;

  if (acc.uiScale) {
    document.body.setAttribute('data-ui-scale', acc.uiScale);
  } else {
    document.body.removeAttribute('data-ui-scale');
  }

  if (acc.highContrast) {
    document.body.setAttribute('data-high-contrast', 'true');
  } else {
    document.body.removeAttribute('data-high-contrast');
  }

  if (acc.disableAnimations) {
    document.body.setAttribute('data-no-animations', 'true');
  } else {
    document.body.removeAttribute('data-no-animations');
  }
}

/**
 * Populates the Settings modal with the current config.
 */
export function renderSettingsMenu(state?: GameState): void {
  const overlay = document.getElementById('settings-overlay');
  if (state && overlay) {
    if (state.uiMode === UIMode.Settings) {
      overlay.classList.remove('hidden');
      const downloadReplayBtn = document.getElementById('btn-download-replay-settings');
      if (downloadReplayBtn) {
        if (state.entities.length > 0) {
          downloadReplayBtn.style.display = 'block';
        } else {
          downloadReplayBtn.style.display = 'none';
        }
      }
    } else {
      overlay.classList.add('hidden');
      return; // Skip rendering if hidden
    }
  }

  const settings = getSettings();

  // Render Keybinds
  const keybindsContainer = document.getElementById('keybinds-container');
  if (keybindsContainer) {
    keybindsContainer.innerHTML = '';
    const actions = Object.keys(settings.keybinds) as Array<keyof typeof settings.keybinds>;
    for (const action of actions) {
      const row = document.createElement('div');
      row.className = 'keybind-row';
      row.style.display = 'flex';
      row.style.justifyContent = 'space-between';
      row.style.marginBottom = '8px';

      const label = document.createElement('span');
      label.textContent = action.replace(/_/g, ' ').toUpperCase();

      const btn = document.createElement('button');
      btn.className = 'keybind-btn';
      btn.style.padding = '4px 8px';
      btn.style.minWidth = '80px';
      // Just show the primary key
      btn.textContent = settings.keybinds[action][0] || 'UNBOUND';
      btn.dataset.action = action; // For main.ts to hook into

      row.appendChild(label);
      row.appendChild(btn);
      keybindsContainer.appendChild(row);
    }
  }

  const dmgNumbers = document.getElementById('setting-dmg-numbers') as HTMLInputElement;
  const statusText = document.getElementById('setting-status-text') as HTMLInputElement;
  const dangerTel = document.getElementById('setting-danger-telegraphs') as HTMLInputElement;

  if (dmgNumbers) dmgNumbers.checked = settings.visualFeedback.showDamageNumbers;
  if (statusText) statusText.checked = settings.visualFeedback.showStatusText;
  if (dangerTel) dangerTel.checked = settings.visualFeedback.showDangerTelegraphs;

  const uiScale = document.getElementById('setting-ui-scale') as HTMLSelectElement;
  const highContrast = document.getElementById('setting-high-contrast') as HTMLInputElement;
  const disableAnim = document.getElementById('setting-disable-animations') as HTMLInputElement;

  if (uiScale) uiScale.value = settings.accessibility.uiScale;
  if (highContrast) highContrast.checked = settings.accessibility.highContrast;
  if (disableAnim) disableAnim.checked = settings.accessibility.disableAnimations;
}
