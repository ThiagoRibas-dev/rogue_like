import { setGameState } from '../../core/game-loop.ts';
import { validateCampaign } from '../../editor/campaign_validator.ts';
import { createNewCampaign } from '../../editor/workspace_file_service.ts';
import { getRuleset, getAllRulesets } from '../../rulesets/registry.ts';
import { UIMode } from '../../types/game-state.types.ts';
import type { GameState } from '../../types/game-state.types.ts';
import type { ValidationError } from '../../editor/validator/validator.types.ts';
import type { RulesetId } from '../../types/ruleset.types.ts';
import type { EditorController } from '../editor_ui.ts';
import { editorState, notifyEditorStateChanged } from './editor_state.ts';
import { VIEW_GROUPS } from './editor_config.ts';
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

  const rulesetBadge = document.createElement('span');
  rulesetBadge.id = 'editor-ruleset-badge';
  rulesetBadge.className = 'editor-ruleset-badge';
  rulesetBadge.style.cssText =
    'padding: 2px 8px; border-radius: 4px; background: rgba(241, 196, 15, 0.15); border: 1px solid rgba(241, 196, 15, 0.4); color: #f1c40f; font-size: 0.75rem; margin-right: 8px;';
  rulesetBadge.textContent = '⚔️ Classic';
  left.appendChild(rulesetBadge);

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
  container.querySelector('#btn-editor-new')?.addEventListener('click', (): void => {
    if (controller.hasUnsavedChanges() && !confirm('You have unsaved changes that will be lost. Continue?')) {
      return;
    }
    showNewCampaignModal(controller);
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
  const rulesetBadge = document.getElementById('editor-ruleset-badge');

  if (btnUndo) btnUndo.disabled = !controller.canUndo();
  if (btnRedo) btnRedo.disabled = !controller.canRedo();

  if (rulesetBadge) {
    const activeRuleset = getRuleset(controller.getDocument().manifest.rulesetId);
    rulesetBadge.textContent = `${activeRuleset.metadata.badgeIcon} ${activeRuleset.metadata.shortLabel}`;
    rulesetBadge.title = activeRuleset.metadata.name;
  }

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

  const editorLayout = document.getElementById('editor-layout');
  if (!editorLayout || editorLayout.classList.contains('hidden')) {
    return;
  }

  // Update (or create) the persistent bottom validation dock inside #editor-layout
  let dock = document.getElementById('validation-dock') as HTMLElement | null;
  if (!dock) {
    dock = document.createElement('div');
    dock.id = 'validation-dock';
    dock.className = 'validation-dock';
    dock.style.cssText =
      'position:fixed;bottom:0;left:0;right:0;height:200px;max-height:30vh;background:#16162a;border-top:2px solid #e74c3c;z-index:900;padding:12px;overflow-y:auto;box-shadow:0 -4px 16px rgba(0,0,0,0.4);font-family:monospace;font-size:0.8rem;color:#cdd6f4;display:flex;flex-direction:column;';
    dock.addEventListener('editor:navigate-to-field', ((e: Event): void => {
      const detail = (e as CustomEvent).detail as { focusSelector?: string } | undefined;
      if (detail && detail.focusSelector) {
        const target = document.querySelector(detail.focusSelector) as HTMLElement | null;
        if (target) {
          target.focus();
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    }) as EventListener);
    editorLayout.appendChild(dock);
  }

  renderValidationPanel(dock, {
    errors: errors.map((e): { path: string; message: string; severity?: 'error' | 'warning' | 'info' } => ({
      path: e.path || '',
      message: e.message || '',
      severity: (e.severity as 'error' | 'warning' | 'info') || 'error'
    }))
  });
}

/**
 * Displays a modal dialog prompting the user to choose a ruleset and template for a new campaign workspace.
 * @param controller The active EditorController.
 */
function showNewCampaignModal(controller: EditorController): void {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.style.cssText =
    'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.75);display:flex;justify-content:center;align-items:center;z-index:9999;backdrop-filter:blur(4px);';

  const modal = document.createElement('div');
  modal.className = 'modal-container';
  modal.style.cssText =
    'background:#181926;border:1px solid #45475a;border-radius:10px;padding:24px;width:100%;max-width:540px;box-shadow:0 12px 30px rgba(0,0,0,0.6);display:flex;flex-direction:column;gap:18px;color:#cdd6f4;';

  const rulesets = getAllRulesets();
  let selectedRulesetId: RulesetId = 'dnd35e';

  const title = document.createElement('h2');
  title.style.cssText = 'margin:0;font-size:1.3rem;display:flex;align-items:center;gap:8px;';
  title.textContent = '✨ Create New Campaign Workspace';
  modal.appendChild(title);

  const rulesetLabel = document.createElement('div');
  rulesetLabel.textContent = '1. Select RPG Ruleset:';
  rulesetLabel.style.cssText = 'font-weight:600;font-size:0.9rem;opacity:0.9;';
  modal.appendChild(rulesetLabel);

  const rulesetContainer = document.createElement('div');
  rulesetContainer.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:10px;';
  modal.appendChild(rulesetContainer);

  const templateLabel = document.createElement('div');
  templateLabel.textContent = '2. Choose Starting Template:';
  templateLabel.style.cssText = 'font-weight:600;font-size:0.9rem;opacity:0.9;';
  modal.appendChild(templateLabel);

  const templateList = document.createElement('div');
  templateList.style.cssText = 'display:flex;flex-direction:column;gap:8px;max-height:220px;overflow-y:auto;';
  modal.appendChild(templateList);

  const renderTemplateOptions = (): void => {
    templateList.replaceChildren();

    const options: Array<{ id?: string; name: string; desc: string; icon: string }> = [
      {
        name: `Blank Slate (${selectedRulesetId === 'dnd35e' ? 'D&D 3.5e' : 'Classic'})`,
        desc: `Fresh minimal canvas pre-configured for ${selectedRulesetId === 'dnd35e' ? 'D&D 3.5e archetypes' : 'Classic rules'}.`,
        icon: '✨'
      }
    ];

    if (selectedRulesetId === 'dnd35e') {
      options.push({
        id: 'dnd35e-crypt',
        name: 'Clone: Crypt of the Undead',
        desc: 'Complete D&D 3.5e dungeon crawl with skeletons, levers, traps, and boss fight.',
        icon: '📦'
      });
    } else {
      options.push(
        {
          id: 'default',
          name: 'Clone: The Default Dungeon',
          desc: 'Balanced classic roguelike dungeon with goblins, loot, and stairs.',
          icon: '📦'
        },
        {
          id: 'shroudgarde',
          name: 'Clone: Shroudgarde Keep',
          desc: 'Castle dungeon with heavy guards, barracks, and armor.',
          icon: '📦'
        }
      );
    }

    options.forEach((opt): void => {
      const card = document.createElement('div');
      card.style.cssText =
        'padding:10px 14px;background:#1e1e2e;border:1px solid #313244;border-radius:6px;cursor:pointer;display:flex;align-items:center;gap:12px;transition:all 0.15s ease;';
      card.innerHTML = `
        <span style="font-size:1.4rem;">${opt.icon}</span>
        <div style="flex-grow:1;">
          <div style="font-weight:bold;font-size:0.95rem;color:#cdd6f4;">${opt.name}</div>
          <div style="font-size:0.8rem;color:#a6adc8;margin-top:2px;">${opt.desc}</div>
        </div>
      `;
      card.addEventListener('mouseenter', (): void => {
        card.style.borderColor = '#89b4fa';
        card.style.background = '#252739';
      });
      card.addEventListener('mouseleave', (): void => {
        card.style.borderColor = '#313244';
        card.style.background = '#1e1e2e';
      });
      card.addEventListener('click', async (): Promise<void> => {
        card.style.opacity = '0.5';
        card.style.pointerEvents = 'none';
        try {
          const doc = await createNewCampaign(selectedRulesetId, opt.id);
          controller.resetDocument(doc);
          const firstGroup = getRuleset(doc.manifest.rulesetId).getEditorViewGroups(VIEW_GROUPS)[0];
          if (firstGroup) {
            editorState.activeGroupId = firstGroup.id;
            editorState.activeTabId = firstGroup.tabs[0]?.id ?? null;
          }
          notifyEditorStateChanged();
          overlay.remove();
        } catch (err) {
          console.error('Failed to create campaign:', err);
          alert(`Failed to create campaign: ${(err as Error).message}`);
          overlay.remove();
        }
      });
      templateList.appendChild(card);
    });
  };

  const updateRulesetButtons = (): void => {
    rulesetContainer.replaceChildren();
    rulesets.forEach((rs): void => {
      const isSelected = rs.id === selectedRulesetId;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.style.cssText = `padding:10px;border-radius:6px;border:1px solid ${isSelected ? '#89b4fa' : '#313244'};background:${isSelected ? 'rgba(137,180,250,0.15)' : '#1e1e2e'};color:#cdd6f4;cursor:pointer;text-align:left;display:flex;align-items:center;gap:8px;font-weight:${isSelected ? 'bold' : 'normal'};`;
      btn.innerHTML = `<span style="font-size:1.3rem;">${rs.metadata.badgeIcon}</span><div><div>${rs.metadata.name}</div><small style="opacity:0.7;font-size:0.75rem;">${rs.metadata.shortLabel}</small></div>`;
      btn.addEventListener('click', (): void => {
        selectedRulesetId = rs.id;
        updateRulesetButtons();
        renderTemplateOptions();
      });
      rulesetContainer.appendChild(btn);
    });
  };

  updateRulesetButtons();
  renderTemplateOptions();

  const footer = document.createElement('div');
  footer.style.cssText = 'display:flex;justify-content:flex-end;margin-top:4px;';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.className = 'btn btn-secondary';
  cancelBtn.style.cssText =
    'padding:8px 16px;background:#313244;color:#cdd6f4;border:1px solid #45475a;border-radius:6px;cursor:pointer;';
  cancelBtn.addEventListener('click', (): void => overlay.remove());
  footer.appendChild(cancelBtn);
  modal.appendChild(footer);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}
