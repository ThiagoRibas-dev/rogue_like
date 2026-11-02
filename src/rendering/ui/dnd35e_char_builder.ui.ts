/**
 * @file D&D 3.5e 7-Step Character Creation Wizard Modal (Milestone 112.5).
 * Full-screen 2-pane layout with scroll preservation, playable race filtering,
 * wizard prohibited school selection, and clean ability-method state transitions.
 */

import { getComponent } from '../../core/ecs.ts';
import { setGameState } from '../../core/game-loop.ts';
import { markAllDomainsDirty } from '../../core/presentation_queue.ts';
import {
  ALL_ABILITY_IDS,
  applyCharacterCreationToPlayer,
  calculateLevelSkillPointBudget,
  calculatePointBuyCost,
  type CharacterCreationDraft,
  computeAbilityModifier,
  type DnD35Alignment,
  type DnD35SpellSchool,
  ELITE_ABILITY_ARRAY,
  getDnD35SystemContent,
  POINT_BUY_MAX_SCORE,
  POINT_BUY_MIN_SCORE,
  POINT_BUY_PRESETS,
  rollAbilityScores4d6DropLowest,
  sanitizeDraftOnRaceOrClassChange,
  validateSpecialistSchoolSelection
} from '../../rulesets/registry.ts';
import { ComponentType } from '../../types/components.types.ts';
import { type GameState, UIMode } from '../../types/game-state.types.ts';
import {
  renderCharBuilderEquipmentStep,
  renderCharBuilderFeatsStep,
  renderCharBuilderSkillsStep,
  renderCharBuilderSpellsStep
} from './dnd35e_char_builder_steps.ui.ts';
import { renderRaceInspector } from './dnd35e_inspector.ui.ts';

const WIZARD_STEPS: ReadonlyArray<string> = [
  '1. Race',
  '2. Class & Paths',
  '3. Ability Scores',
  '4. Skills',
  '5. Feats',
  '6. Spells',
  '7. Equipment'
];

const SPELL_SCHOOLS: ReadonlyArray<DnD35SpellSchool> = [
  'abjuration',
  'conjuration',
  'divination',
  'enchantment',
  'evocation',
  'illusion',
  'necromancy',
  'transmutation',
  'universal'
];
const ALL_ALIGNMENTS: ReadonlyArray<DnD35Alignment> = ['LG', 'NG', 'CG', 'LN', 'N', 'CN', 'LE', 'NE', 'CE'];
const FAVORED_ENEMY_TYPES: ReadonlyArray<string> = [
  'undead',
  'goblinoid',
  'orc',
  'giant',
  'dragon',
  'magical_beast',
  'outsider',
  'aberration',
  'construct'
];

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
    baseAbilityScores: { str: 15, dex: 13, con: 14, int: 10, wis: 12, cha: 10 },
    skillRanks: { climb: 4, jump: 4, intimidate: 4 },
    selectedFeats: ['power_attack', 'cleave', 'improved_initiative'],
    knownSpells: [],
    equipmentPackageId: 'martial_vanguard'
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

  if (state.uiMode !== UIMode.CharCreation) {
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
      setGameState({ ...state, uiMode: UIMode.Game });
      markAllDomainsDirty();
    });
    content.appendChild(fallbackBtn);
    return;
  }

  // Step tabs bar
  const stepBar = document.createElement('div');
  stepBar.style.display = 'flex';
  stepBar.style.gap = '6px';
  stepBar.style.flexWrap = 'wrap';
  WIZARD_STEPS.forEach((label, idx) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'modal-btn';
    tab.style.padding = '6px 12px';
    tab.style.fontSize = '0.8rem';
    tab.style.borderColor = idx === currentStepIndex ? '#f1c40f' : 'var(--border-color)';
    tab.textContent = label;
    tab.addEventListener('click', () => {
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

  if (currentStepIndex === 0) renderRaceStep(stageHost, state, updateDraft);
  else if (currentStepIndex === 1) renderClassStep(stageHost, state, updateDraft);
  else if (currentStepIndex === 2) renderAbilityStep(stageHost, state, updateDraft);
  else if (currentStepIndex === 3) renderCharBuilderSkillsStep(stageHost, state, draftState, updateDraft);
  else if (currentStepIndex === 4) renderCharBuilderFeatsStep(stageHost, state, draftState, updateDraft);
  else if (currentStepIndex === 5) renderCharBuilderSpellsStep(stageHost, state, draftState, updateDraft);
  else renderCharBuilderEquipmentStep(stageHost, draftState, updateDraft);

  content.appendChild(stageHost);

  // Footer navigation
  const footer = document.createElement('div');
  footer.style.display = 'flex';
  footer.style.justifyContent = 'space-between';
  footer.style.gap = '8px';
  footer.style.paddingTop = '6px';
  footer.style.borderTop = '1px solid #333947';

  const quickBtn = document.createElement('button');
  quickBtn.type = 'button';
  quickBtn.className = 'modal-btn';
  quickBtn.textContent = '⚡ Quick Start Default Hero';
  quickBtn.addEventListener('click', () => {
    const nextState = applyCharacterCreationToPlayer(state, playerId, createDefaultDraft());
    setGameState({ ...nextState, uiMode: UIMode.Game });
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

  if (currentStepIndex < WIZARD_STEPS.length - 1) {
    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'modal-btn';
    nextBtn.textContent = 'Next Step →';
    nextBtn.addEventListener('click', () => {
      currentStepIndex++;
      renderDnD35eCharBuilderModal(state);
    });
    navRight.appendChild(nextBtn);
  } else {
    const finishBtn = document.createElement('button');
    finishBtn.type = 'button';
    finishBtn.className = 'modal-btn';
    finishBtn.style.borderColor = '#2ecc71';
    finishBtn.textContent = '✔ Embark into the Dungeon';
    finishBtn.addEventListener('click', () => {
      const nextState = applyCharacterCreationToPlayer(state, playerId, draftState);
      setGameState({ ...nextState, uiMode: UIMode.Game });
      markAllDomainsDirty();
    });
    navRight.appendChild(finishBtn);
  }

  footer.appendChild(quickBtn);
  footer.appendChild(navRight);
  content.appendChild(footer);

  restoreScrollPositions(content, savedScrolls);
}

function renderRaceStep(
  container: HTMLElement,
  state: GameState,
  updateDraft: (next: CharacterCreationDraft) => void
): void {
  const sys = getDnD35SystemContent(state.campaign);
  if (!sys) return;

  const stage = document.createElement('div');
  stage.className = 'dnd35-two-pane-stage';

  const leftPane = document.createElement('div');
  leftPane.className = 'dnd35-pane-left';
  leftPane.dataset['scrollId'] = 'char-race-left';

  const rightPane = document.createElement('div');
  rightPane.className = 'dnd35-pane-right';
  rightPane.dataset['scrollId'] = 'char-race-right';

  const allRaces = Object.values(sys.races);
  const playableCount = allRaces.filter((r) => r.isPlayableRace).length;

  const filterBar = document.createElement('div');
  filterBar.className = 'dnd35-filter-bar';
  const countSpan = document.createElement('span');
  countSpan.style.fontSize = '0.78rem';
  countSpan.textContent = showMonstrousRaces
    ? `Showing All Races (${allRaces.length})`
    : `Playable Races (${playableCount})`;
  filterBar.appendChild(countSpan);

  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'modal-btn';
  toggleBtn.style.padding = '3px 8px';
  toggleBtn.style.fontSize = '0.72rem';
  toggleBtn.style.borderColor = showMonstrousRaces ? '#f1c40f' : 'var(--border-color)';
  toggleBtn.textContent = showMonstrousRaces ? 'Hide Monstrous Races' : 'Show Monstrous Races';
  toggleBtn.addEventListener('click', () => {
    showMonstrousRaces = !showMonstrousRaces;
    renderDnD35eCharBuilderModal(state);
  });
  filterBar.appendChild(toggleBtn);
  leftPane.appendChild(filterBar);

  const visibleRaces = showMonstrousRaces ? allRaces : allRaces.filter((r) => r.isPlayableRace);
  for (const race of visibleRaces) {
    const isSelected = draftState.raceId === race.id;
    const row = document.createElement('div');
    row.className = `dnd35-list-item${isSelected ? ' selected' : ''}`;
    row.addEventListener('click', () => {
      updateDraft({ ...draftState, raceId: race.id });
    });

    const nameSpan = document.createElement('strong');
    nameSpan.textContent = race.name;
    const metaSpan = document.createElement('span');
    metaSpan.style.fontSize = '0.75rem';
    metaSpan.style.color = '#9da7b3';
    const laText = race.levelAdjustment > 0 ? ` • LA +${race.levelAdjustment}` : '';
    metaSpan.textContent = `${race.size.toUpperCase()} • ${race.baseLandSpeedFt}ft${laText}`;

    row.appendChild(nameSpan);
    row.appendChild(metaSpan);
    leftPane.appendChild(row);
  }

  const activeRace = sys.races[draftState.raceId] ?? visibleRaces[0];
  if (activeRace) {
    renderRaceInspector(rightPane, activeRace);
  }

  stage.appendChild(leftPane);
  stage.appendChild(rightPane);
  container.appendChild(stage);
}

function renderClassStep(
  container: HTMLElement,
  state: GameState,
  updateDraft: (next: CharacterCreationDraft) => void
): void {
  const sys = getDnD35SystemContent(state.campaign);
  if (!sys) return;

  const stage = document.createElement('div');
  stage.className = 'dnd35-two-pane-stage';

  const leftPane = document.createElement('div');
  leftPane.className = 'dnd35-pane-left';
  leftPane.dataset['scrollId'] = 'char-class-left';

  const rightPane = document.createElement('div');
  rightPane.className = 'dnd35-pane-right';
  rightPane.dataset['scrollId'] = 'char-class-right';

  const filterBar = document.createElement('div');
  filterBar.className = 'dnd35-filter-bar';
  const lbl = document.createElement('span');
  lbl.style.fontSize = '0.78rem';
  lbl.textContent = showNpcClasses ? 'Base & NPC Classes' : 'Core Base Classes (11)';
  const npcBtn = document.createElement('button');
  npcBtn.type = 'button';
  npcBtn.className = 'modal-btn';
  npcBtn.style.padding = '3px 8px';
  npcBtn.style.fontSize = '0.72rem';
  npcBtn.style.borderColor = showNpcClasses ? '#f1c40f' : 'var(--border-color)';
  npcBtn.textContent = showNpcClasses ? 'Hide NPC Classes' : 'Show NPC Classes';
  npcBtn.addEventListener('click', () => {
    showNpcClasses = !showNpcClasses;
    renderDnD35eCharBuilderModal(state);
  });
  filterBar.appendChild(lbl);
  filterBar.appendChild(npcBtn);
  leftPane.appendChild(filterBar);

  const classes = Object.values(sys.classes).filter((c) => !c.isPrestige && (showNpcClasses || !c.isNpcClass));
  for (const cls of classes) {
    const row1 = cls.progression[0] ?? { bab: 0, fortSave: 0, refSave: 0, willSave: 0 };
    const isSelected = draftState.classId === cls.id;
    const row = document.createElement('div');
    row.className = `dnd35-list-item${isSelected ? ' selected' : ''}`;
    row.addEventListener('click', () => {
      updateDraft({
        ...draftState,
        classId: cls.id,
        selectedAcfs: [],
        domains: [],
        prohibitedSchools: []
      });
    });

    const nameSpan = document.createElement('strong');
    nameSpan.textContent = cls.name;
    const metaSpan = document.createElement('span');
    metaSpan.style.fontSize = '0.75rem';
    metaSpan.style.color = '#9da7b3';
    metaSpan.textContent = `d${cls.hitDieSides} HD • BAB +${row1.bab} • ${cls.skillPointsPerLevel}+INT Skills`;
    row.appendChild(nameSpan);
    row.appendChild(metaSpan);
    leftPane.appendChild(row);
  }

  const activeCls = sys.classes[draftState.classId];
  if (activeCls) {
    const title = document.createElement('h3');
    title.style.margin = '0 0 4px 0';
    title.style.color = '#f1c40f';
    title.textContent = `${activeCls.name} (d${activeCls.hitDieSides} Hit Die)`;
    rightPane.appendChild(title);

    // Table preview levels 1..5
    const tablePreview = document.createElement('div');
    tablePreview.style.fontSize = '0.78rem';
    tablePreview.style.padding = '8px';
    tablePreview.style.background = 'rgba(0,0,0,0.35)';
    tablePreview.style.border = '1px solid #333947';
    for (const row of activeCls.progression.slice(0, 5)) {
      const rDiv = document.createElement('div');
      const featsStr = row.features.length > 0 ? ` [${row.features.join(', ')}]` : '';
      rDiv.textContent = `Lv ${row.level}: BAB +${row.bab} | Fort +${row.fortSave}, Ref +${row.refSave}, Will +${row.willSave}${featsStr}`;
      tablePreview.appendChild(rDiv);
    }
    rightPane.appendChild(tablePreview);

    // Alignment
    const alignRow = document.createElement('div');
    alignRow.style.display = 'flex';
    alignRow.style.flexWrap = 'wrap';
    alignRow.style.alignItems = 'center';
    alignRow.style.gap = '4px';
    const alignTitle = document.createElement('strong');
    alignTitle.textContent = 'Alignment: ';
    alignRow.appendChild(alignTitle);
    const allowed = activeCls.allowedAlignments ?? ALL_ALIGNMENTS;
    for (const align of allowed) {
      const aBtn = document.createElement('button');
      aBtn.type = 'button';
      aBtn.className = 'modal-btn';
      aBtn.style.padding = '4px 8px';
      aBtn.style.fontSize = '0.75rem';
      aBtn.style.borderColor = draftState.alignment === align ? '#f1c40f' : 'var(--border-color)';
      aBtn.textContent = align;
      aBtn.addEventListener('click', () => {
        updateDraft({ ...draftState, alignment: align });
      });
      alignRow.appendChild(aBtn);
    }
    rightPane.appendChild(alignRow);

    // ACFs
    for (const acf of activeCls.acfSwaps.filter((a) => a.level === 1)) {
      const isChecked = draftState.selectedAcfs.includes(acf.acfId);
      const acfBtn = document.createElement('button');
      acfBtn.type = 'button';
      acfBtn.className = 'modal-btn';
      acfBtn.style.fontSize = '0.78rem';
      acfBtn.style.borderColor = isChecked ? '#2ecc71' : 'var(--border-color)';
      acfBtn.textContent = `${isChecked ? '☑' : '☐'} [ACF] ${acf.name} (Replaces ${acf.replacesFeature} → ${acf.grantedFeature})`;
      acfBtn.addEventListener('click', () => {
        const nextAcfs = isChecked
          ? draftState.selectedAcfs.filter((id) => id !== acf.acfId)
          : [...draftState.selectedAcfs, acf.acfId];
        updateDraft({ ...draftState, selectedAcfs: nextAcfs });
      });
      rightPane.appendChild(acfBtn);
    }

    // Cleric Domains
    if (draftState.classId === 'cleric') {
      const domHeader = document.createElement('strong');
      domHeader.style.color = '#f1c40f';
      domHeader.textContent = `Cleric Domains (${draftState.domains.length} / 2 selected):`;
      rightPane.appendChild(domHeader);
      for (const dom of Object.values(sys.domains)) {
        const chosen = draftState.domains.includes(dom.id);
        const dRow = document.createElement('div');
        dRow.className = `dnd35-list-item${chosen ? ' selected' : ''}`;
        dRow.textContent = `${chosen ? '☑' : '☐'} ${dom.name} — ${dom.grantedPowerDescription}`;
        dRow.addEventListener('click', () => {
          const nextDomains = chosen
            ? draftState.domains.filter((d) => d !== dom.id)
            : draftState.domains.length < 2
              ? [...draftState.domains, dom.id]
              : draftState.domains;
          updateDraft({ ...draftState, domains: nextDomains });
        });
        rightPane.appendChild(dRow);
      }
    }

    // Wizard Arcane School & Prohibited Schools
    if (draftState.classId === 'wizard') {
      const activeSchool = draftState.arcaneSchool ?? 'universal';
      const specCheck = validateSpecialistSchoolSelection(activeSchool, draftState.prohibitedSchools);
      const specTitle = document.createElement('strong');
      specTitle.style.color = specCheck.valid ? '#2ecc71' : '#e67e22';
      specTitle.textContent = `Arcane School (${specCheck.valid ? 'Valid' : (specCheck.reason ?? 'Select prohibited schools')}):`;
      rightPane.appendChild(specTitle);

      const schoolWrap = document.createElement('div');
      schoolWrap.style.display = 'flex';
      schoolWrap.style.flexWrap = 'wrap';
      schoolWrap.style.gap = '4px';
      for (const school of SPELL_SCHOOLS) {
        const sBtn = document.createElement('button');
        sBtn.type = 'button';
        sBtn.className = 'modal-btn';
        sBtn.style.padding = '4px 8px';
        sBtn.style.fontSize = '0.74rem';
        sBtn.style.borderColor = activeSchool === school ? '#f1c40f' : 'var(--border-color)';
        sBtn.textContent = school;
        sBtn.addEventListener('click', () => {
          updateDraft({ ...draftState, arcaneSchool: school, prohibitedSchools: [] });
        });
        schoolWrap.appendChild(sBtn);
      }
      rightPane.appendChild(schoolWrap);

      if (activeSchool !== 'universal') {
        const reqCount = activeSchool === 'divination' ? 1 : 2;
        const prohibLabel = document.createElement('strong');
        prohibLabel.textContent = `Prohibited Schools (${draftState.prohibitedSchools.length} / ${reqCount}):`;
        rightPane.appendChild(prohibLabel);

        const prohibWrap = document.createElement('div');
        prohibWrap.style.display = 'flex';
        prohibWrap.style.flexWrap = 'wrap';
        prohibWrap.style.gap = '4px';
        for (const pSchool of SPELL_SCHOOLS) {
          if (pSchool === 'universal' || pSchool === 'divination' || pSchool === activeSchool) continue;
          const isProhib = draftState.prohibitedSchools.includes(pSchool);
          const pBtn = document.createElement('button');
          pBtn.type = 'button';
          pBtn.className = 'modal-btn';
          pBtn.style.padding = '4px 8px';
          pBtn.style.fontSize = '0.74rem';
          pBtn.style.borderColor = isProhib ? '#e74c3c' : 'var(--border-color)';
          pBtn.textContent = `${isProhib ? '✖ ' : ''}${pSchool}`;
          pBtn.addEventListener('click', () => {
            const nextProhib = isProhib
              ? draftState.prohibitedSchools.filter((s) => s !== pSchool)
              : draftState.prohibitedSchools.length < reqCount
                ? [...draftState.prohibitedSchools, pSchool]
                : draftState.prohibitedSchools;
            updateDraft({ ...draftState, prohibitedSchools: nextProhib });
          });
          prohibWrap.appendChild(pBtn);
        }
        rightPane.appendChild(prohibWrap);
      }
    }

    // Ranger Favored Enemy
    if (draftState.classId === 'ranger') {
      const feLabel = document.createElement('strong');
      feLabel.textContent = '1st Favored Enemy (+2 Bonus):';
      rightPane.appendChild(feLabel);
      const feWrap = document.createElement('div');
      feWrap.style.display = 'flex';
      feWrap.style.flexWrap = 'wrap';
      feWrap.style.gap = '4px';
      const curFe = draftState.favoredEnemyType ?? 'undead';
      for (const feType of FAVORED_ENEMY_TYPES) {
        const feBtn = document.createElement('button');
        feBtn.type = 'button';
        feBtn.className = 'modal-btn';
        feBtn.style.padding = '4px 8px';
        feBtn.style.fontSize = '0.74rem';
        feBtn.style.borderColor = curFe === feType ? '#f1c40f' : 'var(--border-color)';
        feBtn.textContent = feType;
        feBtn.addEventListener('click', () => {
          updateDraft({ ...draftState, favoredEnemyType: feType });
        });
        feWrap.appendChild(feBtn);
      }
      rightPane.appendChild(feWrap);
    }
  }

  stage.appendChild(leftPane);
  stage.appendChild(rightPane);
  container.appendChild(stage);
}

function renderAbilityStep(
  container: HTMLElement,
  state: GameState,
  updateDraft: (next: CharacterCreationDraft) => void
): void {
  const sys = getDnD35SystemContent(state.campaign);
  if (!sys) return;
  const race = sys.races[draftState.raceId];
  const cls = sys.classes[draftState.classId];

  const stage = document.createElement('div');
  stage.className = 'dnd35-two-pane-stage';

  const leftPane = document.createElement('div');
  leftPane.className = 'dnd35-pane-left';
  leftPane.dataset['scrollId'] = 'char-ability-left';

  const rightPane = document.createElement('div');
  rightPane.className = 'dnd35-pane-right';
  rightPane.dataset['scrollId'] = 'char-ability-right';

  const presetBar = document.createElement('div');
  presetBar.style.display = 'flex';
  presetBar.style.flexWrap = 'wrap';
  presetBar.style.gap = '6px';

  for (const pts of POINT_BUY_PRESETS) {
    const pBtn = document.createElement('button');
    pBtn.type = 'button';
    pBtn.className = 'modal-btn';
    pBtn.style.padding = '4px 9px';
    pBtn.style.fontSize = '0.75rem';
    const isThisPreset = draftState.abilityMethod === 'point_buy' && draftState.pointBuyBudget === pts;
    pBtn.style.borderColor = isThisPreset ? '#f1c40f' : 'var(--border-color)';
    pBtn.textContent = `Point Buy (${pts})`;
    pBtn.addEventListener('click', () => {
      const clampedScores = { ...draftState.baseAbilityScores };
      for (const k of ALL_ABILITY_IDS) {
        clampedScores[k] = Math.max(POINT_BUY_MIN_SCORE, Math.min(POINT_BUY_MAX_SCORE, clampedScores[k]));
      }
      updateDraft({
        ...draftState,
        abilityMethod: 'point_buy',
        pointBuyBudget: pts,
        baseAbilityScores: clampedScores
      });
    });
    presetBar.appendChild(pBtn);
  }

  const eliteBtn = document.createElement('button');
  eliteBtn.type = 'button';
  eliteBtn.className = 'modal-btn';
  eliteBtn.style.padding = '4px 9px';
  eliteBtn.style.fontSize = '0.75rem';
  eliteBtn.style.borderColor = draftState.abilityMethod === 'elite_array' ? '#f1c40f' : 'var(--border-color)';
  eliteBtn.textContent = 'Elite Array';
  eliteBtn.addEventListener('click', () => {
    updateDraft({
      ...draftState,
      abilityMethod: 'elite_array',
      baseAbilityScores: {
        str: ELITE_ABILITY_ARRAY[0] ?? 15,
        dex: ELITE_ABILITY_ARRAY[1] ?? 14,
        con: ELITE_ABILITY_ARRAY[2] ?? 13,
        int: ELITE_ABILITY_ARRAY[3] ?? 12,
        wis: ELITE_ABILITY_ARRAY[4] ?? 10,
        cha: ELITE_ABILITY_ARRAY[5] ?? 8
      }
    });
  });
  presetBar.appendChild(eliteBtn);

  const rollBtn = document.createElement('button');
  rollBtn.type = 'button';
  rollBtn.className = 'modal-btn';
  rollBtn.style.padding = '4px 9px';
  rollBtn.style.fontSize = '0.75rem';
  rollBtn.style.borderColor = draftState.abilityMethod === 'rolled_4d6kh3' ? '#f1c40f' : 'var(--border-color)';
  rollBtn.textContent = '🎲 Roll 4d6kh3';
  rollBtn.addEventListener('click', () => {
    updateDraft({
      ...draftState,
      abilityMethod: 'rolled_4d6kh3',
      baseAbilityScores: rollAbilityScores4d6DropLowest()
    });
  });
  presetBar.appendChild(rollBtn);
  leftPane.appendChild(presetBar);

  // Explicit mode banner (fixes sticky Point-Buy Cost label when switching to Rolled / Elite Array)
  const modeBanner = document.createElement('div');
  modeBanner.className = 'dnd35-filter-bar';
  modeBanner.style.fontWeight = '700';
  if (draftState.abilityMethod === 'point_buy') {
    const spent = calculatePointBuyCost(draftState.baseAbilityScores);
    modeBanner.style.color = spent <= draftState.pointBuyBudget ? '#2ecc71' : '#e74c3c';
    modeBanner.textContent = `Mode: Point-Buy (${draftState.pointBuyBudget} Budget) — Spent: ${spent} / ${draftState.pointBuyBudget} pts`;
  } else if (draftState.abilityMethod === 'elite_array') {
    modeBanner.style.color = '#58a6ff';
    modeBanner.textContent = 'Mode: Elite Array (15, 14, 13, 12, 10, 8) — Use ⇅ to swap scores';
  } else {
    modeBanner.style.color = '#f1c40f';
    modeBanner.textContent = 'Mode: Rolled 4d6 Drop Lowest — Click Roll 4d6kh3 to reroll or ⇅ to arrange';
  }
  leftPane.appendChild(modeBanner);

  ALL_ABILITY_IDS.forEach((key, idx) => {
    const row = document.createElement('div');
    row.className = 'dnd35-list-item';
    const val = draftState.baseAbilityScores[key];
    const racialAdj = race?.abilityAdjustments[key] ?? 0;
    const effective = val + racialAdj;
    const mod = computeAbilityModifier(effective);

    const label = document.createElement('strong');
    const adjStr = racialAdj !== 0 ? ` (${racialAdj > 0 ? `+${racialAdj}` : racialAdj} race = ${effective})` : '';
    label.textContent = `${key.toUpperCase()}: ${val}${adjStr} [Mod ${mod >= 0 ? `+${mod}` : mod}]`;

    const controls = document.createElement('div');
    controls.className = 'dnd35-counter-group';

    if (draftState.abilityMethod === 'point_buy') {
      const minus = document.createElement('button');
      minus.type = 'button';
      minus.className = 'modal-btn dnd35-counter-btn';
      minus.textContent = '−';
      minus.disabled = val <= POINT_BUY_MIN_SCORE;
      minus.addEventListener('click', () => {
        updateDraft({
          ...draftState,
          baseAbilityScores: { ...draftState.baseAbilityScores, [key]: val - 1 }
        });
      });

      const plus = document.createElement('button');
      plus.type = 'button';
      plus.className = 'modal-btn dnd35-counter-btn';
      plus.textContent = '+';
      plus.disabled = val >= POINT_BUY_MAX_SCORE;
      plus.addEventListener('click', () => {
        updateDraft({
          ...draftState,
          baseAbilityScores: { ...draftState.baseAbilityScores, [key]: val + 1 }
        });
      });
      controls.appendChild(minus);
      controls.appendChild(plus);
    }

    const nextKey = ALL_ABILITY_IDS[(idx + 1) % ALL_ABILITY_IDS.length]!;
    const swapBtn = document.createElement('button');
    swapBtn.type = 'button';
    swapBtn.className = 'modal-btn';
    swapBtn.style.padding = '2px 7px';
    swapBtn.style.fontSize = '0.72rem';
    swapBtn.textContent = `⇅ ${nextKey.toUpperCase()}`;
    swapBtn.addEventListener('click', () => {
      const nextVal = draftState.baseAbilityScores[nextKey];
      updateDraft({
        ...draftState,
        baseAbilityScores: {
          ...draftState.baseAbilityScores,
          [key]: nextVal,
          [nextKey]: val
        }
      });
    });
    controls.appendChild(swapBtn);

    row.appendChild(label);
    row.appendChild(controls);
    leftPane.appendChild(row);
  });

  // Right pane live derived stats preview
  const rTitle = document.createElement('h3');
  rTitle.style.margin = '0 0 6px 0';
  rTitle.style.color = '#f1c40f';
  rTitle.textContent = 'Live Combat & Skill Preview (Level 1)';
  rightPane.appendChild(rTitle);

  if (race && cls) {
    const conMod = computeAbilityModifier(draftState.baseAbilityScores.con + (race.abilityAdjustments.con ?? 0));
    const dexMod = computeAbilityModifier(draftState.baseAbilityScores.dex + (race.abilityAdjustments.dex ?? 0));
    const intMod = computeAbilityModifier(draftState.baseAbilityScores.int + (race.abilityAdjustments.int ?? 0));
    const lv1Hp = Math.max(1, cls.hitDieSides + conMod);
    const lv1Skills = calculateLevelSkillPointBudget(
      cls.skillPointsPerLevel,
      intMod,
      true,
      race.extraSkillPointsFirstLevel,
      race.extraSkillPointsPerLevel
    );
    const statsLines = [
      `Level 1 Hit Points: ${lv1Hp} HP (d${cls.hitDieSides} max + ${conMod >= 0 ? `+${conMod}` : conMod} CON)`,
      `Unarmored AC: ${10 + dexMod} | Initiative Modifier: ${dexMod >= 0 ? `+${dexMod}` : dexMod}`,
      `Level 1 Skill Points Budget: ${lv1Skills} pts`,
      `Racial Ability Adjustments (${race.name}): ${ALL_ABILITY_IDS.map((k) => `${k.toUpperCase()} ${race.abilityAdjustments[k] ?? 0}`).join(', ')}`
    ];
    for (const sLine of statsLines) {
      const div = document.createElement('div');
      div.style.padding = '6px 8px';
      div.style.border = '1px solid #303644';
      div.style.fontSize = '0.84rem';
      div.textContent = sLine;
      rightPane.appendChild(div);
    }
  }

  stage.appendChild(leftPane);
  stage.appendChild(rightPane);
  container.appendChild(stage);
}
