import { listEditorWorkspaces } from '../../core/campaign_store.ts';
import { loadCampaignRegistry, loadCampaign } from '../../core/loader.ts';
import { getRuleset, getAllRulesets } from '../../rulesets/registry.ts';
import type { EditorController } from '../editor_ui.ts';
import { editorState, notifyEditorStateChanged } from './editor_state.ts';
import { VIEW_GROUPS } from './editor_config.ts';
import { renderSimulationLab } from '../ui/ai_arena.ui.ts';
import { renderDirectorSandbox } from '../ui/director_sandbox.ui.ts';
import { renderKnowledgeSimulator } from '../ui/knowledge_simulator.ui.ts';
import { renderNarrativeFuzzer } from '../ui/narrative_fuzzer.ui.ts';
import { renderBalanceLab } from '../ui/balance_lab.ui.ts';

/**
 * Renders the initial Editor Welcome Splash Screen with saved browser workspaces and bundled disk campaigns.
 *
 * @param controller The active EditorController instance.
 * @param container The workspace pane DOM container.
 */
export function renderEditorSplashScreen(controller: EditorController, container: HTMLElement): void {
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
        btn.innerHTML = `<strong>${ws.name}</strong><br><small style="opacity:0.7">Workspace ID: ${ws.id}</small>`;
        btn.onclick = (): void => {
          controller.loadFromIDB(ws.id).catch(console.error);
        };
        listEl.appendChild(btn);
      });
    })
    .catch(console.error);

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
}

/**
 * Renders the Simulation Lab horizontal sub-tabs (AI Arena, Encounter Director, Knowledge Sim, Fuzzer, Balance Lab).
 *
 * @param controller The active EditorController instance.
 * @param formContainer The container element to mount the sub-tabs into.
 */
export function renderSimulationLabSubTabs(controller: EditorController, formContainer: HTMLElement): void {
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
