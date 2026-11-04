import type { CampaignData } from '../../types/campaign.types.ts';
import { CampaignCategorySchemas } from '../../types/campaign.types.ts';
import { AUTHORING_LEVELS } from '../../constants/campaign.constants.ts';
import { getRuleset } from '../../rulesets/registry.ts';
import type { EditorController } from '../editor_ui.ts';
import type { ValidationReport } from '../../editor/validator/validator.types.ts';
import { editorState, notifyEditorStateChanged } from './editor_state.ts';
import { VIEW_GROUPS } from './editor_config.ts';
import { renderEditorSplashScreen, renderSimulationLabSubTabs } from './editor_splash.ts';

// Sub-editor view renderers
import { renderAreaEditor } from '../ui/area_editor.ts';
import { renderDialogueTreeEditor } from '../ui/dialogue_editor.ts';
import { renderFactionMatrixEditor } from '../ui/faction_matrix_editor.ts';
import { renderWorldGraph } from '../ui/world_graph.ts';
import { renderFormForZodSchema } from '../ui/zod_form_renderer.ts';
import { renderTriggerComposer } from '../ui/trigger_composer.ui.ts';

export * from './editor_splash.ts';

/**
 * Renders the primary workspace container, horizontal tabs, and delegates editing panel content.
 * @param controller The active EditorController instance.
 * @param container The workspace pane DOM container.
 * @param report The optional ValidationReport containing active errors.
 */
export function renderWorkspace(controller: EditorController, container: HTMLElement, report?: ValidationReport): void {
  const doc = controller.getDocument();

  if (!editorState.activeGroupId) {
    renderEditorSplashScreen(controller, container);
    return;
  }

  const activeGroups = getRuleset(doc.manifest?.rulesetId).getEditorViewGroups(VIEW_GROUPS);
  const group = activeGroups.find((g): boolean => g.id === editorState.activeGroupId);
  if (!group) {
    return;
  }

  const tabBar = document.createElement('div');
  tabBar.className = 'workspace-tabs-bar';
  tabBar.style.cssText =
    'display:flex;align-items:center;background:#1a1b24;border-bottom:1px solid rgba(255,255,255,0.08);flex-shrink:0;';

  const tab = group.tabs.find((t): boolean => t.id === editorState.activeTabId);

  if (editorState.sidebarCollapsed && tab && tab.panelType === 'dictionary') {
    const listToggle = document.createElement('button');
    listToggle.className = 'editor-btn';
    listToggle.style.cssText =
      'padding:6px 12px;margin:4px 8px;font-size:0.8rem;background:rgba(52,152,219,0.2);color:#3498db;border:1px solid #3498db;';
    listToggle.innerHTML = '📂 Show List';
    listToggle.onclick = (): void => {
      editorState.sidebarCollapsed = false;
      notifyEditorStateChanged();
    };
    tabBar.appendChild(listToggle);
  }

  group.tabs.forEach((t): void => {
    const btn = document.createElement('button');
    btn.className = `workspace-tab-btn ${editorState.activeTabId === t.id ? 'active' : ''}`;

    let badgeText = '';
    if (t.panelType !== 'custom') {
      const level = AUTHORING_LEVELS[t.id as keyof CampaignData];
      if (level) {
        badgeText = ` [${level === 'Static' ? 'ST' : level === 'Blueprint' ? 'BP' : 'DYN'}]`;
      }
    }
    btn.textContent = t.label + badgeText;

    btn.onclick = (): void => {
      editorState.activeTabId = t.id;
      editorState.activeItemId = null;
      notifyEditorStateChanged();
      sessionStorage.setItem('editor_active_category', t.id);
    };
    tabBar.appendChild(btn);
  });

  container.appendChild(tabBar);

  const contentArea = document.createElement('div');
  contentArea.className = 'workspace-content';
  contentArea.style.cssText = 'flex:1;overflow-y:auto;display:flex;flex-direction:column;';

  if (!tab) {
    container.appendChild(contentArea);
    return;
  }

  const formContainer = document.createElement('div');
  formContainer.className = 'editor-form';
  formContainer.style.cssText = 'flex:1;display:flex;flex-direction:column;';

  if (tab.panelType === 'dictionary') {
    const header = document.createElement('div');
    header.className = 'workspace-header';

    if (editorState.activeItemId) {
      const h2 = document.createElement('h2');
      h2.className = 'workspace-title';
      const itemObj = (doc[tab.id as keyof CampaignData] as Record<string, unknown> | undefined)?.[
        editorState.activeItemId
      ] as Record<string, unknown> | undefined;

      let level = AUTHORING_LEVELS[tab.id as keyof CampaignData] || 'Static';
      if (tab.id === 'areas' && itemObj?.generatorType && itemObj.generatorType !== 'static') {
        level = 'Blueprint';
      }
      const badgeClass =
        level === 'Static' ? 'badge-static' : level === 'Blueprint' ? 'badge-blueprint' : 'badge-dynamic';

      h2.innerHTML = `Editing: ${editorState.activeItemId} <span class="badge ${badgeClass}">${level}</span>`;
      header.appendChild(h2);
      contentArea.appendChild(header);

      const activeItem = (doc[tab.id as keyof CampaignData] as Record<string, unknown>)[editorState.activeItemId];
      if (activeItem) {
        if (tab.id === 'dialogues') {
          renderDialogueTreeEditor(
            controller,
            activeItem,
            `/${tab.id}/${editorState.activeItemId}`,
            formContainer,
            report?.errors
          );
        } else if (tab.id === 'areas') {
          renderAreaEditor(
            controller,
            activeItem,
            `/${tab.id}/${editorState.activeItemId}`,
            formContainer,
            report?.errors
          );
        } else {
          renderFormForZodSchema(
            controller,
            CampaignCategorySchemas[tab.id as keyof CampaignData],
            activeItem,
            `/${tab.id}/${editorState.activeItemId}`,
            formContainer,
            report?.errors
          );
        }
      }
    } else {
      if (tab.id === 'areas') {
        renderWorldGraph(doc, formContainer, (nodeId): void => {
          editorState.activeItemId = nodeId;
          notifyEditorStateChanged();
        });
      } else {
        const level = AUTHORING_LEVELS[tab.id as keyof CampaignData] || 'Static';
        const badgeClass =
          level === 'Static' ? 'badge-static' : level === 'Blueprint' ? 'badge-blueprint' : 'badge-dynamic';
        header.innerHTML = `<h2 class="workspace-title">${tab.label.toUpperCase()} <span class="badge ${badgeClass}">${level}</span></h2>`;
        contentArea.appendChild(header);
        formContainer.innerHTML = `<div class="workspace-placeholder"><h2>Select an item from the list to edit.</h2></div>`;
      }
    }
  } else if (tab.id === 'factions') {
    const header = document.createElement('div');
    header.className = 'workspace-header';
    const level = AUTHORING_LEVELS['factions'] || 'Static';
    const badgeClass =
      level === 'Static' ? 'badge-static' : level === 'Blueprint' ? 'badge-blueprint' : 'badge-dynamic';
    header.innerHTML = `<h2 class="workspace-title">FACTIONS <span class="badge ${badgeClass}">${level}</span></h2>`;
    contentArea.appendChild(header);

    renderFactionMatrixEditor(controller, '/factions', formContainer);
  } else if (tab.id === 'simulation') {
    renderSimulationLabSubTabs(controller, formContainer);
  } else if (tab.id === 'triggerComposer') {
    renderTriggerComposer(controller, formContainer);
  } else {
    const header = document.createElement('div');
    header.className = 'workspace-header';
    const level = AUTHORING_LEVELS[tab.id as keyof CampaignData] || 'Static';
    const badgeClass =
      level === 'Static' ? 'badge-static' : level === 'Blueprint' ? 'badge-blueprint' : 'badge-dynamic';
    header.innerHTML = `<h2 class="workspace-title">${tab.label.toUpperCase()} <span class="badge ${badgeClass}">${level}</span></h2>`;
    contentArea.appendChild(header);

    const obj = doc[tab.id as keyof CampaignData];
    const schema = CampaignCategorySchemas[tab.id as keyof CampaignData];
    renderFormForZodSchema(controller, schema, obj, `/${tab.id}`, formContainer, report?.errors);
  }

  contentArea.appendChild(formContainer);
  container.appendChild(contentArea);
}
