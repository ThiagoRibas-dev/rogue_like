import { FEET_PER_GRID_SQUARE } from './spatial/grid_geometry.ts';
import type { DnD35ActionBudget } from './types/dnd35e.types.ts';

/** Maximum recursion depth for nested Attacks of Opportunity (`AoO` chains). */
export const MAX_AOO_CHAIN_DEPTH = 4;

/** Default number of Attacks of Opportunity per round without Combat Reflexes (`1`). */
const DEFAULT_AOO_PER_ROUND = 1;

/** Movement cost multiplier when stepping into a Difficult Terrain square (`2x`). */
const DIFFICULT_TERRAIN_MULTIPLIER = 2;

/**
 * Creates a fresh 6-second tactical round `DnD35ActionBudget` for an actor at the start
 * of their turn.
 * - If `immediateUsedOffTurn === true` from the prior round, the actor's `swiftRemaining`
 *   for this turn is automatically consumed (`0`).
 * - With `hasCombatReflexes === true`, `aooMax = Math.max(1, 1 + dexModifier)`.
 *
 * @param options Actor parameters for the new round.
 * @returns Initialized `DnD35ActionBudget`.
 */
export function createRoundActionBudget(options: {
  readonly dexModifier: number;
  readonly hasCombatReflexes: boolean;
  readonly isFlatFooted: boolean;
  readonly immediateUsedOffTurn?: boolean;
  readonly isSurpriseRound?: boolean;
}): DnD35ActionBudget {
  const aooMax = options.hasCombatReflexes
    ? Math.max(DEFAULT_AOO_PER_ROUND, DEFAULT_AOO_PER_ROUND + options.dexModifier)
    : DEFAULT_AOO_PER_ROUND;
  const consumedSwift = options.immediateUsedOffTurn === true;

  return {
    standardRemaining: 1,
    moveRemaining: options.isSurpriseRound === true ? 0 : 1,
    movementRemainingFt: 0,
    swiftRemaining: consumedSwift ? 0 : 1,
    immediateUsedOffTurn: false,
    fiveFootStepAvailable: true,
    canMoveFurtherThisRound: true,
    distanceMovedThisRoundFt: 0,
    aooRemaining: aooMax,
    aooMax,
    isFlatFooted: options.isFlatFooted,
    hasCombatReflexes: options.hasCombatReflexes,
    reactorsThisOpportunity: [],
    movementAoOReactorsThisRound: []
  };
}

/**
 * Downgrades an available `Standard` action into a second `Move` action (Double Move).
 *
 * @param budget Current `DnD35ActionBudget`.
 * @returns `{ allowed: boolean, budget: DnD35ActionBudget }`.
 */
export function downgradeStandardToMove(budget: DnD35ActionBudget): {
  readonly allowed: boolean;
  readonly budget: DnD35ActionBudget;
} {
  if (budget.standardRemaining < 1) {
    return { allowed: false, budget };
  }
  return {
    allowed: true,
    budget: {
      ...budget,
      standardRemaining: budget.standardRemaining - 1,
      moveRemaining: budget.moveRemaining + 1
    }
  };
}

/**
 * Consumes a single grid step (`stepDistanceFt`, e.g. `5` or `10` ft) from the actor's
 * current `movementRemainingFt`, automatically starting a `Move` action (or downgrading
 * `Standard -> Move` for a Double Move) when needed.
 * Automatically sets `fiveFootStepAvailable = false` once `distanceMovedThisRoundFt > 0`.
 *
 * @param budget Current `DnD35ActionBudget`.
 * @param actorSpeedFt Actor's tactical movement speed in feet (e.g. `30`).
 * @param stepDistanceFt Base distance of the step (`5` or `10` ft).
 * @param isDifficultTerrain True if entering a Difficult Terrain square (`2x` cost).
 * @returns `{ allowed: boolean, budget: DnD35ActionBudget }`.
 */
export function consumeMovementStepFt(
  budget: DnD35ActionBudget,
  actorSpeedFt: number,
  stepDistanceFt: number,
  isDifficultTerrain = false
): {
  readonly allowed: boolean;
  readonly budget: DnD35ActionBudget;
} {
  if (!budget.canMoveFurtherThisRound) {
    return { allowed: false, budget };
  }

  const effectiveCostFt = isDifficultTerrain ? stepDistanceFt * DIFFICULT_TERRAIN_MULTIPLIER : stepDistanceFt;

  let nextBudget = budget;
  while (nextBudget.movementRemainingFt < effectiveCostFt) {
    if (nextBudget.moveRemaining > 0) {
      nextBudget = {
        ...nextBudget,
        moveRemaining: nextBudget.moveRemaining - 1,
        movementRemainingFt: nextBudget.movementRemainingFt + actorSpeedFt
      };
    } else if (nextBudget.standardRemaining > 0) {
      nextBudget = {
        ...nextBudget,
        standardRemaining: nextBudget.standardRemaining - 1,
        movementRemainingFt: nextBudget.movementRemainingFt + actorSpeedFt
      };
    } else {
      return { allowed: false, budget };
    }
  }

  return {
    allowed: true,
    budget: {
      ...nextBudget,
      movementRemainingFt: nextBudget.movementRemainingFt - effectiveCostFt,
      distanceMovedThisRoundFt: nextBudget.distanceMovedThisRoundFt + effectiveCostFt,
      fiveFootStepAvailable: false
    }
  };
}

/**
 * Executes a `5-Foot Step` (does not provoke Attacks of Opportunity).
 * Prohibited if the actor has already moved any distance this round (`distanceMovedThisRoundFt > 0`)
 * or if the destination tile is Difficult Terrain. Consumes all further movement for the round.
 *
 * @param budget Current `DnD35ActionBudget`.
 * @param isDifficultTerrain True if destination square is Difficult Terrain.
 * @returns `{ allowed: boolean, budget: DnD35ActionBudget }`.
 */
export function takeFiveFootStep(
  budget: DnD35ActionBudget,
  isDifficultTerrain = false
): {
  readonly allowed: boolean;
  readonly budget: DnD35ActionBudget;
} {
  if (!budget.fiveFootStepAvailable || budget.distanceMovedThisRoundFt > 0 || isDifficultTerrain) {
    return { allowed: false, budget };
  }

  return {
    allowed: true,
    budget: {
      ...budget,
      fiveFootStepAvailable: false,
      canMoveFurtherThisRound: false,
      movementRemainingFt: 0,
      distanceMovedThisRoundFt: FEET_PER_GRID_SQUARE
    }
  };
}

/**
 * Uses a `Swift` or `Immediate` action per `/docs/rules/actions/action-types.md`:
 * - Cannot use an `Immediate` action while `isFlatFooted === true`.
 * - Using an `Immediate` action on-turn consumes `swiftRemaining`.
 * - Using an `Immediate` action off-turn sets `immediateUsedOffTurn = true`, which will
 *   consume the actor's `Swift` action on their next turn.
 *
 * @param budget Current `DnD35ActionBudget`.
 * @param isOnTurn True if used during the actor's own turn.
 * @returns `{ allowed: boolean, budget: DnD35ActionBudget }`.
 */
export function useImmediateAction(
  budget: DnD35ActionBudget,
  isOnTurn: boolean
): {
  readonly allowed: boolean;
  readonly budget: DnD35ActionBudget;
} {
  if (budget.isFlatFooted) {
    return { allowed: false, budget };
  }

  if (isOnTurn) {
    if (budget.swiftRemaining < 1) {
      return { allowed: false, budget };
    }
    return {
      allowed: true,
      budget: {
        ...budget,
        swiftRemaining: budget.swiftRemaining - 1
      }
    };
  }

  if (budget.immediateUsedOffTurn) {
    return { allowed: false, budget };
  }

  return {
    allowed: true,
    budget: {
      ...budget,
      immediateUsedOffTurn: true
    }
  };
}

/** Descriptor for a candidate reactor threatening a provoking actor. */
export interface CandidateAoOReactor {
  readonly reactorId: number;
  readonly aooRemaining: number;
  readonly isFlatFooted: boolean;
  readonly hasCombatReflexes: boolean;
  readonly isArmedOrThreatening: boolean;
  readonly targetHasCover: boolean;
  readonly targetHasTotalConcealment: boolean;
}

/**
 * Resolves Pre-Action Attacks of Opportunity (`AoO`) in **Last-In, First-Out (LIFO)** order
 * before the provoking action completes, enforcing:
 * 1. `Armed Threat Gate`, `Cover` block, and `Total Concealment (50%)` block.
 * 2. `Flat-Footed` block unless the reactor has `Combat Reflexes`.
 * 3. `One AoO Per Opportunity` (`reactorsThisOpportunity`).
 * 4. `Movement Provocation Deduplication` (`movementAoOReactorsThisRound`): leaving multiple
 *    threatened squares in the same round only provokes ONE movement AoO per reactor, whereas
 *    a subsequent non-movement provocation (e.g. casting a spell) is a new opportunity.
 *
 * @param opportunityKind `'movement' | 'action'`.
 * @param provokerBudget Current `DnD35ActionBudget` of the provoking actor.
 * @param candidates Ordered list of candidate reactors.
 * @returns Eligible reactor IDs in LIFO execution order and updated `provokerBudget`.
 */
export function filterAndOrderAoOReactors(
  opportunityKind: 'movement' | 'action',
  provokerBudget: DnD35ActionBudget,
  candidates: ReadonlyArray<CandidateAoOReactor>
): {
  readonly lifoReactorIds: ReadonlyArray<number>;
  readonly updatedProvokerBudget: DnD35ActionBudget;
} {
  const accepted: number[] = [];
  const nextOpportunityReactors = [...provokerBudget.reactorsThisOpportunity];
  const nextMovementReactors = [...provokerBudget.movementAoOReactorsThisRound];

  for (const c of candidates) {
    if (accepted.length >= MAX_AOO_CHAIN_DEPTH) break;
    if (c.aooRemaining < 1 || !c.isArmedOrThreatening) continue;
    if (c.targetHasCover || c.targetHasTotalConcealment) continue;
    if (c.isFlatFooted && !c.hasCombatReflexes) continue;
    if (nextOpportunityReactors.includes(c.reactorId)) continue;
    if (opportunityKind === 'movement' && nextMovementReactors.includes(c.reactorId)) {
      continue;
    }

    accepted.push(c.reactorId);
    nextOpportunityReactors.push(c.reactorId);
    if (opportunityKind === 'movement') {
      nextMovementReactors.push(c.reactorId);
    }
  }

  return {
    lifoReactorIds: [...accepted].reverse(),
    updatedProvokerBudget: {
      ...provokerBudget,
      reactorsThisOpportunity: nextOpportunityReactors,
      movementAoOReactorsThisRound: nextMovementReactors
    }
  };
}
