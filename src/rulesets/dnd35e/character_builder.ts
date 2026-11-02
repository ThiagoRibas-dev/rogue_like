import { addComponent, getComponent } from '../../core/ecs.ts';
import { ComponentType, type FighterComponent } from '../../types/components.types.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';
import { computeAbilityModifier, computeEffectiveAbilityScore } from './abilities.ts';
import { evaluateDiceExpression } from './math/dice.ts';
import { dndFloor } from './math/multipliers.ts';
import { evaluatePrerequisiteAST, type PrerequisiteEvalContext } from './prerequisites.ts';
import {
  aggregateProgressionChassis,
  buildHitDieTrackFromClass,
  collectClassFeaturesUpToLevel
} from './progression.ts';
import { applyRaceToActorChassis } from './races.ts';
import { getDnD35EntityData, projectDnD35ActorSemanticTags, setDnD35EntityData } from './srd_registry.ts';
import {
  applyNegativeLevelsToActor,
  applyPermanentLevelDrainToActor,
  buildClassAndDomainEffectModifiers,
  rebuildActorStateFromLevelHistory
} from './level_ledger.ts';
import type {
  AbilityId,
  AbilityScoresRecord,
  DnD35Alignment,
  DnD35CharacterLevelRecord,
  DnD35EntityData,
  DnD35SpellSchool,
  HitDieTrack
} from './types/dnd35e.types.ts';
import { ALL_ABILITY_IDS } from './types/dnd35e.types.ts';
import { type DnD35ClassDefinition, getDnD35SystemContent } from './types/dnd35e_system.types.ts';

export {
  applyNegativeLevelsToActor,
  applyPermanentLevelDrainToActor,
  buildClassAndDomainEffectModifiers,
  rebuildActorStateFromLevelHistory
};

/** Standard D&D 3.5e DMG Point-Buy cost table (scores 8 through 18). */
export const POINT_BUY_COST_TABLE: Readonly<Record<number, number>> = {
  8: 0,
  9: 1,
  10: 2,
  11: 3,
  12: 4,
  13: 5,
  14: 6,
  15: 8,
  16: 10,
  17: 13,
  18: 16
};

/** Standard Point-Buy budget presets (`25` Standard, `28` High-Powered, `32` Elite). */
export const POINT_BUY_PRESETS: ReadonlyArray<number> = [25, 28, 32];

/** Standard D&D 3.5e Elite Array ability scores. */
export const ELITE_ABILITY_ARRAY: ReadonlyArray<number> = [15, 14, 13, 12, 10, 8];

/** Minimum and maximum base ability scores allowed in Point-Buy. */
export const POINT_BUY_MIN_SCORE = 8;
export const POINT_BUY_MAX_SCORE = 18;

/** First-level skill point multiplier (`x4`). */
const FIRST_LEVEL_SKILL_MULTIPLIER = 4;

/** Minimum skill points gained per level regardless of negative INT modifier (`1`). */
const MIN_SKILL_POINTS_PER_LEVEL = 1;

/** Minimum ranks required in a source skill to unlock a +2 synergy bonus (`5`). */
export const SYNERGY_RANK_THRESHOLD = 5;

/** Curated starting equipment packages for character creation. */
export interface StartingEquipmentPackage {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly weaponDice: string;
  readonly weaponDamageType: 'slashing' | 'piercing' | 'bludgeoning';
  readonly armorBonus: number;
  readonly shieldBonus: number;
}

/** Canonical starting equipment packages selectable in Step 7 of Character Creation. */
export const STARTING_EQUIPMENT_PACKAGES: ReadonlyArray<StartingEquipmentPackage> = [
  {
    id: 'martial_vanguard',
    name: 'Martial Vanguard Kit',
    description: 'Longsword (1d8 slashing), Scale Mail (+4 armor), Heavy Wooden Shield (+2 shield), Explorer Pack.',
    weaponDice: '1d8',
    weaponDamageType: 'slashing',
    armorBonus: 4,
    shieldBonus: 2
  },
  {
    id: 'skirmisher_scout',
    name: 'Skirmisher & Scout Kit',
    description: 'Shortsword (1d6 piercing), Studded Leather (+3 armor), Thieves Tools, Shortbow & 20 Arrows.',
    weaponDice: '1d6',
    weaponDamageType: 'piercing',
    armorBonus: 3,
    shieldBonus: 0
  },
  {
    id: 'divine_templar',
    name: 'Divine Templar Kit',
    description: 'Heavy Mace (1d8 bludgeoning), Chainmail (+5 armor), Heavy Shield (+2 shield), Wooden Holy Symbol.',
    weaponDice: '1d8',
    weaponDamageType: 'bludgeoning',
    armorBonus: 5,
    shieldBonus: 2
  },
  {
    id: 'arcane_scholar',
    name: 'Arcane Scholar & Monk Kit',
    description: 'Quarterstaff (1d6 bludgeoning), Unarmored (+0 armor), Spell Component Pouch & Scholar Robes.',
    weaponDice: '1d6',
    weaponDamageType: 'bludgeoning',
    armorBonus: 0,
    shieldBonus: 0
  }
];

/** Draft state for the 7-Step D&D 3.5e Character Creation Wizard. */
export interface CharacterCreationDraft {
  readonly raceId: string;
  readonly classId: string;
  readonly alignment: DnD35Alignment;
  readonly abilityMethod: 'point_buy' | 'elite_array' | 'rolled_4d6kh3';
  readonly pointBuyBudget: number;
  readonly baseAbilityScores: Readonly<Record<AbilityId, number>>;
  readonly selectedAcfs: ReadonlyArray<string>;
  readonly domains: ReadonlyArray<string>;
  readonly arcaneSchool?: DnD35SpellSchool | undefined;
  readonly prohibitedSchools: ReadonlyArray<DnD35SpellSchool>;
  readonly favoredEnemyType?: string | undefined;
  readonly combatStyle?: 'archery' | 'two_weapon' | undefined;
  readonly skillRanks: Readonly<Record<string, number>>;
  readonly selectedFeats: ReadonlyArray<string>;
  readonly knownSpells: ReadonlyArray<string>;
  readonly equipmentPackageId: string;
}

/** Input payload for advancing an actor by 1 class level in the Level-Up Modal. */
export interface LevelUpChoice {
  readonly classId: string;
  readonly hpMethod: 'average' | 'roll';
  readonly abilityScoreIncrease?: AbilityId | undefined;
  readonly addedSkillRanks: Readonly<Record<string, number>>;
  readonly selectedFeats: ReadonlyArray<string>;
  readonly selectedAcfs?: ReadonlyArray<string> | undefined;
  readonly learnedSpells?: ReadonlyArray<string> | undefined;
}

/**
 * Computes the total Point-Buy cost of a 6-ability score assignment.
 *
 * @param baseScores Map of base ability scores (`8..18`).
 * @returns Total point cost, or `Infinity` if any score is out of range `[8, 18]`.
 */
export function calculatePointBuyCost(baseScores: Readonly<Record<AbilityId, number>>): number {
  let total = 0;
  for (const abId of ALL_ABILITY_IDS) {
    const score = baseScores[abId];
    const cost = POINT_BUY_COST_TABLE[score];
    if (cost === undefined) {
      return Number.POSITIVE_INFINITY;
    }
    total += cost;
  }
  return total;
}

/**
 * Rolls 6 ability scores using deterministic `4d6kh3` (roll 4d6, keep highest 3).
 *
 * @returns A 6-ability score map populated with `4d6kh3` totals.
 */
export function rollAbilityScores4d6DropLowest(): Readonly<Record<AbilityId, number>> {
  return {
    str: evaluateDiceExpression('4d6kh3').total,
    dex: evaluateDiceExpression('4d6kh3').total,
    con: evaluateDiceExpression('4d6kh3').total,
    int: evaluateDiceExpression('4d6kh3').total,
    wis: evaluateDiceExpression('4d6kh3').total,
    cha: evaluateDiceExpression('4d6kh3').total
  };
}

/**
 * Computes the skill point budget for a single level-up or 1st-level character creation.
 *
 * @param skillPointsPerLevel Base skill points per level of the class (`2, 4, 6, 8`).
 * @param intModifier Effective Intelligence modifier.
 * @param isFirstLevel True if this is Character Level 1 (`x4` multiplier).
 * @param extraRaceFirstLevel Extra skill points at 1st level from race (`4` for Human).
 * @param extraRacePerLevel Extra skill points at subsequent levels from race (`1` for Human).
 * @returns Total skill points available to spend at this level.
 */
export function calculateLevelSkillPointBudget(
  skillPointsPerLevel: number,
  intModifier: number,
  isFirstLevel: boolean,
  extraRaceFirstLevel = 0,
  extraRacePerLevel = 0
): number {
  const basePerLevel = Math.max(MIN_SKILL_POINTS_PER_LEVEL, skillPointsPerLevel + intModifier);
  if (isFirstLevel) {
    return basePerLevel * FIRST_LEVEL_SKILL_MULTIPLIER + extraRaceFirstLevel;
  }
  return basePerLevel + extraRacePerLevel;
}

/**
 * Computes the maximum allowed skill ranks for a skill at a given total Hit Dice (`HD + 3` for class,
 * `(HD + 3) / 2` for cross-class).
 *
 * @param totalHd Total Hit Dice of the actor ($\ge 1$).
 * @param isClassSkill True if the skill is in the class's `classSkills` (or granted by a Cleric Domain).
 * @returns Maximum rank cap.
 */
export function getSkillMaxRanks(totalHd: number, isClassSkill: boolean): number {
  const classCap = Math.max(1, dndFloor(totalHd)) + 3;
  return isClassSkill ? classCap : classCap / 2;
}

/**
 * Computes the total skill points spent for a set of rank additions (`1 pt = 1 rank` for class skills,
 * `1 pt = 0.5 rank` / `2 pts = 1 rank` for cross-class skills).
 *
 * @param addedRanks Map of skill ID to added rank delta.
 * @param classSkillIds Set or array of class skill IDs for the current level's class.
 * @returns Total skill points spent.
 */
export function calculateSkillAllocationCost(
  addedRanks: Readonly<Record<string, number>>,
  classSkillIds: ReadonlyArray<string>
): number {
  let spent = 0;
  for (const [skillId, delta] of Object.entries(addedRanks)) {
    if (delta <= 0) continue;
    const isClass = classSkillIds.includes(skillId);
    spent += isClass ? delta : delta * 2;
  }
  return Math.round(spent * 100) / 100;
}

/**
 * Validates Wizard Specialist School and Prohibited School choices per D&D 3.5e PHB p. 57.
 * - `universal` requires 0 prohibited schools.
 * - `divination` requires 1 prohibited school.
 * - All other 7 schools require 2 prohibited schools.
 * - `divination` and `universal` can never be chosen as prohibited schools.
 *
 * @param school Chosen specialist school (or `'universal'`).
 * @param prohibited Array of prohibited schools.
 * @returns `{ valid: boolean; reason?: string }`.
 */
export function validateSpecialistSchoolSelection(
  school: DnD35SpellSchool,
  prohibited: ReadonlyArray<DnD35SpellSchool>
): { readonly valid: boolean; readonly reason?: string } {
  if (school === 'universal') {
    return prohibited.length === 0
      ? { valid: true }
      : { valid: false, reason: 'Generalist (Universal) wizards do not select prohibited schools.' };
  }
  if (prohibited.includes(school)) {
    return { valid: false, reason: 'Cannot prohibit your own specialty school.' };
  }
  if (prohibited.includes('divination') || prohibited.includes('universal')) {
    return { valid: false, reason: 'Divination and Universal cannot be chosen as prohibited schools.' };
  }
  const requiredCount = school === 'divination' ? 1 : 2;
  const uniqueCount = new Set(prohibited).size;
  if (uniqueCount !== requiredCount) {
    return {
      valid: false,
      reason: `${school} specialization requires exactly ${requiredCount} prohibited school(s).`
    };
  }
  return { valid: true };
}

/**
 * Builds a `PrerequisiteEvalContext` snapshot for an actor (`DnD35EntityData`) so feats and
 * Prestige Classes can be validated via `evaluatePrerequisiteAST()`.
 *
 * @param dndData The actor's `DnD35EntityData`.
 * @param classRegistry Loaded D&D 3.5e class definitions.
 * @returns `PrerequisiteEvalContext`.
 */
export function buildPrerequisiteContextForActor(
  dndData: DnD35EntityData,
  classRegistry: Readonly<Record<string, DnD35ClassDefinition>>
): PrerequisiteEvalContext {
  const conMod = computeAbilityModifier(computeEffectiveAbilityScore(dndData.abilityScores.con));
  const chassis = aggregateProgressionChassis(dndData.tracks, conMod, dndData.levelAdjustment ?? 0);
  const abilityScores: Record<AbilityId, number | null> = {
    str: computeEffectiveAbilityScore(dndData.abilityScores.str),
    dex: computeEffectiveAbilityScore(dndData.abilityScores.dex),
    con: computeEffectiveAbilityScore(dndData.abilityScores.con),
    int: computeEffectiveAbilityScore(dndData.abilityScores.int),
    wis: computeEffectiveAbilityScore(dndData.abilityScores.wis),
    cha: computeEffectiveAbilityScore(dndData.abilityScores.cha)
  };

  let maxArcaneSpellLevel = 0;
  let maxDivineSpellLevel = 0;
  let totalCasterLevel = 0;

  for (const track of dndData.tracks) {
    const classDef = classRegistry[track.trackId];
    if (!classDef || classDef.castingMode === 'none') continue;
    totalCasterLevel += track.levels;
    const row = classDef.progression.find((r) => r.level === track.levels);
    if (!row || !row.spellsPerDay) continue;
    let highestSlot = 0;
    for (const [lvlKey, slots] of Object.entries(row.spellsPerDay)) {
      const spellLvl = Number(lvlKey);
      if (!Number.isNaN(spellLvl) && slots >= 0 && spellLvl > highestSlot) {
        highestSlot = spellLvl;
      }
    }
    if (classDef.castingTradition === 'arcane' && highestSlot > maxArcaneSpellLevel) {
      maxArcaneSpellLevel = highestSlot;
    } else if (classDef.castingTradition === 'divine' && highestSlot > maxDivineSpellLevel) {
      maxDivineSpellLevel = highestSlot;
    }
  }

  return {
    abilityScores,
    totalBab: chassis.totalBab,
    skillRanks: dndData.skillRanks,
    feats: dndData.feats,
    tags: projectDnD35ActorSemanticTags(dndData),
    casterLevel: totalCasterLevel,
    sizeCategory: dndData.sizeCategory,
    ...(dndData.alignment !== undefined ? { alignment: dndData.alignment } : {}),
    ...(dndData.raceId !== undefined ? { raceId: dndData.raceId } : {}),
    maxArcaneSpellLevel,
    maxDivineSpellLevel
  };
}

/**
 * Applies a completed 7-Step `CharacterCreationDraft` to an entity in `GameState`,
 * hydrating its race, ability scores, Level 1 class track, domains/school/ACFs, skills, feats,
 * Effect Provider modifiers, and starting equipment.
 */
export function applyCharacterCreationToPlayer(
  state: GameState,
  entityId: EntityId,
  draft: CharacterCreationDraft
): GameState {
  const sysContent = getDnD35SystemContent(state.campaign);
  if (!sysContent) return state;

  const raceDef = sysContent.races[draft.raceId];
  const classDef = sysContent.classes[draft.classId];
  if (!raceDef || !classDef) return state;

  const currentData = getDnD35EntityData(state, entityId);
  const rawBaseScores: AbilityScoresRecord = {
    str: { base: draft.baseAbilityScores.str, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 },
    dex: { base: draft.baseAbilityScores.dex, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 },
    con: { base: draft.baseAbilityScores.con, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 },
    int: { base: draft.baseAbilityScores.int, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 },
    wis: { base: draft.baseAbilityScores.wis, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 },
    cha: { base: draft.baseAbilityScores.cha, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 }
  };

  const withBaseAbilities: DnD35EntityData = {
    ...currentData,
    abilityScores: rawBaseScores,
    tracks: []
  };

  const withRaceResult = applyRaceToActorChassis(withBaseAbilities, raceDef);
  const withRace = withRaceResult.entityData;
  const levelOneTrack = buildHitDieTrackFromClass(classDef, 1);
  const nextTracks: ReadonlyArray<HitDieTrack> = [...withRace.tracks, levelOneTrack];
  const classAndDomainMods = buildClassAndDomainEffectModifiers(
    nextTracks,
    draft.selectedAcfs,
    draft.domains,
    sysContent.classes,
    sysContent.domains
  );

  const equipPkg =
    STARTING_EQUIPMENT_PACKAGES.find((p) => p.id === draft.equipmentPackageId) ?? STARTING_EQUIPMENT_PACKAGES[0]!;

  const activeFeatures = collectClassFeaturesUpToLevel(classDef, 1, draft.selectedAcfs);
  const hasPounce = activeFeatures.includes('pounce') || withRace.hasPounce === true;

  const domainFeats: string[] = [];
  for (const domId of draft.domains) {
    const dom = sysContent.domains[domId];
    if (dom) {
      for (const f of dom.featGrants) {
        if (!domainFeats.includes(f)) domainFeats.push(f);
      }
    }
  }
  const mergedFeats = Array.from(new Set([...draft.selectedFeats, ...domainFeats]));

  const levelOneRecord: DnD35CharacterLevelRecord = {
    characterLevel: 1,
    classId: classDef.id,
    classLevel: 1,
    hpRolled: classDef.hitDieSides,
    addedSkillRanks: draft.skillRanks,
    selectedFeats: draft.selectedFeats,
    selectedAcfs: draft.selectedAcfs,
    learnedSpells: draft.knownSpells
  };

  const updatedData: DnD35EntityData = {
    ...withRace,
    raceId: raceDef.id,
    alignment: draft.alignment,
    favoredClass: raceDef.favoredClass,
    tracks: nextTracks,
    selectedAcfs: draft.selectedAcfs,
    domains: draft.domains,
    ...(draft.arcaneSchool !== undefined ? { arcaneSchool: draft.arcaneSchool } : {}),
    prohibitedSchools: draft.prohibitedSchools,
    ...(draft.favoredEnemyType !== undefined
      ? { favoredEnemies: [{ creatureType: draft.favoredEnemyType, bonus: 2 }] }
      : {}),
    ...(draft.combatStyle !== undefined ? { combatStyle: draft.combatStyle } : {}),
    skillRanks: draft.skillRanks,
    feats: mergedFeats,
    knownSpells: draft.knownSpells,
    preparedSpells: draft.knownSpells,
    weaponDice: equipPkg.weaponDice,
    weaponDamageType: equipPkg.weaponDamageType,
    armorBonus: equipPkg.armorBonus,
    shieldBonus: equipPkg.shieldBonus,
    hasPounce,
    levelHistory: [levelOneRecord],
    statModifiers: [...withRaceResult.statModifiers, ...classAndDomainMods]
  };

  const conMod = computeAbilityModifier(computeEffectiveAbilityScore(updatedData.abilityScores.con));
  const chassis = aggregateProgressionChassis(updatedData.tracks, conMod, updatedData.levelAdjustment ?? 0);

  const nextState = setDnD35EntityData(state, entityId, updatedData);
  const fighter = getComponent(nextState, entityId, ComponentType.Fighter) as FighterComponent | undefined;
  if (!fighter) return nextState;

  return addComponent(nextState, entityId, {
    ...fighter,
    level: chassis.ecl,
    hp: chassis.maxHp,
    maxHp: chassis.maxHp,
    attack: chassis.totalBab,
    defense: equipPkg.armorBonus + equipPkg.shieldBonus
  });
}

/**
 * Applies an interactive Level-Up choice to an actor, advancing an existing class track or
 * adding a new Base/Prestige Class track, rolling/averaging HP, applying 4th-HD ability score
 * increases, updating skills/feats/spells, and refreshing class Effect Provider modifiers.
 */
export function applyLevelUpToActor(
  state: GameState,
  entityId: EntityId,
  choice: LevelUpChoice
): { readonly state: GameState; readonly success: boolean; readonly errorReason?: string } {
  const sysContent = getDnD35SystemContent(state.campaign);
  if (!sysContent) {
    return { state, success: false, errorReason: 'D&D 3.5e system content not loaded.' };
  }

  const classDef = sysContent.classes[choice.classId];
  if (!classDef) {
    return { state, success: false, errorReason: `Unknown class "${choice.classId}".` };
  }

  const dndData = getDnD35EntityData(state, entityId);
  const existingTrack = dndData.tracks.find((t) => t.trackId === classDef.id);
  const nextClassLevel = (existingTrack ? existingTrack.levels : 0) + 1;
  if (nextClassLevel > classDef.maxLevel) {
    return {
      state,
      success: false,
      errorReason: `Cannot exceed maximum level ${classDef.maxLevel} in ${classDef.name}.`
    };
  }

  if (classDef.prerequisites) {
    const prereqCtx = buildPrerequisiteContextForActor(dndData, sysContent.classes);
    if (!evaluatePrerequisiteAST(classDef.prerequisites, prereqCtx)) {
      return { state, success: false, errorReason: `Prerequisites not met for ${classDef.name}.` };
    }
  }

  const conMod = computeAbilityModifier(computeEffectiveAbilityScore(dndData.abilityScores.con));
  const prevChassis = aggregateProgressionChassis(dndData.tracks, conMod, dndData.levelAdjustment ?? 0);
  const nextCharLevel = prevChassis.totalHD + 1;

  const rawRoll =
    choice.hpMethod === 'roll'
      ? evaluateDiceExpression(`1d${classDef.hitDieSides}`).total
      : dndFloor(classDef.hitDieSides / 2) + 1;

  const newRecord: DnD35CharacterLevelRecord = {
    characterLevel: nextCharLevel,
    classId: classDef.id,
    classLevel: nextClassLevel,
    hpRolled: rawRoll,
    ...(choice.abilityScoreIncrease !== undefined ? { abilityScoreIncrease: choice.abilityScoreIncrease } : {}),
    addedSkillRanks: choice.addedSkillRanks,
    selectedFeats: choice.selectedFeats,
    selectedAcfs: choice.selectedAcfs ?? [],
    learnedSpells: choice.learnedSpells ?? []
  };

  const prevHistory = dndData.levelHistory ?? [];
  const updatedHistory = [...prevHistory, newRecord];

  let baseAbilities = dndData.abilityScores;
  if (choice.abilityScoreIncrease !== undefined) {
    const abId = choice.abilityScoreIncrease;
    const prev = baseAbilities[abId];
    if (prev.base !== null) {
      baseAbilities = {
        ...baseAbilities,
        [abId]: { ...prev, base: prev.base + 1 }
      };
    }
  }

  const updatedData = rebuildActorStateFromLevelHistory(
    { ...dndData, abilityScores: baseAbilities },
    updatedHistory,
    sysContent
  );

  const nextConMod = computeAbilityModifier(computeEffectiveAbilityScore(updatedData.abilityScores.con));
  const hpGain = Math.max(1, rawRoll + nextConMod);
  const nextChassis = aggregateProgressionChassis(updatedData.tracks, nextConMod, updatedData.levelAdjustment ?? 0);

  const nextState = setDnD35EntityData(state, entityId, updatedData);
  const fighter = getComponent(nextState, entityId, ComponentType.Fighter) as FighterComponent | undefined;
  if (!fighter) {
    return { state: nextState, success: true };
  }

  return {
    state: addComponent(nextState, entityId, {
      ...fighter,
      level: nextChassis.ecl,
      maxHp: fighter.maxHp + hpGain,
      hp: fighter.hp + hpGain,
      attack: nextChassis.totalBab
    }),
    success: true
  };
}
