import { type GameState, UIMode } from '../../types/game-state.types.ts';
import { getSettings, updateAutoPause } from '../../core/settings.ts';
import { MAX_LOW_HEALTH_PERCENT, MIN_LOW_HEALTH_PERCENT } from '../../constants/autopause.constants.ts';

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
    keybindsContainer.replaceChildren();
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

  renderAutoPauseSettings();
}

/** Metadata for one boolean auto-pause toggle row. */
interface AutoPauseToggleSpec {
  readonly key: 'pauseOnEnemySpotted' | 'pauseOnNemesisSpotted' | 'pauseOnLowHealth' | 'pauseOnDetrimentalStatus' | 'pauseOnNarrative';
  readonly label: string;
}

/** Ordered auto-pause boolean toggles. */
const AUTOPAUSE_TOGGLES: ReadonlyArray<AutoPauseToggleSpec> = [
  { key: 'pauseOnEnemySpotted', label: 'Pause when a hostile is spotted' },
  { key: 'pauseOnNemesisSpotted', label: 'Pause when a nemesis is spotted' },
  { key: 'pauseOnLowHealth', label: 'Pause at low health' },
  { key: 'pauseOnDetrimentalStatus', label: 'Pause on detrimental status' },
  { key: 'pauseOnNarrative', label: 'Pause on narrative events' }
];

/**
 * Renders the RTwP auto-pause preference toggles and threshold input.
 * Options derive from the constants module so no dropdown values are hardcoded.
 */
function renderAutoPauseSettings(): void {
  const container = document.getElementById('autopause-container');
  if (!container) return;

  const { autoPause } = getSettings();
  container.replaceChildren();

  for (const spec of AUTOPAUSE_TOGGLES) {
    const row = document.createElement('label');
    row.className = 'settings-label autopause-row';

    const label = document.createElement('span');
    label.textContent = spec.label;

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = autoPause[spec.key];
    input.dataset.autopauseKey = spec.key;
    input.addEventListener('change', () => {
      updateAutoPause({ [spec.key]: input.checked });
    });

    row.appendChild(label);
    row.appendChild(input);
    container.appendChild(row);
  }

  const thresholdRow = document.createElement('label');
  thresholdRow.className = 'settings-label autopause-row';

  const thresholdLabel = document.createElement('span');
  thresholdLabel.textContent = 'Low health threshold (%)';

  const thresholdInput = document.createElement('input');
  thresholdInput.type = 'number';
  thresholdInput.className = 'autopause-threshold-input';
  thresholdInput.min = String(MIN_LOW_HEALTH_PERCENT);
  thresholdInput.max = String(MAX_LOW_HEALTH_PERCENT);
  thresholdInput.value = String(autoPause.lowHealthThresholdPercent);
  thresholdInput.addEventListener('change', () => {
    updateAutoPause({ lowHealthThresholdPercent: Number(thresholdInput.value) });
    thresholdInput.value = String(getSettings().autoPause.lowHealthThresholdPercent);
  });

  thresholdRow.appendChild(thresholdLabel);
  thresholdRow.appendChild(thresholdInput);
  container.appendChild(thresholdRow);
}
