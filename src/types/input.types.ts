/**
 * Ordered priority scopes for global keyboard input dispatch.
 * Higher-priority scopes capture matching commands before lower-priority scopes.
 */
export type InputScopeId =
  | 'rebind_capture'
  | 'system_dialog'
  | 'help_overlay'
  | 'active_modal'
  | 'hud_focus'
  | 'targeting_inspect'
  | 'world_gameplay'
  | 'editor';

/**
 * Canonical evaluation priority order from highest to lowest.
 */
export const INPUT_SCOPE_PRIORITY: ReadonlyArray<InputScopeId> = [
  'rebind_capture',
  'system_dialog',
  'help_overlay',
  'active_modal',
  'hud_focus',
  'targeting_inspect',
  'world_gameplay',
  'editor'
];

/**
 * Logical grouping for commands displayed in Settings and the F1 Help Panel.
 */
export type CommandCategory =
  'movement' | 'combat_actions' | 'hotbar' | 'panels' | 'cartridge' | 'hud_camera' | 'navigation' | 'system' | 'editor';

/**
 * Physical or layout-aware key combination with optional modifier flags.
 */
export interface KeyChord {
  /** Physical KeyboardEvent.code (preferred for digits, F-keys, arrows, Space, Escape, Backslash, Numpad). */
  readonly code?: string;
  /** Layout-aware lowercase KeyboardEvent.key (preferred for letter mnemonics and punctuation like ?, /, <, >). */
  readonly key?: string;
  readonly ctrl?: boolean;
  readonly shift?: boolean;
  readonly alt?: boolean;
  readonly meta?: boolean;
}

/**
 * Origin tier declaring a command.
 */
export type CommandSource = 'console' | 'editor' | `cartridge:${string}`;

/**
 * Declarative keyboard command contract shared across Console, Cartridges, Settings, and Help.
 */
export interface CommandDefinition {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly category: CommandCategory;
  readonly scopes: ReadonlyArray<InputScopeId>;
  readonly defaultBindings: ReadonlyArray<KeyChord>;
  /** When true, command still fires inside editable text fields (restricted to Escape, F1, Ctrl+S, etc.). */
  readonly allowInTextInput?: boolean;
  /** When true, calls event.preventDefault() proactively on match (critical for F1, F6, Tab, Arrows, Space). */
  readonly preventDefault?: boolean;
  readonly source: CommandSource;
}

/**
 * Built-in keyboard preset profiles selectable in Settings.
 */
export type KeybindPresetId = 'modern' | 'classic_vi';

/**
 * Represents a keybinding collision between two commands active within the same scope.
 */
export interface KeybindConflict {
  readonly commandId: string;
  readonly otherCommandId: string;
  readonly scope: InputScopeId;
  readonly chord: KeyChord;
}

/**
 * Single help topic entry displayed inside the F1 Help Panel.
 */
export interface UIHelpEntry {
  readonly title: string;
  readonly summary: string;
  readonly commandIds?: ReadonlyArray<string>;
}

/**
 * Structured ruleset or screen help section rendered declaratively by HelpModal.
 */
export interface UIHelpSection {
  readonly id: string;
  readonly title: string;
  readonly icon?: string;
  /** Scopes in which this section is automatically promoted into the Contextual "This Screen" tab. */
  readonly contextScopes?: ReadonlyArray<InputScopeId>;
  readonly entries: ReadonlyArray<UIHelpEntry>;
}
