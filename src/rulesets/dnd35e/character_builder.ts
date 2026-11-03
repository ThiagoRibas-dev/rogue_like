import { addComponent, getComponent, removeComponent, spawnItem } from '../../core/ecs.ts';
import {
  ComponentType,
  type EquipmentComponent,
  type FighterComponent,
  type InventoryComponent
} from '../../types/components.types.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';
import { computeAbilityModifier, computeEffectiveAbilityScore } from './abilities.ts';
import { evaluateDiceExpression } from './math/dice.ts';
import { dndFloor } from './math/multipliers.ts';
import { evaluatePrerequisiteAST, type PrerequisiteEvalContext } from './prerequisites.ts';
import {
  aggregateProgressionChassis,
  buildHitDieTrackFromClass,
  collectClassFeaturesUpToLevel,
  computeEffectiveClassCastingLevel,
  computeNpcClassCrContribution,
  getEligibleBaseCastingClassesForPrestige
} from './progression.ts';
import { applyRaceToActorChassis } from './races.ts';
import { getDnD35EntityData, projectDnD35ActorSemanticTags, setDnD35EntityData } from './srd_registry.ts';
import {
  applyNegativeLevelsToActor,
  applyPermanentLevelDrainToActor,
  buildActorSpellbooksByClass,
  buildClassAndDomainEffectModifiers,
  collectActiveClassFeaturesAndPools,
  collectActiveGrantedAndVirtualFeats,
  rebuildActorStateFromLevelHistory
} from './level_ledger.ts';
import { computeMaxSkillRankCap, SYNERGY_REQUIRED_RANKS } from './skills.ts';
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
import {
  type DnD35ClassDefinition,
  type DnD35RaceDefinition,
  type DnD35SpellDefinition,
  type DnD35SystemContent,
  getDnD35SystemContent
} from './types/dnd35e_system.types.ts';

export {
  applyNegativeLevelsToActor,
  applyPermanentLevelDrainToActor,
  buildActorSpellbooksByClass,
  buildClassAndDomainEffectModifiers,
  collectActiveClassFeaturesAndPools,
  collectActiveGrantedAndVirtualFeats,
  computeNpcClassCrContribution,
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

/** Standard D&D 3.5e Elite Array ability scores (PCs, Monsters with PC classes, Heroic NPCs). */
export const ELITE_ABILITY_ARRAY: ReadonlyArray<number> = [15, 14, 13, 12, 10, 8];

/** Standard D&D 3.5e Nonelite Array ability scores (creatures with only NPC class levels, DMG p. 110). */
export const NONELITE_ABILITY_ARRAY: ReadonlyArray<number> = [13, 12, 11, 10, 9, 8];

/** Minimum and maximum base ability scores allowed in Point-Buy. */
export const POINT_BUY_MIN_SCORE = 8;
export const POINT_BUY_MAX_SCORE = 18;

/** First-level skill point multiplier (`x4`). */
const FIRST_LEVEL_SKILL_MULTIPLIER = 4;

/** Minimum skill points gained per level regardless of negative INT modifier (`1`). */
const MIN_SKILL_POINTS_PER_LEVEL = 1;

/** Minimum ranks required in a source skill to unlock a +2 synergy bonus (`5`). */
export const SYNERGY_RANK_THRESHOLD = SYNERGY_REQUIRED_RANKS;

/** Curated starting equipment packages for character creation. */
export interface StartingEquipmentPackage {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly items: ReadonlyArray<{
    readonly itemId: string;
    readonly equipSlot?: 'main_hand' | 'off_hand' | 'torso' | 'body' | 'hand' | undefined;
  }>;
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
    items: [
      { itemId: 'longsword', equipSlot: 'main_hand' },
      { itemId: 'scale_mail', equipSlot: 'torso' },
      { itemId: 'heavy_wooden_shield', equipSlot: 'off_hand' },
      { itemId: 'backpack' },
      { itemId: 'health_potion' }
    ],
    weaponDice: '1d8',
    weaponDamageType: 'slashing',
    armorBonus: 4,
    shieldBonus: 2
  },
  {
    id: 'skirmisher_scout',
    name: 'Skirmisher & Scout Kit',
    description: 'Shortsword (1d6 piercing), Leather Armor (+3 armor), Thieves Tools, Backpack.',
    items: [
      { itemId: 'short_sword', equipSlot: 'main_hand' },
      { itemId: 'leather_armor', equipSlot: 'torso' },
      { itemId: 'lockpick' },
      { itemId: 'backpack' },
      { itemId: 'health_potion' }
    ],
    weaponDice: '1d6',
    weaponDamageType: 'piercing',
    armorBonus: 3,
    shieldBonus: 0
  },
  {
    id: 'divine_templar',
    name: 'Divine Templar Kit',
    description: 'Heavy Mace (1d8 bludgeoning), Chainmail (+5 armor), Heavy Shield (+2 shield), Wooden Holy Symbol.',
    items: [
      { itemId: 'heavy_mace', equipSlot: 'main_hand' },
      { itemId: 'chainmail', equipSlot: 'torso' },
      { itemId: 'heavy_wooden_shield', equipSlot: 'off_hand' },
      { itemId: 'backpack' },
      { itemId: 'health_potion' }
    ],
    weaponDice: '1d8',
    weaponDamageType: 'bludgeoning',
    armorBonus: 5,
    shieldBonus: 2
  },
  {
    id: 'arcane_scholar',
    name: 'Arcane Scholar & Monk Kit',
    description: 'Quarterstaff (1d6 bludgeoning), Scholar Robes (+0 armor), Backpack, Health Potion.',
    items: [
      { itemId: 'quarterstaff', equipSlot: 'main_hand' },
      { itemId: 'scholar_robes', equipSlot: 'torso' },
      { itemId: 'backpack' },
      { itemId: 'health_potion' }
    ],
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
  readonly spendSkillPointsForLiteracy?: boolean | undefined;
  readonly selectedFeats: ReadonlyArray<string>;
  readonly selectedAcfs?: ReadonlyArray<string> | undefined;
  readonly learnedSpells?: ReadonlyArray<string> | undefined;
  readonly advancedSpellcastingClassIds?: ReadonlyArray<string> | undefined;
  readonly learnedSpellsByClass?: Readonly<Record<string, ReadonlyArray<string>>> | undefined;
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
  return computeMaxSkillRankCap(totalHd, isClassSkill);
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

  const creatureTypeEngine = sysContent.creatureTypes[raceDef.creatureType];
  const withRaceResult = applyRaceToActorChassis(withBaseAbilities, raceDef, creatureTypeEngine);
  const withRace = withRaceResult.entityData;
  const levelOneTrack = buildHitDieTrackFromClass(classDef, 1);
  const nextTracks: ReadonlyArray<HitDieTrack> = [...withRace.tracks, levelOneTrack];
  const suppressedIds = currentData.suppressedBundleIds ?? [];
  const activeTags = projectDnD35ActorSemanticTags(withRace);
  const classAndDomainMods = buildClassAndDomainEffectModifiers(
    nextTracks,
    draft.selectedAcfs,
    draft.domains,
    sysContent.classes,
    sysContent.domains,
    suppressedIds,
    activeTags
  );

  const equipPkg =
    STARTING_EQUIPMENT_PACKAGES.find((p) => p.id === draft.equipmentPackageId) ?? STARTING_EQUIPMENT_PACKAGES[0]!;

  const activeFeatures = collectClassFeaturesUpToLevel(classDef, 1, draft.selectedAcfs);
  const hasPounce = activeFeatures.includes('pounce') || withRace.hasPounce === true;

  const grantedFeats = collectActiveGrantedAndVirtualFeats(
    nextTracks,
    draft.selectedAcfs,
    draft.domains,
    sysContent.classes,
    sysContent.domains,
    suppressedIds,
    activeTags
  );
  const mergedFeats = Array.from(new Set([...withRace.feats, ...draft.selectedFeats, ...grantedFeats]));

  const levelOneRecord: DnD35CharacterLevelRecord = {
    characterLevel: 1,
    classId: classDef.id,
    classLevel: 1,
    hpRolled: classDef.hitDieSides,
    addedSkillRanks: draft.skillRanks,
    selectedFeats: draft.selectedFeats,
    selectedAcfs: draft.selectedAcfs,
    learnedSpells: draft.knownSpells,
    learnedSpellsByClass: { [classDef.id]: draft.knownSpells }
  };

  const basePreRebuildData: DnD35EntityData = {
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

  const rebuiltData = rebuildActorStateFromLevelHistory(basePreRebuildData, [levelOneRecord], sysContent);
  const updatedData: DnD35EntityData = {
    ...rebuiltData,
    feats: Array.from(new Set([...withRace.feats, ...rebuiltData.feats])),
    preparedSpells: rebuiltData.knownSpells
  };

  const conMod = computeAbilityModifier(computeEffectiveAbilityScore(updatedData.abilityScores.con));
  const chassis = aggregateProgressionChassis(updatedData.tracks, conMod, updatedData.levelAdjustment ?? 0);

  let runningState = setDnD35EntityData(state, entityId, updatedData);

  // Materialize starting equipment into Inventory and Equipment slots
  const inventory = getComponent(runningState, entityId, ComponentType.Inventory) as InventoryComponent | undefined;
  const equipment = getComponent(runningState, entityId, ComponentType.Equipment) as EquipmentComponent | undefined;

  if (inventory && equipPkg.items) {
    const spawnedItemIds: EntityId[] = [];
    const updatedSlots = equipment ? equipment.slots.map((s) => ({ ...s })) : [];

    for (const itemEntry of equipPkg.items) {
      if (runningState.campaign.items[itemEntry.itemId]) {
        let itemEntityId: EntityId;
        [runningState, itemEntityId] = spawnItem(runningState, itemEntry.itemId, 0, 0);
        runningState = removeComponent(runningState, itemEntityId, ComponentType.Position);
        spawnedItemIds.push(itemEntityId);

        if (itemEntry.equipSlot && updatedSlots.length > 0) {
          const targetSlotType = itemEntry.equipSlot;
          const slot = updatedSlots.find((s) => {
            if (s.equippedItem !== null) return false;
            if (targetSlotType === 'main_hand' || targetSlotType === 'off_hand') {
              return s.slotType === targetSlotType || s.slotType === 'hand' || s.slotType === 'held';
            }
            if (targetSlotType === 'torso') {
              return s.slotType === 'torso' || s.slotType === 'body';
            }
            return s.slotType === targetSlotType;
          });
          if (slot) {
            (slot as { equippedItem: EntityId | null }).equippedItem = itemEntityId;
          }
        }
      }
    }

    if (spawnedItemIds.length > 0) {
      runningState = addComponent(runningState, entityId, {
        ...inventory,
        items: [...inventory.items, ...spawnedItemIds]
      });
    }

    if (equipment && updatedSlots.length > 0) {
      runningState = addComponent(runningState, entityId, {
        ...equipment,
        slots: updatedSlots
      });
    }
  }

  const fighter = getComponent(runningState, entityId, ComponentType.Fighter) as FighterComponent | undefined;
  if (!fighter) return runningState;

  return addComponent(runningState, entityId, {
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

  const flatLearnedSpells = new Set<string>(choice.learnedSpells ?? []);
  if (choice.learnedSpellsByClass) {
    for (const spList of Object.values(choice.learnedSpellsByClass)) {
      for (const spId of spList) {
        flatLearnedSpells.add(spId);
      }
    }
  }

  const newRecord: DnD35CharacterLevelRecord = {
    characterLevel: nextCharLevel,
    classId: classDef.id,
    classLevel: nextClassLevel,
    hpRolled: rawRoll,
    ...(choice.abilityScoreIncrease !== undefined ? { abilityScoreIncrease: choice.abilityScoreIncrease } : {}),
    addedSkillRanks: choice.addedSkillRanks,
    selectedFeats: choice.selectedFeats,
    selectedAcfs: choice.selectedAcfs ?? [],
    learnedSpells: Array.from(flatLearnedSpells),
    ...(choice.advancedSpellcastingClassIds !== undefined
      ? { advancedSpellcastingClassIds: choice.advancedSpellcastingClassIds }
      : {}),
    ...(choice.learnedSpellsByClass !== undefined ? { learnedSpellsByClass: choice.learnedSpellsByClass } : {})
  };

  let prevHistory = dndData.levelHistory ?? [];
  if (prevHistory.length === 0) {
    let charLvl = 1;
    const synthesized: DnD35CharacterLevelRecord[] = [];
    for (const track of dndData.tracks) {
      if (sysContent.classes[track.trackId]) {
        for (let l = 1; l <= track.levels; l++) {
          synthesized.push({
            characterLevel: charLvl++,
            classId: track.trackId,
            classLevel: l,
            hpRolled: track.hitDieSides,
            addedSkillRanks: {},
            selectedFeats: [],
            selectedAcfs: [],
            learnedSpells: []
          });
        }
      }
    }
    prevHistory = synthesized;
  }
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
    {
      ...dndData,
      abilityScores: baseAbilities,
      ...(dndData.spentLiteracySkillPoints === true || choice.spendSkillPointsForLiteracy === true
        ? { spentLiteracySkillPoints: true }
        : {})
    },
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

/**
 * Computes the 1st-level feat slot budget breakdown (`generalSlots`, `humanBonusSlots`, `fighterBonusSlots`, `totalSlots`).
 *
 * @param raceDef Selected 1st-level race definition.
 * @param classDef Selected 1st-level class definition.
 * @returns Breakdown of 1st-level feat slots.
 */
export function computeFirstLevelFeatSlotBudget(
  raceDef: DnD35RaceDefinition | undefined,
  classDef: DnD35ClassDefinition | undefined
): {
  readonly generalSlots: number;
  readonly humanBonusSlots: number;
  readonly fighterBonusSlots: number;
  readonly totalSlots: number;
} {
  const generalSlots = 1;
  const humanBonusSlots = raceDef?.bonusFeatAtFirstLevel === true ? 1 : 0;
  const row1 = classDef?.progression.find((r) => r.level === 1);
  const fighterBonusSlots = row1?.bonusFeatSlot === true ? 1 : 0;
  return {
    generalSlots,
    humanBonusSlots,
    fighterBonusSlots,
    totalSlots: generalSlots + humanBonusSlots + fighterBonusSlots
  };
}

/**
 * Returns the spell level of a spell for a given class (or Cleric domain), or `null` if the spell is not on that class's spell list.
 *
 * @param spell Spell definition.
 * @param classId Class identifier (`'wizard'`, `'cleric'`, etc.).
 * @param domainIds Active Cleric domain IDs.
 * @returns Effective spell level (`0..9`) or `null`.
 */
export function getSpellLevelForClass(
  spell: DnD35SpellDefinition,
  classId: string,
  domainIds: ReadonlyArray<string> = []
): number | null {
  const classLevel = spell.levelByClass[classId];
  if (classLevel !== undefined) {
    return classLevel;
  }
  if (classId === 'cleric') {
    for (const domId of domainIds) {
      const domLvl = spell.levelByDomain[domId];
      if (domLvl !== undefined) {
        return domLvl;
      }
    }
  }
  return null;
}

/**
 * Checks whether a spell is legal for a character creation draft or level-up given their class,
 * maximum castable spell level, Cleric domains, and Wizard prohibited schools.
 *
 * @param spell Spell definition.
 * @param classId Class identifier.
 * @param maxCastableLevel Highest spell level the class can cast at this level (`0` or `1` at level 1).
 * @param prohibitedSchools Wizard prohibited schools.
 * @param domainIds Selected Cleric domains.
 * @returns `{ selectable: boolean; effectiveLevel: number | null; reason?: string }`.
 */
export function isSpellSelectableForDraft(
  spell: DnD35SpellDefinition,
  classId: string,
  maxCastableLevel: number,
  prohibitedSchools: ReadonlyArray<DnD35SpellSchool> = [],
  domainIds: ReadonlyArray<string> = []
): { readonly selectable: boolean; readonly effectiveLevel: number | null; readonly reason?: string } {
  const effectiveLevel = getSpellLevelForClass(spell, classId, domainIds);
  if (effectiveLevel === null) {
    return { selectable: false, effectiveLevel: null, reason: 'Not on class spell list' };
  }
  if (effectiveLevel > maxCastableLevel) {
    return {
      selectable: false,
      effectiveLevel,
      reason: `Requires spell level ${effectiveLevel} slots`
    };
  }
  if (prohibitedSchools.includes(spell.school as DnD35SpellSchool)) {
    return {
      selectable: false,
      effectiveLevel,
      reason: `Prohibited school (${spell.school})`
    };
  }
  return { selectable: true, effectiveLevel };
}

/**
 * Computes the effective list of class skill IDs for a class + Cleric domains.
 *
 * @param classDef Class definition.
 * @param domainIds Selected domain IDs.
 * @param sysContent Loaded system content.
 * @returns Deduplicated array of class skill IDs.
 */
export function getEffectiveClassSkillIds(
  classDef: DnD35ClassDefinition | undefined,
  domainIds: ReadonlyArray<string>,
  sysContent: DnD35SystemContent
): ReadonlyArray<string> {
  if (!classDef) return [];
  const skills = new Set<string>(classDef.classSkills);
  for (const domId of domainIds) {
    const dom = sysContent.domains[domId];
    if (dom) {
      for (const s of dom.classSkillsAdded) {
        skills.add(s);
      }
    }
  }
  return Array.from(skills);
}

/**
 * Computes the union of all class skill IDs across EVERY class the actor has ever taken
 * (plus the currently advancing class and Cleric domains).
 * Per D&D 3.5e Multiclass Skill Rules (PHB p. 62):
 * - If a skill is a class skill for ANY of a multiclass character's classes, max rank is `TotalHD + 3`.
 * - Point purchase cost (`1.0` vs `0.5` rank/point) still uses `getEffectiveClassSkillIds` for the currently advancing class.
 *
 * @param dndData Optional existing `DnD35EntityData` of the actor.
 * @param advancingClassId Class ID being advanced at the current level.
 * @param domainIds Active Cleric domain IDs.
 * @param sysContent Loaded system content.
 * @returns Deduplicated array of all ever-class skill IDs.
 */
export function getActorEverClassSkillIds(
  dndData: DnD35EntityData | undefined,
  advancingClassId: string,
  domainIds: ReadonlyArray<string>,
  sysContent: DnD35SystemContent
): ReadonlyArray<string> {
  const skills = new Set<string>();
  const addFromClass = (cId: string): void => {
    const cDef = sysContent.classes[cId];
    if (!cDef) return;
    for (const sId of cDef.classSkills) {
      skills.add(sId);
    }
  };

  if (dndData) {
    for (const track of dndData.tracks) {
      if (track.levels > 0) {
        addFromClass(track.trackId);
      }
    }
    for (const rec of dndData.levelHistory ?? []) {
      addFromClass(rec.classId);
    }
  }
  addFromClass(advancingClassId);

  for (const domId of domainIds) {
    const dom = sysContent.domains[domId];
    if (dom) {
      for (const s of dom.classSkillsAdded) {
        skills.add(s);
      }
    }
  }

  return Array.from(skills);
}

/**
 * Resolves the canonical spell acquisition mode for a class (`'none' | 'spellbook_scribed' | 'spontaneous_known' | 'prayerbook_full_list'`).
 *
 * @param classDef Class definition.
 * @returns Resolved spell acquisition mode.
 */
export function resolveClassSpellAcquisitionMode(
  classDef: DnD35ClassDefinition | undefined
): 'none' | 'spellbook_scribed' | 'spontaneous_known' | 'prayerbook_full_list' {
  if (!classDef || classDef.castingMode === 'none' || classDef.castingTradition === 'none') {
    return 'none';
  }
  if (classDef.spellAcquisitionMode) {
    return classDef.spellAcquisitionMode;
  }
  if (classDef.castingTradition === 'divine' && classDef.castingMode === 'prepared') {
    return 'prayerbook_full_list';
  }
  if (classDef.castingMode === 'spontaneous') {
    return 'spontaneous_known';
  }
  return 'spellbook_scribed';
}

/** Per-class spell selection budget for a Character Creation or Level-Up step. */
export interface ClassSpellSelectionBudget {
  readonly classId: string;
  readonly className: string;
  readonly spellAcquisitionMode: 'none' | 'spellbook_scribed' | 'spontaneous_known' | 'prayerbook_full_list';
  readonly requiresManualSelection: boolean;
  readonly prevEffectiveCasterLevel: number;
  readonly nextEffectiveCasterLevel: number;
  readonly maxCastableLevel: number;
  readonly autoGrantedCantripIds: ReadonlyArray<string>;
  /** Free-pick spell count across any castable spell level 1..maxCastableLevel (e.g. Wizard +2 spells at Lv 2+). */
  readonly freePickCount: number;
  /** Exact new spells to pick per spell level (e.g. Sorcerer/Bard/Assassin spellsKnown delta, or Wizard 3+INT Lv1 spells). */
  readonly requiredBySpellLevel: Readonly<Record<number, number>>;
}

/**
 * Computes the exact spell selection budget for a class advancing from `prevEffectiveCasterLevel`
 * to `nextEffectiveCasterLevel`.
 * - Divine Prayerbook casters (`cleric`, `druid`, `paladin`, `ranger`, `blackguard`, `adept`) have
 *   `requiresManualSelection: false` because they automatically know their full class + domain list.
 * - Wizards (`spellbook_scribed`) auto-learn all 0-level cantrips (excluding prohibited schools) plus
 *   `3 + max(0, intMod)` 1st-level spells at effective caster level 1, and `+2` spells of any castable
 *   level `1..maxCastableLevel` at each subsequent effective caster level.
 * - Spontaneous casters (`sorcerer`, `bard`, `assassin`) select the exact delta in their `spellsKnown` table.
 */
export function computeClassSpellSelectionBudget(
  classDef: DnD35ClassDefinition | undefined,
  prevEffectiveCasterLevel: number,
  nextEffectiveCasterLevel: number,
  intModifier: number,
  prohibitedSchools: ReadonlyArray<DnD35SpellSchool>,
  domainIds: ReadonlyArray<string>,
  alreadyKnownSpellIds: ReadonlyArray<string>,
  sysContent: DnD35SystemContent
): ClassSpellSelectionBudget {
  const mode = resolveClassSpellAcquisitionMode(classDef);
  if (
    !classDef ||
    mode === 'none' ||
    nextEffectiveCasterLevel <= prevEffectiveCasterLevel ||
    nextEffectiveCasterLevel <= 0
  ) {
    return {
      classId: classDef?.id ?? '',
      className: classDef?.name ?? '',
      spellAcquisitionMode: mode,
      requiresManualSelection: false,
      prevEffectiveCasterLevel,
      nextEffectiveCasterLevel,
      maxCastableLevel: -1,
      autoGrantedCantripIds: [],
      freePickCount: 0,
      requiredBySpellLevel: {}
    };
  }

  const clampedNow = Math.min(classDef.maxLevel, nextEffectiveCasterLevel);
  const rowNow = classDef.progression.find((r) => r.level === clampedNow);
  let maxCastableLevel = -1;
  if (rowNow?.spellsPerDay) {
    for (const [lvlKey, slots] of Object.entries(rowNow.spellsPerDay)) {
      const lvl = Number(lvlKey);
      if (!Number.isNaN(lvl) && slots >= 0 && lvl > maxCastableLevel) {
        maxCastableLevel = lvl;
      }
    }
  }

  if (maxCastableLevel < 0 || mode === 'prayerbook_full_list') {
    return {
      classId: classDef.id,
      className: classDef.name,
      spellAcquisitionMode: mode,
      requiresManualSelection: false,
      prevEffectiveCasterLevel,
      nextEffectiveCasterLevel,
      maxCastableLevel,
      autoGrantedCantripIds: [],
      freePickCount: 0,
      requiredBySpellLevel: {}
    };
  }

  const getUnlearnedSelectableAtLevel = (lvl: number): ReadonlyArray<DnD35SpellDefinition> =>
    Object.values(sysContent.spells).filter(
      (sp) =>
        !alreadyKnownSpellIds.includes(sp.id) &&
        isSpellSelectableForDraft(sp, classDef.id, maxCastableLevel, prohibitedSchools, domainIds).selectable &&
        getSpellLevelForClass(sp, classDef.id, domainIds) === lvl
    );

  if (mode === 'spellbook_scribed') {
    if (prevEffectiveCasterLevel === 0) {
      const autoGrantedCantripIds = getUnlearnedSelectableAtLevel(0).map((s) => s.id);
      const availLvl1 = getUnlearnedSelectableAtLevel(1).length;
      const targetLvl1 = Math.min(availLvl1, Math.max(1, 3 + Math.max(0, intModifier)));
      const requiredBySpellLevel: Record<number, number> = targetLvl1 > 0 ? { 1: targetLvl1 } : {};
      return {
        classId: classDef.id,
        className: classDef.name,
        spellAcquisitionMode: mode,
        requiresManualSelection: targetLvl1 > 0,
        prevEffectiveCasterLevel,
        nextEffectiveCasterLevel,
        maxCastableLevel,
        autoGrantedCantripIds,
        freePickCount: 0,
        requiredBySpellLevel
      };
    }

    let totalUnlearned = 0;
    for (let l = 1; l <= maxCastableLevel; l++) {
      totalUnlearned += getUnlearnedSelectableAtLevel(l).length;
    }
    const levelDelta = Math.max(1, nextEffectiveCasterLevel - prevEffectiveCasterLevel);
    const freePickCount = Math.min(totalUnlearned, 2 * levelDelta);
    return {
      classId: classDef.id,
      className: classDef.name,
      spellAcquisitionMode: mode,
      requiresManualSelection: freePickCount > 0,
      prevEffectiveCasterLevel,
      nextEffectiveCasterLevel,
      maxCastableLevel,
      autoGrantedCantripIds: [],
      freePickCount,
      requiredBySpellLevel: {}
    };
  }

  // spontaneous_known
  const clampedPrev = prevEffectiveCasterLevel > 0 ? Math.min(classDef.maxLevel, prevEffectiveCasterLevel) : 0;
  const rowPrev = clampedPrev > 0 ? classDef.progression.find((r) => r.level === clampedPrev) : undefined;
  const requiredBySpellLevel: Record<number, number> = {};
  let totalRequired = 0;

  for (let lvl = 0; lvl <= maxCastableLevel; lvl++) {
    const nowKnown = rowNow?.spellsKnown?.[String(lvl)] ?? 0;
    const prevKnown = rowPrev?.spellsKnown?.[String(lvl)] ?? 0;
    const delta = Math.max(0, nowKnown - prevKnown);
    if (delta > 0) {
      const avail = getUnlearnedSelectableAtLevel(lvl).length;
      const clamped = Math.min(delta, avail);
      if (clamped > 0) {
        requiredBySpellLevel[lvl] = clamped;
        totalRequired += clamped;
      }
    }
  }

  return {
    classId: classDef.id,
    className: classDef.name,
    spellAcquisitionMode: mode,
    requiresManualSelection: totalRequired > 0,
    prevEffectiveCasterLevel,
    nextEffectiveCasterLevel,
    maxCastableLevel,
    autoGrantedCantripIds: [],
    freePickCount: 0,
    requiredBySpellLevel
  };
}

/**
 * Validates that a set of selected spell IDs for a class satisfies its `ClassSpellSelectionBudget`.
 */
export function validateClassSpellSelection(
  selectedSpellIds: ReadonlyArray<string>,
  budget: ClassSpellSelectionBudget,
  prohibitedSchools: ReadonlyArray<DnD35SpellSchool>,
  domainIds: ReadonlyArray<string>,
  sysContent: DnD35SystemContent
): { readonly valid: boolean; readonly reason?: string } {
  if (!budget.requiresManualSelection) {
    return { valid: true };
  }

  // Filter out auto-granted cantrips if included in selectedSpellIds
  const manualPicks = selectedSpellIds.filter((id) => !budget.autoGrantedCantripIds.includes(id));

  for (const spId of manualPicks) {
    const sp = sysContent.spells[spId];
    if (!sp) {
      return { valid: false, reason: `Unknown spell "${spId}".` };
    }
    const sel = isSpellSelectableForDraft(sp, budget.classId, budget.maxCastableLevel, prohibitedSchools, domainIds);
    if (!sel.selectable) {
      return { valid: false, reason: `${sp.name}: ${sel.reason ?? 'Not selectable'}` };
    }
  }

  if (budget.freePickCount > 0) {
    const validLvlPicks = manualPicks.filter((spId) => {
      const sp = sysContent.spells[spId];
      const lvl = sp ? getSpellLevelForClass(sp, budget.classId, domainIds) : null;
      return lvl !== null && lvl >= 1 && lvl <= budget.maxCastableLevel;
    });
    if (validLvlPicks.length !== budget.freePickCount) {
      return {
        valid: false,
        reason: `Select ${budget.freePickCount} new spell(s) for ${budget.className} (${validLvlPicks.length}/${budget.freePickCount} selected).`
      };
    }
    return { valid: true };
  }

  const countsByLevel: Record<number, number> = {};
  for (const spId of manualPicks) {
    const sp = sysContent.spells[spId];
    if (!sp) continue;
    const lvl = getSpellLevelForClass(sp, budget.classId, domainIds);
    if (lvl !== null) {
      countsByLevel[lvl] = (countsByLevel[lvl] ?? 0) + 1;
    }
  }

  for (const [lvlKey, reqCount] of Object.entries(budget.requiredBySpellLevel)) {
    const lvl = Number(lvlKey);
    const actual = countsByLevel[lvl] ?? 0;
    if (actual !== reqCount) {
      return {
        valid: false,
        reason: `Select ${reqCount} level-${lvl} spell(s) for ${budget.className} (${actual}/${reqCount} selected).`
      };
    }
  }

  for (const [lvlKey, actual] of Object.entries(countsByLevel)) {
    const lvl = Number(lvlKey);
    const reqCount = budget.requiredBySpellLevel[lvl] ?? 0;
    if (actual > reqCount) {
      return {
        valid: false,
        reason: `Too many level-${lvl} spells selected for ${budget.className} (${actual}/${reqCount}).`
      };
    }
  }

  return { valid: true };
}

/**
 * Validates a specific step of the Character Creation draft (`race`, `class`, `abilities`, `skills`, `feats`, `spells`, `equipment`).
 */
export function validateCharacterCreationStep(
  draft: CharacterCreationDraft,
  stepId: 'race' | 'class' | 'abilities' | 'skills' | 'feats' | 'spells' | 'equipment',
  sysContent: DnD35SystemContent
): { readonly valid: boolean; readonly reason?: string } {
  const raceDef = sysContent.races[draft.raceId];
  const classDef = sysContent.classes[draft.classId];

  if (stepId === 'race') {
    if (!raceDef) return { valid: false, reason: 'Please select a valid race.' };
    return { valid: true };
  }

  if (stepId === 'class') {
    if (!classDef) return { valid: false, reason: 'Please select a valid class.' };
    if (classDef.allowedAlignments && classDef.allowedAlignments.length > 0) {
      if (!classDef.allowedAlignments.includes(draft.alignment)) {
        return {
          valid: false,
          reason: `${classDef.name} requires alignment in: ${classDef.allowedAlignments.join(', ')}.`
        };
      }
    }
    if (classDef.id === 'cleric' && draft.domains.length !== 2) {
      return { valid: false, reason: 'Clerics must select exactly 2 deity domains.' };
    }
    if (classDef.id === 'wizard') {
      const schoolCheck = validateSpecialistSchoolSelection(draft.arcaneSchool ?? 'universal', draft.prohibitedSchools);
      if (!schoolCheck.valid) return schoolCheck;
    }
    if (classDef.id === 'ranger' && !draft.favoredEnemyType) {
      return { valid: false, reason: 'Rangers must select a 1st-level Favored Enemy.' };
    }
    return { valid: true };
  }

  if (stepId === 'abilities') {
    if (draft.abilityMethod === 'point_buy') {
      const spent = calculatePointBuyCost(draft.baseAbilityScores);
      if (spent !== draft.pointBuyBudget) {
        return {
          valid: false,
          reason: `Spend all Point-Buy points before continuing (${spent}/${draft.pointBuyBudget} spent).`
        };
      }
    }
    return { valid: true };
  }

  if (stepId === 'skills') {
    if (!raceDef || !classDef) return { valid: false, reason: 'Select race and class first.' };
    const intMod = computeAbilityModifier(draft.baseAbilityScores.int + (raceDef.abilityAdjustments.int ?? 0));
    const budget = calculateLevelSkillPointBudget(
      classDef.skillPointsPerLevel,
      intMod,
      true,
      raceDef.extraSkillPointsFirstLevel,
      raceDef.extraSkillPointsPerLevel
    );
    const classSkills = getEffectiveClassSkillIds(classDef, draft.domains, sysContent);
    const spent = calculateSkillAllocationCost(draft.skillRanks, classSkills);
    if (spent > budget) {
      return { valid: false, reason: `Skill points overspent (${spent}/${budget}).` };
    }
    if (spent < budget) {
      return { valid: false, reason: `Allocate all remaining skill points (${spent}/${budget} spent).` };
    }
    return { valid: true };
  }

  if (stepId === 'feats') {
    const featBudget = computeFirstLevelFeatSlotBudget(raceDef, classDef);
    if (draft.selectedFeats.length !== featBudget.totalSlots) {
      return {
        valid: false,
        reason: `Select ${featBudget.totalSlots} feat(s) before continuing (${draft.selectedFeats.length}/${featBudget.totalSlots} selected).`
      };
    }
    return { valid: true };
  }

  if (stepId === 'spells') {
    if (!classDef || !raceDef) return { valid: true };
    const intMod = computeAbilityModifier(draft.baseAbilityScores.int + (raceDef.abilityAdjustments.int ?? 0));
    const spellBudget = computeClassSpellSelectionBudget(
      classDef,
      0,
      1,
      intMod,
      draft.prohibitedSchools,
      draft.domains,
      [],
      sysContent
    );
    return validateClassSpellSelection(
      draft.knownSpells,
      spellBudget,
      draft.prohibitedSchools,
      draft.domains,
      sysContent
    );
  }

  if (stepId === 'equipment') {
    const pkg = STARTING_EQUIPMENT_PACKAGES.find((p) => p.id === draft.equipmentPackageId);
    if (!pkg) return { valid: false, reason: 'Please select a starting equipment package.' };
    return { valid: true };
  }

  return { valid: true };
}

/**
 * Validates a specific step of the Level-Up modal (`class`, `skills`, `feats`, or `spells:<classId>`).
 */
export function validateLevelUpStep(
  dndData: DnD35EntityData,
  choice: LevelUpChoice,
  stepKey: string,
  sysContent: DnD35SystemContent
): { readonly valid: boolean; readonly reason?: string } {
  const classDef = sysContent.classes[choice.classId];
  if (!classDef) {
    return { valid: false, reason: 'Please select a valid class to advance.' };
  }

  const conMod = computeAbilityModifier(computeEffectiveAbilityScore(dndData.abilityScores.con));
  const prevChassis = aggregateProgressionChassis(dndData.tracks, conMod, dndData.levelAdjustment ?? 0);
  const newTotalHd = prevChassis.totalHD + 1;
  const existingTrack = dndData.tracks.find((t) => t.trackId === classDef.id);
  const nextClassLevel = (existingTrack ? existingTrack.levels : 0) + 1;

  if (stepKey === 'class') {
    if (nextClassLevel > classDef.maxLevel) {
      return { valid: false, reason: `Already at maximum level (${classDef.maxLevel}) for ${classDef.name}.` };
    }
    if (classDef.prerequisites) {
      const prereqCtx = buildPrerequisiteContextForActor(dndData, sysContent.classes);
      if (!evaluatePrerequisiteAST(classDef.prerequisites, prereqCtx)) {
        return { valid: false, reason: `Prerequisites not met for ${classDef.name}.` };
      }
    }
    if (newTotalHd % 4 === 0 && !choice.abilityScoreIncrease) {
      return { valid: false, reason: `Select a +1 Ability Score Increase for reaching HD ${newTotalHd}.` };
    }
    const prcSlots = getEligibleBaseCastingClassesForPrestige(
      dndData.tracks,
      classDef,
      nextClassLevel,
      sysContent.classes
    );
    const nonEmptySlots = prcSlots.filter((s) => s.eligibleClassIds.length > 0);
    if (nonEmptySlots.length > 0) {
      const chosen = choice.advancedSpellcastingClassIds ?? [];
      if (chosen.length < nonEmptySlots.length || chosen.some((c) => !c)) {
        return {
          valid: false,
          reason: `Select which base spellcasting class(es) ${classDef.name} advances.`
        };
      }
    }
    return { valid: true };
  }

  if (stepKey === 'skills') {
    const raceDef = dndData.raceId ? sysContent.races[dndData.raceId] : undefined;
    let effInt = computeEffectiveAbilityScore(dndData.abilityScores.int);
    if (choice.abilityScoreIncrease === 'int' && effInt !== null) {
      effInt += 1;
    }
    const intMod = computeAbilityModifier(effInt);
    const budget = calculateLevelSkillPointBudget(
      classDef.skillPointsPerLevel,
      intMod,
      false,
      0,
      raceDef?.extraSkillPointsPerLevel ?? 0
    );
    const activeLevelClassSkills = getEffectiveClassSkillIds(classDef, dndData.domains ?? [], sysContent);
    const literacyCost = choice.spendSkillPointsForLiteracy === true ? 2 : 0;
    const spent = calculateSkillAllocationCost(choice.addedSkillRanks, activeLevelClassSkills) + literacyCost;
    if (spent > budget) {
      return { valid: false, reason: `Skill points overspent (${spent}/${budget}).` };
    }
    if (spent < budget) {
      return { valid: false, reason: `Allocate all remaining skill points (${spent}/${budget} spent).` };
    }
    return { valid: true };
  }

  if (stepKey === 'feats') {
    const gainsGeneralFeat = newTotalHd % 3 === 0;
    const row = classDef.progression.find((r) => r.level === nextClassLevel);
    const gainsBonusFeat = row?.bonusFeatSlot === true;
    const totalFeatSlots = (gainsGeneralFeat ? 1 : 0) + (gainsBonusFeat ? 1 : 0);
    if (choice.selectedFeats.length !== totalFeatSlots) {
      return {
        valid: false,
        reason: `Select ${totalFeatSlots} feat(s) before continuing (${choice.selectedFeats.length}/${totalFeatSlots} selected).`
      };
    }
    return { valid: true };
  }

  if (stepKey.startsWith('spells:')) {
    const targetClassId = stepKey.slice('spells:'.length);
    const targetClassDef = sysContent.classes[targetClassId];
    if (!targetClassDef) return { valid: true };

    const prevCasterLvl = computeEffectiveClassCastingLevel(
      dndData.tracks,
      targetClassDef,
      sysContent.classes,
      dndData.levelHistory
    );
    const nextCasterLvl = prevCasterLvl + 1;
    let effInt = computeEffectiveAbilityScore(dndData.abilityScores.int);
    if (choice.abilityScoreIncrease === 'int' && effInt !== null) {
      effInt += 1;
    }
    const intMod = computeAbilityModifier(effInt);
    const existingKnown = dndData.spellbooksByClass?.[targetClassId]?.knownSpellIds ?? dndData.knownSpells ?? [];
    const budget = computeClassSpellSelectionBudget(
      targetClassDef,
      prevCasterLvl,
      nextCasterLvl,
      intMod,
      dndData.prohibitedSchools ?? [],
      dndData.domains ?? [],
      existingKnown,
      sysContent
    );
    const selectedForClass =
      choice.learnedSpellsByClass?.[targetClassId] ??
      (choice.classId === targetClassId ? (choice.learnedSpells ?? []) : []);
    return validateClassSpellSelection(
      selectedForClass,
      budget,
      dndData.prohibitedSchools ?? [],
      dndData.domains ?? [],
      sysContent
    );
  }

  return { valid: true };
}

/**
 * Sanitizes a `CharacterCreationDraft` whenever `raceId`, `classId`, `domains`, or `prohibitedSchools` changes,
 * pruning invalid alignments, clamping or refunding skill ranks that exceed the new point budget,
 * trimming excess feat selections, and removing spells not on the new class's spell list.
 *
 * @param draft Current draft.
 * @param sysContent Loaded D&D 3.5e system content.
 * @returns Sanitized `CharacterCreationDraft`.
 */
export function sanitizeDraftOnRaceOrClassChange(
  draft: CharacterCreationDraft,
  sysContent: DnD35SystemContent
): CharacterCreationDraft {
  const raceDef = sysContent.races[draft.raceId];
  const classDef = sysContent.classes[draft.classId];
  if (!raceDef || !classDef) return draft;

  const allowedAlignments = classDef.allowedAlignments;
  const alignment: DnD35Alignment =
    allowedAlignments && allowedAlignments.length > 0 && !allowedAlignments.includes(draft.alignment)
      ? allowedAlignments[0]!
      : draft.alignment;

  const domains = classDef.id === 'cleric' ? draft.domains.slice(0, 2) : [];
  const arcaneSchool = classDef.id === 'wizard' ? (draft.arcaneSchool ?? 'universal') : undefined;
  const prohibitedSchools = classDef.id === 'wizard' && arcaneSchool !== 'universal' ? draft.prohibitedSchools : [];

  const validAcfs = new Set(classDef.acfSwaps.filter((a) => a.level === 1).map((a) => a.acfId));
  const selectedAcfs = draft.selectedAcfs.filter((id) => validAcfs.has(id));

  const classSkills = getEffectiveClassSkillIds(classDef, domains, sysContent);
  const intAdj = raceDef.abilityAdjustments.int ?? 0;
  const intMod = computeAbilityModifier(draft.baseAbilityScores.int + intAdj);
  const totalHd = Math.max(1, (raceDef.rhdProgression?.baseHdCount ?? 0) + 1);
  const budget = calculateLevelSkillPointBudget(
    classDef.skillPointsPerLevel,
    intMod,
    true,
    raceDef.extraSkillPointsFirstLevel,
    raceDef.extraSkillPointsPerLevel
  );

  const clampedRanks: Record<string, number> = {};
  for (const [skillId, ranks] of Object.entries(draft.skillRanks)) {
    if (ranks <= 0) continue;
    const isClass = classSkills.includes(skillId);
    const maxCap = getSkillMaxRanks(totalHd, isClass);
    const clamped = Math.min(ranks, maxCap);
    const finalized = isClass ? Math.floor(clamped) : Math.floor(clamped * 2) / 2;
    if (finalized > 0) {
      clampedRanks[skillId] = finalized;
    }
  }
  const newCost = calculateSkillAllocationCost(clampedRanks, classSkills);
  const skillRanks = newCost <= budget ? clampedRanks : {};

  const featBudget = computeFirstLevelFeatSlotBudget(raceDef, classDef);
  const selectedFeats = draft.selectedFeats.slice(0, featBudget.totalSlots);

  const spellBudget = computeClassSpellSelectionBudget(
    classDef,
    0,
    1,
    intMod,
    prohibitedSchools,
    domains,
    [],
    sysContent
  );

  const knownSpells =
    spellBudget.maxCastableLevel >= 0
      ? draft.knownSpells.filter((spellId) => {
          const spell = sysContent.spells[spellId];
          if (!spell) return false;
          return isSpellSelectableForDraft(spell, classDef.id, spellBudget.maxCastableLevel, prohibitedSchools, domains)
            .selectable;
        })
      : [];

  return {
    ...draft,
    alignment,
    selectedAcfs,
    domains,
    arcaneSchool,
    prohibitedSchools,
    ...(classDef.id === 'ranger' ? { favoredEnemyType: draft.favoredEnemyType ?? 'undead' } : {}),
    skillRanks,
    selectedFeats,
    knownSpells
  };
}
