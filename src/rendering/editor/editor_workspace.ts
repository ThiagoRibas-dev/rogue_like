import type { CampaignData } from '../../types/campaign.types.ts';
import { CampaignCategorySchemas } from '../../types/campaign.types.ts';
import { AUTHORING_LEVELS } from '../../constants/campaign.constants.ts';
import { listEditorWorkspaces } from '../../core/campaign_store.ts';
import { loadCampaignRegistry, loadCampaign } from '../../core/loader.ts';
import { getRuleset, getAllRulesets } from '../../rulesets/registry.ts';
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
      <div class="workspace-placeholder editor-drag-splash" id="editor-start-screen" style="max-width: 900px; margin: 0 auto; padding: 24px;">
        <div class="editor-drag-icon">📁</div>
        <h2 style="margin-bottom: 24px;">Select a Workspace or Load a Campaign</h2>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px; text-align: left; width: 100%;">
          <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 16px;">
            <h3 style="margin-top:0; font-size: 1rem; color: #89b4fa; display:flex; align-items:center; gap:8px;">
              💾 Saved Workspaces (Browser IDB)
            </h3>
            <div id="editor-workspace-list" style="margin-top: 12px; display: flex; flex-direction: column; gap: 8px;">
              <p style="color: var(--text-dim)">Loading saved workspaces...</p>
            </div>
          </div>
          <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 16px;">
            <h3 style="margin-top:0; font-size: 1rem; color: #a6e3a1; display:flex; align-items:center; gap:8px;">
              📦 Bundled Campaigns (Disk)
            </h3>
            <div id="editor-bundled-campaign-list" style="margin-top: 12px; display: flex; flex-direction: column; gap: 8px;">
              <p style="color: var(--text-dim)">Loading bundled campaigns...</p>
            </div>
          </div>
        </div>
      </div>
    `;

    // Populate saved workspaces
    listEditorWorkspaces()
      .then((workspaces): void => {
        const listEl = container.querySelector('#editor-workspace-list');
        if (!listEl) {
          return;
        }
        if (workspaces.length === 0) {
          listEl.innerHTML = `<p style="color: var(--text-dim); font-size: 0.85rem;">No saved browser workspaces found.</p>`;
          return;
        }
        listEl.replaceChildren();
        workspaces.forEach((ws): void => {
          const btn = document.createElement('button');
          btn.className = 'modal-btn';
          btn.style.width = '100%';
          btn.style.textAlign = 'left';
          btn.style.padding = '8px 12px';
          btn.innerHTML = `<strong>${ws.name}</strong><br><small style="opacity:0.7">Modified: ${new Date(ws.lastModified).toLocaleDateString()}</small>`;
          btn.onclick = (): void => {
            controller.loadFromIDB(ws.id).catch(console.error);
          };
          listEl.appendChild(btn);
        });
      })
      .catch(console.error);

    // Populate bundled disk campaigns grouped by ruleset
    loadCampaignRegistry()
      .then((registry): void => {
        const bundledListEl = container.querySelector('#editor-bundled-campaign-list');
        if (!bundledListEl) {
          return;
        }
        bundledListEl.replaceChildren();

        const rulesets = getAllRulesets();
        rulesets.forEach((rs): void => {
          const matching = registry.campaigns.filter((c) => (c.rulesetId ?? 'classic') === rs.id);
          if (matching.length === 0) {
            return;
          }

          const groupHeader = document.createElement('div');
          groupHeader.style.cssText =
            'font-size:0.8rem;font-weight:bold;color:#cdd6f4;opacity:0.85;margin-top:8px;margin-bottom:4px;';
          groupHeader.textContent = `${rs.metadata.badgeIcon} ${rs.metadata.name}`;
          bundledListEl.appendChild(groupHeader);

          matching.forEach((c): void => {
            const btn = document.createElement('button');
            btn.className = 'modal-btn';
            btn.style.width = '100%';
            btn.style.textAlign = 'left';
            btn.style.padding = '8px 12px';
            btn.style.display = 'flex';
            btn.style.justifyContent = 'space-between';
            btn.style.alignItems = 'center';
            btn.innerHTML = `
              <div>
                <strong>${c.name}</strong>
                <div style="font-size:0.75rem;opacity:0.7;">${c.description}</div>
              </div>
              <span style="font-size:0.8rem;background:#313244;padding:2px 8px;border-radius:4px;white-space:nowrap;margin-left:8px;">Open ➔</span>
            `;
            btn.onclick = async (): Promise<void> => {
              btn.style.opacity = '0.5';
              btn.style.pointerEvents = 'none';
              try {
                const campaignDoc = await loadCampaign(c.id);
                controller.resetDocument(campaignDoc);
                const firstGroup = getRuleset(campaignDoc.manifest.rulesetId).getEditorViewGroups(VIEW_GROUPS)[0];
                if (firstGroup) {
                  editorState.activeGroupId = firstGroup.id;
                  editorState.activeTabId = firstGroup.tabs[0]?.id ?? null;
                }
                notifyEditorStateChanged();
              } catch (err) {
                console.error(`Failed to load campaign ${c.id}:`, err);
                alert(`Failed to load campaign: ${(err as Error).message}`);
              }
            };
            bundledListEl.appendChild(btn);
          });
        });
      })
      .catch(console.error);

    return;
  }

  const activeGroups = getRuleset(doc.manifest?.rulesetId).getEditorViewGroups(VIEW_GROUPS);
  const group = activeGroups.find((g): boolean => g.id === editorState.activeGroupId);
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
      tabContent.replaceChildren();
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
