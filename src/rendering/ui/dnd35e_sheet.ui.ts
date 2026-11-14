/**
 * @file D&D 3.5e Standardized Tabbed Character Sheet Modal (Milestone 134).
 * Orchestrates:
 * - Tab Header Bar: [ Character ] | [ Progression & Features ] | [ Companions (N) ]
 * - Tab 1: Character (3 Equal-Width Columns — 1fr : 1fr : 1fr)
 *   - Column 1: Identity & Vitals, Defenses & Saves, Active Conditions, Ability Scores, Skills
 *   - Column 2: Attacks & Weapons, Combat Maneuvers, Abilities & Pools, Tactical Stances
 *   - Column 3: Reactive Paper Doll Equipment and Uniform 5-Column Backpack Stash
 * - Tab 2: Progression & Features (Feats & Traits + Level Progression Matrix)
 * - Tab 3: Companions & Summons (Live Companion Roster via getPlayerCompanions)
 */

import { getComponent } from '../../core/ecs.ts';
import { getGameState } from '../../core/game-loop.ts';
import { evaluateDnD35eEntityDAG } from '../../rulesets/dnd35e/cartridge/dnd35e_dag_adapter.ts';
import { DnD35UIAdapter } from '../../rulesets/dnd35e/ui/dnd35e_ui_adapter.ts';
import { getPlayerCompanions } from '../../systems/companion_commands.system.ts';
import { ComponentType } from '../../types/components.types.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';
import { getConsoleThemeMode } from './console_theme.ts';
import { renderSheetAttacksTab } from './dnd35e_sheet_attacks_tab.ui.ts';
import { renderSheetCompanionsTab } from './dnd35e_sheet_companions_tab.ui.ts';
import { renderSheetEquipmentTab } from './dnd35e_sheet_equipment_tab.ui.ts';
import { renderSheetOverviewTab } from './dnd35e_sheet_overview_tab.ui.ts';
import { renderSheetProgressionTab } from './dnd35e_sheet_progression_tab.ui.ts';

export type SheetTabId = 'character' | 'progression' | 'companions';

const dndAdapter = new DnD35UIAdapter();
let currentActiveTab: SheetTabId = 'character';

/**
 * Renders the Standardized Tabbed Character Sheet into `#dnd35e-sheet-body`.
 */
export function renderDnD35eSheetModal(state: GameState): void {
  const overlay = document.getElementById('dnd35e-sheet-overlay');
  if (!overlay) return;

  const content = document.getElementById('dnd35e-sheet-body');
  if (!content) return;

  content.replaceChildren();

  const liveState = getGameState() ?? state;
  const playerId = liveState.entities.find(
    (id: EntityId) => getComponent(liveState, id, ComponentType.Player) !== undefined
  );
  if (playerId === undefined) {
    const empty = document.createElement('div');
    empty.className = 'status-empty';
    empty.textContent = 'No player entity found.';
    content.appendChild(empty);
    return;
  }

  const evalResult = evaluateDnD35eEntityDAG(liveState, playerId);
  const sheetModel = dndAdapter.getCharacterSheetData({ state: liveState, entityId: playerId, evalResult });
  const invData = dndAdapter.getInventoryData({ state: liveState, entityId: playerId });
  const companionCount = getPlayerCompanions(liveState, playerId).length;

  const theme = getConsoleThemeMode();
  const shell = document.createElement('div');
  shell.className = 'crpg-prototype-shell';
  shell.setAttribute('data-console-theme', theme);

  // 1. Standardized 3-Tab Header Bar
  const tabBar = document.createElement('div');
  tabBar.className = 'crpg-sheet-tab-bar';

  const tabs: ReadonlyArray<readonly [SheetTabId, string]> = [
    ['character', '⚔ Character'],
    ['progression', '📜 Progression & Features'],
    ['companions', companionCount > 0 ? `🐾 Companions (${companionCount})` : '🐾 Companions']
  ];

  for (const [tabId, label] of tabs) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `crpg-sheet-tab-btn ${currentActiveTab === tabId ? 'active' : ''}`;
    btn.textContent = label;
    btn.addEventListener('click', () => {
      currentActiveTab = tabId;
      renderDnD35eSheetModal(liveState);
    });
    tabBar.appendChild(btn);
  }
  shell.appendChild(tabBar);

  // 2. Active Tab Content Pane
  if (currentActiveTab === 'character') {
    const grid = document.createElement('div');
    grid.className = 'crpg-three-col-grid';
    renderSheetOverviewTab(grid, liveState, playerId, evalResult, sheetModel);
    renderSheetAttacksTab(grid, liveState, playerId, sheetModel);
    renderSheetEquipmentTab(grid, liveState, playerId, invData);
    shell.appendChild(grid);
  } else if (currentActiveTab === 'progression') {
    renderSheetProgressionTab(shell, liveState, playerId, sheetModel);
  } else if (currentActiveTab === 'companions') {
    renderSheetCompanionsTab(shell, liveState, playerId);
  }

  content.appendChild(shell);
}
