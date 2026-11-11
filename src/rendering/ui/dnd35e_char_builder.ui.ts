/**
 * @file D&D 3.5e 7-Step Character Creation Wizard Modal (Milestone 112.5).
 * Full-screen 2-pane layout with scroll preservation, playable race filtering,
 * wizard prohibited school selection, and clean ability-method state transitions.
 */

import { getComponent } from '../../core/ecs.ts';
import { setGameState } from '../../core/game-loop.ts';
import { markAllDomainsDirty } from '../../core/presentation_queue.ts';
import { invalidateViewportSnapshot } from '../presenter.ts';
import { updateExploredTiles } from '../../systems/map.system.ts';
import { computeAbilityModifier } from '../../rulesets/dnd35e/abilities.ts';
import {
  applyCharacterCreationToPlayer,
  type CharacterCreationDraft,
  computeClassSpellSelectionBudget,
  sanitizeDraftOnRaceOrClassChange,
  validateCharacterCreationStep
} from '../../rulesets/dnd35e/character_builder.ts';
import { type DnD35SystemContent, getDnD35SystemContent } from '../../rulesets/dnd35e/types/dnd35e_system.types.ts';
import { ComponentType } from '../../types/components.types.ts';
import type { GameState } from '../../types/game-state.types.ts';
import { closeCartridgeModal, isCartridgeModalOpen } from './cartridge_ui_registry.ts';
import { renderClassStep } from './dnd35e_char_builder_class.ui.ts';
import { renderAbilityStep, renderRaceStep } from './dnd35e_char_builder_race_abilities.ui.ts';
import {
  renderCharBuilderEquipmentStep,
  renderCharBuilderFeatsStep,
  renderCharBuilderSkillsStep,
  renderCharBuilderSpellsStep
} from './dnd35e_char_builder_steps.ui.ts';

export * from './dnd35e_char_builder_class.ui.ts';
export * from './dnd35e_char_builder_race_abilities.ui.ts';

interface WizardStepDescriptor {
  readonly id: 'race' | 'class' | 'abilities' | 'skills' | 'feats' | 'spells' | 'equipment';
  readonly label: string;
}

function getActiveWizardSteps(
  draft: CharacterCreationDraft,
  sys: DnD35SystemContent
): ReadonlyArray<WizardStepDescriptor> {
  const cls = sys.classes[draft.classId];
  const race = sys.races[draft.raceId];
  const intMod = computeAbilityModifier((draft.baseAbilityScores.int ?? 10) + (race?.abilityAdjustments.int ?? 0));
  const spellBudget = cls
    ? computeClassSpellSelectionBudget(cls, 0, 1, intMod, draft.prohibitedSchools, draft.domains, [], sys)
    : undefined;
  const includeSpells = spellBudget?.requiresManualSelection === true;

  const baseSteps: WizardStepDescriptor[] = [
    { id: 'race', label: '1. Race' },
    { id: 'class', label: '2. Class & Paths' },
    { id: 'abilities', label: '3. Ability Scores' },
    { id: 'skills', label: '4. Skills' },
    { id: 'feats', label: '5. Feats' }
  ];
  if (includeSpells) {
    baseSteps.push({
      id: 'spells',
      label: `6. ${cls?.name ?? ''} Spells`.trim()
    });
    baseSteps.push({ id: 'equipment', label: '7. Equipment' });
  } else {
    baseSteps.push({ id: 'equipment', label: '6. Equipment' });
  }
  return baseSteps;
}

let currentStepIndex = 0;
let showMonstrousRaces = false;
let showNpcClasses = false;
let draftState: CharacterCreationDraft = createDefaultDraft();

function createDefaultDraft(): CharacterCreationDraft {
  return {
    raceId: 'human',
    classId: 'fighter',
    alignment: 'NG',
    selectedAcfs: [],
    domains: [],
    prohibitedSchools: [],
    abilityMethod: 'point_buy',
    pointBuyBudget: 28,
    baseAbilityScores: { str: 15, dex: 14, con: 14, int: 10, wis: 12, cha: 10 },
    skillRanks: {},
    selectedFeats: [],
    knownSpells: [],
    equipmentPackageId: 'martial_vanguard'
  };
}

function createQuickStartHeroDraft(): CharacterCreationDraft {
  return {
    ...createDefaultDraft(),
    skillRanks: { climb: 4, jump: 4, intimidate: 4 },
    selectedFeats: ['power_attack', 'cleave', 'improved_initiative']
  };
}

/** Captures scrollTop of all `[data-scroll-id]` containers inside root before re-render. */
export function captureScrollPositions(root: HTMLElement): ReadonlyMap<string, number> {
  const map = new Map<string, number>();
  const nodes = root.querySelectorAll<HTMLElement>('[data-scroll-id]');
  nodes.forEach((el) => {
    const id = el.dataset['scrollId'];
    if (id) map.set(id, el.scrollTop);
  });
  return map;
}

/** Restores scrollTop of all `[data-scroll-id]` containers inside root after re-render. */
export function restoreScrollPositions(root: HTMLElement, saved: ReadonlyMap<string, number>): void {
  const nodes = root.querySelectorAll<HTMLElement>('[data-scroll-id]');
  nodes.forEach((el) => {
    const id = el.dataset['scrollId'];
    if (id && saved.has(id)) {
      el.scrollTop = saved.get(id)!;
    }
  });
}

/**
 * Resets the character creation wizard draft state for a fresh campaign start.
 */
export function resetDnD35eCharBuilderDraft(_state: GameState): void {
  currentStepIndex = 0;
  showMonstrousRaces = false;
  showNpcClasses = false;
  draftState = createDefaultDraft();
}

/**
 * Renders the D&D 3.5e Character Creation overlay when `state.uiMode === UIMode.CharCreation`.
 */
export function renderDnD35eCharBuilderModal(state: GameState): void {
  const overlay = document.getElementById('char-creation-overlay');
  if (!overlay) return;

  if (!isCartridgeModalOpen(state, 'char_creation')) {
    overlay.classList.add('hidden');
    return;
  }

  overlay.classList.remove('hidden');
  const content = document.getElementById('char-creation-body');
  if (!content) return;

  const savedScrolls = captureScrollPositions(content);
  content.replaceChildren();

  const sys = getDnD35SystemContent(state.campaign);
  const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined);
  if (!sys || playerId === undefined) {
    const fallbackBtn = document.createElement('button');
    fallbackBtn.className = 'modal-btn';
    fallbackBtn.textContent = 'Continue to Dungeon';
    fallbackBtn.addEventListener('click', () => {
      setGameState(closeCartridgeModal(state));
      markAllDomainsDirty();
    });
    content.appendChild(fallbackBtn);
    return;
  }

  const activeSteps = getActiveWizardSteps(draftState, sys);
  if (currentStepIndex >= activeSteps.length) {
    currentStepIndex = activeSteps.length - 1;
  }
  const activeStep = activeSteps[currentStepIndex] ?? activeSteps[0]!;
  const currentStepCheck = validateCharacterCreationStep(draftState, activeStep.id, sys);

  const canNavigateToStep = (targetIdx: number): boolean => {
    if (targetIdx <= currentStepIndex) return true;
    for (let i = 0; i < targetIdx; i++) {
      const st = activeSteps[i];
      if (st && !validateCharacterCreationStep(draftState, st.id, sys).valid) {
        return false;
      }
    }
    return true;
  };

  const stepBar = document.createElement('div');
  stepBar.style.display = 'flex';
  stepBar.style.gap = '6px';
  stepBar.style.flexWrap = 'wrap';
  activeSteps.forEach((stepDesc, idx) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'modal-btn';
    tab.style.padding = '6px 12px';
    tab.style.fontSize = '0.8rem';
    const stepValid = validateCharacterCreationStep(draftState, stepDesc.id, sys).valid;
    tab.style.borderColor = idx === currentStepIndex ? '#f1c40f' : stepValid ? 'var(--border-color)' : '#e67e22';
    tab.textContent = stepDesc.label;
    tab.disabled = !canNavigateToStep(idx);
    tab.addEventListener('click', () => {
      if (!canNavigateToStep(idx)) return;
      currentStepIndex = idx;
      renderDnD35eCharBuilderModal(state);
    });
    stepBar.appendChild(tab);
  });
  content.appendChild(stepBar);

  const stageHost = document.createElement('div');
  stageHost.style.flex = '1';
  stageHost.style.minHeight = '0';
  stageHost.style.display = 'flex';
  stageHost.style.flexDirection = 'column';
  stageHost.style.overflow = 'hidden';

  const updateDraft = (next: CharacterCreationDraft): void => {
    draftState = sanitizeDraftOnRaceOrClassChange(next, sys);
    renderDnD35eCharBuilderModal(state);
  };

  if (activeStep.id === 'race') {
    renderRaceStep(
      stageHost,
      state,
      draftState,
      showMonstrousRaces,
      () => {
        showMonstrousRaces = !showMonstrousRaces;
        renderDnD35eCharBuilderModal(state);
      },
      updateDraft
    );
  } else if (activeStep.id === 'class') {
    renderClassStep(
      stageHost,
      state,
      draftState,
      showNpcClasses,
      () => {
        showNpcClasses = !showNpcClasses;
        renderDnD35eCharBuilderModal(state);
      },
      updateDraft
    );
  } else if (activeStep.id === 'abilities') {
    renderAbilityStep(stageHost, state, draftState, updateDraft);
  } else if (activeStep.id === 'skills') {
    renderCharBuilderSkillsStep(stageHost, state, draftState, updateDraft);
  } else if (activeStep.id === 'feats') {
    renderCharBuilderFeatsStep(stageHost, state, draftState, updateDraft);
  } else if (activeStep.id === 'spells') {
    renderCharBuilderSpellsStep(stageHost, state, draftState, updateDraft);
  } else {
    renderCharBuilderEquipmentStep(stageHost, draftState, updateDraft, sys);
  }

  content.appendChild(stageHost);

  if (!currentStepCheck.valid && currentStepCheck.reason) {
    const gateBanner = document.createElement('div');
    gateBanner.style.padding = '5px 10px';
    gateBanner.style.fontSize = '0.78rem';
    gateBanner.style.color = 'var(--crpg-warning, #f39c12)';
    gateBanner.style.border = '1px solid var(--crpg-warning, #e67e22)';
    gateBanner.style.background = 'rgba(230, 126, 34, 0.12)';
    gateBanner.textContent = `⚠ Required before proceeding: ${currentStepCheck.reason}`;
    content.appendChild(gateBanner);
  }

  const footer = document.createElement('div');
  footer.style.display = 'flex';
  footer.style.justifyContent = 'space-between';
  footer.style.gap = '8px';
  footer.style.paddingTop = '6px';
  footer.style.borderTop = '1px solid var(--crpg-border-subtle, #333947)';

  const quickBtn = document.createElement('button');
  quickBtn.type = 'button';
  quickBtn.className = 'modal-btn';
  quickBtn.textContent = '⚡ Quick Start Default Hero';
  quickBtn.addEventListener('click', () => {
    let nextState = applyCharacterCreationToPlayer(state, playerId, createQuickStartHeroDraft());
    nextState = updateExploredTiles(nextState);
    setGameState(closeCartridgeModal(nextState));
    invalidateViewportSnapshot();
    markAllDomainsDirty();
  });

  const navRight = document.createElement('div');
  navRight.style.display = 'flex';
  navRight.style.gap = '8px';

  if (currentStepIndex > 0) {
    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'modal-btn';
    prevBtn.textContent = '← Previous';
    prevBtn.addEventListener('click', () => {
      currentStepIndex--;
      renderDnD35eCharBuilderModal(state);
    });
    navRight.appendChild(prevBtn);
  }

  if (currentStepIndex < activeSteps.length - 1) {
    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'modal-btn';
    nextBtn.textContent = 'Next Step →';
    nextBtn.disabled = !currentStepCheck.valid;
    nextBtn.addEventListener('click', () => {
      if (!currentStepCheck.valid) return;
      currentStepIndex++;
      renderDnD35eCharBuilderModal(state);
    });
    navRight.appendChild(nextBtn);
  } else {
    const allStepsValid = activeSteps.every((st) => validateCharacterCreationStep(draftState, st.id, sys).valid);
    const finishBtn = document.createElement('button');
    finishBtn.type = 'button';
    finishBtn.className = 'modal-btn';
    finishBtn.style.borderColor = allStepsValid ? 'var(--crpg-success, #2ecc71)' : 'var(--border-color)';
    finishBtn.textContent = '✔ Embark into the Dungeon';
    finishBtn.disabled = !allStepsValid;
    finishBtn.addEventListener('click', () => {
      if (!allStepsValid) return;
      let nextState = applyCharacterCreationToPlayer(state, playerId, draftState);
      nextState = updateExploredTiles(nextState);
      setGameState(closeCartridgeModal(nextState));
      invalidateViewportSnapshot();
      markAllDomainsDirty();
    });
    navRight.appendChild(finishBtn);
  }

  footer.appendChild(quickBtn);
  footer.appendChild(navRight);
  content.appendChild(footer);

  restoreScrollPositions(content, savedScrolls);
}
