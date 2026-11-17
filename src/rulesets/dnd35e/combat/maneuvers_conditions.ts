import { rollD20 } from '../math/dice.ts';
import { resolveTypedModifiersWithBreakdown } from '../modifiers.ts';
import { resolveOpposedCheck } from '../skills.ts';
import { SIZE_METRICS } from '../spatial/grid_geometry.ts';
import {
  applyConditionWithEscalation,
  buildConditionStatModifiers,
  summarizeConditionEffects
} from './condition_registry.ts';
import type { CreatureSizeCategory, OnHitRiderDescriptor, StatModifier } from '../types/dnd35e.types.ts';

export { applyConditionWithEscalation, buildConditionStatModifiers, summarizeConditionEffects };

/** Single-limb grapple penalty (`-20`) allowing a monster with Improved Grab to not be considered grappled itself. */
export const SINGLE_LIMB_IMPROVED_GRAB_PENALTY = -20;

/** Canonical D&D 3.5e special combat maneuver types. */
export type CombatManeuverType = 'trip' | 'bull_rush' | 'disarm' | 'sunder' | 'overrun' | 'grapple' | 'feint';

/**
 * Declarative rule overrides parameterizing combat maneuver resolution.
 */
export interface ManeuverRuleOverrides {
  readonly provokesAoO?: boolean | undefined;
  readonly opposedBonus?: number | undefined;
  readonly grantsFreeFollowupAttackOnSuccess?: boolean | undefined;
  readonly bypassesTouchAttack?: boolean | undefined;
  readonly canBeCounterTripped?: boolean | undefined;
}

/** Input parameters for the 4-step special combat maneuver pipeline. */
export interface CombatManeuverParams {
  readonly maneuver: CombatManeuverType;
  readonly attackerSize: CreatureSizeCategory;
  readonly defenderSize: CreatureSizeCategory;
  readonly attackerBab: number;
  readonly defenderBab: number;
  readonly attackerStrMod: number;
  readonly defenderStrOrDexMod: number;
  readonly attackerTouchAttackBonus: number;
  readonly defenderTouchAC: number;
  readonly hasImprovedManeuverFeat?: boolean | undefined;
  readonly singleLimbImprovedGrab?: boolean | undefined;
  readonly defenderStabilityBonus?: number | undefined;
  readonly AoODamageDealtToAttacker?: number | undefined;
  readonly forcedTouchRoll?: number | undefined;
  readonly forcedOpposedRolls?: { readonly rollA: number; readonly rollB: number } | undefined;
  readonly overrides?: ManeuverRuleOverrides | undefined;
}

/** Result of resolving a 4-step special combat maneuver. */
export interface CombatManeuverResult {
  readonly provokedAoO: boolean;
  readonly disruptedByAoO: boolean;
  readonly touchAttackHit: boolean;
  readonly opposedSuccess: boolean;
  readonly attackerTotal: number;
  readonly defenderTotal: number;
  readonly attackerRemainsUngrappled: boolean;
  readonly grantedFreeFollowupAttack: boolean;
  readonly counterTripAllowed: boolean;
}

/**
 * Resolves a 4-step D&D 3.5e Special Combat Maneuver (`Trip`, `Bull Rush`, `Disarm`,
 * `Sunder`, `Overrun`, `Grapple`, `Feint`):
 * 1. Provocation check (unless `hasImprovedManeuverFeat === true`); if AoO deals damage during Grapple, disrupts it.
 * 2. Preliminary Melee Touch Attack (for `trip` and `grapple`).
 * 3. Opposed Check incorporating `SIZE_METRICS[size].specialSizeModifier` (`4 * sizeRank`)
 *    and optional `-20` single-limb `Improved Grab`.
 *
 * @param params Structured `CombatManeuverParams`.
 * @returns Complete `CombatManeuverResult`.
 */
export function resolveCombatManeuver(params: CombatManeuverParams): CombatManeuverResult {
  let provokedAoO = params.hasImprovedManeuverFeat !== true;
  if (params.overrides?.provokesAoO !== undefined) {
    provokedAoO = params.overrides.provokesAoO;
  }

  const aooDamage = params.AoODamageDealtToAttacker ?? 0;

  if (provokedAoO && aooDamage > 0 && params.maneuver === 'grapple') {
    return {
      provokedAoO,
      disruptedByAoO: true,
      touchAttackHit: false,
      opposedSuccess: false,
      attackerTotal: 0,
      defenderTotal: 0,
      attackerRemainsUngrappled: true,
      grantedFreeFollowupAttack: false,
      counterTripAllowed: false
    };
  }

  const bypassTouch = params.overrides?.bypassesTouchAttack === true;
  const requiresTouchAttack = !bypassTouch && (params.maneuver === 'trip' || params.maneuver === 'grapple');

  if (requiresTouchAttack) {
    const touchRoll = rollD20('attack', params.attackerTouchAttackBonus, params.forcedTouchRoll);
    const hit = !touchRoll.isAutoFailure && (touchRoll.isAutoSuccess || touchRoll.total >= params.defenderTouchAC);
    if (!hit) {
      return {
        provokedAoO,
        disruptedByAoO: false,
        touchAttackHit: false,
        opposedSuccess: false,
        attackerTotal: 0,
        defenderTotal: 0,
        attackerRemainsUngrappled: true,
        grantedFreeFollowupAttack: false,
        counterTripAllowed: false
      };
    }
  }

  const atkSizeMod = SIZE_METRICS[params.attackerSize].specialSizeModifier;
  const defSizeMod = SIZE_METRICS[params.defenderSize].specialSizeModifier;
  const singleLimbPenalty =
    params.maneuver === 'grapple' && params.singleLimbImprovedGrab === true ? SINGLE_LIMB_IMPROVED_GRAB_PENALTY : 0;

  const includeBab = params.maneuver === 'grapple' || params.maneuver === 'disarm' || params.maneuver === 'sunder';
  const baselineFeatBonus = params.hasImprovedManeuverFeat === true ? 4 : 0;
  const overrideOpposedBonus = params.overrides?.opposedBonus ?? 0;

  const atkMod =
    (includeBab ? params.attackerBab : 0) +
    params.attackerStrMod +
    atkSizeMod +
    baselineFeatBonus +
    overrideOpposedBonus +
    singleLimbPenalty;
  const defMod =
    (includeBab ? params.defenderBab : 0) +
    params.defenderStrOrDexMod +
    defSizeMod +
    (params.defenderStabilityBonus ?? 0);

  const opposed = resolveOpposedCheck(atkMod, defMod, params.forcedOpposedRolls);
  const opposedSuccess = opposed.winner === 'A';

  const grantedFreeFollowupAttack =
    opposedSuccess &&
    (params.overrides?.grantsFreeFollowupAttackOnSuccess === true ||
      (params.maneuver === 'trip' && params.hasImprovedManeuverFeat === true));

  const counterTripAllowed =
    params.maneuver === 'trip' &&
    !opposedSuccess &&
    params.overrides?.canBeCounterTripped !== false &&
    params.hasImprovedManeuverFeat !== true;

  return {
    provokedAoO,
    disruptedByAoO: false,
    touchAttackHit: true,
    opposedSuccess,
    attackerTotal: opposed.totalA,
    defenderTotal: opposed.totalB,
    attackerRemainsUngrappled: params.singleLimbImprovedGrab === true || !opposedSuccess,
    grantedFreeFollowupAttack,
    counterTripAllowed
  };
}

/**
 * Evaluates whether an on-hit rider (poison, disease, paralysis) triggers:
 * - Contact delivery: triggers on any hit.
 * - Injury delivery: only triggers if attack hits AND damage dealt penetrates Damage Reduction (> 0).
 *
 * @param rider OnHitRiderDescriptor describing the poison/disease/rider.
 * @param damageDealtAfterDR Effective damage dealt that penetrated DR.
 * @param attackHit Whether the attack successfully connected.
 * @returns True if the rider delivery succeeds and triggers a saving throw.
 */
export function shouldTriggerOnHitRider(
  rider: OnHitRiderDescriptor,
  damageDealtAfterDR: number,
  attackHit: boolean
): boolean {
  if (!attackHit) return false;
  if (rider.delivery === 'contact') return true;
  if (rider.delivery === 'injury') return damageDealtAfterDR > 0;
  return false;
}

/**
 * Resolves the effective saving throw DC for a special attack or on-hit rider by applying
 * any active `special_ability_save_dc` modifiers (e.g. Ability Focus) scoped to `ability:<abilityId>`.
 *
 * @param baseDc Baseline saving throw DC (e.g. `10 + 1/2 HD + ability mod`).
 * @param abilityId Canonical special attack identifier (e.g. `'breath_weapon'`, `'poison'`).
 * @param statModifiers Active `StatModifier`s on the attacking entity.
 * @param selfTags Optional active semantic self-tags on the attacking entity.
 * @returns Effective saving throw DC.
 */
export function resolveSpecialAbilitySaveDc(
  baseDc: number,
  abilityId: string,
  statModifiers: ReadonlyArray<StatModifier> = [],
  selfTags: ReadonlyArray<string> = []
): number {
  const dcMods = statModifiers.filter((m) => m.targetStat === 'special_ability_save_dc');
  if (dcMods.length === 0) return baseDc;
  const breakdown = resolveTypedModifiersWithBreakdown(dcMods, {
    selfTags,
    effectTags: [`ability:${abilityId}`]
  });
  return baseDc + breakdown.total;
}
