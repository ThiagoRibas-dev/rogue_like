import { validateCampaign } from '../editor/campaign_validator.ts';
import type { CampaignData } from '../types/campaign.types.ts';
import type { GameState } from '../types/game-state.types.ts';
import { UIMode } from '../types/game-state.types.ts';
import type { PatchOperation } from '../utils/json-patch.ts';
import type { ValidationError } from '../editor/validator/validator.types.ts';
import type { GeneratedArea } from '../map/generator.ts';

// Import refactored editor modules
import {
  editorState,
  subscribeToEditorState,
  notifyEditorStateChanged,
  type EditorState
} from './editor/editor_state.ts';
import { VIEW_GROUPS } from './editor/editor_config.ts';
import { renderToolbar, bindToolbarEvents, updateToolbarState } from './editor/editor_toolbar.ts';
import { renderSidebar } from './editor/editor_sidebar.ts';
import { renderWorkspace } from './editor/editor_workspace.ts';

/**
 * Controls operations in the Campaign Editor, handling workspace save/load, validation, undo/redo, and sandbox generation.
 */
export interface EditorController {
  getDocument(): CampaignData;
  resetDocument(newDoc: CampaignData): void;
  loadFromIDB(workspaceId: string): Promise<void>;
  saveWorkspace(): Promise<void>;
  importZipWorkspace(file: File): Promise<void>;
  exportZipWorkspace(): Promise<void>;
  applyOperations(ops: PatchOperation[], coalesce?: boolean): void;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  validate(): ReadonlyArray<ValidationError>;
  hasUnsavedChanges(): boolean;
  generateSandboxArea(areaId: string): GeneratedArea;
  onChange(listener: (doc: CampaignData, errors: ReadonlyArray<ValidationError>, isCoalesced: boolean) => void): void;
}

/**
 * Initializes and renders the Campaign Editor UI.
 * This acts as the View layer orchestrator for the Editor.
 * @param state The current GameState containing the CampaignData
 * @param controller The Editor Controller instance injected from main.ts
 */
export function renderEditorUI(state: GameState, controller: EditorController): void {
  const editorLayout = document.getElementById('editor-layout');
  if (!editorLayout) {
    return;
  }

  if (state.uiMode !== UIMode.Editor) {
    editorLayout.innerHTML = '';
    editorState.isInitialized = false;
    return;
  }

  // Initialize the DOM scaffold once
  if (!editorState.isInitialized) {
    editorLayout.innerHTML = '';

    // 1. Scaffold HTML Layout
    const toolbarEl = document.createElement('header');
    toolbarEl.className = 'editor-toolbar';
    toolbarEl.id = 'editor-toolbar';

    const bodyLayout = document.createElement('div');
    bodyLayout.className = 'editor-main';

    const activityBarEl = document.createElement('nav');
    activityBarEl.className = 'editor-activity-bar';
    activityBarEl.id = 'editor-activity-bar';

    const sidebarEl = document.createElement('aside');
    sidebarEl.className = 'editor-sidebar';
    sidebarEl.id = 'editor-sidebar';

    const resizeHandleEl = document.createElement('div');
    resizeHandleEl.className = 'editor-resize-handle';

    const workspaceEl = document.createElement('main');
    workspaceEl.className = 'editor-workspace-container';
    workspaceEl.id = 'editor-workspace';

    bodyLayout.appendChild(activityBarEl);
    bodyLayout.appendChild(sidebarEl);
    bodyLayout.appendChild(resizeHandleEl);
    bodyLayout.appendChild(workspaceEl);

    editorLayout.appendChild(toolbarEl);
    editorLayout.appendChild(bodyLayout);

    // 2. Render and Bind Toolbar
    renderToolbar(toolbarEl);
    bindToolbarEvents(controller, toolbarEl, state);

    // 3. Render Activity Bar
    renderActivityBar(activityBarEl);

    // 4. Bind Sidebar Resize Drag Handle
    bindResizeHandle(resizeHandleEl, sidebarEl);

    // 5. Bind Editor State Changes (Re-render views)
    subscribeToEditorState((): void => {
      // Sync active states on Activity Bar buttons
      activityBarEl.querySelectorAll('.editor-activity-btn').forEach((btn): void => {
        const htmlBtn = btn as HTMLButtonElement;
        const isCurrent = htmlBtn.dataset.group === editorState.activeGroupId;
        htmlBtn.classList.toggle('active', isCurrent);
      });

      renderSidebar(controller, sidebarEl);
      workspaceEl.innerHTML = '';
      renderWorkspace(controller, workspaceEl);
    });

    // 6. Bind Controller Changes (Data updates from outside)
    controller.onChange(async (_doc, _errors, isCoalesced): Promise<void> => {
      if (isCoalesced) {
        updateToolbarState(controller, _errors);
        return;
      }
      try {
        const report = await validateCampaign(controller.getDocument());
        updateToolbarState(controller, report.errors);

        renderSidebar(controller, sidebarEl);
        workspaceEl.innerHTML = '';
        renderWorkspace(controller, workspaceEl, report);
      } catch (err) {
        console.error(err);
      }
    });

    // 7. Bind Keyboard Shortcuts (Undo/Redo)
    const handleKeydown = (e: KeyboardEvent): void => {
      if (state.uiMode !== UIMode.Editor) {
        return;
      }
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

    // 8. Restore active categories from session storage (Reload or playtest recovery)
    const savedCat = sessionStorage.getItem('editor_active_category');
    const savedItem = sessionStorage.getItem('editor_active_item');
    if (savedCat) {
      const foundGroup = VIEW_GROUPS.find((g): boolean => g.tabs.some((t): boolean => t.id === savedCat));
      if (foundGroup) {
        editorState.activeGroupId = foundGroup.id;
        editorState.activeTabId = savedCat as EditorState['activeTabId'];
        if (savedItem) {
          editorState.activeItemId = savedItem;
        }
      }
    } else {
      // Default to first tab of core group
      const firstGroup = VIEW_GROUPS[0];
      if (firstGroup) {
        editorState.activeGroupId = firstGroup.id;
        const firstTab = firstGroup.tabs[0];
        if (firstTab) {
          editorState.activeTabId = firstTab.id;
        }
      }
      editorState.activeItemId = null;
    }

    // Trigger initial render
    notifyEditorStateChanged();

    // Trigger initial validation status display
    try {
      const initialErrors = controller.validate();
      updateToolbarState(controller, initialErrors);
    } catch (err) {
      console.error(err);
    }

    editorState.isInitialized = true;
  }
}

/**
 * Builds the Activity Bar buttons.
 */
function renderActivityBar(container: HTMLElement): void {
  container.innerHTML = '';
  VIEW_GROUPS.forEach((group): void => {
    const btn = document.createElement('button');
    btn.className = `editor-activity-btn ${editorState.activeGroupId === group.id ? 'active' : ''}`;
    btn.dataset.group = group.id;
    btn.title = group.description ? `${group.label}\n\n${group.description}` : group.label;
    btn.innerHTML = `
      <span class="activity-icon" style="font-size:1.5rem;display:block;">${group.icon}</span>
      <span class="activity-label" style="font-size:0.6rem;display:block;opacity:0.7;margin-top:2px;">${group.label.split(' ')[0]}</span>
    `;

    btn.onclick = (): void => {
      if (editorState.activeGroupId !== group.id) {
        editorState.activeGroupId = group.id;
        // Select first tab in group by default
        editorState.activeTabId = group.tabs[0]?.id || null;
        editorState.activeItemId = null;
        notifyEditorStateChanged();
      }
    };

    container.appendChild(btn);
  });
}

/**
 * Binds mousedown/mousemove/mouseup to make the sidebar resizable.
 */
function bindResizeHandle(handle: HTMLElement, sidebar: HTMLElement): void {
  let isDragging = false;

  handle.addEventListener('mousedown', (e: MouseEvent): void => {
    isDragging = true;
    document.body.style.cursor = 'col-resize';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e: MouseEvent): void => {
    if (!isDragging) {
      return;
    }
    const rect = sidebar.getBoundingClientRect();
    const newWidth = Math.max(180, Math.min(450, e.clientX - rect.left));
    editorState.sidebarWidth = newWidth;
    sidebar.style.width = `${newWidth}px`;
  });

  document.addEventListener('mouseup', (): void => {
    if (isDragging) {
      isDragging = false;
      document.body.style.cursor = '';
      notifyEditorStateChanged();
    }
  });

  // Double click toggles collapse
  handle.addEventListener('dblclick', (): void => {
    editorState.sidebarCollapsed = !editorState.sidebarCollapsed;
    notifyEditorStateChanged();
  });
}
