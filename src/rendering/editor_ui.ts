import type { GameState } from '../types/game-state.types.ts';
import { UIMode } from '../types/game-state.types.ts';
import { setGameState } from '../core/game-loop.ts';
import type { CampaignData } from '../types/campaign.types.ts';
import type { PatchOperation } from '../utils/json-patch.ts';
import { renderFormForZodSchema } from './ui/zod_form_renderer.ts';
import { renderDialogueTreeEditor } from './ui/dialogue_editor.ts';
import { createBlankSlateCampaign } from '../editor/workspace_file_service.ts';
import { loadCampaign } from '../core/loader.ts';
import { CampaignCategorySchemas } from '../types/campaign.types.ts';
import { renderAreaEditor } from './ui/area_editor.ts';
import { renderWorldGraph } from './ui/world_graph.ts';
import type { GeneratedArea } from '../map/generator.ts';

export interface ValidationError {
  readonly path: string;
  readonly message: string;
  readonly severity: 'error' | 'warning';
}

export interface EditorController {
  getDocument(): CampaignData;
  resetDocument(newDoc: CampaignData): void;
  openWorkspace(): Promise<void>;
  saveWorkspace(): Promise<void>;
  importZipWorkspace(file: File): Promise<void>;
  exportZipWorkspace(): Promise<void>;
  applyOperations(ops: PatchOperation[], coalesce?: boolean): void;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  validate(): ReadonlyArray<ValidationError>;
  onChange(listener: (doc: CampaignData, errors: ReadonlyArray<ValidationError>) => void): void;
  generateSandboxArea(areaId: string): GeneratedArea;
}

// Local UI State for the Editor
let currentCategory: keyof CampaignData | null = null;
let currentItemId: string | null = null;
let isInitialized = false;

/**
 * Initializes and renders the Campaign Editor UI.
 * This acts as the View layer for the Editor.
 * @param state The current GameState containing the CampaignData
 * @param controller The Editor Controller instance injected from main.ts
 */
export function renderEditorUI(state: GameState, controller: EditorController): void {
  const editorLayout = document.getElementById('editor-layout');
  if (!editorLayout) return;

  if (state.uiMode !== UIMode.Editor) {
    editorLayout.innerHTML = '';
    isInitialized = false;
    return;
  }

  // Initialize the DOM scaffold once
  if (!isInitialized) {
    editorLayout.innerHTML = ''; // Clear previous

    // Toolbar
    const toolbar = document.createElement('header');
    toolbar.className = 'editor-toolbar';
    toolbar.innerHTML = `
      <div class="editor-toolbar-left">
        <h1 class="editor-title">🛠️ Campaign Editor</h1>
        <button id="btn-editor-new" class="editor-btn">✨ New</button>
        <button id="btn-editor-open" class="editor-btn">📂 Open Workspace</button>
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

    // Main Body Layout
    const bodyLayout = document.createElement('div');
    bodyLayout.className = 'editor-main';

    // Left Navigation Pane
    const navPane = document.createElement('aside');
    navPane.className = 'editor-sidebar';
    navPane.innerHTML = `
      <ul class="sidebar-menu" id="editor-nav-menu">
        <li><button class="sidebar-item-btn" data-target="manifest">Manifest</button></li>
        <li><button class="sidebar-item-btn" data-target="rules">Rules & Config</button></li>
        <li><button class="sidebar-item-btn" data-target="theme">Theme & UI</button></li>
        <li><button class="sidebar-item-btn" data-target="areas">Areas (Maps)</button></li>
        <li><button class="sidebar-item-btn" data-target="entities">Entities</button></li>
        <li><button class="sidebar-item-btn" data-target="items">Items & Equip</button></li>
        <li><button class="sidebar-item-btn" data-target="factions">Factions</button></li>
        <li><button class="sidebar-item-btn" data-target="dialogues">Dialogues</button></li>
        <li><button class="sidebar-item-btn" data-target="quests">Quests</button></li>
        <li><button class="sidebar-item-btn" data-target="triggers">Triggers</button></li>
        <li><button class="sidebar-item-btn" data-target="villains">Villains</button></li>
      </ul>
    `;

    // Middle List Pane
    const middlePane = document.createElement('aside');
    middlePane.className = 'editor-middle-pane';
    middlePane.id = 'editor-middle-pane';
    middlePane.style.display = 'none'; // Hidden by default
    middlePane.innerHTML = `
      <div class="middle-pane-header">
        <span class="middle-pane-title">Select a Category</span>
        <button id="btn-editor-add-item" class="editor-btn" style="padding: 4px 8px; font-size: 0.8rem;">➕ Add</button>
      </div>
      <div class="middle-pane-list" id="editor-middle-list"></div>
    `;

    // Central Workspace Area
    const workspacePane = document.createElement('main');
    workspacePane.className = 'editor-workspace';
    workspacePane.id = 'editor-workspace-pane';
    workspacePane.innerHTML = `
      <div class="workspace-header">
        <h2 class="workspace-title">Welcome to the Campaign Creator</h2>
      </div>
      <div class="workspace-placeholder editor-drag-splash">
        <div class="editor-drag-icon">📁</div>
        <h2>Open a Workspace to Begin</h2>
        <p style="color: var(--text-dim)">Click 'Open Workspace' in the toolbar to select your campaign folder.</p>
      </div>
    `;

    bodyLayout.appendChild(navPane);
    bodyLayout.appendChild(middlePane);
    bodyLayout.appendChild(workspacePane);

    // Update body layout CSS initially
    bodyLayout.style.gridTemplateColumns = '220px 1fr';

    editorLayout.appendChild(toolbar);
    editorLayout.appendChild(bodyLayout);

    // Initial render of whatever is selected
    refreshActiveViews(controller);

    // Bind basic events
    document.getElementById('btn-editor-exit')?.addEventListener('click', () => {
      setGameState({ ...state, uiMode: UIMode.MainMenu });
    });

    document.getElementById('btn-editor-new')?.addEventListener('click', async () => {
      if (
        confirm(
          'Create a new workspace? Any unsaved changes will be lost.\n\nPress OK to start with a Clone of Default, or Cancel to start from a Blank Slate.'
        )
      ) {
        // Clone Default
        const defaultDoc = await loadCampaign('default');
        controller.resetDocument(defaultDoc);
      } else {
        // Blank Slate
        controller.resetDocument(createBlankSlateCampaign());
      }
    });

    document.getElementById('btn-editor-open')?.addEventListener('click', () => {
      controller.openWorkspace().catch(console.error);
    });

    document.getElementById('btn-editor-save')?.addEventListener('click', () => {
      controller.saveWorkspace().catch(console.error);
    });

    const importZipInput = document.getElementById('input-editor-import-zip') as HTMLInputElement | null;
    document.getElementById('btn-editor-import-zip')?.addEventListener('click', () => {
      importZipInput?.click();
    });
    importZipInput?.addEventListener('change', () => {
      const file = importZipInput.files?.[0];
      if (file) {
        controller.importZipWorkspace(file).catch(console.error);
        importZipInput.value = ''; // clear
      }
    });

    document.getElementById('btn-editor-export-zip')?.addEventListener('click', () => {
      controller.exportZipWorkspace().catch(console.error);
    });

    document.getElementById('btn-editor-undo')?.addEventListener('click', () => controller.undo());
    document.getElementById('btn-editor-redo')?.addEventListener('click', () => controller.redo());

    document.getElementById('btn-editor-playtest')?.addEventListener('click', () => {
      const doc = controller.getDocument();
      const validationErrors = controller.validate();
      if (validationErrors.filter((e) => e.severity === 'error').length > 0) {
        alert('Cannot playtest with validation errors. Please fix them first.');
        return;
      }
      sessionStorage.setItem('editor_active_document', JSON.stringify(doc));
      if (currentCategory) sessionStorage.setItem('editor_active_category', currentCategory);
      if (currentItemId) sessionStorage.setItem('editor_active_item', currentItemId);
      else sessionStorage.removeItem('editor_active_item');

      // Reload the page to bootstrap the engine with the injected document
      window.location.reload();
    });

    // Bind keyboard shortcuts
    const handleKeydown = (e: KeyboardEvent) => {
      if (state.uiMode !== UIMode.Editor) return;
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z') {
          e.preventDefault();
          if (e.shiftKey) {
            controller.redo();
          } else {
            controller.undo();
          }
        } else if (e.key === 'y') {
          e.preventDefault();
          controller.redo();
        }
      }
    };
    window.addEventListener('keydown', handleKeydown);

    // Subscribe to controller changes to update toolbar state
    controller.onChange((_doc, errors) => {
      updateToolbar(controller, errors);
      refreshActiveViews(controller);
    });

    // Restore state from session storage if coming back from playtest
    const navMenu = document.getElementById('editor-nav-menu');
    const savedCat = sessionStorage.getItem('editor_active_category');
    const savedItem = sessionStorage.getItem('editor_active_item');
    if (savedCat) {
      currentCategory = savedCat as keyof CampaignData;
      if (savedItem) currentItemId = savedItem;
      const btn = navMenu?.querySelector(`[data-target="${savedCat}"]`);
      if (btn) {
        navMenu?.querySelectorAll('.sidebar-item-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
      }
      refreshActiveViews(controller);
    }

    // Bind left nav clicks
    navMenu?.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('.sidebar-item-btn') as HTMLButtonElement | null;
      if (!btn) return;

      const target = btn.dataset.target as keyof CampaignData;
      if (target) {
        currentCategory = target;
        currentItemId = null; // Reset selection when changing categories

        // Update active class
        navMenu.querySelectorAll('.sidebar-item-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');

        refreshActiveViews(controller);
      }
    });

    isInitialized = true;
  }
}

function updateToolbar(controller: EditorController, errors: ReadonlyArray<ValidationError>) {
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
    } else {
      const errorCount = errors.filter((e) => e.severity === 'error').length;
      const warnCount = errors.filter((e) => e.severity === 'warning').length;
      statusEl.textContent = `❌ ${errorCount} Err, ${warnCount} Warn`;
      statusEl.className = 'validation-status error';
      statusEl.title = errors.map((e) => `[${e.severity.toUpperCase()}] ${e.path}: ${e.message}`).join('\n');
    }
  }
}

function refreshActiveViews(controller: EditorController) {
  const doc = controller.getDocument();
  const middlePane = document.getElementById('editor-middle-pane');
  const middleList = document.getElementById('editor-middle-list');
  const workspacePane = document.getElementById('editor-workspace-pane');
  const bodyLayout = document.querySelector('.editor-main') as HTMLElement | null;

  if (!currentCategory) {
    if (middlePane) middlePane.style.display = 'none';
    if (bodyLayout) bodyLayout.style.gridTemplateColumns = '220px 1fr';
    return;
  }

  // Dictionary categories vs Singleton categories
  const dictCategories = [
    'areas',
    'entities',
    'items',
    'effects',
    'status',
    'tiles',
    'factions',
    'dialogues',
    'quests',
    'triggers',
    'villains',
    'schemes',
    'agreements'
  ];

  if (dictCategories.includes(currentCategory)) {
    // Show Middle Pane
    if (middlePane) middlePane.style.display = 'flex';
    if (bodyLayout) bodyLayout.style.gridTemplateColumns = '220px 280px 1fr';
    if (middleList) {
      middleList.innerHTML = '';
      const dict = doc[currentCategory as keyof CampaignData] as Record<string, unknown>;
      for (const key of Object.keys(dict)) {
        const itemObj = dict[key] as Record<string, unknown> | undefined;
        const btn = document.createElement('div');
        btn.className = `database-list-item ${currentItemId === key ? 'active' : ''}`;

        const nameText = (itemObj?.name as string | undefined) || key;
        const glyphText = (itemObj?.glyph as string | undefined) || '📄';

        btn.innerHTML = `
          <div style="display:flex;align-items:center;flex-grow:1;cursor:pointer;" class="item-click-target">
            <span class="database-list-item-glyph">${glyphText}</span>
            <span>${nameText}</span>
          </div>
          <button class="editor-btn editor-btn-danger btn-delete-item" data-key="${key}" style="padding:2px 6px;font-size:0.75rem;opacity:0.5;">✖</button>
        `;

        btn.querySelector('.item-click-target')?.addEventListener('click', () => {
          currentItemId = key;
          refreshActiveViews(controller); // re-render just the workspace
        });

        btn.querySelector('.btn-delete-item')?.addEventListener('click', (e) => {
          e.stopPropagation();
          if (confirm(`Are you sure you want to delete ${key}?`)) {
            controller.applyOperations([{ op: 'remove', path: `/${currentCategory}/${key}` }]);
            if (currentItemId === key) currentItemId = null;
          }
        });

        middleList.appendChild(btn);
      }

      // Wire up Add New button
      const btnAdd = document.getElementById('btn-editor-add-item');
      if (btnAdd) {
        // Clone and replace to clear old listeners
        const newBtnAdd = btnAdd.cloneNode(true) as HTMLButtonElement;
        btnAdd.parentNode?.replaceChild(newBtnAdd, btnAdd);
        newBtnAdd.addEventListener('click', () => {
          const newId = prompt('Enter a unique ID for the new item:');
          if (newId && !dict[newId]) {
            controller.applyOperations([
              { op: 'add', path: `/${currentCategory}/${newId}`, value: { id: newId, name: 'New Item' } }
            ]);
            currentItemId = newId;
          } else if (newId && dict[newId]) {
            alert('An item with that ID already exists.');
          }
        });
      }
    }
  } else {
    // Singleton (Manifest, Rules, Theme)
    if (middlePane) middlePane.style.display = 'none';
    if (bodyLayout) bodyLayout.style.gridTemplateColumns = '220px 1fr';
  }

  // Render Form in Workspace
  if (workspacePane) {
    workspacePane.innerHTML = '';
    const formContainer = document.createElement('div');
    formContainer.className = 'editor-form';

    if (dictCategories.includes(currentCategory)) {
      const header = document.createElement('div');
      header.className = 'workspace-header';
      header.innerHTML = `<h2 class="workspace-title">${currentCategory.toUpperCase()}</h2>`;

      if (currentItemId) {
        workspacePane.appendChild(header);
        // Render dictionary item form
        const dict = doc[currentCategory as keyof CampaignData] as Record<string, unknown>;
        const itemObj = dict[currentItemId];
        const schema = CampaignCategorySchemas[currentCategory];

        if (currentCategory === 'dialogues') {
          renderDialogueTreeEditor(controller, itemObj, `/${currentCategory}/${currentItemId}`, formContainer);
        } else if (currentCategory === 'areas') {
          renderAreaEditor(controller, itemObj, `/${currentCategory}/${currentItemId}`, formContainer);
        } else {
          renderFormForZodSchema(controller, schema, itemObj, `/${currentCategory}/${currentItemId}`, formContainer);
        }
      } else {
        if (currentCategory === 'areas') {
          // World Graph renders its own full layout, no standard header needed
          renderWorldGraph(doc, formContainer, (nodeId) => {
            currentItemId = nodeId;
            refreshActiveViews(controller);
          });
        } else {
          const header = document.createElement('div');
          header.className = 'workspace-header';
          header.innerHTML = `<h2 class="workspace-title">${currentCategory.toUpperCase()}</h2>`;
          workspacePane.appendChild(header);
          formContainer.innerHTML = `<div class="workspace-placeholder"><h2>Select an item from the list to edit.</h2></div>`;
        }
      }
    } else {
      const header = document.createElement('div');
      header.className = 'workspace-header';
      header.innerHTML = `<h2 class="workspace-title">${currentCategory.toUpperCase()}</h2>`;
      workspacePane.appendChild(header);
      // Render singleton form
      const obj = doc[currentCategory as keyof CampaignData];
      const schema = CampaignCategorySchemas[currentCategory];
      renderFormForZodSchema(controller, schema, obj, `/${currentCategory}`, formContainer);
    }

    workspacePane.appendChild(formContainer);
  }
}
