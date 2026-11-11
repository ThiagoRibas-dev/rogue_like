/**
 * @file D&D 3.5e Vancian Spellbook & Preparation Grimoire Modal (Milestone 118 / Phase 26).
 * Multi-class tabbed grimoire showing Spell Level 0-9 slots, domain bonus slots,
 * prepared spells with cast/unprepare/convert buttons, and 8-hour rest recovery.
 */

import { getComponent } from '../../core/ecs.ts';
import { getGameState } from '../../core/game-loop.ts';
import { ComponentType } from '../../types/components.types.ts';
import type { GameState } from '../../types/game-state.types.ts';
import { computeClassLevelSlotSummaries, reconcilePreparedSlots } from '../../rulesets/dnd35e/magic/spellbook_slots.ts';
import { getDnD35EntityData } from '../../rulesets/dnd35e/srd_registry.ts';
import { getDnD35SystemContent } from '../../rulesets/dnd35e/types/dnd35e_system.types.ts';
import { applyRestAction } from './dnd35e_spellbook_actions.ts';
import { renderPreparedSlotsPane, renderSpontaneousSlotsPane } from './dnd35e_spellbook_panes.ui.ts';
import { renderKnownSpellsPane } from './dnd35e_spellbook_known.ui.ts';

let selectedClassTab: string | undefined;
let selectedLevelFilter = -1; // -1 = All levels

/**
 * Renders the Vancian Spellbook modal dialog into `#dnd35e-spellbook-body`.
 */
export function renderDnD35eSpellbookModal(state: GameState): void {
  const overlay = document.getElementById('dnd35e-spellbook-overlay');
  if (!overlay) return;

  const content = document.getElementById('dnd35e-spellbook-body');
  if (!content) return;

  content.replaceChildren();

  const liveState = getGameState() ?? state;
  const playerId = liveState.entities.find((id) => getComponent(liveState, id, ComponentType.Player) !== undefined);
  if (playerId === undefined) {
    const empty = document.createElement('div');
    empty.className = 'status-empty';
    empty.textContent = 'No player entity found.';
    content.appendChild(empty);
    return;
  }

  const dndData = getDnD35EntityData(liveState, playerId);
  const sys = getDnD35SystemContent(liveState.campaign);
  const spellRegistry = sys?.spells ?? {};
  const classBooks = dndData.spellbooksByClass ?? {};
  const classIds = Object.keys(classBooks);

  if (classIds.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'status-empty';
    empty.textContent = 'This character possesses no spellcasting classes or grimoires.';
    content.appendChild(empty);

    const restBtn = document.createElement('button');
    restBtn.type = 'button';
    restBtn.className = 'modal-btn';
    restBtn.style.marginTop = '16px';
    restBtn.textContent = '💤 Take 8-Hour Rest';
    restBtn.addEventListener('click', () => {
      applyRestAction(liveState, playerId);
      renderDnD35eSpellbookModal(getGameState() ?? liveState);
    });
    content.appendChild(restBtn);
    return;
  }

  if (!selectedClassTab || !classBooks[selectedClassTab]) {
    selectedClassTab = classIds[0]!;
  }

  // Compute active book slot summaries
  let activeBook = classBooks[selectedClassTab]!;
  const summaries = computeClassLevelSlotSummaries(activeBook, dndData, dndData.abilityScores, sys ?? undefined);

  // Initialize/reconcile preparedSlots if needed
  if (activeBook.castingMode === 'prepared') {
    const reconciled = reconcilePreparedSlots(activeBook, summaries, spellRegistry);
    activeBook = { ...activeBook, preparedSlots: reconciled };
  }

  // 1. Top Bar: Class Tabs & Rest Action
  const topBar = document.createElement('div');
  topBar.className = 'spellbook-top-bar';
  topBar.style.display = 'flex';
  topBar.style.justifyContent = 'space-between';
  topBar.style.alignItems = 'center';
  topBar.style.gap = '8px';
  topBar.style.padding = '8px 12px';
  topBar.style.background = 'var(--crpg-bg-panel, rgba(232, 224, 207, 0.94))';
  topBar.style.borderBottom = '1px solid var(--crpg-border-inner, #a69478)';

  const tabContainer = document.createElement('div');
  tabContainer.className = 'spellbook-class-tabs';
  tabContainer.style.display = 'flex';
  tabContainer.style.gap = '6px';
  for (const cid of classIds) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = cid === selectedClassTab ? 'dnd35-tab-btn active' : 'dnd35-tab-btn';
    btn.textContent = `${cid.toUpperCase()} (${classBooks[cid]!.castingMode})`;
    btn.addEventListener('click', () => {
      selectedClassTab = cid;
      renderDnD35eSpellbookModal(getGameState() ?? liveState);
    });
    tabContainer.appendChild(btn);
  }
  topBar.appendChild(tabContainer);

  const restBtn = document.createElement('button');
  restBtn.type = 'button';
  restBtn.className = 'modal-btn spellbook-rest-btn';
  restBtn.textContent = '💤 8-Hour Rest';
  restBtn.title = 'Refresh daily spell slots and restore vital vitality';
  restBtn.addEventListener('click', () => {
    applyRestAction(liveState, playerId);
    renderDnD35eSpellbookModal(getGameState() ?? liveState);
  });
  topBar.appendChild(restBtn);

  content.appendChild(topBar);

  // 2. Spell Level Filter Strip
  const filterStrip = document.createElement('div');
  filterStrip.className = 'spellbook-level-filter-bar';
  filterStrip.style.display = 'flex';
  filterStrip.style.gap = '6px';
  filterStrip.style.padding = '6px 12px';
  filterStrip.style.background = 'var(--crpg-bg-card, rgba(235, 227, 212, 0.96))';
  filterStrip.style.borderBottom = '1px solid var(--crpg-border-inner, #a69478)';

  const allLevelsBtn = document.createElement('button');
  allLevelsBtn.type = 'button';
  allLevelsBtn.className = selectedLevelFilter === -1 ? 'dnd35-tab-btn active' : 'dnd35-tab-btn';
  allLevelsBtn.textContent = 'All Spell Levels';
  allLevelsBtn.addEventListener('click', () => {
    selectedLevelFilter = -1;
    renderDnD35eSpellbookModal(getGameState() ?? liveState);
  });
  filterStrip.appendChild(allLevelsBtn);

  for (const sum of summaries) {
    if (!sum.canCast) continue;
    const lvlBtn = document.createElement('button');
    lvlBtn.type = 'button';
    lvlBtn.className = selectedLevelFilter === sum.spellLevel ? 'dnd35-tab-btn active' : 'dnd35-tab-btn';
    lvlBtn.textContent = `Level ${sum.spellLevel} (${sum.totalSlots} slots • DC ${sum.saveDc})`;
    lvlBtn.addEventListener('click', () => {
      selectedLevelFilter = sum.spellLevel;
      renderDnD35eSpellbookModal(getGameState() ?? liveState);
    });
    filterStrip.appendChild(lvlBtn);
  }
  content.appendChild(filterStrip);

  // 3. Main 2-Pane Grimoire Stage
  const mainStage = document.createElement('div');
  mainStage.className = 'dnd35-two-pane-stage';
  mainStage.style.flex = '1';
  mainStage.style.minHeight = '0';
  mainStage.style.padding = '12px';
  mainStage.style.gap = '12px';

  // Left Pane: Prepared Slots (or Spontaneous Casts Matrix)
  const leftPane = document.createElement('div');
  leftPane.className = 'dnd35-pane-left';
  leftPane.style.overflowY = 'auto';

  const leftTitle = document.createElement('h3');
  leftTitle.className = 'crpg-section-heading';
  leftTitle.textContent =
    activeBook.castingMode === 'prepared' ? 'Memorized Spell Slots' : 'Daily Spell Casts Remaining';
  leftPane.appendChild(leftTitle);

  const filteredSummaries = summaries.filter(
    (s) => s.canCast && (selectedLevelFilter === -1 || s.spellLevel === selectedLevelFilter)
  );

  if (activeBook.castingMode === 'prepared') {
    renderPreparedSlotsPane(
      leftPane,
      liveState,
      playerId,
      selectedClassTab,
      activeBook,
      filteredSummaries,
      spellRegistry,
      dndData,
      sys ?? undefined
    );
  } else {
    renderSpontaneousSlotsPane(leftPane, activeBook, filteredSummaries);
  }

  // Right Pane: Available / Known Spells by Level
  const rightPane = document.createElement('div');
  rightPane.className = 'dnd35-pane-right';
  rightPane.style.overflowY = 'auto';

  const rightTitle = document.createElement('h3');
  rightTitle.className = 'crpg-section-heading';
  rightTitle.textContent = activeBook.castingMode === 'prepared' ? 'Known Spells & Prayerbook' : 'Known Spells';
  rightPane.appendChild(rightTitle);

  renderKnownSpellsPane(
    rightPane,
    liveState,
    playerId,
    selectedClassTab,
    activeBook,
    filteredSummaries,
    spellRegistry,
    dndData,
    sys ?? undefined
  );

  mainStage.append(leftPane, rightPane);
  content.appendChild(mainStage);
}
