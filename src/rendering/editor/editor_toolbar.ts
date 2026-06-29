import { setGameState } from '../../core/game-loop.ts';
import { loadCampaign } from '../../core/loader.ts';
import { validateCampaign } from '../../editor/campaign_validator.ts';
import { createBlankSlateCampaign } from '../../editor/workspace_file_service.ts';
import { UIMode } from '../../types/game-state.types.ts';
import type { GameState } from '../../types/game-state.types.ts';
import type { ValidationError } from '../../editor/validator/validator.types.ts';
import type { EditorController } from '../editor_ui.ts';
import { editorState, notifyEditorStateChanged } from './editor_state.ts';

/**
 * Renders the HTML structure of the toolbar inside the given header container.
 * @param container The header element to inject the toolbar UI.
 */
export function renderToolbar(container: HTMLElement): void {
  container.innerHTML = `
    <div class="editor-toolbar-left">
      <h1 class="editor-title">🛠️ Campaign Editor</h1>
      <button id="btn-editor-new" class="editor-btn">✨ New</button>
      <button id="btn-editor-open" class="editor-btn">📂 Resume Workspace</button>
      <button id="btn-editor-save" class="editor-btn">💾 Save</button>
      <div style="width:1px;height:24px;background:rgba(255,255,255,0.2);margin:0 8px;"></div>
      <input type="file" id="input-editor-import-zip" accept=".zip" style="display:none;" />
      <button id="btn-editor-import-zip" class="editor-btn">📦 Import ZIP</button>
      <button id="btn-editor-export-zip" class="editor-btn">📦 Export ZIP</button>
    </div>
    <div class="editor-toolbar-center">
      <button id="btn-editor-undo" class="editor-btn">↩️ Undo</button>
      <button id="btn-editor-redo" class="editor-btn">↪️ Redo</button>
    </div>
    <div class="editor-toolbar-right">
      <span id="editor-validation-status" class="validation-status">✅ OK</span>
      <button id="btn-editor-playtest" class="editor-btn playtest-btn">▶️ Play Test</button>
      <button id="btn-editor-exit" class="editor-btn exit-btn">✖ Exit</button>
    </div>
  `;
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

  if (statusEl) {
    if (errors.length === 0) {
      statusEl.textContent = '✅ OK';
      statusEl.className = 'validation-status ok';
      statusEl.title = 'No validation errors found.';
      statusEl.onmouseenter = null;
      statusEl.onmouseleave = null;
      const existingPopup = document.getElementById('editor-validation-popup');
      if (existingPopup) {
        existingPopup.remove();
      }
    } else {
      const errorCount = errors.filter((e): boolean => e.severity === 'error').length;
      const warnCount = errors.filter((e): boolean => e.severity === 'warning').length;
      statusEl.textContent = `❌ ${errorCount} Err, ${warnCount} Warn`;
      statusEl.className = 'validation-status error';

      let popup = document.getElementById('editor-validation-popup');
      if (!popup) {
        popup = document.createElement('div');
        popup.id = 'editor-validation-popup';
        popup.style.cssText =
          'display:none;position:absolute;z-index:1000;background:#1a1a2e;border:1px solid #e74c3c;border-radius:6px;padding:0.75rem;max-width:480px;max-height:400px;overflow-y:auto;font-size:0.75rem;box-shadow:0 8px 24px rgba(0,0,0,0.5);white-space:pre-wrap;';
        document.body.appendChild(popup);
      }

      popup.innerHTML =
        `<div style="font-weight:bold;margin-bottom:0.5rem;color:#e74c3c;">⚠ Validation Errors (${errors.length})</div>` +
        errors
          .map(
            (e): string =>
              `<div style="margin-bottom:0.35rem;padding:0.25rem 0.5rem;border-left:3px solid ${e.severity === 'error' ? '#e74c3c' : '#f39c12'};background:rgba(255,255,255,0.03);border-radius:2px;">` +
              `<span style="font-weight:bold;color:${e.severity === 'error' ? '#e74c3c' : '#f39c12'};">[${e.severity.toUpperCase()}]</span>&nbsp;` +
              `<span style="color:#3498db;">${e.path}</span><br/>` +
              `<span style="color:#ccc;">${e.message}</span>` +
              (e.fixSuggestion
                ? `<br/><span style="color:#a6e3a1;font-weight:bold;">💡 Fix: ${e.fixSuggestion}</span>`
                : '') +
              `</div>`
          )
          .join('');

      statusEl.onmouseenter = (): void => {
        if (popup) {
          const rect = statusEl.getBoundingClientRect();
          popup.style.left = Math.max(10, rect.left - 200) + 'px';
          popup.style.top = rect.bottom + window.scrollY + 4 + 'px';
          popup.style.display = 'block';
        }
      };
      statusEl.onmouseleave = (): void => {
        if (popup) {
          popup.style.display = 'none';
        }
      };
    }
  }
}
