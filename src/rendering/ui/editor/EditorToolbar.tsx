import type { JSX } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { setGameState } from '../../../core/game-loop.ts';
import { getSettings, updateSettings } from '../../../core/settings.ts';
import { validateCampaign } from '../../../editor/campaign_validator.ts';
import { getRuleset } from '../../../rulesets/registry.ts';
import { UIMode } from '../../../types/game-state.types.ts';
import { applySettingsToDOM } from '../core/apply_settings.ts';
import { uiStore, useUiSelector } from '../core/ui_store.ts';
import { Button } from '../primitives/Button.tsx';
import { Badge } from '../primitives/DataDisplay.tsx';
import { Select, type SelectOption } from '../primitives/FormControls.tsx';
import { Keycap } from '../primitives/Keycap.tsx';
import { dialogService } from '../primitives/dialog_service.ts';
import { dedupeValidationDiagnostics, editorStore, useEditorSelector } from './editor_store.ts';

const EDITOR_THEME_OPTIONS: ReadonlyArray<SelectOption> = [
  { value: 'auto', label: 'Theme: Auto' },
  { value: 'obsidian-brass', label: 'Obsidian & Brass' },
  { value: 'parchment', label: 'Parchment' },
  { value: 'retro-crt', label: 'Retro CRT' }
];

/**
 * Triggers campaign validation and exports the workspace to a downloadable ZIP archive.
 */
export async function exportValidatedCampaignZip(): Promise<void> {
  const { controller } = editorStore.getSnapshot();
  if (!controller) return;
  const doc = controller.getDocument();
  const shallowErrors = controller.validate();
  if (shallowErrors.some((e) => e.severity === 'error')) {
    await dialogService.alert({
      title: 'Validation Errors Present',
      message: 'Cannot export with validation errors. Please fix them first.'
    });
    return;
  }

  const deepReport = await validateCampaign(doc);
  if (deepReport.errors.length > 0) {
    await dialogService.alert({
      title: 'Deep Validation Failed',
      message: deepReport.errors.map((e) => `- [${e.path}] ${e.message}`).join('\n')
    });
    return;
  }

  await controller.exportZipWorkspace();
}

/**
 * Validates the workspace and launches Playtest mode into `sessionStorage`.
 */
export async function launchEditorPlaytest(): Promise<void> {
  const { controller, activeTabId, activeItemId } = editorStore.getSnapshot();
  if (!controller) return;
  const doc = controller.getDocument();

  const shallowErrors = controller.validate();
  if (shallowErrors.some((e) => e.severity === 'error')) {
    await dialogService.alert({
      title: 'Validation Errors Present',
      message: 'Cannot playtest with validation errors. Please fix them first.'
    });
    return;
  }

  const deepReport = await validateCampaign(doc);
  if (deepReport.errors.length > 0) {
    await dialogService.alert({
      title: 'Deep Validation Failed',
      message: deepReport.errors.map((e) => `- [${e.path}] ${e.message}`).join('\n')
    });
    return;
  }

  sessionStorage.setItem('editor_active_document', JSON.stringify(doc));
  if (activeTabId) {
    sessionStorage.setItem('editor_active_category', activeTabId);
  } else {
    sessionStorage.removeItem('editor_active_category');
  }
  if (activeItemId) {
    sessionStorage.setItem('editor_active_item', activeItemId);
  } else {
    sessionStorage.removeItem('editor_active_item');
  }

  sessionStorage.setItem('editor_playtest', 'true');
  window.location.reload();
}

/**
 * Prompts for exit if unsaved changes exist, otherwise returns cleanly to MainMenu.
 */
export async function requestExitEditor(): Promise<void> {
  const { controller } = editorStore.getSnapshot();
  const currentGameState = uiStore.getSnapshot().gameState;
  if (!currentGameState) return;

  if (controller?.hasUnsavedChanges()) {
    const confirmed = await dialogService.confirm({
      title: 'Unsaved Changes',
      message: 'You have unsaved changes. Are you sure you want to exit the Campaign Editor?',
      confirmLabel: 'Exit Editor',
      danger: true
    });
    if (!confirmed) return;
  }

  setGameState({ ...currentGameState, uiMode: UIMode.MainMenu });
}

/**
 * Top Campaign Editor toolbar built from Preact primitives, live theme switcher, and `<Keycap>` badges.
 */
export function EditorToolbar(): JSX.Element | null {
  const controller = useEditorSelector((s) => s.controller);
  const errors = useEditorSelector((s) => s.errors);
  const deepReport = useEditorSelector((s) => s.deepReport);
  const dockOpen = useEditorSelector((s) => s.validationDockOpen);
  const docVersion = useEditorSelector((s) => s.documentVersion);
  const settingsVersion = useUiSelector((s) => s.settingsVersion);
  void docVersion;
  void settingsVersion;

  const [busyAction, setBusyAction] = useState<'export' | 'playtest' | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  if (!controller) return null;

  const doc = controller.getDocument();
  const activeRuleset = getRuleset(doc.manifest.rulesetId);
  const currentSettings = getSettings();
  const currentThemePref = currentSettings.accessibility.consoleThemePreference ?? 'auto';

  const uniqueIssues = dedupeValidationDiagnostics(errors, deepReport);
  const errorCount = uniqueIssues.filter((e) => e.severity === 'error').length;
  const warnCount = uniqueIssues.filter((e) => e.severity === 'warning').length;

  const handleNewCampaign = async (): Promise<void> => {
    if (controller.hasUnsavedChanges()) {
      const ok = await dialogService.confirm({
        title: 'Discard Unsaved Changes?',
        message: 'You have unsaved changes that will be lost if you start a new workspace.',
        confirmLabel: 'Continue',
        danger: true
      });
      if (!ok) return;
    }
    editorStore.setNewCampaignModalOpen(true);
  };

  const handleImportFile = (file: File | undefined): void => {
    if (!file) return;
    void controller.importZipWorkspace(file);
  };

  const handleExport = async (): Promise<void> => {
    setBusyAction('export');
    try {
      await exportValidatedCampaignZip();
    } finally {
      setBusyAction(null);
    }
  };

  const handlePlaytest = async (): Promise<void> => {
    setBusyAction('playtest');
    try {
      await launchEditorPlaytest();
    } finally {
      setBusyAction(null);
    }
  };

  const handleThemeChange = (val: string): void => {
    const settings = getSettings();
    updateSettings({
      accessibility: {
        ...settings.accessibility,
        consoleThemePreference: val as 'auto' | 'parchment' | 'retro-crt' | 'obsidian-brass'
      }
    });
    applySettingsToDOM();
    uiStore.bumpSettingsVersion();
  };

  return (
    <div className="ui-editor-toolbar" role="toolbar" aria-label="Campaign Editor Actions">
      <div className="ui-editor-toolbar__group">
        <span className="ui-editor-toolbar__title">Campaign Editor</span>
        <Badge tone="accent" title={activeRuleset.metadata.name}>
          {activeRuleset.metadata.badgeIcon} {activeRuleset.metadata.shortLabel}
        </Badge>
        <Button size="sm" onClick={() => void handleNewCampaign()}>
          New
        </Button>
        <Button size="sm" onClick={() => editorStore.selectGroup(null)}>
          Workspaces
        </Button>
        <Button size="sm" onClick={() => void controller.saveWorkspace()} title="Save workspace to browser storage">
          Save <Keycap commandId="editor.save" fallbackLabel="Ctrl+S" />
        </Button>
        <input
          ref={importInputRef}
          type="file"
          accept=".zip"
          className="ui-editor-sr-file"
          onChange={(e) => {
            const input = e.target as HTMLInputElement;
            handleImportFile(input.files?.[0]);
            input.value = '';
          }}
        />
        <Button size="sm" onClick={() => importInputRef.current?.click()}>
          Import ZIP
        </Button>
        <Button size="sm" disabled={busyAction !== null} onClick={() => void handleExport()}>
          {busyAction === 'export' ? 'Validating...' : 'Export ZIP'}
        </Button>
      </div>

      <div className="ui-editor-toolbar__group">
        <Button size="sm" disabled={!controller.canUndo()} onClick={() => controller.undo()}>
          Undo <Keycap commandId="editor.undo" fallbackLabel="Ctrl+Z" />
        </Button>
        <Button size="sm" disabled={!controller.canRedo()} onClick={() => controller.redo()}>
          Redo <Keycap commandId="editor.redo" fallbackLabel="Ctrl+Y" />
        </Button>
      </div>

      <div className="ui-editor-toolbar__group">
        <Select
          value={currentThemePref}
          options={EDITOR_THEME_OPTIONS}
          ariaLabel="Editor UI Theme"
          className="ui-editor-toolbar__theme"
          onChange={handleThemeChange}
        />
        <Button
          size="sm"
          variant={dockOpen ? 'primary' : 'ghost'}
          ariaPressed={dockOpen}
          onClick={() => editorStore.setValidationDockOpen(!dockOpen)}
          title="Toggle validation diagnostics dock"
        >
          {errorCount === 0 && warnCount === 0 ? (
            <Badge tone="success">OK</Badge>
          ) : (
            <Badge tone={errorCount > 0 ? 'danger' : 'warning'}>
              {errorCount} Err / {warnCount} Warn
            </Badge>
          )}
        </Button>
        <Button size="sm" variant="primary" disabled={busyAction !== null} onClick={() => void handlePlaytest()}>
          {busyAction === 'playtest' ? 'Validating...' : 'Play Test'}{' '}
          <Keycap commandId="editor.playtest" fallbackLabel="F2" />
        </Button>
        <Button size="sm" variant="danger" onClick={() => void requestExitEditor()}>
          Exit
        </Button>
      </div>
    </div>
  );
}
