import type { JSX } from 'preact';
import { uiStore } from '../core/ui_store.ts';
import { Keycap } from '../primitives/Keycap.tsx';

/**
 * Persistent `[F1] Help` reminder chip displayed in the viewport corner so players
 * can discover or invoke the contextual Help overlay with mouse or keyboard.
 */
export function HelpReminderChip(): JSX.Element {
  return (
    <button
      type="button"
      className="ui-help-reminder-chip"
      aria-label="Open contextual help and keybindings"
      onClick={(): void => {
        uiStore.setHelpOpen(true);
      }}
    >
      <Keycap commandId="system.toggle_help" fallbackLabel="F1" />
      <span>Help</span>
    </button>
  );
}
