import type { JSX } from 'preact';
import { formatKeyChord } from '../../../core/input/command_registry.ts';
import { getBindingsForCommand } from '../../../core/settings.ts';
import type { KeyChord } from '../../../types/input.types.ts';
import { useUiSelector } from '../core/ui_store.ts';

/** Props for `<Keycap />`, binding dynamically to a CommandRegistry ID or static fallback label. */
export interface KeycapProps {
  readonly commandId?: string | undefined;
  readonly chord?: KeyChord | undefined;
  readonly fallbackLabel?: string | undefined;
  readonly slotIndex?: number | undefined;
  readonly className?: string | undefined;
}

/**
 * Live `<kbd>` indicator displaying the current effective shortcut for a `CommandRegistry`
 * command ID and automatically updating whenever the user rebinds keys in Settings.
 */
export function Keycap({ commandId, chord, fallbackLabel, slotIndex = 0, className }: KeycapProps): JSX.Element | null {
  // Subscribe to settingsVersion so key rebinds immediately refresh rendered <kbd> hints.
  const settingsVersion = useUiSelector((snap) => snap.settingsVersion);
  void settingsVersion;

  let text = fallbackLabel ?? '';
  if (chord) {
    text = formatKeyChord(chord);
  } else if (commandId) {
    const chords = getBindingsForCommand(commandId);
    const chosen = chords[slotIndex] ?? chords[0];
    text = chosen ? formatKeyChord(chosen) : (fallbackLabel ?? 'Unbound');
  }

  if (!text) return null;

  return <kbd className={className ? `ui-kbd ${className}` : 'ui-kbd'}>{text}</kbd>;
}
