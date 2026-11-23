import { getGameState } from '../../../core/game-loop.ts';
import { getSettings } from '../../../core/settings.ts';
import { UIMode } from '../../../types/game-state.types.ts';
import { getActiveCartridgeUI } from '../cartridge_ui_registry.ts';
import { type ConsoleThemeMode, resolveEffectiveConsoleTheme, setConsoleThemeMode } from './console_theme.ts';

/**
 * Applies active user accessibility and theme settings to `document.documentElement` and `document.body`
 * (`data-ui-scale`, `data-high-contrast`, `data-reduced-motion`, `data-no-animations`, and `[data-ui-theme]`).
 */
export function applySettingsToDOM(): void {
  const settings = getSettings();
  const acc = settings.accessibility;
  const root = document.documentElement;

  if (acc.uiScale) {
    root.setAttribute('data-ui-scale', acc.uiScale);
    document.body.setAttribute('data-ui-scale', acc.uiScale);
  } else {
    root.removeAttribute('data-ui-scale');
    document.body.removeAttribute('data-ui-scale');
  }

  if (acc.highContrast) {
    root.setAttribute('data-high-contrast', 'true');
    document.body.setAttribute('data-high-contrast', 'true');
  } else {
    root.removeAttribute('data-high-contrast');
    document.body.removeAttribute('data-high-contrast');
  }

  if (acc.disableAnimations) {
    root.setAttribute('data-reduced-motion', 'true');
    document.body.setAttribute('data-no-animations', 'true');
  } else {
    root.removeAttribute('data-reduced-motion');
    document.body.removeAttribute('data-no-animations');
  }

  let cartridgeDefault: ConsoleThemeMode = 'obsidian-brass';
  try {
    const curState = getGameState();
    const isPreSystemShell =
      curState.uiMode === UIMode.MainMenu ||
      curState.uiMode === UIMode.RulesetSelect ||
      curState.uiMode === UIMode.CampaignSelect ||
      curState.uiMode === UIMode.Editor ||
      (curState.uiMode === UIMode.Settings && curState.entities.length === 0);
    if (!isPreSystemShell) {
      const activeCartridge = getActiveCartridgeUI(curState);
      if (activeCartridge?.defaultThemeMode) {
        cartridgeDefault = activeCartridge.defaultThemeMode;
      }
    }
  } catch {
    // Fallback to obsidian-brass before initial GameState is created
  }

  const effectiveTheme = resolveEffectiveConsoleTheme(acc.consoleThemePreference ?? 'auto', cartridgeDefault);
  setConsoleThemeMode(effectiveTheme);
}
