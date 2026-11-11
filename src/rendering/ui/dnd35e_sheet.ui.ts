/**
 * @file D&D 3.5e Consolidated 3-Column Master Dossier & Character Sheet Modal.
 * Integrates:
 * - Column 1 (Left): Identity, 6 Ability Scores, Reactive Anatomical Paper Doll, AC & Saves
 * - Column 2 (Center): Full-Attack & Natural Weapon Ledger, Feats/Class Features/Domains, Level Matrix
 * - Column 3 (Right): Pen-and-Paper Skills Table + Compact 36x36px Backpack & Stash Grid
 * - Bottom Dock: NWN2 Tactical Modes & 12-Slot Action Hotbar
 */

import { getComponent } from '../../core/ecs.ts';
import { getGameState } from '../../core/game-loop.ts';
import { evaluateDnD35eEntityDAG } from '../../rulesets/dnd35e/cartridge/dnd35e_dag_adapter.ts';
import { DnD35UIAdapter } from '../../rulesets/dnd35e/ui/dnd35e_ui_adapter.ts';
import { ComponentType } from '../../types/components.types.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';
import { getConsoleThemeMode } from './console_theme.ts';
import { renderSheetFeatsAndFeaturesTab } from './dnd35e_sheet_feats_abilities_tab.ui.ts';
import { renderSheetOverviewTab } from './dnd35e_sheet_overview_tab.ui.ts';
import { renderSheetSkillsTab } from './dnd35e_sheet_skills_tab.ui.ts';

const dndAdapter = new DnD35UIAdapter();

/**
 * Renders the Consolidated 3-Column Character Sheet into `#dnd35e-sheet-body`.
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

  const theme = getConsoleThemeMode();
  const shell = document.createElement('div');
  shell.className = 'crpg-prototype-shell';
  shell.setAttribute('data-console-theme', theme);

  // Consolidated 3-Column Character Sheet Grid
  const grid = document.createElement('div');
  grid.className = 'crpg-three-col-grid';

  renderSheetOverviewTab(grid, liveState, playerId, evalResult, invData);
  renderSheetFeatsAndFeaturesTab(grid, liveState, playerId, sheetModel);
  renderSheetSkillsTab(grid, liveState, playerId, sheetModel, invData);

  shell.appendChild(grid);
  content.appendChild(shell);
}
