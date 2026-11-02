/**
 * @file D&D 3.5e 7-Step Character Creation Wizard Modal (Milestone 112).
 * Built with pure DOM manipulation (document.createElement) per AGENTS.md §7.
 */

import { getComponent } from '../../core/ecs.ts';
import { setGameState } from '../../core/game-loop.ts';
import { markAllDomainsDirty } from '../../core/presentation_queue.ts';
import {
  ALL_ABILITY_IDS,
  applyCharacterCreationToPlayer,
  calculatePointBuyCost,
  type CharacterCreationDraft,
  type DnD35Alignment,
  type DnD35SpellSchool,
  ELITE_ABILITY_ARRAY,
  getDnD35SystemContent,
  POINT_BUY_MAX_SCORE,
  POINT_BUY_MIN_SCORE,
  POINT_BUY_PRESETS,
  rollAbilityScores4d6DropLowest,
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

let currentStepIndex = 0;
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
    selectedFeats: ['power_attack', 'cleave', 'weapon_focus'],
    knownSpells: [],
    equipmentPackageId: 'martial_vanguard'
  };
}

/**
 * Resets the character creation wizard draft state for a fresh campaign start.
 *
 * @param _state The active GameState.
 */
export function resetDnD35eCharBuilderDraft(_state: GameState): void {
  currentStepIndex = 0;
  draftState = createDefaultDraft();
}

/**
 * Renders the D&D 3.5e Character Creation overlay when `state.uiMode === UIMode.CharCreation`.
 *
 * @param state The current GameState.
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
  stepBar.style.marginBottom = '12px';
  WIZARD_STEPS.forEach((label, idx) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'modal-btn';
    tab.style.padding = '6px 10px';
    tab.style.fontSize = '0.78rem';
    tab.style.borderColor = idx === currentStepIndex ? '#f1c40f' : 'var(--border-color)';
    tab.textContent = label;
    tab.addEventListener('click', () => {
      currentStepIndex = idx;
      renderDnD35eCharBuilderModal(state);
    });
    stepBar.appendChild(tab);
  });
  content.appendChild(stepBar);

  const stage = document.createElement('div');
  stage.style.display = 'flex';
  stage.style.flexDirection = 'column';
  stage.style.gap = '10px';
  stage.style.maxHeight = '52vh';
  stage.style.overflowY = 'auto';
  stage.style.padding = '8px';
  stage.style.border = '1px solid var(--border-color)';

  const updateDraft = (next: CharacterCreationDraft): void => {
    draftState = next;
    renderDnD35eCharBuilderModal(state);
  };

  if (currentStepIndex === 0) renderRaceStep(stage, state);
  else if (currentStepIndex === 1) renderClassStep(stage, state);
  else if (currentStepIndex === 2) renderAbilityStep(stage, state);
  else if (currentStepIndex === 3) renderCharBuilderSkillsStep(stage, state, draftState, updateDraft);
  else if (currentStepIndex === 4) renderCharBuilderFeatsStep(stage, state, draftState, updateDraft);
  else if (currentStepIndex === 5) renderCharBuilderSpellsStep(stage, state, draftState, updateDraft);
  else renderCharBuilderEquipmentStep(stage, draftState, updateDraft);

  content.appendChild(stage);

  // Footer navigation
  const footer = document.createElement('div');
  footer.style.display = 'flex';
  footer.style.justifyContent = 'space-between';
  footer.style.gap = '8px';
  footer.style.marginTop = '12px';

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
}

function renderRaceStep(container: HTMLElement, state: GameState): void {
  const sys = getDnD35SystemContent(state.campaign);
  if (!sys) return;

  for (const race of Object.values(sys.races)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'modal-btn';
    btn.style.textAlign = 'left';
    btn.style.borderColor = draftState.raceId === race.id ? '#f1c40f' : 'var(--border-color)';
    btn.textContent = `${race.name} (${race.size.toUpperCase()}, Speed ${race.baseLandSpeedFt}ft, Favored Class: ${race.favoredClass})`;
    btn.addEventListener('click', () => {
      draftState = { ...draftState, raceId: race.id };
      renderDnD35eCharBuilderModal(state);
    });
    container.appendChild(btn);
  }
}

function renderClassStep(container: HTMLElement, state: GameState): void {
  const sys = getDnD35SystemContent(state.campaign);
  if (!sys) return;

  const baseClasses = Object.values(sys.classes).filter((c) => !c.isPrestige);
  for (const cls of baseClasses) {
    const row1 = cls.progression[0] ?? { bab: 0, fortSave: 0, refSave: 0, willSave: 0 };
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'modal-btn';
    btn.style.textAlign = 'left';
    btn.style.borderColor = draftState.classId === cls.id ? '#f1c40f' : 'var(--border-color)';
    btn.textContent = `${cls.name} — d${cls.hitDieSides} HD, Lv 1 BAB +${row1.bab}, Fort +${row1.fortSave}, Ref +${row1.refSave}, Will +${row1.willSave}, ${cls.skillPointsPerLevel}+INT Skills`;
    btn.addEventListener('click', () => {
      const validAlignment = cls.allowedAlignments?.[0] ?? draftState.alignment;
      draftState = {
        ...draftState,
        classId: cls.id,
        alignment: validAlignment,
        selectedAcfs: [],
        domains: []
      };
      renderDnD35eCharBuilderModal(state);
    });
    container.appendChild(btn);
  }

  const activeCls = sys.classes[draftState.classId];
  if (!activeCls) return;

  // Render a compact Table Preview of levels 1..5 for the active class
  const tablePreview = document.createElement('div');
  tablePreview.style.fontSize = '11px';
  tablePreview.style.padding = '6px';
  tablePreview.style.background = 'rgba(0,0,0,0.3)';
  tablePreview.style.border = '1px solid var(--border-color)';
  tablePreview.style.borderRadius = '4px';
  tablePreview.style.margin = '6px 0';
  const tableTitle = document.createElement('strong');
  tableTitle.textContent = `Table: ${activeCls.name} (Levels 1–5 Preview):`;
  tablePreview.appendChild(tableTitle);

  const previewRows = activeCls.progression.slice(0, 5);
  for (const row of previewRows) {
    const rDiv = document.createElement('div');
    const featsStr = row.features.length > 0 ? ` [${row.features.join(', ')}]` : '';
    const spStr = row.spellsPerDay
      ? ` | Slots: ${Object.entries(row.spellsPerDay)
          .map(([lvl, s]) => `${lvl}: ${s}`)
          .join(', ')}`
      : '';
    rDiv.textContent = `Lvl ${row.level}: BAB +${row.bab} | Saves: +${row.fortSave}/+${row.refSave}/+${row.willSave}${featsStr}${spStr}`;
    tablePreview.appendChild(rDiv);
  }
  container.appendChild(tablePreview);

  const alignRow = document.createElement('div');
  const alignTitle = document.createElement('strong');
  alignTitle.textContent = 'Alignment: ';
  alignRow.appendChild(alignTitle);
  const allowed = activeCls.allowedAlignments ?? ALL_ALIGNMENTS;
  for (const align of allowed) {
    const aBtn = document.createElement('button');
    aBtn.type = 'button';
    aBtn.className = 'modal-btn';
    aBtn.style.padding = '4px 8px';
    aBtn.style.marginRight = '4px';
    aBtn.style.borderColor = draftState.alignment === align ? '#f1c40f' : 'var(--border-color)';
    aBtn.textContent = align;
    aBtn.addEventListener('click', () => {
      draftState = { ...draftState, alignment: align };
      renderDnD35eCharBuilderModal(state);
    });
    alignRow.appendChild(aBtn);
  }
  container.appendChild(alignRow);

  for (const acf of activeCls.acfSwaps) {
    const acfBtn = document.createElement('button');
    acfBtn.type = 'button';
    acfBtn.className = 'modal-btn';
    const isChecked = draftState.selectedAcfs.includes(acf.acfId);
    acfBtn.style.borderColor = isChecked ? '#2ecc71' : 'var(--border-color)';
    acfBtn.textContent = `[ACF] ${acf.name} (Replaces ${acf.replacesFeature} → ${acf.grantedFeature})`;
    acfBtn.addEventListener('click', () => {
      const nextAcfs = isChecked
        ? draftState.selectedAcfs.filter((id) => id !== acf.acfId)
        : [...draftState.selectedAcfs, acf.acfId];
      draftState = { ...draftState, selectedAcfs: nextAcfs };
      renderDnD35eCharBuilderModal(state);
    });
    container.appendChild(acfBtn);
  }

  if (draftState.classId === 'cleric') {
    const domHeader = document.createElement('strong');
    domHeader.textContent = `Cleric Domains (${draftState.domains.length}/2 selected):`;
    container.appendChild(domHeader);
    for (const dom of Object.values(sys.domains)) {
      const dBtn = document.createElement('button');
      dBtn.type = 'button';
      dBtn.className = 'modal-btn';
      const chosen = draftState.domains.includes(dom.id);
      dBtn.style.borderColor = chosen ? '#f1c40f' : 'var(--border-color)';
      dBtn.textContent = `${dom.name} — ${dom.grantedPowerDescription}`;
      dBtn.addEventListener('click', () => {
        const nextDomains = chosen
          ? draftState.domains.filter((d) => d !== dom.id)
          : draftState.domains.length < 2
            ? [...draftState.domains, dom.id]
            : draftState.domains;
        draftState = { ...draftState, domains: nextDomains };
        renderDnD35eCharBuilderModal(state);
      });
      container.appendChild(dBtn);
    }
  }

  if (draftState.classId === 'wizard') {
    const specCheck = validateSpecialistSchoolSelection(
      draftState.arcaneSchool ?? 'universal',
      draftState.prohibitedSchools
    );
    const specLabel = document.createElement('div');
    specLabel.textContent = `Arcane Specialization (${specCheck.valid ? 'Valid' : (specCheck.reason ?? 'Invalid')}):`;
    container.appendChild(specLabel);
    for (const school of SPELL_SCHOOLS) {
      const sBtn = document.createElement('button');
      sBtn.type = 'button';
      sBtn.className = 'modal-btn';
      sBtn.style.padding = '4px 8px';
      sBtn.style.borderColor = draftState.arcaneSchool === school ? '#f1c40f' : 'var(--border-color)';
      sBtn.textContent = `Specialize: ${school}`;
      sBtn.addEventListener('click', () => {
        draftState = { ...draftState, arcaneSchool: school, prohibitedSchools: [] };
        renderDnD35eCharBuilderModal(state);
      });
      container.appendChild(sBtn);
    }
  }
}

function renderAbilityStep(container: HTMLElement, state: GameState): void {
  const presetBar = document.createElement('div');
  presetBar.style.display = 'flex';
  presetBar.style.gap = '6px';

  for (const pts of POINT_BUY_PRESETS) {
    const pBtn = document.createElement('button');
    pBtn.type = 'button';
    pBtn.className = 'modal-btn';
    pBtn.textContent = `Point Buy (${pts})`;
    pBtn.addEventListener('click', () => {
      draftState = { ...draftState, abilityMethod: 'point_buy', pointBuyBudget: pts };
      renderDnD35eCharBuilderModal(state);
    });
    presetBar.appendChild(pBtn);
  }

  const eliteBtn = document.createElement('button');
  eliteBtn.type = 'button';
  eliteBtn.className = 'modal-btn';
  eliteBtn.textContent = 'Elite Array (15,14,13,12,10,8)';
  eliteBtn.addEventListener('click', () => {
    draftState = {
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
    };
    renderDnD35eCharBuilderModal(state);
  });
  presetBar.appendChild(eliteBtn);

  const rollBtn = document.createElement('button');
  rollBtn.type = 'button';
  rollBtn.className = 'modal-btn';
  rollBtn.textContent = '🎲 Roll 4d6 Drop Lowest';
  rollBtn.addEventListener('click', () => {
    draftState = {
      ...draftState,
      abilityMethod: 'rolled_4d6kh3',
      baseAbilityScores: rollAbilityScores4d6DropLowest()
    };
    renderDnD35eCharBuilderModal(state);
  });
  presetBar.appendChild(rollBtn);
  container.appendChild(presetBar);

  const spent = calculatePointBuyCost(draftState.baseAbilityScores);
  const info = document.createElement('div');
  info.textContent = `Point-Buy Cost: ${!Number.isFinite(spent) ? 'Rolled' : `${spent} / ${draftState.pointBuyBudget} pts`}`;
  container.appendChild(info);

  for (const key of ALL_ABILITY_IDS) {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '8px';
    const val = draftState.baseAbilityScores[key];

    const label = document.createElement('strong');
    label.style.width = '60px';
    label.textContent = `${key.toUpperCase()}: ${val}`;

    const minus = document.createElement('button');
    minus.type = 'button';
    minus.className = 'modal-btn';
    minus.textContent = '−';
    minus.disabled = val <= POINT_BUY_MIN_SCORE;
    minus.addEventListener('click', () => {
      draftState = {
        ...draftState,
        baseAbilityScores: { ...draftState.baseAbilityScores, [key]: val - 1 }
      };
      renderDnD35eCharBuilderModal(state);
    });

    const plus = document.createElement('button');
    plus.type = 'button';
    plus.className = 'modal-btn';
    plus.textContent = '+';
    plus.disabled = val >= POINT_BUY_MAX_SCORE;
    plus.addEventListener('click', () => {
      draftState = {
        ...draftState,
        baseAbilityScores: { ...draftState.baseAbilityScores, [key]: val + 1 }
      };
      renderDnD35eCharBuilderModal(state);
    });

    row.appendChild(label);
    row.appendChild(minus);
    row.appendChild(plus);
    container.appendChild(row);
  }
}
