import type { JSX } from 'preact';
import { useRef } from 'preact/hooks';
import {
  continueSavedGame,
  openEditorMode,
  openRulesetSelectMenu,
  openSettingsModal
} from '../../../core/session/session_dom.ts';
import { importSaveFromFile, triggerSaveExportDownload } from '../../../core/session/session_settings.ts';
import { UIMode } from '../../../types/game-state.types.ts';
import { useUiSelector } from '../core/ui_store.ts';
import { Button } from '../primitives/Button.tsx';
import { useFocusTrap } from '../primitives/focus_hooks.ts';
import { Keycap } from '../primitives/Keycap.tsx';

/**
 * Declarative Main Menu hero screen with live keyboard focus trapping and save management.
 */
export function MainMenu(): JSX.Element | null {
  const uiMode = useUiSelector((s) => s.gameState?.uiMode ?? null);
  const hasSave = useUiSelector((s) => s.hasSave);
  const cardRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isOpen = uiMode === UIMode.MainMenu;
  useFocusTrap(cardRef, isOpen);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="ui-main-menu-backdrop" role="dialog" aria-modal="true" aria-label="Main Menu">
      <div ref={cardRef} className="ui-main-menu-card">
        <div className="ui-main-menu-header">
          <h1 className="ui-main-menu-title">Many Worlds Rogues</h1>
          <p className="ui-main-menu-subtitle">Tactical Roguelike RPG</p>
        </div>

        <div className="ui-main-menu-actions">
          <Button variant="primary" size="lg" onClick={(): void => openRulesetSelectMenu()}>
            New Game
          </Button>
          <Button variant="secondary" size="lg" disabled={!hasSave} onClick={(): void => continueSavedGame()}>
            Continue Saved Run
          </Button>
          <Button variant="secondary" size="md" onClick={(): void => openEditorMode()}>
            Campaign Editor & Dev Tools
          </Button>
          <Button variant="secondary" size="md" onClick={(): void => openSettingsModal()}>
            Settings & Keybindings
          </Button>

          <div className="ui-main-menu-row">
            <Button variant="secondary" size="sm" disabled={!hasSave} onClick={(): void => triggerSaveExportDownload()}>
              Export Save
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={(): void => {
                fileInputRef.current?.click();
              }}
            >
              Import Save
            </Button>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            style={{ display: 'none' }}
            onChange={(e): void => {
              const target = e.currentTarget;
              const file = target.files?.[0];
              if (file) {
                void importSaveFromFile(file).finally(() => {
                  target.value = '';
                });
              }
            }}
          />
        </div>

        <div className="ui-main-menu-footer">
          <span>Tab / Arrows to Navigate</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <Keycap commandId="system.toggle_help" fallbackLabel="F1" />
            <span>Help Guide</span>
          </span>
        </div>
      </div>
    </div>
  );
}
