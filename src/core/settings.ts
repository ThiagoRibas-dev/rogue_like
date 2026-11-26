import {
  DEFAULT_AUTO_PAUSE_SETTINGS,
  MAX_LOW_HEALTH_PERCENT,
  MIN_LOW_HEALTH_PERCENT,
  type AutoPauseSettings
} from '../constants/autopause.constants.ts';
import { DEFAULT_PREFERRED_SPRITE_PACK } from '../utils/sprite_pack.ts';
import type { ConsoleThemePreference } from '../types/ui_adapter.types.ts';
import type { KeyChord, KeybindPresetId } from '../types/input.types.ts';
import { getKeybindPresetPatch } from './input/command_catalog.ts';
import { areChordsEqual, commandRegistry, matchesChord, normalizeChord } from './input/command_registry.ts';
import {
  ACTION_TO_COMMAND_ID,
  buildDefaultCommandBindings,
  migrateV1KeybindsToV2,
  projectV2BindingsToLegacyStrings,
  upgradePrePhase50CommandBindings
} from './input/keybind_migration.ts';

/**
 * Type union representing all configurable keyboard command actions in the game.
 */
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
  | 'factions'
  | 'quests'
  | 'investigation'
  | 'verb_menu'
  | 'dossier'
  | 'ledger'
  | 'automap'
  | 'character_sheet'
  | 'spellbook'
  | 'level_up';

/**
 * Rendering mode preference: campaign default ('auto'), procedural/sheet 2D pixel sprites ('sprites'), or classic ASCII ('ascii').
 */
export type RenderModePreference = 'auto' | 'sprites' | 'ascii';

/**
 * Settings configuration controlling combat and visual telemetry effects.
 */
export interface VisualFeedbackSettings {
  showDamageNumbers: boolean;
  showStatusText: boolean;
  showDangerTelegraphs: boolean;
  reduceDramaticDelays: boolean;
  renderMode: RenderModePreference;
  preferredSpritePack: string;
}

/**
 * Layout and accessibility preferences in UI containers.
 */
export interface AccessibilitySettings {
  uiScale: 'small' | 'normal' | 'large';
  highContrast: boolean;
  disableAnimations: boolean;
  consoleThemePreference?: ConsoleThemePreference | undefined;
}

/**
 * Persisted dimensions for resizable UI layout panels.
 */
export interface PanelLayoutSettings {
  readonly leftSidebarWidthPx?: number | undefined;
  readonly rightSidebarWidthPx?: number | undefined;
  readonly logDrawerHeightPx?: number | undefined;
  readonly modalMasterWidthPercent?: number | undefined;
}

/**
 * Combined player configuration container representing binds and user choices.
 */
export interface PlayerSettings {
  settingsVersion?: number | undefined;
  keybindRevision?: number | undefined;
  debugModeEnabled?: boolean | undefined;
  keybindPreset?: KeybindPresetId | undefined;
  keybinds: Record<ActionType, string[]>;
  commandBindings?: Record<string, KeyChord[]> | undefined;
  visualFeedback: VisualFeedbackSettings;
  accessibility: AccessibilitySettings;
  autoPause: AutoPauseSettings;
  panelLayout?: PanelLayoutSettings;
}

const CURRENT_SETTINGS_VERSION = 2;
const CURRENT_KEYBIND_REVISION = 3;

function createInitialCommandBindings(presetId: KeybindPresetId = 'modern'): Record<string, KeyChord[]> {
  return buildDefaultCommandBindings(presetId);
}

const DEFAULT_V2_BINDINGS = createInitialCommandBindings('modern');

const DEFAULT_SETTINGS: PlayerSettings = {
  settingsVersion: CURRENT_SETTINGS_VERSION,
  keybindRevision: CURRENT_KEYBIND_REVISION,
  debugModeEnabled: false,
  keybindPreset: 'modern',
  keybinds: {
    move_north: ['arrowup', 'w', '8'],
    move_south: ['arrowdown', 's', '2'],
    move_west: ['arrowleft', 'a', '4'],
    move_east: ['arrowright', 'd', '6'],
    wait: [' '],
    interact: ['e', '.', ','],
    pick_up: ['g'],
    inventory: ['i'],
    target_toggle: ['f'],
    target_confirm: ['enter'],
    inspect: ['x'],
    debug_reveal_map: ['Alt+r'],
    debug_god_mode: ['Alt+g'],
    debug_spawn_entity: ['Alt+e'],
    factions: ['j'],
    quests: ['q'],
    investigation: ['k'],
    verb_menu: ['v', 'enter'],
    dossier: ['n'],
    ledger: ['Shift+l'],
    automap: ['m'],
    character_sheet: ['c'],
    spellbook: ['b'],
    level_up: ['u']
  },
  commandBindings: DEFAULT_V2_BINDINGS,
  visualFeedback: {
    showDamageNumbers: true,
    showStatusText: true,
    showDangerTelegraphs: true,
    reduceDramaticDelays: false,
    renderMode: 'auto',
    preferredSpritePack: DEFAULT_PREFERRED_SPRITE_PACK
  },
  accessibility: {
    uiScale: 'large',
    highContrast: false,
    disableAnimations: false,
    consoleThemePreference: 'auto'
  },
  autoPause: DEFAULT_AUTO_PAUSE_SETTINGS
};

let currentSettings: PlayerSettings = {
  ...DEFAULT_SETTINGS,
  commandBindings: createInitialCommandBindings('modern')
};

const SETTINGS_STORAGE_KEY = 'roguelike_settings';
const settingsListeners = new Set<() => void>();

function emitSettingsChange(): void {
  for (const listener of settingsListeners) {
    listener();
  }
}

/**
 * Subscribes to PlayerSettings updates (preferences, theme, and command keybindings).
 *
 * @param listener Callback invoked whenever settings change.
 * @returns Unsubscribe function.
 */
export function subscribeSettingsChange(listener: () => void): () => void {
  settingsListeners.add(listener);
  return (): void => {
    settingsListeners.delete(listener);
  };
}

/**
 * Hydrates and migrates a raw persisted settings payload (v1 or v2) against active defaults.
 */
export function migrateSettingsPayload(
  raw: Record<string, unknown>,
  defaults: PlayerSettings = DEFAULT_SETTINGS
): PlayerSettings {
  const presetId: KeybindPresetId =
    raw['keybindPreset'] === 'classic_vi' ? 'classic_vi' : (defaults.keybindPreset ?? 'modern');
  const baseV2 = defaults.commandBindings ?? createInitialCommandBindings(presetId);

  let commandBindings: Record<string, KeyChord[]>;
  if (
    raw['settingsVersion'] === CURRENT_SETTINGS_VERSION &&
    raw['commandBindings'] &&
    typeof raw['commandBindings'] === 'object'
  ) {
    commandBindings = { ...baseV2 };
    for (const [cmdId, list] of Object.entries(raw['commandBindings'] as Record<string, unknown>)) {
      if (Array.isArray(list)) {
        commandBindings[cmdId] = list
          .filter((item): item is KeyChord => item !== null && typeof item === 'object')
          .map((item) => normalizeChord(item));
      }
    }
    const rawRev = typeof raw['keybindRevision'] === 'number' ? raw['keybindRevision'] : 0;
    if (rawRev < CURRENT_KEYBIND_REVISION) {
      commandBindings = upgradePrePhase50CommandBindings(commandBindings, presetId);
    }
  } else if (raw['keybinds'] && typeof raw['keybinds'] === 'object') {
    commandBindings = migrateV1KeybindsToV2(
      raw['keybinds'] as Record<string, ReadonlyArray<string> | undefined>,
      baseV2
    );
  } else {
    commandBindings = { ...baseV2 };
  }

  const projectedLegacy = projectV2BindingsToLegacyStrings(commandBindings);
  const mergedLegacyKeybinds = {
    ...defaults.keybinds,
    ...projectedLegacy
  } as Record<ActionType, string[]>;

  return {
    settingsVersion: CURRENT_SETTINGS_VERSION,
    keybindRevision: CURRENT_KEYBIND_REVISION,
    debugModeEnabled:
      typeof raw['debugModeEnabled'] === 'boolean' ? raw['debugModeEnabled'] : (defaults.debugModeEnabled ?? false),
    keybindPreset: presetId,
    keybinds: mergedLegacyKeybinds,
    commandBindings,
    visualFeedback: {
      ...defaults.visualFeedback,
      ...((raw['visualFeedback'] as Partial<VisualFeedbackSettings>) || {})
    },
    accessibility: { ...defaults.accessibility, ...((raw['accessibility'] as Partial<AccessibilitySettings>) || {}) },
    autoPause: { ...defaults.autoPause, ...((raw['autoPause'] as Partial<AutoPauseSettings>) || {}) },
    ...(raw['panelLayout'] ? { panelLayout: raw['panelLayout'] as PanelLayoutSettings } : {})
  };
}

/**
 * Initializes settings by loading from localStorage, falling back to defaults,
 * and fetching the base campaign keybinds JSON.
 */
export async function initSettings(campaignId: string = 'default'): Promise<void> {
  let campaignDefaults: Record<string, KeyChord[]> = createInitialCommandBindings('modern');

  try {
    const response = await fetch(`${import.meta.env.BASE_URL}data/campaigns/${campaignId}/keybinds.json`);
    if (response.ok) {
      const defaultBinds = (await response.json()) as Record<string, unknown>;
      if (defaultBinds['commandBindings'] && typeof defaultBinds['commandBindings'] === 'object') {
        campaignDefaults = {
          ...campaignDefaults,
          ...(defaultBinds['commandBindings'] as Record<string, KeyChord[]>)
        };
      } else {
        campaignDefaults = migrateV1KeybindsToV2(
          defaultBinds as Record<string, ReadonlyArray<string> | undefined>,
          campaignDefaults
        );
      }
      DEFAULT_SETTINGS.commandBindings = campaignDefaults;
      DEFAULT_SETTINGS.keybinds = {
        ...DEFAULT_SETTINGS.keybinds,
        ...projectV2BindingsToLegacyStrings(campaignDefaults)
      } as Record<ActionType, string[]>;
    }
  } catch (err) {
    console.warn('Failed to load default keybinds.json, using fallback definitions.', err);
  }

  const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(SETTINGS_STORAGE_KEY) : null;
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as Record<string, unknown>;
      currentSettings = migrateSettingsPayload(parsed, DEFAULT_SETTINGS);
    } catch (e) {
      console.error('Failed to parse stored settings.', e);
      currentSettings = migrateSettingsPayload({}, DEFAULT_SETTINGS);
    }
  } else {
    currentSettings = migrateSettingsPayload({}, DEFAULT_SETTINGS);
  }
}

/**
 * Gets the current active PlayerSettings.
 */
export function getSettings(): PlayerSettings {
  return currentSettings;
}

/**
 * Returns whether Developer Debug Mode is currently enabled.
 */
export function getDebugModeEnabled(): boolean {
  return currentSettings.debugModeEnabled === true;
}

/**
 * Enables or disables Developer Debug Mode and persists the setting.
 */
export function setDebugModeEnabled(enabled: boolean): void {
  updateSettings({ debugModeEnabled: enabled });
}

/**
 * Returns the active v2 KeyChord dictionary merged with registered command defaults.
 */
export function getCommandBindings(): Readonly<Record<string, ReadonlyArray<KeyChord>>> {
  const base = createInitialCommandBindings(currentSettings.keybindPreset ?? 'modern');
  return {
    ...base,
    ...(currentSettings.commandBindings ?? {})
  };
}

/**
 * Returns the active KeyChord slots for a specific command ID.
 */
export function getBindingsForCommand(commandId: string): ReadonlyArray<KeyChord> {
  const bindings = currentSettings.commandBindings;
  if (bindings && commandId in bindings) {
    return bindings[commandId] ?? [];
  }
  return commandRegistry.getEffectiveBindings(commandId);
}

/**
 * Updates settings and persists them to localStorage.
 */
export function updateSettings(newSettings: Partial<PlayerSettings>): void {
  const nextCommandBindings =
    newSettings.commandBindings !== undefined
      ? { ...(currentSettings.commandBindings ?? {}), ...newSettings.commandBindings }
      : currentSettings.commandBindings;

  const projected = nextCommandBindings ? projectV2BindingsToLegacyStrings(nextCommandBindings) : {};
  currentSettings = {
    settingsVersion: CURRENT_SETTINGS_VERSION,
    keybindRevision: CURRENT_KEYBIND_REVISION,
    debugModeEnabled:
      newSettings.debugModeEnabled !== undefined
        ? newSettings.debugModeEnabled
        : (currentSettings.debugModeEnabled ?? false),
    keybindPreset: newSettings.keybindPreset ?? currentSettings.keybindPreset ?? 'modern',
    keybinds: { ...currentSettings.keybinds, ...projected, ...(newSettings.keybinds || {}) },
    ...(nextCommandBindings !== undefined ? { commandBindings: nextCommandBindings } : {}),
    visualFeedback: { ...currentSettings.visualFeedback, ...(newSettings.visualFeedback || {}) },
    accessibility: { ...currentSettings.accessibility, ...(newSettings.accessibility || {}) },
    autoPause: { ...currentSettings.autoPause, ...(newSettings.autoPause || {}) },
    ...(newSettings.panelLayout !== undefined
      ? { panelLayout: newSettings.panelLayout }
      : currentSettings.panelLayout !== undefined
        ? { panelLayout: currentSettings.panelLayout }
        : {})
  };
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(currentSettings));
  }
  emitSettingsChange();
}

/**
 * Updates one or more auto-pause preferences and persists them.
 * Clamps the low-health threshold to the supported range.
 *
 * @param partial The auto-pause fields to change.
 */
export function updateAutoPause(partial: Partial<AutoPauseSettings>): void {
  const merged: AutoPauseSettings = { ...currentSettings.autoPause, ...partial };
  const clampedPercent = Math.min(
    MAX_LOW_HEALTH_PERCENT,
    Math.max(MIN_LOW_HEALTH_PERCENT, Math.round(merged.lowHealthThresholdPercent))
  );

  updateSettings({ autoPause: { ...merged, lowHealthThresholdPercent: clampedPercent } });
}

/**
 * Updates persisted panel layout dimensions.
 *
 * @param partial New panel layout values.
 */
export function updatePanelLayout(partial: Partial<PanelLayoutSettings>): void {
  const current = currentSettings.panelLayout ?? {};
  updateSettings({ panelLayout: { ...current, ...partial } });
}

/**
 * Rebinds a single KeyChord slot (`slotIndex`) on `commandId`, optionally stripping identical
 * chords from commands sharing at least one `InputScopeId`.
 */
export function rebindCommandSlot(
  commandId: string,
  slotIndex: number,
  chord: KeyChord,
  resolveConflicts = false
): void {
  const normalized = normalizeChord(chord);
  const currentMap: Record<string, KeyChord[]> = { ...getCommandBindings() } as Record<string, KeyChord[]>;
  const targetCmd = commandRegistry.getCommand(commandId);

  if (resolveConflicts && targetCmd) {
    for (const other of commandRegistry.getAllCommands()) {
      if (other.id === commandId) continue;
      if (!other.scopes.some((s) => targetCmd.scopes.includes(s))) continue;
      const otherList = currentMap[other.id] ?? [];
      currentMap[other.id] = otherList.filter((c) => !areChordsEqual(c, normalized));
    }
  }

  const existing = [...(currentMap[commandId] ?? [])];
  if (slotIndex >= 0 && slotIndex < existing.length) {
    existing[slotIndex] = normalized;
  } else {
    existing.push(normalized);
  }
  currentMap[commandId] = existing;

  updateSettings({ commandBindings: currentMap });
}

/**
 * Removes a single KeyChord slot (`slotIndex`) from `commandId`.
 */
export function clearCommandSlot(commandId: string, slotIndex: number): void {
  const currentMap: Record<string, KeyChord[]> = { ...getCommandBindings() } as Record<string, KeyChord[]>;
  const existing = [...(currentMap[commandId] ?? [])];
  if (slotIndex >= 0 && slotIndex < existing.length) {
    existing.splice(slotIndex, 1);
  }
  currentMap[commandId] = existing;
  updateSettings({ commandBindings: currentMap });
}

/**
 * Applies a built-in keyboard preset (`modern` or `classic_vi`) across movement and conflicting panel shortcuts.
 */
export function applyKeybindPreset(presetId: KeybindPresetId): void {
  const currentMap: Record<string, KeyChord[]> = { ...getCommandBindings() } as Record<string, KeyChord[]>;
  const patch = getKeybindPresetPatch(presetId);
  for (const [cmdId, chords] of Object.entries(patch)) {
    currentMap[cmdId] = chords.map((c) => normalizeChord(c));
  }
  updateSettings({ keybindPreset: presetId, commandBindings: currentMap });
}

/**
 * Resets only command keybindings back to the selected (or default) preset without altering visual/a11y choices.
 */
export function resetCommandBindings(presetId: KeybindPresetId = 'modern'): void {
  const defaults = createInitialCommandBindings(presetId);
  updateSettings({ keybindPreset: presetId, commandBindings: defaults });
}

/**
 * Helper to check if a KeyboardEvent matches a legacy `ActionType` via the v2 CommandRegistry bindings.
 */
export function isAction(event: KeyboardEvent, action: ActionType): boolean {
  const cmdId = ACTION_TO_COMMAND_ID[action] ?? action;
  const chords = getBindingsForCommand(cmdId);
  if (chords.length > 0) {
    return chords.some((chord) => matchesChord(event, chord));
  }

  const binds = currentSettings.keybinds[action];
  if (!binds) return false;
  const keyLower = event.key.toLowerCase();
  return binds.includes(keyLower);
}

/**
 * Rebinds an action to a new key, clearing collisions in shared scopes.
 */
export function rebindAction(action: ActionType, newKey: string): void {
  const cmdId = ACTION_TO_COMMAND_ID[action] ?? action;
  const chord = normalizeChord({ key: newKey.toLowerCase() });
  const currentMap: Record<string, KeyChord[]> = { ...getCommandBindings() } as Record<string, KeyChord[]>;
  const targetCmd = commandRegistry.getCommand(cmdId);

  if (targetCmd) {
    for (const other of commandRegistry.getAllCommands()) {
      if (other.id === cmdId) continue;
      if (!other.scopes.some((s) => targetCmd.scopes.includes(s))) continue;
      currentMap[other.id] = (currentMap[other.id] ?? []).filter((c) => !areChordsEqual(c, chord));
    }
  }

  currentMap[cmdId] = [chord];
  updateSettings({ commandBindings: currentMap });
}

/**
 * Resets settings back to default.
 */
export function resetSettings(): void {
  currentSettings = migrateSettingsPayload({}, DEFAULT_SETTINGS);
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(currentSettings));
  }
  emitSettingsChange();
}
