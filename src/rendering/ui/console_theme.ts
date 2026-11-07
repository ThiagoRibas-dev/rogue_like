/**
 * Global Theme Mode for the Core Console Engine and Ruleset Cartridges.
 */
export type ConsoleThemeMode = 'parchment' | 'retro-crt';

/**
 * Interface representing CSS theme tokens applied to root UI containers.
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
  borderStructural: '#4a3a2a',
  borderHighlight: '#c8963e',
  textPrimary: '#2c221a',
  textSecondary: '#5a4838',
  textMuted: '#8a7662',
  accentPrimary: '#8c241c',
  accentSuccess: '#2a5c36',
  fontHeader: '"Cinzel", "Playfair Display", Georgia, serif',
  fontBody: '"Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, sans-serif',
  fontData: '"IBM Plex Mono", monospace'
};

const RETRO_CRT_TOKENS: ConsoleThemeTokens = {
  mode: 'retro-crt',
  bgCanvas: '#0a0f12',
  bgCard: '#0d181c',
  borderStructural: '#1a3a42',
  borderHighlight: '#00f0ff',
  textPrimary: '#00f0ff',
  textSecondary: '#a0e0e6',
  textMuted: '#4a7078',
  accentPrimary: '#00f0ff',
  accentSuccess: '#00ff66',
  fontHeader: '"Space Mono", "Courier New", monospace',
  fontBody: '"IBM Plex Mono", monospace',
  fontData: '"IBM Plex Mono", monospace'
};

let currentThemeMode: ConsoleThemeMode = 'parchment';
const themeChangeListeners: Array<(mode: ConsoleThemeMode, tokens: ConsoleThemeTokens) => void> = [];

/**
 * Gets the active console theme mode.
 *
 * @returns Active `ConsoleThemeMode`.
 */
export function getConsoleThemeMode(): ConsoleThemeMode {
  return currentThemeMode;
}

/**
 * Gets the current active `ConsoleThemeTokens`.
 *
 * @returns `ConsoleThemeTokens` object.
 */
export function getConsoleThemeTokens(): ConsoleThemeTokens {
  return currentThemeMode === 'parchment' ? PARCHMENT_TOKENS : RETRO_CRT_TOKENS;
}

/**
 * Sets the active console theme mode and notifies all registered listeners.
 *
 * @param mode Target theme mode.
 */
export function setConsoleThemeMode(mode: ConsoleThemeMode): void {
  currentThemeMode = mode;
  const tokens = getConsoleThemeTokens();

  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    root.setAttribute('data-console-theme', mode);
    root.style.setProperty('--console-bg-canvas', tokens.bgCanvas);
    root.style.setProperty('--console-bg-card', tokens.bgCard);
    root.style.setProperty('--console-border-structural', tokens.borderStructural);
    root.style.setProperty('--console-border-highlight', tokens.borderHighlight);
    root.style.setProperty('--console-text-primary', tokens.textPrimary);
    root.style.setProperty('--console-text-secondary', tokens.textSecondary);
    root.style.setProperty('--console-text-muted', tokens.textMuted);
    root.style.setProperty('--console-accent-primary', tokens.accentPrimary);
    root.style.setProperty('--console-accent-success', tokens.accentSuccess);
    root.style.setProperty('--console-font-header', tokens.fontHeader);
    root.style.setProperty('--console-font-body', tokens.fontBody);
    root.style.setProperty('--console-font-data', tokens.fontData);
  }

  for (const listener of themeChangeListeners) {
    listener(mode, tokens);
  }
}

/**
 * Synchronizes the global console theme based on user settings and cartridge defaults.
 *
 * @param cartridgeDefaultMode The active cartridge's default theme mode.
 * @param userPreference Optional user preference override ('auto', 'parchment', 'retro-crt').
 * @returns Applied ConsoleThemeMode.
 */
export function syncGlobalConsoleTheme(
  cartridgeDefaultMode: ConsoleThemeMode = 'parchment',
  userPreference: 'auto' | ConsoleThemeMode = 'auto'
): ConsoleThemeMode {
  const targetMode = userPreference === 'auto' ? cartridgeDefaultMode : userPreference;
  setConsoleThemeMode(targetMode);
  return targetMode;
}

/**
 * Applies the console theme data attribute to a specific container element.
 *
 * @param container Target HTML container element.
 * @param mode Target theme mode.
 */
export function applyConsoleTheme(container: HTMLElement, mode: ConsoleThemeMode): void {
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
