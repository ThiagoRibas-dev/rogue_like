import type { ConsoleThemeMode, ConsoleThemePreference } from '../../../types/ui_adapter.types.ts';
import { assertNever } from '../../../utils/assert.ts';

export type { ConsoleThemeMode, ConsoleThemePreference };

/**
 * Metadata tokens describing the active Console theme palette and typography.
 */
export interface ConsoleThemeTokens {
  readonly mode: ConsoleThemeMode;
  readonly bgCanvas: string;
  readonly bgCard: string;
  readonly borderStructural: string;
  readonly borderHighlight: string;
  readonly textPrimary: string;
  readonly textSecondary: string;
  readonly textMuted: string;
  readonly accentPrimary: string;
  readonly accentSuccess: string;
  readonly fontHeader: string;
  readonly fontBody: string;
  readonly fontData: string;
}

const PARCHMENT_TOKENS: ConsoleThemeTokens = {
  mode: 'parchment',
  bgCanvas: '#1a1410',
  bgCard: '#e8dfd1',
  borderStructural: '#5c4730',
  borderHighlight: '#9a6c1e',
  textPrimary: '#261d14',
  textSecondary: '#4a3b2c',
  textMuted: '#665341',
  accentPrimary: '#8c241c',
  accentSuccess: '#145a28',
  fontHeader: "'Cinzel', Georgia, serif",
  fontBody: "'Plus Jakarta Sans', Georgia, serif",
  fontData: "'JetBrains Mono', monospace"
};

const RETRO_CRT_TOKENS: ConsoleThemeTokens = {
  mode: 'retro-crt',
  bgCanvas: '#0a0f12',
  bgCard: '#0a171f',
  borderStructural: '#26b899',
  borderHighlight: '#00f0ff',
  textPrimary: '#93e8ff',
  textSecondary: '#68cbe6',
  textMuted: '#4b94ad',
  accentPrimary: '#00d4e6',
  accentSuccess: '#2ecc71',
  fontHeader: "'JetBrains Mono', monospace",
  fontBody: "'JetBrains Mono', monospace",
  fontData: "'JetBrains Mono', monospace"
};

const OBSIDIAN_BRASS_TOKENS: ConsoleThemeTokens = {
  mode: 'obsidian-brass',
  bgCanvas: '#050507',
  bgCard: '#141720',
  borderStructural: '#484f5e',
  borderHighlight: '#9e782f',
  textPrimary: '#e4e6ed',
  textSecondary: '#b9beca',
  textMuted: '#848b9c',
  accentPrimary: '#e6b84c',
  accentSuccess: '#45b35a',
  fontHeader: "'Cinzel', Georgia, serif",
  fontBody: "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif",
  fontData: "'JetBrains Mono', monospace"
};

let currentThemeMode: ConsoleThemeMode = 'obsidian-brass';
const themeChangeListeners: Array<(mode: ConsoleThemeMode, tokens: ConsoleThemeTokens) => void> = [];

/**
 * Resolves the effective console theme from a user preference and cartridge default.
 *
 * @param preference User theme preference ('auto' delegates to cartridgeDefault).
 * @param cartridgeDefault Default theme declared by the active cartridge.
 * @returns Effective `ConsoleThemeMode`.
 */
export function resolveEffectiveConsoleTheme(
  preference: ConsoleThemePreference = 'auto',
  cartridgeDefault: ConsoleThemeMode = 'obsidian-brass'
): ConsoleThemeMode {
  return preference === 'auto' ? cartridgeDefault : preference;
}

/**
 * Gets the active console theme mode.
 *
 * @returns Active `ConsoleThemeMode`.
 */
export function getConsoleThemeMode(): ConsoleThemeMode {
  return currentThemeMode;
}

/**
 * Gets the token metadata summary for a theme mode (defaults to the active theme).
 *
 * @param mode Optional explicit theme mode.
 * @returns `ConsoleThemeTokens` object.
 */
export function getConsoleThemeTokens(mode: ConsoleThemeMode = currentThemeMode): ConsoleThemeTokens {
  switch (mode) {
    case 'parchment':
      return PARCHMENT_TOKENS;
    case 'retro-crt':
      return RETRO_CRT_TOKENS;
    case 'obsidian-brass':
      return OBSIDIAN_BRASS_TOKENS;
    default:
      return assertNever(mode);
  }
}

/**
 * Sets the active console theme mode on `document.documentElement` and notifies listeners.
 *
 * @param mode Target theme mode.
 */
export function setConsoleThemeMode(mode: ConsoleThemeMode): void {
  currentThemeMode = mode;
  const tokens = getConsoleThemeTokens(mode);

  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    root.setAttribute('data-ui-theme', mode);
    root.setAttribute('data-console-theme', mode);
  }

  for (const listener of themeChangeListeners) {
    listener(mode, tokens);
  }
}

/**
 * Synchronizes the global console theme based on user settings and cartridge defaults.
 *
 * @param cartridgeDefaultMode The active cartridge's default theme mode.
 * @param userPreference User preference override ('auto', 'parchment', 'retro-crt', 'obsidian-brass').
 * @returns Applied `ConsoleThemeMode`.
 */
export function syncGlobalConsoleTheme(
  cartridgeDefaultMode: ConsoleThemeMode = 'obsidian-brass',
  userPreference: ConsoleThemePreference = 'auto'
): ConsoleThemeMode {
  const targetMode = resolveEffectiveConsoleTheme(userPreference, cartridgeDefaultMode);
  setConsoleThemeMode(targetMode);
  return targetMode;
}

/**
 * Applies the console theme data attributes to a specific container element.
 *
 * @param container Target HTML container element.
 * @param mode Target theme mode.
 */
export function applyConsoleTheme(container: HTMLElement, mode: ConsoleThemeMode): void {
  container.setAttribute('data-ui-theme', mode);
  container.setAttribute('data-console-theme', mode);
}

/**
 * Registers a listener callback for theme change events.
 *
 * @param listener Function called on theme updates.
 * @returns Unsubscribe function.
 */
export function subscribeConsoleThemeChange(
  listener: (mode: ConsoleThemeMode, tokens: ConsoleThemeTokens) => void
): () => void {
  themeChangeListeners.push(listener);
  return () => {
    const idx = themeChangeListeners.indexOf(listener);
    if (idx >= 0) themeChangeListeners.splice(idx, 1);
  };
}
