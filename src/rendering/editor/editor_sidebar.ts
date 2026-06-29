import type { CampaignData } from '../../types/campaign.types.ts';
import type { EditorController } from '../editor_ui.ts';
import { editorState, notifyEditorStateChanged } from './editor_state.ts';
import { VIEW_GROUPS } from './editor_config.ts';
import { showPromptModal } from '../ui/modal.ui.ts';

/**
 * Renders the search header, item list, and handlers inside the sidebar panel.
 * Handles auto-collapsing if the tab type is a singleton or custom layout.
 * @param controller The active EditorController instance.
 * @param container The sidebar DOM container.
 */
export function renderSidebar(controller: EditorController, container: HTMLElement): void {
  const group = VIEW_GROUPS.find((g): boolean => g.id === editorState.activeGroupId);
  const tab = group?.tabs.find((t): boolean => t.id === editorState.activeTabId);

  // Model 2: Evolution-Based Semi-Modal Layout
  // Auto-collapse if no tab, or if tab is a singleton / custom editor
  if (!tab || tab.panelType === 'singleton' || tab.panelType === 'custom' || editorState.sidebarCollapsed) {
    container.style.width = '0px';
    container.style.display = 'none';
    const handle = document.querySelector('.editor-resize-handle') as HTMLElement | null;
    if (handle) {
      handle.style.display = 'none';
    }
    return;
  }

  // Otherwise, expand sidebar
  container.style.width = `${editorState.sidebarWidth}px`;
  container.style.display = 'flex';
  const handle = document.querySelector('.editor-resize-handle') as HTMLElement | null;
  if (handle) {
    handle.style.display = 'block';
  }

  // Draw Sidebar scaffolding if it hasn't been drawn yet
  if (!container.querySelector('.sidebar-header')) {
    container.innerHTML = `
      <div class="sidebar-header" style="display:flex;align-items:center;justify-content:space-between;padding:8px;border-bottom:1px solid rgba(255,255,255,0.08);">
        <input type="text" id="editor-sidebar-search" class="form-input" placeholder="Filter..." style="flex:1;margin-right:8px;padding:4px 8px;font-size:0.8rem;background:#111;color:#fff;border:1px solid #444;" />
        <button id="btn-editor-sidebar-add" class="editor-btn" style="padding:4px 8px;font-size:0.8rem;">➕ Add</button>
      </div>
      <div class="sidebar-list" id="editor-sidebar-list" style="flex:1;overflow-y:auto;padding:8px 0;"></div>
    `;

    // Search event
    const searchIn = container.querySelector('#editor-sidebar-search') as HTMLInputElement | null;
    if (searchIn) {
      searchIn.value = editorState.searchFilter;
      searchIn.addEventListener('input', (): void => {
        editorState.searchFilter = searchIn.value;
        rebuildSidebarList(controller, container);
      });
    }

    // Add event
    const addBtn = container.querySelector('#btn-editor-sidebar-add') as HTMLButtonElement | null;
    addBtn?.addEventListener('click', (): void => {
      handleAddItem(controller);
    });
  } else {
    // Keep search filter in sync
    const searchIn = container.querySelector('#editor-sidebar-search') as HTMLInputElement | null;
    if (searchIn && searchIn.value !== editorState.searchFilter) {
      searchIn.value = editorState.searchFilter;
    }
  }

  rebuildSidebarList(controller, container);
}

/**
 * Rebuilds only the list items inside the sidebar.
 */
function rebuildSidebarList(controller: EditorController, container: HTMLElement): void {
  const listContainer = container.querySelector('#editor-sidebar-list') as HTMLElement | null;
  if (!listContainer || !editorState.activeTabId) {
    return;
  }

  const doc = controller.getDocument();
  const categoryKey = editorState.activeTabId as keyof CampaignData;
  const dict = doc[categoryKey] as Record<string, unknown> | undefined;

  listContainer.innerHTML = '';
  if (!dict) {
    return;
  }

  for (const key of Object.keys(dict)) {
    const itemObj = dict[key] as Record<string, unknown> | undefined;
    const nameText = (itemObj?.name as string | undefined) || key;

    // Filter list
    if (editorState.searchFilter) {
      const term = editorState.searchFilter.toLowerCase();
      if (!key.toLowerCase().includes(term) && !nameText.toLowerCase().includes(term)) {
        continue;
      }
    }

    const btn = document.createElement('div');
    btn.className = `database-list-item ${editorState.activeItemId === key ? 'active' : ''}`;
    btn.draggable = true;

    // Drag Start support for referencing entities
    btn.addEventListener('dragstart', (e: DragEvent): void => {
      e.dataTransfer?.setData(
        'application/x-editor-ref',
        JSON.stringify({
          id: key,
          category: editorState.activeTabId
        })
      );
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'link';
      }
    });

    const glyphText = (itemObj?.glyph as string | undefined) || '📄';
    const fgColor = (itemObj?.fg as string | undefined) || '#ccc';
    const bgColor = (itemObj?.bg as string | undefined) || 'transparent';

    btn.innerHTML = `
      <div style="display:flex;align-items:center;flex-grow:1;cursor:pointer;" class="item-click-target">
        <span class="database-list-item-glyph" style="color:${fgColor};background:${bgColor};font-family:monospace;width:24px;text-align:center;border-radius:3px;margin-right:8px;">${glyphText}</span>
        <span style="font-size:0.85rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${nameText}</span>
      </div>
      <div style="display:flex;gap:4px;" class="sidebar-item-actions">
        <button class="editor-btn editor-btn-secondary btn-duplicate-item" data-key="${key}" title="Duplicate" style="padding:2px 6px;font-size:0.75rem;opacity:0.5;">📋</button>
        <button class="editor-btn editor-btn-danger btn-delete-item" data-key="${key}" title="Delete" style="padding:2px 6px;font-size:0.75rem;opacity:0.5;">✖</button>
      </div>
    `;

    // Click select
    btn.querySelector('.item-click-target')?.addEventListener('click', (): void => {
      editorState.activeItemId = key;
      notifyEditorStateChanged();
    });

    // Delete
    btn.querySelector('.btn-delete-item')?.addEventListener('click', (e: Event): void => {
      e.stopPropagation();
      if (confirm(`Are you sure you want to delete ${key}?`)) {
        controller.applyOperations([{ op: 'remove', path: `/${categoryKey}/${key}` }]);
        if (editorState.activeItemId === key) {
          editorState.activeItemId = null;
        }
        notifyEditorStateChanged();
      }
    });

    // Duplicate
    btn.querySelector('.btn-duplicate-item')?.addEventListener('click', (e: Event): void => {
      e.stopPropagation();
      showPromptModal({
        title: 'Duplicate Item',
        defaultValue: `${key}_copy`,
        placeholder: 'Enter a unique ID',
        validator: (val: string): string | null => {
          if (!/^[a-z0-9_-]+$/.test(val)) {
            return 'ID must be lowercase alphanumeric, dashes, or underscores.';
          }
          if (dict[val]) {
            return 'An item with that ID already exists.';
          }
          return null;
        },
        onConfirm: (newId: string): void => {
          const copy = JSON.parse(JSON.stringify(dict[key])) as Record<string, unknown>;
          copy.id = newId;
          if (copy.name) {
            copy.name = `${copy.name} (Copy)`;
          }
          controller.applyOperations([{ op: 'add', path: `/${categoryKey}/${newId}`, value: copy }]);
          editorState.activeItemId = newId;
          notifyEditorStateChanged();
        }
      });
    });

    listContainer.appendChild(btn);
  }
}

/**
 * Handles showing the creation prompt modal.
 */
function handleAddItem(controller: EditorController): void {
  if (!editorState.activeTabId) {
    return;
  }
  const doc = controller.getDocument();
  const categoryKey = editorState.activeTabId as keyof CampaignData;
  const dict = (doc[categoryKey] || {}) as Record<string, unknown>;

  showPromptModal({
    title: 'New Item',
    placeholder: 'Enter a unique ID',
    validator: (val: string): string | null => {
      if (!/^[a-z0-9_-]+$/.test(val)) {
        return 'ID must be lowercase alphanumeric, dashes, or underscores.';
      }
      if (dict[val]) {
        return 'An item with that ID already exists.';
      }
      return null;
    },
    onConfirm: (newId: string): void => {
      controller.applyOperations([
        { op: 'add', path: `/${categoryKey}/${newId}`, value: { id: newId, name: 'New Item' } }
      ]);
      editorState.activeItemId = newId;
      notifyEditorStateChanged();
    }
  });
}
