import type { KeyChord, KeybindPresetId } from '../../types/input.types.ts';
import { getKeybindPresetPatch } from './command_catalog.ts';
import { areChordsEqual, commandRegistry, normalizeChord, parseLegacyKeyString } from './command_registry.ts';

/**
 * Legacy v1 ActionType strings mapped to canonical v2 CommandDefinition IDs.
 */
export const ACTION_TO_COMMAND_ID: Readonly<Record<string, string>> = {
  move_north: 'move.north',
  move_south: 'move.south',
  move_west: 'move.west',
  move_east: 'move.east',
  wait: 'action.wait',
  interact: 'action.interact',
  pick_up: 'action.pick_up',
  inventory: 'panel.inventory',
  target_toggle: 'combat.target_toggle',
  target_confirm: 'combat.target_confirm',
  inspect: 'action.inspect',
  debug_reveal_map: 'debug.reveal_map',
  debug_god_mode: 'debug.god_mode',
  debug_spawn_entity: 'debug.spawn_entity',
  factions: 'panel.factions',
  quests: 'panel.quests',
  investigation: 'panel.investigation',
  verb_menu: 'action.verb_menu',
  dossier: 'panel.dossier',
  ledger: 'panel.ledger',
  automap: 'panel.automap',
  character_sheet: 'panel.inventory',
  spellbook: 'dnd35e:spellbook',
  level_up: 'dnd35e:level_up'
};

/**
 * Stock v1 default key arrays used to detect untouched boilerplate entries during v1 -> v2 migration.
 */
const STOCK_V1_DEFAULT_VARIANTS: Readonly<Record<string, ReadonlyArray<ReadonlyArray<string>>>> = {
  move_north: [['arrowup', 'w', 'k', '8']],
  move_south: [['arrowdown', 's', 'j', '2']],
  move_west: [['arrowleft', 'a', 'h', '4']],
  move_east: [['arrowright', 'd', 'l', '6']],
  interact: [
    ['<', '>', ',', '.'],
    [',', '.']
  ],
  debug_reveal_map: [['r']],
  debug_god_mode: [['o']],
  debug_spawn_entity: [['e']],
  factions: [['y'], ['l']],
  investigation: [['v'], ['k']],
  ledger: [['l']],
  verb_menu: [['m'], ['m', 'enter'], ['enter', 'shift+m']],
  level_up: [['l'], ['u']]
};

/**
 * Untouched stock v2 bindings from pre-Phase 50 releases that would collide with revised
 * Phase 50 defaults (`R` Rest, `E` Interact, `V` Verb Menu, `J` Factions, `Alt+*` Debug).
 */
const PRE_PHASE50_STOCK_V2_VARIANTS: Readonly<Record<string, ReadonlyArray<ReadonlyArray<KeyChord>>>> = {
  'action.interact': [[{ key: ',' }, { key: '.' }]],
  'combat.target_toggle': [[{ key: 'r' }]],
  'action.verb_menu': [[{ code: 'Enter' }, { key: 'm', shift: true }], [{ key: 'm' }]],
  'panel.investigation': [[{ key: 'v' }]],
  'panel.factions': [[{ key: 'y' }], [{ key: 'f' }]],
  'panel.debug': [[{ key: '`' }], [{ code: 'Backquote' }]],
  'debug.reveal_map': [[{ key: 'r' }]],
  'debug.god_mode': [[{ key: 'o' }]],
  'debug.spawn_entity': [[{ key: 'e' }]],
  'dnd35e:rest_8h': [[{ key: 't' }]]
};

function arraysEqualCaseInsensitive(a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if ((a[i] ?? '').toLowerCase() !== (b[i] ?? '').toLowerCase()) return false;
  }
  return true;
}

function chordListsEqual(a: ReadonlyArray<KeyChord>, b: ReadonlyArray<KeyChord>): boolean {
  if (a.length !== b.length) return false;
  return a.every((chord, idx) => {
    const other = b[idx];
    return other !== undefined && areChordsEqual(chord, other);
  });
}

/**
 * Upgrades persisted v2 command bindings created prior to Phase 50 (`keybindRevision < 3`),
 * replacing untouched stock defaults while preserving user-customized bindings.
 */
export function upgradePrePhase50CommandBindings(
  bindings: Readonly<Record<string, ReadonlyArray<KeyChord>>>,
  presetId: KeybindPresetId = 'modern'
): Record<string, KeyChord[]> {
  const defaults = buildDefaultCommandBindings(presetId);
  const upgraded: Record<string, KeyChord[]> = {};
  for (const [cmdId, chords] of Object.entries(bindings)) {
    const stockVariants = PRE_PHASE50_STOCK_V2_VARIANTS[cmdId];
    if (stockVariants !== undefined && stockVariants.some((variant) => chordListsEqual(chords, variant))) {
      const replacement = defaults[cmdId];
      if (replacement !== undefined) {
        upgraded[cmdId] = replacement.map((c) => normalizeChord(c));
        continue;
      }
    }
    upgraded[cmdId] = chords.map((c) => normalizeChord(c));
  }
  return upgraded;
}

/**
 * Builds the default v2 command binding dictionary from `CommandRegistry` + selected preset.
 */
export function buildDefaultCommandBindings(presetId: KeybindPresetId = 'modern'): Record<string, KeyChord[]> {
  const result: Record<string, KeyChord[]> = {};
  for (const cmd of commandRegistry.getAllCommands()) {
    result[cmd.id] = cmd.defaultBindings.map((c) => normalizeChord(c));
  }
  const patch = getKeybindPresetPatch(presetId);
  for (const [cmdId, chords] of Object.entries(patch)) {
    result[cmdId] = chords.map((c) => normalizeChord(c));
  }
  return result;
}

/**
 * Migrates legacy v1 `Record<ActionType, string[]>` keybinds (from `localStorage` or campaign `keybinds.json`)
 * into typed v2 `Record<CommandId, KeyChord[]>`, automatically repairing known v1 collisions (`ledger: ['l']`
 * and untouched stock boilerplate movement lists).
 *
 * @param v1Keybinds Legacy string-array keybind dictionary.
 * @param baseDefaults Optional base v2 command bindings to merge onto.
 * @returns Migrated typed v2 command binding map.
 */
export function migrateV1KeybindsToV2(
  v1Keybinds: Readonly<Record<string, ReadonlyArray<string> | undefined>>,
  baseDefaults: Readonly<Record<string, ReadonlyArray<KeyChord>>> = buildDefaultCommandBindings('modern')
): Record<string, KeyChord[]> {
  const migrated: Record<string, KeyChord[]> = {};
  for (const [cmdId, chords] of Object.entries(baseDefaults)) {
    migrated[cmdId] = chords.map((c) => normalizeChord(c));
  }

  for (const [legacyAction, rawKeys] of Object.entries(v1Keybinds)) {
    if (!Array.isArray(rawKeys)) continue;
    const cmdId = ACTION_TO_COMMAND_ID[legacyAction] ?? legacyAction;

    // Skip untouched stock v1 boilerplate entries that caused collisions (e.g. ledger=['l'], verb_menu=['m'])
    const stockVariants = STOCK_V1_DEFAULT_VARIANTS[legacyAction];
    if (stockVariants !== undefined && stockVariants.some((variant) => arraysEqualCaseInsensitive(rawKeys, variant))) {
      continue;
    }

    migrated[cmdId] = rawKeys.map((raw) => parseLegacyKeyString(raw, legacyAction));
  }

  return migrated;
}

/**
 * Projects a v2 command binding dictionary back into legacy `string[]` entries for backwards-compatible consumers.
 */
export function projectV2BindingsToLegacyStrings(
  v2Bindings: Readonly<Record<string, ReadonlyArray<KeyChord>>>
): Record<string, string[]> {
  const legacy: Record<string, string[]> = {};
  for (const [actionKey, cmdId] of Object.entries(ACTION_TO_COMMAND_ID)) {
    const chords = v2Bindings[cmdId];
    if (!chords) continue;
    legacy[actionKey] = chords.map((chord) => {
      if (chord.code === 'Space') return ' ';
      if (chord.code === 'ArrowUp') return 'arrowup';
      if (chord.code === 'ArrowDown') return 'arrowdown';
      if (chord.code === 'ArrowLeft') return 'arrowleft';
      if (chord.code === 'ArrowRight') return 'arrowright';
      if (chord.code === 'Enter') return 'enter';
      if (chord.code?.startsWith('Numpad')) return chord.code.slice(6);
      const mods: string[] = [];
      if (chord.ctrl) mods.push('Ctrl');
      if (chord.shift) mods.push('Shift');
      if (chord.alt) mods.push('Alt');
      if (chord.meta) mods.push('Meta');
      const base = chord.key ?? chord.code ?? '';
      return mods.length > 0 ? `${mods.join('+')}+${base}` : base.toLowerCase();
    });
  }
  return legacy;
}
