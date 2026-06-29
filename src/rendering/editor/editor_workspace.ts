import type { CampaignData } from '../../types/campaign.types.ts';
import { CampaignCategorySchemas } from '../../types/campaign.types.ts';
import { AUTHORING_LEVELS } from '../../constants/campaign.constants.ts';
import { listEditorWorkspaces } from '../../core/campaign_store.ts';
import type { EditorController } from '../editor_ui.ts';
import type { ValidationReport } from '../../editor/validator/validator.types.ts';
import { editorState, notifyEditorStateChanged } from './editor_state.ts';
import { VIEW_GROUPS } from './editor_config.ts';

// Sub-editor view renderers
import { renderSimulationLab } from '../ui/ai_arena.ui.ts';
import { renderDirectorSandbox } from '../ui/director_sandbox.ui.ts';
import { renderAreaEditor } from '../ui/area_editor.ts';
import { renderDialogueTreeEditor } from '../ui/dialogue_editor.ts';
import { renderFactionMatrixEditor } from '../ui/faction_matrix_editor.ts';
import { renderWorldGraph } from '../ui/world_graph.ts';
import { renderFormForZodSchema } from '../ui/zod_form_renderer.ts';
import { renderKnowledgeSimulator } from '../ui/knowledge_simulator.ui.ts';
import { renderTriggerComposer } from '../ui/trigger_composer.ui.ts';
import { renderNarrativeFuzzer } from '../ui/narrative_fuzzer.ui.ts';
import { renderBalanceLab } from '../ui/balance_lab.ui.ts';

/**
 * Renders the primary workspace container, horizontal tabs, and delegates editing panel content.
 * @param controller The active EditorController instance.
 * @param container The workspace pane DOM container.
 * @param report The optional ValidationReport containing active errors.
 */
export function renderWorkspace(controller: EditorController, container: HTMLElement, report?: ValidationReport): void {
  const doc = controller.getDocument();

  // If no group is selected, render the Splash Welcome screen
  if (!editorState.activeGroupId) {
    container.innerHTML = `
      <div class="workspace-header">
        <h2 class="workspace-title">Welcome to the Campaign Creator</h2>
      </div>
      <div class="workspace-placeholder editor-drag-splash" id="editor-start-screen">
        <div class="editor-drag-icon">📁</div>
        <h2>Select a Workspace to Begin</h2>
        <div id="editor-workspace-list" style="margin-top: 20px; display: flex; flex-direction: column; gap: 8px;">
           <p style="color: var(--text-dim)">Loading workspaces...</p>
        </div>
      </div>
    `;

    listEditorWorkspaces()
      .then((workspaces): void => {
        const listEl = container.querySelector('#editor-workspace-list');
        if (!listEl) {
          return;
        }
        if (workspaces.length === 0) {
          listEl.innerHTML = `<p style="color: var(--text-dim)">No saved workspaces found. Click 'New' to start.</p>`;
          return;
        }
        listEl.innerHTML = '';
        workspaces.forEach((ws): void => {
          const btn = document.createElement('button');
          btn.className = 'modal-btn';
          btn.style.width = '300px';
          btn.style.textAlign = 'left';
          btn.innerHTML = `<strong>${ws.name}</strong><br><small style="opacity:0.7">Last modified: ${new Date(ws.lastModified).toLocaleString()}</small>`;
          btn.onclick = (): void => {
            controller.loadFromIDB(ws.id).catch(console.error);
          };
          listEl.appendChild(btn);
        });
      })
      .catch(console.error);
    return;
  }

  const group = VIEW_GROUPS.find((g): boolean => g.id === editorState.activeGroupId);
  if (!group) {
    return;
  }

  // 1. Render Horizontal Tabs Bar (Primary UI)
  const tabBar = document.createElement('div');
  tabBar.className = 'workspace-tabs-bar';
  tabBar.style.cssText =
    'display:flex;align-items:center;background:#1a1b24;border-bottom:1px solid rgba(255,255,255,0.08);flex-shrink:0;';

  const tab = group.tabs.find((t): boolean => t.id === editorState.activeTabId);

  // If the sidebar is collapsed and this is a dictionary tab, render the "Show List" toggle button
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

    // Apply Authoring Level badges in tab labels
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

  // 2. Render Panel Content below tabs
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
      // Draw standard edit header with authoring badge
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
          renderDialogueTreeEditor(controller, activeItem, `/${tab.id}/${editorState.activeItemId}`, formContainer);
        } else if (tab.id === 'areas') {
          renderAreaEditor(controller, activeItem, `/${tab.id}/${editorState.activeItemId}`, formContainer);
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
      // If area but no areaId selected, render World Graph
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
    // Custom Simulation Lab Sub-Tabs
    const simTabBar = document.createElement('div');
    simTabBar.className = 'sim-tabs';
    simTabBar.style.cssText =
      'display:flex;gap:0;border-bottom:2px solid var(--border-color);margin-bottom:0.5rem;flex-shrink:0;';

    const arenaTab = createSimTabBtn('⚔ AI Arena', 'arena');
    const directorTab = createSimTabBtn('🎲 Encounter Director', 'director');
    const knowledgeTab = createSimTabBtn('🧠 Knowledge Sim', 'knowledge');
    const fuzzerTab = createSimTabBtn('🤖 Narrative Fuzzer', 'fuzzer');
    const balanceTab = createSimTabBtn('⚖ Balance Lab', 'balance');

    simTabBar.appendChild(arenaTab);
    simTabBar.appendChild(directorTab);
    simTabBar.appendChild(knowledgeTab);
    simTabBar.appendChild(fuzzerTab);
    simTabBar.appendChild(balanceTab);
    formContainer.appendChild(simTabBar);

    const tabContent = document.createElement('div');
    tabContent.id = 'sim-tab-content';
    tabContent.style.cssText = 'flex:1;overflow-y:auto;';
    formContainer.appendChild(tabContent);

    let activeSimTab: 'arena' | 'director' | 'knowledge' | 'fuzzer' | 'balance' = 'arena';
    const updateSimTabs = (): void => {
      [arenaTab, directorTab, knowledgeTab, fuzzerTab, balanceTab].forEach((btn): void => {
        const isCurrent = btn.dataset.tab === activeSimTab;
        btn.style.color = isCurrent ? 'var(--text-bright, #fff)' : 'var(--text-dim)';
        btn.style.borderBottomColor = isCurrent ? 'var(--accent-color, #3498db)' : 'transparent';
      });
      tabContent.innerHTML = '';
      if (activeSimTab === 'arena') {
        renderSimulationLab(controller, tabContent);
      } else if (activeSimTab === 'director') {
        renderDirectorSandbox(controller, tabContent);
      } else if (activeSimTab === 'knowledge') {
        renderKnowledgeSimulator(controller, tabContent);
      } else if (activeSimTab === 'fuzzer') {
        renderNarrativeFuzzer(controller, tabContent);
      } else {
        renderBalanceLab(controller, tabContent);
      }
    };

    arenaTab.onclick = (): void => {
      activeSimTab = 'arena';
      updateSimTabs();
    };
    directorTab.onclick = (): void => {
      activeSimTab = 'director';
      updateSimTabs();
    };
    knowledgeTab.onclick = (): void => {
      activeSimTab = 'knowledge';
      updateSimTabs();
    };
    fuzzerTab.onclick = (): void => {
      activeSimTab = 'fuzzer';
      updateSimTabs();
    };
    balanceTab.onclick = (): void => {
      activeSimTab = 'balance';
      updateSimTabs();
    };

    updateSimTabs();
  } else if (tab.id === 'triggerComposer') {
    renderTriggerComposer(controller, formContainer);
  } else {
    // Singleton generic schema editor (Manifest, Rules, Theme, Advancement)
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

function createSimTabBtn(label: string, id: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'sim-tab';
  btn.dataset.tab = id;
  btn.textContent = label;
  btn.style.cssText =
    'padding:0.5rem 1rem;cursor:pointer;background:transparent;color:var(--text-dim);border:none;border-bottom:2px solid transparent;margin-bottom:-2px;font-size:0.85rem;';
  return btn;
}
