import { rollD20 } from '../math/dice.ts';
import { resolveOpposedCheck } from '../skills.ts';
import { SIZE_METRICS } from '../spatial/grid_geometry.ts';
import type { CreatureSizeCategory, DnD35ConditionId } from '../types/dnd35e.types.ts';

/** Single-limb grapple penalty (`-20`) allowing a monster with Improved Grab to not be considered grappled itself. */
export const SINGLE_LIMB_IMPROVED_GRAB_PENALTY = -20;

/** Canonical D&D 3.5e special combat maneuver types. */
export type CombatManeuverType = 'trip' | 'bull_rush' | 'disarm' | 'sunder' | 'overrun' | 'grapple' | 'feint';

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
  readonly hasImprovedManeuverFeat?: boolean;
  readonly singleLimbImprovedGrab?: boolean;
  readonly defenderStabilityBonus?: number;
  readonly AoODamageDealtToAttacker?: number;
  readonly forcedTouchRoll?: number;
  readonly forcedOpposedRolls?: { readonly rollA: number; readonly rollB: number };
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
export function resolveCombatManeuver(params: CombatManeuverParams): {
  readonly provokedAoO: boolean;
  readonly disruptedByAoO: boolean;
  readonly touchAttackHit: boolean;
  readonly opposedSuccess: boolean;
  readonly attackerTotal: number;
  readonly defenderTotal: number;
  readonly attackerRemainsUngrappled: boolean;
} {
  const provokedAoO = params.hasImprovedManeuverFeat !== true;
  const aooDamage = params.AoODamageDealtToAttacker ?? 0;

  if (provokedAoO && aooDamage > 0 && params.maneuver === 'grapple') {
    return {
      provokedAoO,
      disruptedByAoO: true,
      touchAttackHit: false,
      opposedSuccess: false,
      attackerTotal: 0,
      defenderTotal: 0,
      attackerRemainsUngrappled: true
    };
  }

  const requiresTouchAttack = params.maneuver === 'trip' || params.maneuver === 'grapple';
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
        attackerRemainsUngrappled: true
      };
    }
  }

  const atkSizeMod = SIZE_METRICS[params.attackerSize].specialSizeModifier;
  const defSizeMod = SIZE_METRICS[params.defenderSize].specialSizeModifier;
  const singleLimbPenalty =
    params.maneuver === 'grapple' && params.singleLimbImprovedGrab === true ? SINGLE_LIMB_IMPROVED_GRAB_PENALTY : 0;

  const includeBab = params.maneuver === 'grapple' || params.maneuver === 'disarm' || params.maneuver === 'sunder';
  const atkMod =
    (includeBab ? params.attackerBab : 0) +
    params.attackerStrMod +
    atkSizeMod +
    (params.hasImprovedManeuverFeat === true ? 4 : 0) +
    singleLimbPenalty;
  const defMod =
    (includeBab ? params.defenderBab : 0) +
    params.defenderStrOrDexMod +
    defSizeMod +
    (params.defenderStabilityBonus ?? 0);

  const opposed = resolveOpposedCheck(atkMod, defMod, params.forcedOpposedRolls);
  const opposedSuccess = opposed.winner === 'A';

  return {
    provokedAoO,
    disruptedByAoO: false,
    touchAttackHit: true,
    opposedSuccess,
    attackerTotal: opposed.totalA,
    defenderTotal: opposed.totalB,
    attackerRemainsUngrappled: params.singleLimbImprovedGrab === true || !opposedSuccess
  };
}

/**
 * Applies a condition to an entity's active condition list while enforcing canonical
 * D&D 3.5e escalation chains:
 * - Fear escalation: `shaken + shaken/frightened -> frightened`, `frightened + fear -> panicked`.
 * - Fatigue escalation: `fatigued + fatigued -> exhausted`.
 *
 * @param currentConditions Existing active `DnD35ConditionId` array.
 * @param incomingCondition Incoming `DnD35ConditionId`.
 * @returns Updated deduplicated `ReadonlyArray<DnD35ConditionId>`.
 */
export function applyConditionWithEscalation(
  currentConditions: ReadonlyArray<DnD35ConditionId>,
  incomingCondition: DnD35ConditionId
): ReadonlyArray<DnD35ConditionId> {
  const next = new Array<DnD35ConditionId>(...currentConditions);

  if (incomingCondition === 'shaken') {
    if (next.includes('panicked')) return next;
    if (next.includes('frightened')) {
      return [...next.filter((c) => c !== 'frightened' && c !== 'shaken'), 'panicked'];
    }
    if (next.includes('shaken')) {
      return [...next.filter((c) => c !== 'shaken'), 'frightened'];
    }
  }

  if (incomingCondition === 'frightened') {
    if (next.includes('panicked')) return next;
    if (next.includes('shaken') || next.includes('frightened')) {
      return [...next.filter((c) => c !== 'shaken' && c !== 'frightened'), 'panicked'];
    }
  }

  if (incomingCondition === 'fatigued') {
    if (next.includes('exhausted')) return next;
    if (next.includes('fatigued')) {
      return [...next.filter((c) => c !== 'fatigued'), 'exhausted'];
    }
  }

  if (!next.includes(incomingCondition)) {
    next.push(incomingCondition);
  }
  return next;
}

/**
 * Computes aggregate combat and stat penalties from an entity's active D&D 3.5e conditions.
 *
 * @param conditions Active `DnD35ConditionId` list.
 * @returns `{ meleeAttackPenalty: number, acPenalty: number, losesDexToAC: boolean, strPenalty: number, dexPenalty: number, canTakeActions: boolean }`.
 */
export function summarizeConditionEffects(conditions: ReadonlyArray<DnD35ConditionId>): {
  readonly meleeAttackPenalty: number;
  readonly acPenalty: number;
  readonly losesDexToAC: boolean;
  readonly strPenalty: number;
  readonly dexPenalty: number;
  readonly canTakeActions: boolean;
} {
  let meleeAttackPenalty = 0;
  let acPenalty = 0;
  let losesDexToAC = false;
  let strPenalty = 0;
  let dexPenalty = 0;
  let canTakeActions = true;

  for (const c of conditions) {
    switch (c) {
      case 'blinded':
        acPenalty -= 2;
        losesDexToAC = true;
        break;
      case 'dazzled':
        meleeAttackPenalty -= 1;
        break;
      case 'entangled':
        meleeAttackPenalty -= 2;
        dexPenalty = Math.max(dexPenalty, 4);
        break;
      case 'fatigued':
        strPenalty = Math.max(strPenalty, 2);
        dexPenalty = Math.max(dexPenalty, 2);
        break;
      case 'exhausted':
        strPenalty = Math.max(strPenalty, 6);
        dexPenalty = Math.max(dexPenalty, 6);
        break;
      case 'shaken':
      case 'frightened':
      case 'panicked':
      case 'sickened':
        meleeAttackPenalty -= 2;
        break;
      case 'prone':
        meleeAttackPenalty -= 4;
        acPenalty -= 4;
        break;
      case 'stunned':
        acPenalty -= 2;
        losesDexToAC = true;
        canTakeActions = false;
        break;
      case 'helpless':
      case 'paralyzed':
      case 'unconscious':
        acPenalty -= 4;
        losesDexToAC = true;
        canTakeActions = false;
        break;
      case 'deafened':
      case 'grappled':
      case 'nauseated':
      case 'staggered':
        break;
    }
  }

  return {
    meleeAttackPenalty,
    acPenalty,
    losesDexToAC,
    strPenalty,
    dexPenalty,
    canTakeActions
  };
}
