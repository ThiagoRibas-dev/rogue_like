import type { CommandDefinition, KeyChord, KeybindPresetId } from '../../types/input.types.ts';

/**
 * Built-in Console Engine commands shared across all ruleset cartridges.
 */
export const CONSOLE_COMMANDS: ReadonlyArray<CommandDefinition> = [
  {
    id: 'system.toggle_help',
    label: 'Contextual Help',
    description: 'Open or close the contextual help and keybinds reference overlay.',
    category: 'system',
    scopes: [
      'help_overlay',
      'active_modal',
      'hud_focus',
      'targeting_inspect',
      'world_gameplay',
      'editor',
      'system_dialog'
    ],
    defaultBindings: [{ code: 'F1' }],
    allowInTextInput: true,
    preventDefault: true,
    source: 'console'
  },
  {
    id: 'system.escape_or_pause',
    label: 'Back / Pause Menu',
    description: 'Close the active overlay, exit HUD/targeting focus, or open the Pause/Settings menu.',
    category: 'system',
    scopes: [
      'system_dialog',
      'help_overlay',
      'active_modal',
      'hud_focus',
      'targeting_inspect',
      'world_gameplay',
      'editor'
    ],
    defaultBindings: [{ code: 'Escape' }],
    allowInTextInput: true,
    preventDefault: true,
    source: 'console'
  },
  {
    id: 'hud.cycle_focus',
    label: 'HUD Keyboard Focus',
    description: 'Enter or cycle keyboard focus across floating HUD cards and action dock controls.',
    category: 'hud_camera',
    scopes: ['world_gameplay', 'hud_focus'],
    defaultBindings: [{ code: 'F6' }],
    preventDefault: true,
    source: 'console'
  },
  {
    id: 'hud.toggle_fold_all',
    label: 'Fold / Unfold HUD',
    description: 'Collapse or expand all floating HUD side panels.',
    category: 'hud_camera',
    scopes: ['world_gameplay', 'targeting_inspect'],
    defaultBindings: [{ code: 'Backslash' }],
    preventDefault: true,
    source: 'console'
  },
  {
    id: 'move.north',
    label: 'Move North',
    description: 'Step or move cursor North.',
    category: 'movement',
    scopes: ['world_gameplay', 'targeting_inspect'],
    defaultBindings: [{ code: 'ArrowUp' }, { key: 'w' }, { code: 'Numpad8' }],
    preventDefault: true,
    source: 'console'
  },
  {
    id: 'move.south',
    label: 'Move South',
    description: 'Step or move cursor South.',
    category: 'movement',
    scopes: ['world_gameplay', 'targeting_inspect'],
    defaultBindings: [{ code: 'ArrowDown' }, { key: 's' }, { code: 'Numpad2' }],
    preventDefault: true,
    source: 'console'
  },
  {
    id: 'move.west',
    label: 'Move West',
    description: 'Step or move cursor West.',
    category: 'movement',
    scopes: ['world_gameplay', 'targeting_inspect'],
    defaultBindings: [{ code: 'ArrowLeft' }, { key: 'a' }, { code: 'Numpad4' }],
    preventDefault: true,
    source: 'console'
  },
  {
    id: 'move.east',
    label: 'Move East',
    description: 'Step or move cursor East.',
    category: 'movement',
    scopes: ['world_gameplay', 'targeting_inspect'],
    defaultBindings: [{ code: 'ArrowRight' }, { key: 'd' }, { code: 'Numpad6' }],
    preventDefault: true,
    source: 'console'
  },
  {
    id: 'move.nw',
    label: 'Move Northwest',
    description: 'Step or move cursor diagonally Northwest.',
    category: 'movement',
    scopes: ['world_gameplay', 'targeting_inspect'],
    defaultBindings: [{ code: 'Numpad7' }],
    preventDefault: true,
    source: 'console'
  },
  {
    id: 'move.ne',
    label: 'Move Northeast',
    description: 'Step or move cursor diagonally Northeast.',
    category: 'movement',
    scopes: ['world_gameplay', 'targeting_inspect'],
    defaultBindings: [{ code: 'Numpad9' }],
    preventDefault: true,
    source: 'console'
  },
  {
    id: 'move.sw',
    label: 'Move Southwest',
    description: 'Step or move cursor diagonally Southwest.',
    category: 'movement',
    scopes: ['world_gameplay', 'targeting_inspect'],
    defaultBindings: [{ code: 'Numpad1' }],
    preventDefault: true,
    source: 'console'
  },
  {
    id: 'move.se',
    label: 'Move Southeast',
    description: 'Step or move cursor diagonally Southeast.',
    category: 'movement',
    scopes: ['world_gameplay', 'targeting_inspect'],
    defaultBindings: [{ code: 'Numpad3' }],
    preventDefault: true,
    source: 'console'
  },
  {
    id: 'move.up_z',
    label: 'Ascend / Aim Up Z',
    description: 'Climb stairs, ladder, ramp, fly up, or raise aiming/inspect Z-level.',
    category: 'movement',
    scopes: ['world_gameplay', 'targeting_inspect'],
    defaultBindings: [{ key: '<' }],
    preventDefault: true,
    source: 'console'
  },
  {
    id: 'move.down_z',
    label: 'Descend / Aim Down Z',
    description: 'Descend stairs, ladder, ramp, fly down, or lower aiming/inspect Z-level.',
    category: 'movement',
    scopes: ['world_gameplay', 'targeting_inspect'],
    defaultBindings: [{ key: '>' }],
    preventDefault: true,
    source: 'console'
  },
  {
    id: 'camera.peek_z_up',
    label: 'Peek Camera Up Z',
    description: 'Shift the rendered camera focal Z-level up by 1 stratum without moving.',
    category: 'panels',
    scopes: ['world_gameplay', 'targeting_inspect'],
    defaultBindings: [{ code: 'PageUp' }, { key: '[' }],
    preventDefault: true,
    source: 'console'
  },
  {
    id: 'camera.peek_z_down',
    label: 'Peek Camera Down Z',
    description: 'Shift the rendered camera focal Z-level down by 1 stratum without moving.',
    category: 'panels',
    scopes: ['world_gameplay', 'targeting_inspect'],
    defaultBindings: [{ code: 'PageDown' }, { key: ']' }],
    preventDefault: true,
    source: 'console'
  },
  {
    id: 'camera.peek_z_reset',
    label: 'Reset Camera Z Peek',
    description: 'Snap the rendered camera focal Z-level back to the player elevation.',
    category: 'panels',
    scopes: ['world_gameplay', 'targeting_inspect'],
    defaultBindings: [{ code: 'Home' }],
    preventDefault: true,
    source: 'console'
  },
  {
    id: 'action.wait',
    label: 'Wait / Toggle Pause',
    description: 'Wait one turn in Turn-Based mode, or toggle tactical pause in Real-Time with Pause.',
    category: 'combat_actions',
    scopes: ['world_gameplay'],
    defaultBindings: [{ code: 'Space' }],
    preventDefault: true,
    source: 'console'
  },
  {
    id: 'action.interact',
    label: 'Smart Interact / Portals',
    description: 'Interact with tile/entity or traverse portals/area transitions.',
    category: 'combat_actions',
    scopes: ['world_gameplay', 'targeting_inspect'],
    defaultBindings: [{ key: ',' }, { key: '.' }],
    preventDefault: true,
    source: 'console'
  },
  {
    id: 'action.pick_up',
    label: 'Pick Up Item',
    description: 'Pick up items on the current tile.',
    category: 'combat_actions',
    scopes: ['world_gameplay'],
    defaultBindings: [{ key: 'g' }],
    preventDefault: true,
    source: 'console'
  },
  {
    id: 'action.inspect',
    label: 'Look / Inspect Tile',
    description: 'Toggle the free-roaming look/inspect reticle.',
    category: 'combat_actions',
    scopes: ['world_gameplay', 'targeting_inspect'],
    defaultBindings: [{ key: 'x' }],
    preventDefault: true,
    source: 'console'
  },
  {
    id: 'action.verb_menu',
    label: 'Context Verb Menu',
    description: 'Open the full contextual interaction menu for the tile or cursor.',
    category: 'combat_actions',
    scopes: ['world_gameplay', 'targeting_inspect'],
    defaultBindings: [{ key: 'm' }, { code: 'Enter' }],
    preventDefault: true,
    source: 'console'
  },
  {
    id: 'combat.target_toggle',
    label: 'Toggle Aim / Target',
    description: 'Enter or exit ranged targeting mode.',
    category: 'combat_actions',
    scopes: ['world_gameplay', 'targeting_inspect'],
    defaultBindings: [{ key: 'f' }],
    preventDefault: true,
    source: 'console'
  },
  {
    id: 'combat.target_confirm',
    label: 'Fire / Confirm Target',
    description: 'Confirm attack or throw at the targeted tile.',
    category: 'combat_actions',
    scopes: ['targeting_inspect'],
    defaultBindings: [{ code: 'Enter' }],
    preventDefault: true,
    source: 'console'
  },
  {
    id: 'combat.target_next',
    label: 'Next Visible Target',
    description: 'Cycle targeting reticle to the next visible hostile actor.',
    category: 'combat_actions',
    scopes: ['targeting_inspect'],
    defaultBindings: [{ code: 'Tab' }],
    preventDefault: true,
    source: 'console'
  },
  {
    id: 'combat.target_prev',
    label: 'Previous Visible Target',
    description: 'Cycle targeting reticle to the previous visible hostile actor.',
    category: 'combat_actions',
    scopes: ['targeting_inspect'],
    defaultBindings: [{ code: 'Tab', shift: true }],
    preventDefault: true,
    source: 'console'
  },
  {
    id: 'hotbar.bank_prev',
    label: 'Previous Hotbar Bank',
    description: 'Cycle to the previous action hotbar bank (1–10).',
    category: 'hotbar',
    scopes: ['world_gameplay'],
    defaultBindings: [{ code: 'ArrowUp', shift: true }],
    preventDefault: true,
    source: 'console'
  },
  {
    id: 'hotbar.bank_next',
    label: 'Next Hotbar Bank',
    description: 'Cycle to the next action hotbar bank (1–10).',
    category: 'hotbar',
    scopes: ['world_gameplay'],
    defaultBindings: [{ code: 'ArrowDown', shift: true }],
    preventDefault: true,
    source: 'console'
  },
  {
    id: 'panel.inventory',
    label: 'Inventory & Pack',
    description: 'Open or close the equipment & stash view.',
    category: 'panels',
    scopes: ['world_gameplay', 'active_modal'],
    defaultBindings: [{ key: 'i' }],
    preventDefault: true,
    source: 'console'
  },
  {
    id: 'panel.quests',
    label: 'Quest Journal',
    description: 'Open or close the quest journal.',
    category: 'panels',
    scopes: ['world_gameplay', 'active_modal'],
    defaultBindings: [{ key: 'q' }],
    preventDefault: true,
    source: 'console'
  },
  {
    id: 'panel.investigation',
    label: 'Investigation Board',
    description: 'Open or close the clues & secrets board.',
    category: 'panels',
    scopes: ['world_gameplay', 'active_modal'],
    defaultBindings: [{ key: 'v' }],
    preventDefault: true,
    source: 'console'
  },
  {
    id: 'panel.factions',
    label: 'Factions',
    description: 'Open or close the faction standings panel.',
    category: 'panels',
    scopes: ['world_gameplay', 'active_modal'],
    defaultBindings: [{ key: 'y' }],
    preventDefault: true,
    source: 'console'
  },
  {
    id: 'panel.dossier',
    label: 'Nemesis Dossier',
    description: 'Open or close the NPC & Nemesis dossier.',
    category: 'panels',
    scopes: ['world_gameplay', 'active_modal'],
    defaultBindings: [{ key: 'n' }],
    preventDefault: true,
    source: 'console'
  },
  {
    id: 'panel.ledger',
    label: 'World Ledger',
    description: 'Open or close the historical world event ledger.',
    category: 'panels',
    scopes: ['world_gameplay', 'active_modal'],
    defaultBindings: [{ key: 'l', shift: true }],
    preventDefault: true,
    source: 'console'
  },
  {
    id: 'panel.legends',
    label: 'World Legends',
    description: 'Open or close the World Map & multi-century Legends browser.',
    category: 'panels',
    scopes: ['world_gameplay', 'active_modal'],
    defaultBindings: [{ key: 'h', shift: true }],
    preventDefault: true,
    source: 'console'
  },
  {
    id: 'panel.debug',
    label: 'Debug Telemetry',
    description: 'Toggle the developer debug telemetry overlay.',
    category: 'system',
    scopes: ['world_gameplay', 'active_modal'],
    defaultBindings: [{ key: '`' }],
    preventDefault: true,
    source: 'console'
  },
  {
    id: 'debug.reveal_map',
    label: 'Debug: Reveal Map',
    description: 'Reveal the entire active map.',
    category: 'system',
    scopes: ['world_gameplay'],
    defaultBindings: [{ key: 'r' }],
    preventDefault: true,
    source: 'console'
  },
  {
    id: 'debug.god_mode',
    label: 'Debug: God Mode',
    description: 'Toggle invulnerability debug flag.',
    category: 'system',
    scopes: ['world_gameplay'],
    defaultBindings: [{ key: 'o' }],
    preventDefault: true,
    source: 'console'
  },
  {
    id: 'debug.spawn_entity',
    label: 'Debug: Spawn Test Entity',
    description: 'Spawn a test entity near the player.',
    category: 'system',
    scopes: ['world_gameplay'],
    defaultBindings: [{ key: 'e' }],
    preventDefault: true,
    source: 'console'
  }
];

/**
 * Built-in Campaign Editor commands registered cleanly for Phase 44 compatibility.
 */
export const EDITOR_COMMANDS: ReadonlyArray<CommandDefinition> = [
  {
    id: 'editor.undo',
    label: 'Undo Campaign Edit',
    description: 'Undo the previous campaign JSON patch operation.',
    category: 'editor',
    scopes: ['editor'],
    defaultBindings: [
      { key: 'z', ctrl: true },
      { key: 'z', meta: true }
    ],
    preventDefault: true,
    source: 'editor'
  },
  {
    id: 'editor.redo',
    label: 'Redo Campaign Edit',
    description: 'Redo the previously undone campaign JSON patch operation.',
    category: 'editor',
    scopes: ['editor'],
    defaultBindings: [
      { key: 'z', ctrl: true, shift: true },
      { key: 'z', meta: true, shift: true },
      { key: 'y', ctrl: true }
    ],
    preventDefault: true,
    source: 'editor'
  },
  {
    id: 'editor.save',
    label: 'Save Campaign',
    description: 'Save the current campaign workspace.',
    category: 'editor',
    scopes: ['editor'],
    defaultBindings: [
      { key: 's', ctrl: true },
      { key: 's', meta: true }
    ],
    allowInTextInput: true,
    preventDefault: true,
    source: 'editor'
  },
  {
    id: 'editor.playtest',
    label: 'Playtest Campaign',
    description: 'Launch live playtest from the current editor campaign.',
    category: 'editor',
    scopes: ['editor'],
    defaultBindings: [{ code: 'F2' }],
    allowInTextInput: true,
    preventDefault: true,
    source: 'editor'
  }
];

/** Preset binding patches keyed by KeybindPresetId. */
const PRESET_PATCHES: Readonly<Record<KeybindPresetId, Readonly<Record<string, ReadonlyArray<KeyChord>>>>> = {
  modern: {
    'move.north': [{ code: 'ArrowUp' }, { key: 'w' }, { code: 'Numpad8' }],
    'move.south': [{ code: 'ArrowDown' }, { key: 's' }, { code: 'Numpad2' }],
    'move.west': [{ code: 'ArrowLeft' }, { key: 'a' }, { code: 'Numpad4' }],
    'move.east': [{ code: 'ArrowRight' }, { key: 'd' }, { code: 'Numpad6' }],
    'move.nw': [{ code: 'Numpad7' }],
    'move.ne': [{ code: 'Numpad9' }],
    'move.sw': [{ code: 'Numpad1' }],
    'move.se': [{ code: 'Numpad3' }],
    'panel.factions': [{ key: 'y' }],
    'panel.dossier': [{ key: 'n' }],
    'dnd35e:spellbook': [{ key: 'b' }],
    'dnd35e:level_up': [{ key: 'u' }]
  },
  classic_vi: {
    'move.north': [{ code: 'ArrowUp' }, { key: 'k' }, { code: 'Numpad8' }],
    'move.south': [{ code: 'ArrowDown' }, { key: 'j' }, { code: 'Numpad2' }],
    'move.west': [{ code: 'ArrowLeft' }, { key: 'h' }, { code: 'Numpad4' }],
    'move.east': [{ code: 'ArrowRight' }, { key: 'l' }, { code: 'Numpad6' }],
    'move.nw': [{ key: 'y' }, { code: 'Numpad7' }],
    'move.ne': [{ key: 'u' }, { code: 'Numpad9' }],
    'move.sw': [{ key: 'b' }, { code: 'Numpad1' }],
    'move.se': [{ key: 'n' }, { code: 'Numpad3' }],
    'panel.factions': [{ key: 'y', shift: true }],
    'panel.dossier': [{ key: 'n', shift: true }],
    'dnd35e:spellbook': [{ key: 'b', shift: true }],
    'dnd35e:level_up': [{ key: 'u', shift: true }]
  }
};

/**
 * Returns the command-binding patch for the requested keybind preset.
 *
 * @param presetId Target preset identifier.
 * @returns Map of commandId to KeyChord array.
 */
export function getKeybindPresetPatch(presetId: KeybindPresetId): Readonly<Record<string, ReadonlyArray<KeyChord>>> {
  return PRESET_PATCHES[presetId];
}
