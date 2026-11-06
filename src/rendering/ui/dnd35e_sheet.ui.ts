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
import { markAllDomainsDirty } from '../../core/presentation_queue.ts';
import { DnD35UIAdapter, getDnD35EntityData } from '../../rulesets/registry.ts';
import { ComponentType, type TacticalDoctrineComponent } from '../../types/components.types.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';
import { renderConsoleHotbar, type UIHotbarSlotData } from './console_hotbar.ui.ts';
import { getConsoleThemeMode, setConsoleThemeMode } from './console_theme.ts';
import { applyDoctrineUpdate } from './dnd35e_doctrine_actions.ts';
import { renderSheetFeatsAndFeaturesTab } from './dnd35e_sheet_feats_abilities_tab.ui.ts';
import {
  getSheetMorphologyMode,
  renderSheetOverviewTab,
  setSheetMorphologyMode,
  type SheetMorphologyMode
} from './dnd35e_sheet_overview_tab.ui.ts';
import { renderSheetSkillsTab } from './dnd35e_sheet_skills_tab.ui.ts';

const dndAdapter = new DnD35UIAdapter();

interface MorphologyOption {
  readonly id: SheetMorphologyMode;
  readonly label: string;
}

const MORPHOLOGY_OPTIONS: ReadonlyArray<MorphologyOption> = [
  { id: 'live', label: '🧍 Live Anatomy' },
  { id: 'marilith_6arm', label: '🐍 6-Armed Marilith' },
  { id: 'quadruped_wolf', label: '🐺 Wild Shape Wolf' }
];

const DEFAULT_HOTBAR_SLOTS: ReadonlyArray<UIHotbarSlotData> = [
  { slotIndex: 0, keyLabel: '1', label: 'Strike', iconUrl: '⚔️', tooltipTitle: 'Full Attack Routine' },
  { slotIndex: 1, keyLabel: '2', label: 'Heal', iconUrl: '🧪', tooltipTitle: 'Potion of Cure Serious Wounds' },
  { slotIndex: 2, keyLabel: '3', label: 'Haste', iconUrl: '📜', tooltipTitle: 'Scroll of Haste' },
  { slotIndex: 3, keyLabel: '4', label: 'Tumble', iconUrl: '🤸', tooltipTitle: 'Acrobatic Tumble' }
];

function handleStanceToggle(state: GameState, playerId: EntityId, stanceId: string): void {
  const docComp = getComponent(state, playerId, ComponentType.TacticalDoctrine) as
    TacticalDoctrineComponent | undefined;
  const currentPA = docComp?.powerAttackAmount ?? 0;
  const currentFD = docComp?.fightingDefensively ?? false;
  const currentTD = docComp?.totalDefense ?? false;
  const currentGrip = docComp?.gripMode ?? 'one_handed';

  if (stanceId === 'power_attack') {
    applyDoctrineUpdate(state, playerId, { powerAttackAmount: currentPA > 0 ? 0 : 2 });
  } else if (stanceId === 'fighting_defensively') {
    const nextFD = !currentFD;
    applyDoctrineUpdate(state, playerId, {
      fightingDefensively: nextFD,
      totalDefense: nextFD ? false : currentTD
    });
  } else if (stanceId === 'total_defense') {
    const nextTD = !currentTD;
    applyDoctrineUpdate(state, playerId, {
      totalDefense: nextTD,
      fightingDefensively: nextTD ? false : currentFD
    });
  } else if (stanceId === 'two_handed_grip') {
    applyDoctrineUpdate(state, playerId, {
      gripMode: currentGrip === 'two_handed' ? 'one_handed' : 'two_handed'
    });
  }
  renderDnD35eSheetModal(getGameState() ?? state);
}

/**
 * Renders the Consolidated 3-Column Master Dossier into `#dnd35e-sheet-body`.
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

  const theme = getConsoleThemeMode();
  const shell = document.createElement('div');
  shell.className = 'crpg-prototype-shell';
  shell.setAttribute('data-console-theme', theme);

  // 1. Top Toolbar: Skin Switcher + Reactive Morphology Inspector
  const topBar = document.createElement('div');
  topBar.className = 'crpg-top-toolbar';

  const morphGroup = document.createElement('div');
  morphGroup.className = 'crpg-theme-switch-group';
  const morphLabel = document.createElement('span');
  morphLabel.className = 'crpg-top-toolbar-title';
  morphLabel.textContent = 'Anatomy:';
  morphGroup.appendChild(morphLabel);

  const currentMorph = getSheetMorphologyMode();
  for (const opt of MORPHOLOGY_OPTIONS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `crpg-theme-btn ${currentMorph === opt.id ? 'active-parchment' : ''}`;
    btn.textContent = opt.label;
    btn.addEventListener('click', () => {
      setSheetMorphologyMode(opt.id);
      renderDnD35eSheetModal(getGameState() ?? liveState);
    });
    morphGroup.appendChild(btn);
  }

  const skinGroup = document.createElement('div');
  skinGroup.className = 'crpg-theme-switch-group';

  const btnParchment = document.createElement('button');
  btnParchment.type = 'button';
  btnParchment.className = `crpg-theme-btn ${theme === 'parchment' ? 'active-parchment' : ''}`;
  btnParchment.textContent = '📜 Parchment Tabletop';
  btnParchment.addEventListener('click', () => {
    setConsoleThemeMode('parchment');
    renderDnD35eSheetModal(getGameState() ?? liveState);
  });

  const btnCrt = document.createElement('button');
  btnCrt.type = 'button';
  btnCrt.className = `crpg-theme-btn ${theme === 'retro-crt' ? 'active-crt' : ''}`;
  btnCrt.textContent = '📟 Retro CRT';
  btnCrt.addEventListener('click', () => {
    setConsoleThemeMode('retro-crt');
    renderDnD35eSheetModal(getGameState() ?? liveState);
  });

  skinGroup.append(btnParchment, btnCrt);
  topBar.append(morphGroup, skinGroup);
  shell.appendChild(topBar);

  // 2. Consolidated 3-Column Master Dossier Grid
  const grid = document.createElement('div');
  grid.className = 'crpg-three-col-grid';

  renderSheetOverviewTab(grid, liveState, playerId);
  renderSheetFeatsAndFeaturesTab(grid, liveState, playerId);
  renderSheetSkillsTab(grid, liveState, playerId);

  shell.appendChild(grid);

  // 3. Bottom NWN2 Tactical Modes & 12-Slot Hotbar Dock
  const dndData = getDnD35EntityData(liveState, playerId);
  const docComp = getComponent(liveState, playerId, ComponentType.TacticalDoctrine) as
    TacticalDoctrineComponent | undefined;
  const baseStances = dndAdapter.getStanceActions(dndData);
  const liveStances = baseStances.map((s) => ({
    ...s,
    isActive:
      s.id === 'power_attack'
        ? (docComp?.powerAttackAmount ?? 0) > 0
        : s.id === 'fighting_defensively'
          ? (docComp?.fightingDefensively ?? false)
          : s.id === 'total_defense'
            ? (docComp?.totalDefense ?? false)
            : s.isActive
  }));

  const hotbarRoot = document.createElement('div');
  renderConsoleHotbar(hotbarRoot, DEFAULT_HOTBAR_SLOTS, liveStances, {
    onChangeBank: () => {
      renderDnD35eSheetModal(getGameState() ?? liveState);
    },
    onExecuteSlot: () => {
      markAllDomainsDirty();
    },
    onToggleStance: (stanceId: string) => {
      handleStanceToggle(getGameState() ?? liveState, playerId, stanceId);
    }
  });
  shell.appendChild(hotbarRoot);

  content.appendChild(shell);
}
