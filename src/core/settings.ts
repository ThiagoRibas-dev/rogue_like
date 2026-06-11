export type ActionType =
  | 'move_north'
  | 'move_south'
  | 'move_west'
  | 'move_east'
  | 'wait'
  | 'interact'
  | 'pick_up'
  | 'inventory'
  | 'target_toggle'
  | 'target_confirm'
  | 'inspect'
  | 'debug_reveal_map'
  | 'debug_god_mode'
  | 'debug_spawn_entity'
  | 'factions';

export interface VisualFeedbackSettings {
  showDamageNumbers: boolean;
  showStatusText: boolean;
  showDangerTelegraphs: boolean;
}

export interface AccessibilitySettings {
  uiScale: 'small' | 'normal' | 'large';
  highContrast: boolean;
  disableAnimations: boolean;
}

export interface PlayerSettings {
  keybinds: Record<ActionType, string[]>;
  visualFeedback: VisualFeedbackSettings;
  accessibility: AccessibilitySettings;
}

const DEFAULT_SETTINGS: PlayerSettings = {
  keybinds: {
    move_north: ['arrowup', 'w', 'k', '8'],
    move_south: ['arrowdown', 's', 'j', '2'],
    move_west: ['arrowleft', 'a', 'h', '4'],
    move_east: ['arrowright', 'd', 'l', '6'],
    wait: [' '],
    interact: ['<', '>', ',', '.'],
    pick_up: ['g'],
    inventory: ['i'],
    target_toggle: ['f'],
    target_confirm: ['enter'],
    inspect: ['x'],
    debug_reveal_map: ['r'],
    debug_god_mode: ['o'],
    debug_spawn_entity: ['e'],
    factions: ['c']
  },
  visualFeedback: {
    showDamageNumbers: true,
    showStatusText: true,
    showDangerTelegraphs: true
  },
  accessibility: {
    uiScale: 'large',
    highContrast: false,
    disableAnimations: false
  }
};

let currentSettings: PlayerSettings = { ...DEFAULT_SETTINGS };

const SETTINGS_STORAGE_KEY = 'roguelike_settings';

/**
 * Initializes settings by loading from localStorage, falling back to defaults,
 * and fetching the base campaign keybinds JSON.
 */
export async function initSettings(campaignId: string = 'default'): Promise<void> {
  // 1. Fetch defaults from campaign JSON if needed
  try {
    const response = await fetch(`/data/campaigns/${campaignId}/keybinds.json`);
    if (response.ok) {
      const defaultBinds = await response.json();
      DEFAULT_SETTINGS.keybinds = { ...DEFAULT_SETTINGS.keybinds, ...defaultBinds };
    }
  } catch (err) {
    console.warn('Failed to load default keybinds.json, using fallback definitions.', err);
  }

  // 2. Load overrides from localStorage
  const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      currentSettings = {
        keybinds: { ...DEFAULT_SETTINGS.keybinds, ...(parsed.keybinds || {}) },
        visualFeedback: { ...DEFAULT_SETTINGS.visualFeedback, ...(parsed.visualFeedback || {}) },
        accessibility: { ...DEFAULT_SETTINGS.accessibility, ...(parsed.accessibility || {}) }
      };
    } catch (e) {
      console.error('Failed to parse stored settings.', e);
      currentSettings = { ...DEFAULT_SETTINGS };
    }
  } else {
    currentSettings = { ...DEFAULT_SETTINGS };
  }
}

/**
 * Gets the current active PlayerSettings.
 */
export function getSettings(): PlayerSettings {
  return currentSettings;
}

/**
 * Updates settings and persists them to localStorage.
 */
export function updateSettings(newSettings: Partial<PlayerSettings>): void {
  currentSettings = {
    keybinds: { ...currentSettings.keybinds, ...(newSettings.keybinds || {}) },
    visualFeedback: { ...currentSettings.visualFeedback, ...(newSettings.visualFeedback || {}) },
    accessibility: { ...currentSettings.accessibility, ...(newSettings.accessibility || {}) }
  };
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(currentSettings));
}

/**
 * Helper to check if a KeyboardEvent matches a specific action.
 */
export function isAction(event: KeyboardEvent, action: ActionType): boolean {
  const binds = currentSettings.keybinds[action];
  if (!binds) return false;
  return binds.includes(event.key.toLowerCase());
}

/**
 * Rebinds an action to a new key, clearing collisions.
 */
export function rebindAction(action: ActionType, newKey: string): void {
  const normalizedKey = newKey.toLowerCase();

  // Remove the key from any other action to prevent collisions
  const updatedKeybinds = { ...currentSettings.keybinds };
  for (const act of Object.keys(updatedKeybinds) as ActionType[]) {
    updatedKeybinds[act] = updatedKeybinds[act].filter((k) => k !== normalizedKey);
  }

  // We overwrite the existing array entirely to only allow 1 custom key per action right now,
  // or we can just prepend it so the custom key is primary, and keep the others as fallbacks.
  // We'll replace it completely for simplicity in the UI so the user clearly sees what they set.
  updatedKeybinds[action] = [normalizedKey];

  updateSettings({ keybinds: updatedKeybinds });
}

/**
 * Resets settings back to default.
 */
export function resetSettings(): void {
  currentSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(currentSettings));
}
