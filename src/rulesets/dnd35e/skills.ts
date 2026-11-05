import { rng } from '../../core/rng.ts';
import { rollD20 } from './math/dice.ts';
import { dndFloor } from './math/multipliers.ts';
import { resolveTypedModifiers } from './modifiers.ts';
import {
  OPPOSED_CHECK_TIE_COIN_FLIP_THRESHOLD,
  type SkillCheckParams,
  type SkillCheckResult,
  TAKE_10_VALUE,
  TAKE_20_DURATION_MULTIPLIER,
  TAKE_20_VALUE
} from './skills/skill_constants.ts';
import { computeSkillSynergyBonus } from './skills/skill_synergies.ts';

export * from './skills/skill_constants.ts';
export * from './skills/skill_synergies.ts';
export * from './skills/specialized_skill_checks.ts';

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
    if (params.isThreatenedOrDistracted === true || params.definition.take10Allowed === false) {
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

  const synergyBonus = computeSkillSynergyBonus(params.definition.synergyFromSkills ?? [], params.allSkillRanks ?? {});
  const acpPenaltyMagnitude = Math.abs(params.armorCheckPenalty ?? 0) * (params.definition.acpMultiplier ?? 0);
  const acpApplied = -acpPenaltyMagnitude;
  const typedBonusSum = params.modifiers ? resolveTypedModifiers(params.modifiers) : 0;

  const totalModifier = wholeRanks + (params.keyAbilityModifier ?? 0) + synergyBonus + typedBonusSum + acpApplied;

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
    winner = rng.getUniform() < OPPOSED_CHECK_TIE_COIN_FLIP_THRESHOLD ? 'A' : 'B';
  }

  return {
    winner,
    totalA: d20A.total,
    totalB: d20B.total,
    rollA: d20A.naturalRoll,
    rollB: d20B.naturalRoll
  };
}
