/**
 * @file D&D 3.5e Vancian Spellbook & Preparation Grimoire Modal (Milestone 118).
 * Multi-class tabbed grimoire showing Spell Level 0-9 slots, domain bonus slots,
 * prepared spells with cast/unprepare buttons, and 8-hour rest recovery.
 */

import { getComponent } from '../../core/ecs.ts';
import { setGameState } from '../../core/game-loop.ts';
import { markAllDomainsDirty } from '../../core/presentation_queue.ts';
import { getDnD35EntityData, getDnD35SystemContent } from '../../rulesets/registry.ts';
import { ComponentType } from '../../types/components.types.ts';
import type { GameState } from '../../types/game-state.types.ts';
import { applyRestAction, prepareSpellIntoSlot, unprepareSpellSlot } from './dnd35e_spellbook_actions.ts';

let selectedClassTab: string | undefined;

/**
 * Renders the Vancian Spellbook modal dialog into `#dnd35e-spellbook-body`.
 */
export function renderDnD35eSpellbookModal(state: GameState): void {
  const overlay = document.getElementById('dnd35e-spellbook-overlay');
  if (!overlay) return;

  const content = document.getElementById('dnd35e-spellbook-body');
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

  const dndData = getDnD35EntityData(state, playerId);
  const sys = getDnD35SystemContent(state.campaign);
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
      applyRestAction(state, playerId);
      renderDnD35eSpellbookModal(state);
    });
    content.appendChild(restBtn);
    return;
  }

  if (!selectedClassTab || !classBooks[selectedClassTab]) {
    selectedClassTab = classIds[0]!;
  }

  // 1. Top Bar: Class Tabs & Rest Action
  const topBar = document.createElement('div');
  topBar.className = 'spellbook-top-bar';

  const tabContainer = document.createElement('div');
  tabContainer.className = 'spellbook-class-tabs';
  for (const cid of classIds) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = cid === selectedClassTab ? 'dnd35-tab-btn active' : 'dnd35-tab-btn';
    btn.textContent = cid.toUpperCase();
    btn.addEventListener('click', () => {
      selectedClassTab = cid;
      renderDnD35eSpellbookModal(state);
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
    applyRestAction(state, playerId);
    renderDnD35eSpellbookModal(state);
  });
  topBar.appendChild(restBtn);

  content.appendChild(topBar);

  // 2. Active Class Grimoire Pane
  const activeBook = classBooks[selectedClassTab]!;
  const pane = document.createElement('div');
  pane.className = 'spellbook-grimoire-pane';

  // Prepared Spell Slots Section
  const prepSection = document.createElement('div');
  prepSection.className = 'spellbook-section';
  const prepTitle = document.createElement('h3');
  prepTitle.textContent = 'Prepared Spells & Slots';
  prepSection.appendChild(prepTitle);

  const prepList = document.createElement('div');
  prepList.className = 'sheet-cards-list';
  if (activeBook.preparedSpellIds.length === 0) {
    const emptyPrep = document.createElement('div');
    emptyPrep.className = 'status-empty';
    emptyPrep.textContent = 'No spells currently prepared.';
    prepList.appendChild(emptyPrep);
  } else {
    activeBook.preparedSpellIds.forEach((spId, idx) => {
      const spDef = spellRegistry[spId];
      const row = document.createElement('div');
      row.className = 'sheet-detail-card spell-slot-card';

      const label = document.createElement('strong');
      label.textContent = spDef?.name ?? spId;
      row.appendChild(label);

      const unprepBtn = document.createElement('button');
      unprepBtn.type = 'button';
      unprepBtn.className = 'skill-use-btn';
      unprepBtn.textContent = 'Unprepare';
      unprepBtn.addEventListener('click', () => {
        const next = unprepareSpellSlot(state, playerId, selectedClassTab!, idx);
        setGameState(next);
        markAllDomainsDirty();
      });
      row.appendChild(unprepBtn);

      prepList.appendChild(row);
    });
  }
  prepSection.appendChild(prepList);
  pane.appendChild(prepSection);

  // Known / Available Spells to Prepare Section
  const knownSection = document.createElement('div');
  knownSection.className = 'spellbook-section';
  const knownTitle = document.createElement('h3');
  knownTitle.textContent = 'Known Spells (Click to Prepare)';
  knownSection.appendChild(knownTitle);

  const knownList = document.createElement('div');
  knownList.className = 'sheet-cards-list';
  for (const spId of activeBook.knownSpellIds) {
    const spDef = spellRegistry[spId];
    const row = document.createElement('div');
    row.className = 'sheet-detail-card spell-slot-card';

    const info = document.createElement('div');
    const nameStrong = document.createElement('strong');
    nameStrong.textContent = spDef?.name ?? spId;
    info.appendChild(nameStrong);

    const lvlBadge = document.createElement('span');
    lvlBadge.className = 'badge-feat';
    lvlBadge.textContent = ` Scroll/School: ${spDef?.school ?? 'universal'}`;
    info.appendChild(lvlBadge);
    row.appendChild(info);

    const prepBtn = document.createElement('button');
    prepBtn.type = 'button';
    prepBtn.className = 'skill-use-btn';
    prepBtn.textContent = 'Prepare';
    prepBtn.addEventListener('click', () => {
      const next = prepareSpellIntoSlot(state, playerId, selectedClassTab!, spId);
      setGameState(next);
      markAllDomainsDirty();
    });
    row.appendChild(prepBtn);

    knownList.appendChild(row);
  }
  knownSection.appendChild(knownList);
  pane.appendChild(knownSection);

  content.appendChild(pane);
}
