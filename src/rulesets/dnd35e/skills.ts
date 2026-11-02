import { rng } from '../../core/rng.ts';
import { rollD20 } from './math/dice.ts';
import { dndFloor } from './math/multipliers.ts';
import { appendSourcePath, resolveTypedModifiers } from './modifiers.ts';
import type { AbilityId, StatModifier } from './types/dnd35e.types.ts';
import type { DnD35SkillDefinition } from './types/dnd35e_system.types.ts';
import type { AttitudeTier } from '../../types/components.types.ts';

/** Minimum whole ranks required in a source skill to grant a +2 Synergy bonus. */
export const SYNERGY_REQUIRED_RANKS = 5;

/** Untyped bonus granted per qualifying 5-rank skill synergy (`+2`). */
export const SYNERGY_BONUS_AMOUNT = 2;

/** Offset added to Total Hit Dice for maximum class skill ranks (`HD + 3`). */
export const CLASS_SKILL_RANK_CAP_OFFSET = 3;

/** Fixed d20 substitute value when Taking 10. */
export const TAKE_10_VALUE = 10;

/** Fixed d20 substitute value when Taking 20. */
export const TAKE_20_VALUE = 20;

/** Action duration multiplier when Taking 20 (`20x` standard duration). */
export const TAKE_20_DURATION_MULTIPLIER = 20;

/** Declarative definition of a D&D 3.5e skill for check resolution. */
export interface SkillCheckDefinition {
  readonly skillId: string;
  readonly keyAbility: AbilityId;
  readonly trainedOnly: boolean;
  readonly acpMultiplier: 0 | 1 | 2;
  readonly synergyFromSkills: ReadonlyArray<string>;
  readonly take10Allowed?: boolean;
  readonly take20Allowed?: boolean;
}

/** Input parameters for `resolveSkillCheck`. */
export interface SkillCheckParams {
  readonly definition: SkillCheckDefinition;
  readonly rawRanks: number;
  readonly allSkillRanks: Readonly<Record<string, number>>;
  readonly keyAbilityModifier: number;
  readonly armorCheckPenalty: number;
  readonly modifiers?: ReadonlyArray<StatModifier>;
  readonly dc: number;
  readonly takeMode?: 'roll' | 'take10' | 'take20';
  readonly isThreatenedOrDistracted?: boolean;
  readonly carriesPenaltyOnFailure?: boolean;
  readonly forcedNaturalRoll?: number;
}

/** Result of a resolved Skill Check or Ability Check. */
export interface SkillCheckResult {
  readonly allowed: boolean;
  readonly blockedReason?: string;
  readonly naturalRoll: number;
  readonly wholeRanks: number;
  readonly synergyBonus: number;
  readonly acpApplied: number;
  readonly totalModifier: number;
  readonly totalRoll: number;
  readonly dc: number;
  readonly success: boolean;
  readonly durationMultiplier: number;
}

/**
 * Computes maximum allowed skill ranks for a class skill (`HD + 3`) vs. cross-class skill (`(HD + 3) / 2`).
 *
 * @param totalHD Entity's total Hit Dice ($\ge 1$).
 * @param isClassSkill True if the skill is a class skill for any of the entity's classes.
 * @returns Maximum rank cap (`number`, allowing `.5` for cross-class).
 */
export function computeMaxSkillRankCap(totalHD: number, isClassSkill: boolean): number {
  const maxClassRanks = Math.max(1, dndFloor(totalHD)) + CLASS_SKILL_RANK_CAP_OFFSET;
  return isClassSkill ? maxClassRanks : maxClassRanks / 2;
}

/**
 * Computes the total untyped Synergy bonus (`+2` per qualifying source skill with $\lfloor \text{ranks} \rfloor \ge 5$).
 *
 * @param synergyFromSkills List of source skill IDs that grant synergy to this check.
 * @param allSkillRanks Entity's skill rank map.
 * @returns Total synergy bonus ($\ge 0$).
 */
export function computeSkillSynergyBonus(
  synergyFromSkills: ReadonlyArray<string>,
  allSkillRanks: Readonly<Record<string, number>>
): number {
  let bonus = 0;
  for (const sourceSkillId of synergyFromSkills) {
    const raw = allSkillRanks[sourceSkillId] ?? 0;
    const whole = dndFloor(raw);
    if (whole >= SYNERGY_REQUIRED_RANKS) {
      bonus += SYNERGY_BONUS_AMOUNT;
      if (whole >= 25) {
        bonus += Math.floor((whole - 5) / 20) * SYNERGY_BONUS_AMOUNT;
      }
    }
  }
  return bonus;
}

/**
 * Finds all skills in a skill registry that receive a synergy bonus from the specified source skill.
 * @param sourceSkillId The source skill providing synergy.
 * @param skillRegistry Loaded skill definitions map.
 * @returns List of target skill IDs that list sourceSkillId in their synergyFromSkills.
 */
export function getSkillsGrantedSynergyBy(
  sourceSkillId: string,
  skillRegistry: Readonly<Record<string, DnD35SkillDefinition>>
): ReadonlyArray<string> {
  const results: string[] = [];
  for (const [targetId, def] of Object.entries(skillRegistry)) {
    if (def.synergyFromSkills.includes(sourceSkillId)) {
      results.push(targetId);
    }
  }
  return results;
}

/**
 * Builds passive/conditional StatModifiers unlocked by skill rank thresholds (e.g. 5+ ranks in Tumble
 * granting +1 dodge AC when fighting defensively or using total defense).
 *
 * @param allSkillRanks Entity's skill rank map.
 * @param skillRegistry Loaded D&D 3.5e skill definitions.
 * @returns Array of unlocked `StatModifier` entries with `sourcePath: "skill:<id>/threshold:<minRanks>/<modId>"`.
 */
export function buildSkillRankThresholdModifiers(
  allSkillRanks: Readonly<Record<string, number>>,
  skillRegistry: Readonly<Record<string, DnD35SkillDefinition>>
): ReadonlyArray<StatModifier> {
  const modifiers: StatModifier[] = [];
  for (const [skillId, rawRanks] of Object.entries(allSkillRanks)) {
    const wholeRanks = dndFloor(Math.max(0, rawRanks));
    if (wholeRanks < 1) continue;
    const skillDef = skillRegistry[skillId];
    if (!skillDef || skillDef.rankThresholdModifiers.length === 0) continue;
    for (const entry of skillDef.rankThresholdModifiers) {
      if (wholeRanks < entry.minRanks) continue;
      const rootPath = appendSourcePath(`skill:${skillDef.id}`, `threshold:${entry.minRanks}`);
      for (const mod of entry.modifiers) {
        modifiers.push({
          targetStat: mod.target,
          value: mod.value,
          bonusType: mod.type,
          sourceId: `skill:${skillDef.id}:${mod.id}`,
          sourcePath: appendSourcePath(rootPath, mod.id),
          origin: 'ex',
          ...(mod.condition !== undefined ? { condition: mod.condition } : {})
        });
      }
    }
  }
  return modifiers;
}

/**
 * Resolves a D&D 3.5e Skill Check with support for half-rank rounding ($\lfloor \text{ranks} \rfloor$),
 * `trainedOnly` gating, 5-rank `+2` synergy, `acpMultiplier` (`0 | 1 | 2`, e.g. Swim's `2x ACP`),
 * and `Take 10 / Take 20` validation.
 * Note: Skill checks NEVER auto-fail on a natural 1 or auto-succeed on a natural 20.
 *
 * @param params Structured `SkillCheckParams`.
 * @returns Complete `SkillCheckResult`.
 */
export function resolveSkillCheck(params: SkillCheckParams): SkillCheckResult {
  const wholeRanks = dndFloor(Math.max(0, params.rawRanks));

  if (params.definition.trainedOnly && wholeRanks < 1) {
    return {
      allowed: false,
      blockedReason: 'untrained_in_trained_only_skill',
      naturalRoll: 0,
      wholeRanks,
      synergyBonus: 0,
      acpApplied: 0,
      totalModifier: 0,
      totalRoll: 0,
      dc: params.dc,
      success: false,
      durationMultiplier: 1
    };
  }

  const takeMode = params.takeMode ?? 'roll';
  if (takeMode === 'take10') {
    if (
      params.isThreatenedOrDistracted === true ||
      params.definition.skillId === 'use_magic_device' ||
      params.definition.take10Allowed === false
    ) {
      return {
        allowed: false,
        blockedReason: 'take_10_prohibited',
        naturalRoll: 0,
        wholeRanks,
        synergyBonus: 0,
        acpApplied: 0,
        totalModifier: 0,
        totalRoll: 0,
        dc: params.dc,
        success: false,
        durationMultiplier: 1
      };
    }
  } else if (takeMode === 'take20') {
    if (
      params.isThreatenedOrDistracted === true ||
      params.carriesPenaltyOnFailure === true ||
      params.definition.skillId === 'use_magic_device' ||
      params.definition.take20Allowed === false
    ) {
      return {
        allowed: false,
        blockedReason: 'take_20_prohibited',
        naturalRoll: 0,
        wholeRanks,
        synergyBonus: 0,
        acpApplied: 0,
        totalModifier: 0,
        totalRoll: 0,
        dc: params.dc,
        success: false,
        durationMultiplier: 1
      };
    }
  }

  const synergyBonus = computeSkillSynergyBonus(params.definition.synergyFromSkills, params.allSkillRanks);
  const acpPenaltyMagnitude = Math.abs(params.armorCheckPenalty) * params.definition.acpMultiplier;
  const acpApplied = -acpPenaltyMagnitude;
  const typedBonusSum = params.modifiers ? resolveTypedModifiers(params.modifiers) : 0;

  const totalModifier = wholeRanks + params.keyAbilityModifier + synergyBonus + typedBonusSum + acpApplied;

  let naturalRoll: number;
  let durationMultiplier = 1;
  if (takeMode === 'take10') {
    naturalRoll = TAKE_10_VALUE;
  } else if (takeMode === 'take20') {
    naturalRoll = TAKE_20_VALUE;
    durationMultiplier = TAKE_20_DURATION_MULTIPLIER;
  } else {
    naturalRoll = rollD20('skill_check', totalModifier, params.forcedNaturalRoll).naturalRoll;
  }

  const totalRoll = naturalRoll + totalModifier;
  return {
    allowed: true,
    naturalRoll,
    wholeRanks,
    synergyBonus,
    acpApplied,
    totalModifier,
    totalRoll,
    dc: params.dc,
    success: totalRoll >= params.dc,
    durationMultiplier
  };
}

/**
 * Resolves a symmetric Opposed Check between an initiator and a defender.
 * Ties are broken first by highest total modifier, and if still tied, by a deterministic
 * coin flip (`rng.getUniform() < 0.5`).
 *
 * @param actorAModifier Total check modifier for Actor A.
 * @param actorBModifier Total check modifier for Actor B.
 * @param forcedRolls Optional deterministic roll overrides `{ rollA, rollB }`.
 * @returns `{ winner: 'A' | 'B', totalA: number, totalB: number, rollA: number, rollB: number }`.
 */
export function resolveOpposedCheck(
  actorAModifier: number,
  actorBModifier: number,
  forcedRolls?: { readonly rollA: number; readonly rollB: number }
): {
  readonly winner: 'A' | 'B';
  readonly totalA: number;
  readonly totalB: number;
  readonly rollA: number;
  readonly rollB: number;
} {
  const d20A = rollD20('skill_check', actorAModifier, forcedRolls?.rollA);
  const d20B = rollD20('skill_check', actorBModifier, forcedRolls?.rollB);

  let winner: 'A' | 'B';
  if (d20A.total > d20B.total) {
    winner = 'A';
  } else if (d20B.total > d20A.total) {
    winner = 'B';
  } else if (actorAModifier > actorBModifier) {
    winner = 'A';
  } else if (actorBModifier > actorAModifier) {
    winner = 'B';
  } else {
    winner = rng.getUniform() < 0.5 ? 'A' : 'B';
  }

  return {
    winner,
    totalA: d20A.total,
    totalB: d20B.total,
    rollA: d20A.naturalRoll,
    rollB: d20B.naturalRoll
  };
}

/**
 * Result of resolving a D&D 3.5e Diplomacy check to adjust an NPC's attitude.
 */
export interface DiplomacyResult {
  readonly initialAttitude: AttitudeTier;
  readonly newAttitude: AttitudeTier;
  readonly rollTotal: number;
  readonly changed: boolean;
}

/**
 * Resolves a D&D 3.5e Diplomacy check to influence an NPC's attitude according to
 * the 5-tier standard progression (PHB p. 72).
 *
 * @param initialAttitude Current AttitudeTier of the target.
 * @param checkRollTotal Total Diplomacy skill check roll.
 * @returns Resulting DiplomacyResult with updated AttitudeTier.
 */
export function resolveDiplomacyCheck(initialAttitude: AttitudeTier, checkRollTotal: number): DiplomacyResult {
  const normalizedInitial: 'hostile' | 'unfriendly' | 'indifferent' | 'friendly' | 'helpful' =
    initialAttitude === 'neutral' ? 'indifferent' : initialAttitude;

  let newAttitude: AttitudeTier = normalizedInitial;

  switch (normalizedInitial) {
    case 'hostile':
      if (checkRollTotal >= 50) newAttitude = 'helpful';
      else if (checkRollTotal >= 35) newAttitude = 'friendly';
      else if (checkRollTotal >= 25) newAttitude = 'indifferent';
      else if (checkRollTotal >= 20) newAttitude = 'unfriendly';
      else newAttitude = 'hostile';
      break;
    case 'unfriendly':
      if (checkRollTotal >= 40) newAttitude = 'helpful';
      else if (checkRollTotal >= 25) newAttitude = 'friendly';
      else if (checkRollTotal >= 15) newAttitude = 'indifferent';
      else newAttitude = 'unfriendly';
      break;
    case 'indifferent':
      if (checkRollTotal >= 30) newAttitude = 'helpful';
      else if (checkRollTotal >= 15) newAttitude = 'friendly';
      else newAttitude = 'indifferent';
      break;
    case 'friendly':
      if (checkRollTotal >= 20) newAttitude = 'helpful';
      else newAttitude = 'friendly';
      break;
    case 'helpful':
      newAttitude = 'helpful';
      break;
  }

  return {
    initialAttitude,
    newAttitude,
    rollTotal: checkRollTotal,
    changed: newAttitude !== initialAttitude
  };
}
