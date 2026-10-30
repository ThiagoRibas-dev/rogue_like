import { setGameState } from '../../core/game-loop.ts';
import { loadCampaign } from '../../core/loader.ts';
import { validateCampaign } from '../../editor/campaign_validator.ts';
import { createBlankSlateCampaign } from '../../editor/workspace_file_service.ts';
import { UIMode } from '../../types/game-state.types.ts';
import type { GameState } from '../../types/game-state.types.ts';
import type { ValidationError } from '../../editor/validator/validator.types.ts';
import type { EditorController } from '../editor_ui.ts';
import { editorState, notifyEditorStateChanged } from './editor_state.ts';
import { renderValidationPanel } from '../ui/validation_panel.ui';

/**
 * Renders the HTML structure of the toolbar inside the given header container.
 * @param container The header element to inject the toolbar UI.
 */
export function renderToolbar(container: HTMLElement): void {
  container.replaceChildren();

  const left = document.createElement('div');
  left.className = 'editor-toolbar-left';

  const title = document.createElement('h1');
  title.className = 'editor-title';
  title.textContent = '🛠️ Campaign Editor';
  left.appendChild(title);

  const btnNew = document.createElement('button');
  btnNew.id = 'btn-editor-new';
  btnNew.className = 'editor-btn';
  btnNew.textContent = '✨ New';
  left.appendChild(btnNew);

  const btnOpen = document.createElement('button');
  btnOpen.id = 'btn-editor-open';
  btnOpen.className = 'editor-btn';
  btnOpen.textContent = '📂 Resume Workspace';
  left.appendChild(btnOpen);

  const btnSave = document.createElement('button');
  btnSave.id = 'btn-editor-save';
  btnSave.className = 'editor-btn';
  btnSave.textContent = '💾 Save';
  left.appendChild(btnSave);

  const divider = document.createElement('div');
  divider.style.width = '1px';
  divider.style.height = '24px';
  divider.style.background = 'rgba(255,255,255,0.2)';
  divider.style.margin = '0 8px';
  divider.style.display = 'inline-block';
  divider.style.verticalAlign = 'middle';
  left.appendChild(divider);

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.id = 'input-editor-import-zip';
  fileInput.accept = '.zip';
  fileInput.style.display = 'none';
  left.appendChild(fileInput);

  const btnImport = document.createElement('button');
  btnImport.id = 'btn-editor-import-zip';
  btnImport.className = 'editor-btn';
  btnImport.textContent = '📦 Import ZIP';
  left.appendChild(btnImport);

  const btnExport = document.createElement('button');
  btnExport.id = 'btn-editor-export-zip';
  btnExport.className = 'editor-btn';
  btnExport.textContent = '📦 Export ZIP';
  left.appendChild(btnExport);

  const center = document.createElement('div');
  center.className = 'editor-toolbar-center';

  const btnUndo = document.createElement('button');
  btnUndo.id = 'btn-editor-undo';
  btnUndo.className = 'editor-btn';
  btnUndo.textContent = '↩️ Undo';
  center.appendChild(btnUndo);

  const btnRedo = document.createElement('button');
  btnRedo.id = 'btn-editor-redo';
  btnRedo.className = 'editor-btn';
  btnRedo.textContent = '↪️ Redo';
  center.appendChild(btnRedo);

  const right = document.createElement('div');
  right.className = 'editor-toolbar-right';

  const statusEl = document.createElement('span');
  statusEl.id = 'editor-validation-status';
  statusEl.className = 'validation-status';
  statusEl.textContent = '✅ OK';
  right.appendChild(statusEl);

  const btnPlaytest = document.createElement('button');
  btnPlaytest.id = 'btn-editor-playtest';
  btnPlaytest.className = 'editor-btn playtest-btn';
  btnPlaytest.textContent = '▶️ Play Test';
  right.appendChild(btnPlaytest);

  const btnExit = document.createElement('button');
  btnExit.id = 'btn-editor-exit';
  btnExit.className = 'editor-btn exit-btn';
  btnExit.textContent = '✖ Exit';
  right.appendChild(btnExit);

  container.appendChild(left);
  container.appendChild(center);
  container.appendChild(right);
}

/**
 * Binds click events and window handlers for the toolbar.
 * @param controller The active EditorController instance.
 * @param container The toolbar container element.
 * @param state The global game state.
 */
export function bindToolbarEvents(controller: EditorController, container: HTMLElement, state: GameState): void {
  // 1. Exit Button
  container.querySelector('#btn-editor-exit')?.addEventListener('click', (): void => {
    if (controller.hasUnsavedChanges() && !confirm('You have unsaved changes. Are you sure you want to exit?')) {
      return;
    }
    // Remove the window beforeunload listener or bypass it
    setGameState({ ...state, uiMode: UIMode.MainMenu });
  });

  // 2. New Campaign Button
  container.querySelector('#btn-editor-new')?.addEventListener('click', async (): Promise<void> => {
    if (controller.hasUnsavedChanges() && !confirm('You have unsaved changes that will be lost. Continue?')) {
      return;
    }
    if (
      confirm(
        'Create a new workspace?\n\nPress OK to start with a Clone of Default, or Cancel to start from a Blank Slate.'
      )
    ) {
      const defaultDoc = await loadCampaign('default');
      controller.resetDocument(defaultDoc);
    } else {
      controller.resetDocument(createBlankSlateCampaign());
    }
  });

  // 3. Resume / Open Splash screen button
  container.querySelector('#btn-editor-open')?.addEventListener('click', (): void => {
    editorState.activeGroupId = null;
    editorState.activeTabId = null;
    editorState.activeItemId = null;
    document.querySelectorAll('.editor-activity-btn').forEach((b): void => b.classList.remove('active'));
    notifyEditorStateChanged();
  });

  // 4. Save Button
  container.querySelector('#btn-editor-save')?.addEventListener('click', (): void => {
    controller.saveWorkspace().catch(console.error);
  });

  // 5. Import ZIP
  const importZipInput = container.querySelector('#input-editor-import-zip') as HTMLInputElement | null;
  container.querySelector('#btn-editor-import-zip')?.addEventListener('click', (): void => {
    importZipInput?.click();
  });
  importZipInput?.addEventListener('change', (): void => {
    const file = importZipInput.files?.[0];
    if (file) {
      controller.importZipWorkspace(file).catch(console.error);
      importZipInput.value = '';
    }
  });

  // 6. Export ZIP
  container.querySelector('#btn-editor-export-zip')?.addEventListener('click', async (): Promise<void> => {
    const btn = container.querySelector('#btn-editor-export-zip') as HTMLButtonElement | null;
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ Validating...';
    }
    try {
      const doc = controller.getDocument();
      const shallowErrors = controller.validate();
      if (shallowErrors.filter((e): boolean => e.severity === 'error').length > 0) {
        alert('Cannot export with validation errors. Please fix them first.');
        return;
      }

      const deepReport = await validateCampaign(doc);
      if (deepReport.errors.length > 0) {
        alert(
          'Campaign deep validation failed:\n\n' +
            deepReport.errors.map((e): string => `- [${e.path}] ${e.message}`).join('\n')
        );
        return;
      }

      await controller.exportZipWorkspace();
    } catch (err) {
      console.error(err);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '📦 Export ZIP';
      }
    }
  });

  // 7. Undo / Redo
  container.querySelector('#btn-editor-undo')?.addEventListener('click', (): void => {
    controller.undo();
  });
  container.querySelector('#btn-editor-redo')?.addEventListener('click', (): void => {
    controller.redo();
  });

  // 8. Playtest
  container.querySelector('#btn-editor-playtest')?.addEventListener('click', async (): Promise<void> => {
    const btn = container.querySelector('#btn-editor-playtest') as HTMLButtonElement | null;
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ Validating...';
    }
    try {
      const doc = controller.getDocument();
      const validationErrors = controller.validate();
      if (validationErrors.filter((e): boolean => e.severity === 'error').length > 0) {
        alert('Cannot playtest with validation errors. Please fix them first.');
        return;
      }

      const deepReport = await validateCampaign(doc);
      if (deepReport.errors.length > 0) {
        alert(
          'Campaign deep validation failed:\n\n' +
            deepReport.errors.map((e): string => `- [${e.path}] ${e.message}`).join('\n')
        );
        return;
      }

      sessionStorage.setItem('editor_active_document', JSON.stringify(doc));
      if (editorState.activeTabId) {
        sessionStorage.setItem('editor_active_category', editorState.activeTabId);
      }
      if (editorState.activeItemId) {
        sessionStorage.setItem('editor_active_item', editorState.activeItemId);
      } else {
        sessionStorage.removeItem('editor_active_item');
      }

      sessionStorage.setItem('editor_playtest', 'true');
      window.location.reload();
    } catch (err) {
      console.error(err);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '▶️ Play Test';
      }
    }
  });

  // 9. Window beforeunload event exit safety
  const beforeUnloadHandler = (e: BeforeUnloadEvent): void => {
    if (controller.hasUnsavedChanges()) {
      e.preventDefault();
      // Modern standard: returnValue must be set to empty string
      e.returnValue = '';
    }
  };
  window.addEventListener('beforeunload', beforeUnloadHandler);
}

/**
 * Updates undo/redo buttons states and renders the validation hover panel dynamically.
 * @param controller The active EditorController instance.
 * @param errors Current campaign validation errors list.
 */
export function updateToolbarState(controller: EditorController, errors: ReadonlyArray<ValidationError>): void {
  const btnUndo = document.getElementById('btn-editor-undo') as HTMLButtonElement | null;
  const btnRedo = document.getElementById('btn-editor-redo') as HTMLButtonElement | null;
  const statusEl = document.getElementById('editor-validation-status');

  if (btnUndo) btnUndo.disabled = !controller.canUndo();
  if (btnRedo) btnRedo.disabled = !controller.canRedo();

  // Clean up legacy hover popup (replaced by persistent dock in M76)
  const existingPopup = document.getElementById('editor-validation-popup');
  if (existingPopup) existingPopup.remove();

  if (statusEl) {
    if (errors.length === 0) {
      statusEl.textContent = '✅ OK';
      statusEl.className = 'validation-status ok';
      statusEl.title = 'No validation errors found.';
      statusEl.onmouseenter = null;
      statusEl.onmouseleave = null;
    } else {
      const errorCount = errors.filter((e): boolean => e.severity === 'error').length;
      const warnCount = errors.filter((e): boolean => e.severity === 'warning').length;
      statusEl.textContent = `❌ ${errorCount} Err, ${warnCount} Warn`;
      statusEl.className = 'validation-status error';
      statusEl.onmouseenter = null;
      statusEl.onmouseleave = null;
    }
  }

  // Update (or create) the persistent bottom validation dock
  // The dock element (`#validation-dock`) is mounted by the workspace/controller layer.
  let dock = document.getElementById('validation-dock') as HTMLElement | null;
  if (!dock) {
    dock = document.createElement('div');
    dock.id = 'validation-dock';
    dock.className = 'validation-dock';
    dock.style.cssText =
      'position:fixed;bottom:0;left:0;right:0;height:200px;max-height:30vh;background:#16162a;border-top:2px solid #e74c3c;z-index:900;padding:12px;overflow-y:auto;box-shadow:0 -4px 16px rgba(0,0,0,0.4);font-family:monospace;font-size:0.8rem;color:#cdd6f4;display:flex;flex-direction:column;';
    document.body.appendChild(dock);
  }

  // Listen to custom navigation events from the dock (see validation_panel.ui.ts)
  dock.addEventListener('editor:navigate-to-field', ((e: Event) => {
    const detail = (e as CustomEvent).detail;
    if (detail && detail.focusSelector) {
      const target = document.querySelector(detail.focusSelector) as HTMLElement | null;
      if (target) {
        target.focus();
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }) as EventListener);

  renderValidationPanel(dock, {
    errors: errors.map((e): { path: string; message: string; severity?: 'error' | 'warning' | 'info' } => ({
      path: e.path || '',
      message: e.message || '',
      severity: (e.severity as 'error' | 'warning' | 'info') || 'error'
    }))
  });
}
