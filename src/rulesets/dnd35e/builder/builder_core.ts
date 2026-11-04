import { evaluateDiceExpression } from '../math/dice.ts';
import { computeMaxSkillRankCap, SYNERGY_REQUIRED_RANKS } from '../skills.ts';
import {
  type AbilityId,
  ALL_ABILITY_IDS,
  type DnD35Alignment,
  type DnD35EntityData,
  type DnD35SpellSchool
} from '../types/dnd35e.types.ts';
import type { DnD35ClassDefinition, DnD35RaceDefinition, DnD35SystemContent } from '../types/dnd35e_system.types.ts';

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
      { itemId: 'health_potion' },
      { itemId: 'wooden_holy_symbol' }
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
 */
export function calculatePointBuyCost(baseScores: Readonly<Record<AbilityId, number>>): number {
  let total = 0;
  for (const abId of ALL_ABILITY_IDS) {
    const cost = POINT_BUY_COST_TABLE[baseScores[abId]];
    if (cost === undefined) return Number.POSITIVE_INFINITY;
    total += cost;
  }
  return total;
}

/**
 * Rolls 6 ability scores using deterministic `4d6kh3` (roll 4d6, keep highest 3).
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
 */
export function calculateLevelSkillPointBudget(
  skillPointsPerLevel: number,
  intModifier: number,
  isFirstLevel: boolean,
  extraRaceFirstLevel = 0,
  extraRacePerLevel = 0
): number {
  const basePerLevel = Math.max(MIN_SKILL_POINTS_PER_LEVEL, skillPointsPerLevel + intModifier);
  return isFirstLevel
    ? basePerLevel * FIRST_LEVEL_SKILL_MULTIPLIER + extraRaceFirstLevel
    : basePerLevel + extraRacePerLevel;
}

/**
 * Computes the maximum allowed skill ranks for a skill at a given total Hit Dice.
 */
export function getSkillMaxRanks(totalHd: number, isClassSkill: boolean): number {
  return computeMaxSkillRankCap(totalHd, isClassSkill);
}

/**
 * Computes the total skill points spent for a set of rank additions.
 */
export function calculateSkillAllocationCost(
  addedRanks: Readonly<Record<string, number>>,
  classSkillIds: ReadonlyArray<string>
): number {
  let spent = 0;
  for (const [skillId, delta] of Object.entries(addedRanks)) {
    if (delta <= 0) continue;
    spent += classSkillIds.includes(skillId) ? delta : delta * 2;
  }
  return Math.round(spent * 100) / 100;
}

/**
 * Computes the 1st-level feat slot budget breakdown.
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
 * Computes the effective list of class skill IDs for a class + Cleric domains.
 */
export function getEffectiveClassSkillIds(
  classDef: DnD35ClassDefinition | undefined,
  domainIds: ReadonlyArray<string>,
  sysContent: DnD35SystemContent
): ReadonlyArray<string> {
  if (!classDef) return [];
  const skills = new Set<string>();
  const addSkillWithSubskills = (sId: string): void => {
    skills.add(sId);
    if (sId === 'craft' && sysContent.skills) {
      for (const k of Object.keys(sysContent.skills)) {
        if (k.startsWith('craft_')) skills.add(k);
      }
    }
  };
  for (const s of classDef.classSkills) addSkillWithSubskills(s);
  for (const domId of domainIds) {
    const dom = sysContent.domains[domId];
    if (dom) {
      for (const s of dom.classSkillsAdded) addSkillWithSubskills(s);
    }
  }
  return Array.from(skills);
}

/**
 * Computes the union of all class skill IDs across every class the actor has ever taken.
 */
export function getActorEverClassSkillIds(
  dndData: DnD35EntityData | undefined,
  advancingClassId: string,
  domainIds: ReadonlyArray<string>,
  sysContent: DnD35SystemContent
): ReadonlyArray<string> {
  const skills = new Set<string>();
  const addSkillWithSubskills = (sId: string): void => {
    skills.add(sId);
    if (sId === 'craft' && sysContent.skills) {
      for (const k of Object.keys(sysContent.skills)) {
        if (k.startsWith('craft_')) skills.add(k);
      }
    }
  };
  const addFromClass = (cId: string): void => {
    const cDef = sysContent.classes[cId];
    if (!cDef) return;
    for (const sId of cDef.classSkills) addSkillWithSubskills(sId);
  };
  if (dndData) {
    for (const track of dndData.tracks) {
      if (track.levels > 0) addFromClass(track.trackId);
    }
    for (const rec of dndData.levelHistory ?? []) addFromClass(rec.classId);
  }
  addFromClass(advancingClassId);
  for (const domId of domainIds) {
    const dom = sysContent.domains[domId];
    if (dom) {
      for (const s of dom.classSkillsAdded) addSkillWithSubskills(s);
    }
  }
  return Array.from(skills);
}

/**
 * Validates Wizard Specialist School and Prohibited School choices per D&D 3.5e PHB p. 57.
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
