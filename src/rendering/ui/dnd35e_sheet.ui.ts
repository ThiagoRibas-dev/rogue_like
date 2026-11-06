/**
 * @file D&D 3.5e Heroic Character Sheet Modal (Milestone 118).
 * 7-tab modal dialog integrating Overview DAG, Progression, Anatomical Paper Doll,
 * Skills with active Use, Feats, Special Abilities & Domains, and Conditions.
 */

import { getComponent } from '../../core/ecs.ts';
import { ComponentType } from '../../types/components.types.ts';
import type { GameState } from '../../types/game-state.types.ts';
import { assertNever } from '../../utils/assert.ts';
import {
  renderSheetConditionsTab,
  renderSheetFeatsTab,
  renderSheetProgressionTab,
  renderSheetSpecialAbilitiesTab
} from './dnd35e_sheet_feats_abilities_tab.ui.ts';
import { renderSheetOverviewTab } from './dnd35e_sheet_overview_tab.ui.ts';
import { renderSheetSkillsTab } from './dnd35e_sheet_skills_tab.ui.ts';
import { renderAnatomicalPaperDoll } from './equipment.ui.ts';

type SheetTab = 'overview' | 'progression' | 'equipment' | 'skills' | 'feats' | 'abilities' | 'conditions';

let activeTab: SheetTab = 'overview';

interface TabDef {
  readonly id: SheetTab;
  readonly label: string;
}

const SHEET_TABS: ReadonlyArray<TabDef> = [
  { id: 'overview', label: '1. Overview' },
  { id: 'progression', label: '2. Progression' },
  { id: 'equipment', label: '3. Equipment' },
  { id: 'skills', label: '4. Skills' },
  { id: 'feats', label: '5. Feats' },
  { id: 'abilities', label: '6. Abilities & Domains' },
  { id: 'conditions', label: '7. Conditions' }
];

/**
 * Renders the D&D 3.5e Character Sheet into `#dnd35e-sheet-body`.
 */
export function renderDnD35eSheetModal(state: GameState): void {
  const overlay = document.getElementById('dnd35e-sheet-overlay');
  if (!overlay) return;

  const content = document.getElementById('dnd35e-sheet-body');
  if (!content) return;

  content.replaceChildren();

  const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined);
  if (playerId === undefined) {
    const empty = document.createElement('div');
    empty.className = 'status-empty';
    empty.textContent = 'No player entity found.';
    content.appendChild(empty);
    return;
  }

  // 1. Tab Bar
  const tabBar = document.createElement('div');
  tabBar.className = 'dnd35-sheet-tabs';

  for (const tab of SHEET_TABS) {
    const tabBtn = document.createElement('button');
    tabBtn.type = 'button';
    tabBtn.className = tab.id === activeTab ? 'dnd35-tab-btn active' : 'dnd35-tab-btn';
    tabBtn.textContent = tab.label;
    tabBtn.addEventListener('click', () => {
      activeTab = tab.id;
      renderDnD35eSheetModal(state);
    });
    tabBar.appendChild(tabBtn);
  }
  content.appendChild(tabBar);

  // 2. Active Tab Content Pane
  const pane = document.createElement('div');
  pane.className = 'dnd35-sheet-tab-pane';

  switch (activeTab) {
    case 'overview':
      renderSheetOverviewTab(pane, state, playerId);
      break;
    case 'progression':
      renderSheetProgressionTab(pane, state, playerId);
      break;
    case 'equipment':
      renderAnatomicalPaperDoll(pane, state, playerId, { compact: false });
      break;
    case 'skills':
      renderSheetSkillsTab(pane, state, playerId);
      break;
    case 'feats':
      renderSheetFeatsTab(pane, state, playerId);
      break;
    case 'abilities':
      renderSheetSpecialAbilitiesTab(pane, state, playerId);
      break;
    case 'conditions':
      renderSheetConditionsTab(pane, state, playerId);
      break;
    default:
      assertNever(activeTab);
  }

  content.appendChild(pane);
}
