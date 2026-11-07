import {
  ALL_ABILITY_IDS,
  calculateLevelSkillPointBudget,
  calculatePointBuyCost,
  type CharacterCreationDraft,
  computeAbilityModifier,
  ELITE_ABILITY_ARRAY,
  getDnD35SystemContent,
  POINT_BUY_MAX_SCORE,
  POINT_BUY_MIN_SCORE,
  POINT_BUY_PRESETS,
  rollAbilityScores4d6DropLowest
} from '../../rulesets/registry.ts';
import type { GameState } from '../../types/game-state.types.ts';
import { renderRaceInspector } from './dnd35e_inspector.ui.ts';

/**
 * Renders Step 1 (Race Selection) of the D&D 3.5e Character Creation Wizard.
 */
export function renderRaceStep(
  container: HTMLElement,
  state: GameState,
  draftState: CharacterCreationDraft,
  showMonstrousRaces: boolean,
  onToggleMonstrousRaces: () => void,
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
  toggleBtn.style.borderColor = showMonstrousRaces ? 'var(--crpg-gold, #f1c40f)' : 'var(--border-color)';
  toggleBtn.textContent = showMonstrousRaces ? 'Hide Monstrous Races' : 'Show Monstrous Races';
  toggleBtn.addEventListener('click', () => {
    onToggleMonstrousRaces();
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
    metaSpan.style.color = 'var(--crpg-text-dim, #9da7b3)';
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

/**
 * Renders Step 3 (Ability Scores) of the D&D 3.5e Character Creation Wizard.
 */
export function renderAbilityStep(
  container: HTMLElement,
  state: GameState,
  draftState: CharacterCreationDraft,
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
    pBtn.style.borderColor = isThisPreset ? 'var(--crpg-gold, #f1c40f)' : 'var(--border-color)';
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
  eliteBtn.style.borderColor =
    draftState.abilityMethod === 'elite_array' ? 'var(--crpg-gold, #f1c40f)' : 'var(--border-color)';
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
  rollBtn.style.borderColor =
    draftState.abilityMethod === 'rolled_4d6kh3' ? 'var(--crpg-gold, #f1c40f)' : 'var(--border-color)';
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

  const modeBanner = document.createElement('div');
  modeBanner.className = 'dnd35-filter-bar';
  modeBanner.style.fontWeight = '700';
  if (draftState.abilityMethod === 'point_buy') {
    const spent = calculatePointBuyCost(draftState.baseAbilityScores);
    modeBanner.style.color =
      spent <= draftState.pointBuyBudget ? 'var(--crpg-success, #2ecc71)' : 'var(--crpg-danger, #e74c3c)';
    modeBanner.textContent = `Mode: Point-Buy (${draftState.pointBuyBudget} Budget) — Spent: ${spent} / ${draftState.pointBuyBudget} pts`;
  } else if (draftState.abilityMethod === 'elite_array') {
    modeBanner.style.color = 'var(--crpg-info, #58a6ff)';
    modeBanner.textContent = 'Mode: Elite Array (15, 14, 13, 12, 10, 8) — Use ⇅ to swap scores';
  } else {
    modeBanner.style.color = 'var(--crpg-gold, #f1c40f)';
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
        updateDraft({ ...draftState, baseAbilityScores: { ...draftState.baseAbilityScores, [key]: val - 1 } });
      });

      const plus = document.createElement('button');
      plus.type = 'button';
      plus.className = 'modal-btn dnd35-counter-btn';
      plus.textContent = '+';
      plus.disabled = val >= POINT_BUY_MAX_SCORE;
      plus.addEventListener('click', () => {
        updateDraft({ ...draftState, baseAbilityScores: { ...draftState.baseAbilityScores, [key]: val + 1 } });
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
        baseAbilityScores: { ...draftState.baseAbilityScores, [key]: nextVal, [nextKey]: val }
      });
    });
    controls.appendChild(swapBtn);

    row.appendChild(label);
    row.appendChild(controls);
    leftPane.appendChild(row);
  });

  const rTitle = document.createElement('h3');
  rTitle.style.margin = '0 0 6px 0';
  rTitle.style.color = 'var(--crpg-gold, #f1c40f)';
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
      div.style.border = '1px solid var(--crpg-border-subtle, #303644)';
      div.style.fontSize = '0.84rem';
      div.textContent = sLine;
      rightPane.appendChild(div);
    }
  }

  stage.appendChild(leftPane);
  stage.appendChild(rightPane);
  container.appendChild(stage);
}
