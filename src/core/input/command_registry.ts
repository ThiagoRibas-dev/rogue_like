import type {
  CommandDefinition,
  CommandSource,
  InputScopeId,
  KeyChord,
  KeybindConflict
} from '../../types/input.types.ts';
import { CONSOLE_COMMANDS, EDITOR_COMMANDS } from './command_catalog.ts';

const PHYSICAL_CODES = new Set([
  'Escape',
  'Enter',
  'Space',
  'Tab',
  'Backspace',
  'Delete',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Backslash',
  'Backquote',
  'Minus',
  'Equal',
  'NumpadEnter',
  'NumpadAdd',
  'NumpadSubtract'
]);

const CODE_DISPLAY_LABELS: Readonly<Record<string, string>> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Escape: 'Esc',
  Space: 'Space',
  Backslash: '\\',
  Backquote: '`',
  Enter: 'Enter',
  NumpadEnter: 'NumEnter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Del',
  Minus: '-',
  Equal: '='
};

const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta']);

/**
 * Infers a canonical `KeyboardEvent.code` when synthetic tests construct a `KeyboardEvent`
 * using only `key` without setting `code`.
 */
function inferCodeFromKey(key: string): string | undefined {
  if (key === ' ') return 'Space';
  if (key === '\\') return 'Backslash';
  if (key === '`') return 'Backquote';
  if (key === '-') return 'Minus';
  if (key === '=') return 'Equal';
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(key)) return key;
  if (
    key === 'Escape' ||
    key === 'Enter' ||
    key === 'Tab' ||
    key === 'Backspace' ||
    key === 'Delete' ||
    key === 'ArrowUp' ||
    key === 'ArrowDown' ||
    key === 'ArrowLeft' ||
    key === 'ArrowRight' ||
    key === 'Home' ||
    key === 'End' ||
    key === 'PageUp' ||
    key === 'PageDown'
  ) {
    return key;
  }
  return undefined;
}

/**
 * Normalizes a KeyChord into canonical immutable form with lowercase key and explicit truthy modifiers only.
 */
export function normalizeChord(chord: KeyChord): KeyChord {
  return {
    ...(chord.code !== undefined && chord.code !== '' ? { code: chord.code } : {}),
    ...(chord.key !== undefined && chord.key !== '' ? { key: chord.key.toLowerCase() } : {}),
    ...(chord.ctrl === true ? { ctrl: true } : {}),
    ...(chord.shift === true ? { shift: true } : {}),
    ...(chord.alt === true ? { alt: true } : {}),
    ...(chord.meta === true ? { meta: true } : {})
  };
}

/**
 * Compares two KeyChords for structural equality after normalization.
 */
export function areChordsEqual(a: KeyChord, b: KeyChord): boolean {
  const na = normalizeChord(a);
  const nb = normalizeChord(b);
  return (
    na.code === nb.code &&
    na.key === nb.key &&
    Boolean(na.ctrl) === Boolean(nb.ctrl) &&
    Boolean(na.shift) === Boolean(nb.shift) &&
    Boolean(na.alt) === Boolean(nb.alt) &&
    Boolean(na.meta) === Boolean(nb.meta)
  );
}

/**
 * Converts a live KeyboardEvent into a normalized KeyChord, or returns null for bare modifier presses.
 */
export function chordFromKeyboardEvent(event: KeyboardEvent): KeyChord | null {
  if (MODIFIER_KEYS.has(event.key)) {
    return null;
  }

  const modifiers = {
    ...(event.ctrlKey ? { ctrl: true } : {}),
    ...(event.shiftKey ? { shift: true } : {}),
    ...(event.altKey ? { alt: true } : {}),
    ...(event.metaKey ? { meta: true } : {})
  };

  const code = typeof event.code === 'string' && event.code !== '' ? event.code : inferCodeFromKey(event.key);
  if (
    code !== undefined &&
    (PHYSICAL_CODES.has(code) || /^F([1-9]|1[0-9]|2[0-4])$/.test(code) || code.startsWith('Numpad'))
  ) {
    return { code, ...modifiers };
  }

  if (code !== undefined && code.startsWith('Digit') && !event.shiftKey) {
    return { code, ...modifiers };
  }

  return { key: event.key.toLowerCase(), ...modifiers };
}

/**
 * Tests whether a KeyboardEvent satisfies a given KeyChord.
 */
export function matchesChord(event: KeyboardEvent, chord: KeyChord): boolean {
  const expectedCtrl = Boolean(chord.ctrl);
  const expectedAlt = Boolean(chord.alt);
  const expectedMeta = Boolean(chord.meta);
  if (Boolean(event.ctrlKey) !== expectedCtrl) return false;
  if (Boolean(event.altKey) !== expectedAlt) return false;
  if (Boolean(event.metaKey) !== expectedMeta) return false;

  const isPunctuationMnemonic =
    chord.code === undefined &&
    chord.key !== undefined &&
    chord.key.length === 1 &&
    !/[a-z0-9]/i.test(chord.key) &&
    chord.shift === undefined;

  if (!isPunctuationMnemonic && Boolean(event.shiftKey) !== Boolean(chord.shift)) {
    return false;
  }

  const eventCode = typeof event.code === 'string' && event.code !== '' ? event.code : inferCodeFromKey(event.key);

  if (chord.code !== undefined) {
    return eventCode === chord.code;
  }

  if (chord.key !== undefined) {
    // Prevent top-row Digit keys from accidentally firing character chords unless explicitly intended
    return event.key.toLowerCase() === chord.key.toLowerCase();
  }

  return false;
}

/**
 * Formats a KeyChord into a compact human-readable keycap string (e.g. `Shift+L`, `F1`, `Num7`).
 */
export function formatKeyChord(chord: KeyChord): string {
  const parts: string[] = [];
  if (chord.ctrl) parts.push('Ctrl');
  if (chord.alt) parts.push('Alt');
  if (chord.meta) parts.push('Meta');
  if (chord.shift) parts.push('Shift');

  let base = '';
  if (chord.code !== undefined) {
    const mapped = CODE_DISPLAY_LABELS[chord.code];
    if (mapped !== undefined) {
      base = mapped;
    } else if (chord.code.startsWith('Numpad')) {
      base = `Num${chord.code.slice(6)}`;
    } else if (chord.code.startsWith('Digit')) {
      base = chord.code.slice(5);
    } else if (chord.code.startsWith('Key')) {
      base = chord.code.slice(3).toUpperCase();
    } else {
      base = chord.code;
    }
  } else if (chord.key !== undefined) {
    base = chord.key === ' ' ? 'Space' : chord.key.length === 1 ? chord.key.toUpperCase() : chord.key;
  }

  parts.push(base || '?');
  return parts.join('+');
}

/**
 * Migrates a legacy v1 string binding (e.g. `'arrowup'`, `' '`, `'8'`, `'Shift+L'`) into a typed KeyChord.
 */
export function parseLegacyKeyString(legacyKey: string, actionHint?: string): KeyChord {
  const parts = legacyKey.split('+');
  let rawKey = parts[parts.length - 1] ?? legacyKey;
  if (legacyKey === '+') {
    rawKey = '+';
  }
  const modSet = new Set(parts.slice(0, -1).map((p) => p.toLowerCase()));
  const mods = {
    ...(modSet.has('ctrl') || modSet.has('control') ? { ctrl: true } : {}),
    ...(modSet.has('shift') ? { shift: true } : {}),
    ...(modSet.has('alt') ? { alt: true } : {}),
    ...(modSet.has('meta') || modSet.has('cmd') ? { meta: true } : {})
  };

  const lower = rawKey.toLowerCase();
  if (lower === ' ' || lower === 'space') return { code: 'Space', ...mods };
  if (lower === 'arrowup') return { code: 'ArrowUp', ...mods };
  if (lower === 'arrowdown') return { code: 'ArrowDown', ...mods };
  if (lower === 'arrowleft') return { code: 'ArrowLeft', ...mods };
  if (lower === 'arrowright') return { code: 'ArrowRight', ...mods };
  if (lower === 'enter') return { code: 'Enter', ...mods };
  if (lower === 'escape' || lower === 'esc') return { code: 'Escape', ...mods };
  if (lower === 'tab') return { code: 'Tab', ...mods };
  if (lower === '\\' || lower === 'backslash') return { code: 'Backslash', ...mods };
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(lower)) return { code: lower.toUpperCase(), ...mods };

  // Legacy movement digits '2','4','6','8' represent numpad keys (top-row digits are hotbar slots)
  if (/^[0-9]$/.test(lower) && actionHint?.startsWith('move')) {
    return { code: `Numpad${lower}`, ...mods };
  }

  return normalizeChord({ key: rawKey === ' ' ? ' ' : lower, ...mods });
}

/**
 * Central declarative registry for Console, Editor, and active Cartridge keyboard commands.
 */
export class CommandRegistry {
  private readonly commands = new Map<string, CommandDefinition>();

  public constructor(initialCommands: ReadonlyArray<CommandDefinition> = [...CONSOLE_COMMANDS, ...EDITOR_COMMANDS]) {
    this.registerCommands(initialCommands);
  }

  /** Registers or updates a command definition. */
  public registerCommand(def: CommandDefinition): void {
    this.commands.set(def.id, def);
  }

  /** Registers a batch of command definitions. */
  public registerCommands(defs: ReadonlyArray<CommandDefinition>): void {
    for (const def of defs) {
      this.commands.set(def.id, def);
    }
  }

  /** Unregisters all commands emitted by a given source (e.g. previous cartridge). */
  public unregisterBySource(source: CommandSource): void {
    for (const [id, def] of this.commands.entries()) {
      if (def.source === source) {
        this.commands.delete(id);
      }
    }
  }

  /** Replaces commands belonging to `rulesetId` while preserving other registered cartridges. */
  public syncCartridgeCommands(rulesetId: string, cmds: ReadonlyArray<CommandDefinition>): void {
    const targetSource: CommandSource = `cartridge:${rulesetId}`;
    this.unregisterBySource(targetSource);
    for (const def of cmds) {
      this.commands.set(def.id, { ...def, source: targetSource });
    }
  }

  /** Retrieves a command by ID. */
  public getCommand(id: string): CommandDefinition | undefined {
    return this.commands.get(id);
  }

  private isSourceActive(source: CommandSource, activeRulesetId?: string): boolean {
    if (!source.startsWith('cartridge:')) return true;
    if (activeRulesetId === undefined) return true;
    return source === `cartridge:${activeRulesetId}`;
  }

  /** Lists all registered commands (optionally filtered to Console + Editor + `activeRulesetId`). */
  public getAllCommands(activeRulesetId?: string): ReadonlyArray<CommandDefinition> {
    return Array.from(this.commands.values()).filter((cmd) => this.isSourceActive(cmd.source, activeRulesetId));
  }

  /** Lists all registered commands active inside a specific scope. */
  public getCommandsForScope(scope: InputScopeId, activeRulesetId?: string): ReadonlyArray<CommandDefinition> {
    return this.getAllCommands(activeRulesetId).filter((cmd) => cmd.scopes.includes(scope));
  }

  /** Resolves effective KeyChords for a command after applying optional user overrides. */
  public getEffectiveBindings(
    commandId: string,
    overrides?: Readonly<Record<string, ReadonlyArray<KeyChord>>>
  ): ReadonlyArray<KeyChord> {
    if (overrides && commandId in overrides) {
      return overrides[commandId] ?? [];
    }
    return this.commands.get(commandId)?.defaultBindings ?? [];
  }

  /** Finds the first registered command in `scope` matching the KeyboardEvent. */
  public findMatchingCommand(
    event: KeyboardEvent,
    scope: InputScopeId,
    overrides?: Readonly<Record<string, ReadonlyArray<KeyChord>>>,
    isTextInputActive = false,
    activeRulesetId?: string
  ): CommandDefinition | undefined {
    for (const cmd of this.commands.values()) {
      if (!this.isSourceActive(cmd.source, activeRulesetId)) continue;
      if (!cmd.scopes.includes(scope)) continue;
      if (isTextInputActive && cmd.allowInTextInput !== true) continue;

      const bindings = this.getEffectiveBindings(cmd.id, overrides);
      if (bindings.some((chord) => matchesChord(event, chord))) {
        return cmd;
      }
    }
    return undefined;
  }

  /** Formats the primary bound key for badge display, or returns an empty string if unbound. */
  public formatPrimaryCommandKey(
    commandId: string,
    overrides?: Readonly<Record<string, ReadonlyArray<KeyChord>>>
  ): string {
    const first = this.getEffectiveBindings(commandId, overrides)[0];
    return first ? formatKeyChord(first) : '';
  }

  /** Detects same-scope KeyChord collisions across active commands (never comparing two separate cartridges). */
  public detectConflicts(
    overrides?: Readonly<Record<string, ReadonlyArray<KeyChord>>>,
    activeRulesetId?: string
  ): ReadonlyArray<KeybindConflict> {
    const conflicts: KeybindConflict[] = [];
    const all = this.getAllCommands(activeRulesetId);

    for (let i = 0; i < all.length; i++) {
      const a = all[i];
      if (!a) continue;
      const bindsA = this.getEffectiveBindings(a.id, overrides);

      for (let j = i + 1; j < all.length; j++) {
        const b = all[j];
        if (!b) continue;
        if (a.source.startsWith('cartridge:') && b.source.startsWith('cartridge:') && a.source !== b.source) {
          continue;
        }
        const sharedScopes = a.scopes.filter((s) => b.scopes.includes(s));
        if (sharedScopes.length === 0) continue;

        const bindsB = this.getEffectiveBindings(b.id, overrides);
        for (const chordA of bindsA) {
          if (bindsB.some((chordB) => areChordsEqual(chordA, chordB))) {
            for (const scope of sharedScopes) {
              conflicts.push({
                commandId: a.id,
                otherCommandId: b.id,
                scope,
                chord: normalizeChord(chordA)
              });
            }
          }
        }
      }
    }

    return conflicts;
  }
}

/** Singleton CommandRegistry used across Console, Cartridges, Editor, Settings, and Help. */
export const commandRegistry = new CommandRegistry();
