import {
  type CandidateAoOReactor,
  filterAndOrderAoOReactors,
  MAX_AOO_CHAIN_DEPTH,
  resolveImmediateDefenseReaction,
  useImmediateAction
} from './action_economy_reactions.ts';
import { FEET_PER_GRID_SQUARE } from './spatial/grid_geometry.ts';
import type { DnD35ActionBudget } from './types/dnd35e.types.ts';

export {
  type CandidateAoOReactor,
  filterAndOrderAoOReactors,
  MAX_AOO_CHAIN_DEPTH,
  resolveImmediateDefenseReaction,
  useImmediateAction
};

/** Default number of Attacks of Opportunity per round without Combat Reflexes (`1`). */
const DEFAULT_AOO_PER_ROUND = 1;

/** Movement cost multiplier when stepping into a Difficult Terrain square (`2x`). */
const DIFFICULT_TERRAIN_MULTIPLIER = 2;

/**
 * Creates a fresh 6-second tactical round `DnD35ActionBudget` for an actor at the start
 * of their turn.
 *
 * @param options Actor parameters for the new round.
 * @returns Initialized `DnD35ActionBudget`.
 */
export function createRoundActionBudget(options: {
  readonly dexModifier: number;
  readonly hasCombatReflexes?: boolean;
  readonly isFlatFooted?: boolean;
  readonly immediateUsedOffTurn?: boolean;
  readonly isSurpriseRound?: boolean;
  readonly singleActionOnly?: boolean;
  readonly isNauseated?: boolean;
  readonly extraStandardActions?: number;
  readonly extraMoveActions?: number;
  readonly extraSwiftActions?: number;
  readonly extraAoO?: number;
}): DnD35ActionBudget {
  const hasCombatReflexes = options.hasCombatReflexes === true;
  const isFlatFooted = options.isFlatFooted === true;
  const baseAoo = hasCombatReflexes
    ? Math.max(DEFAULT_AOO_PER_ROUND, DEFAULT_AOO_PER_ROUND + options.dexModifier)
    : DEFAULT_AOO_PER_ROUND;
  const aooMax = Math.max(0, baseAoo + (options.extraAoO ?? 0));
  const consumedSwift = options.immediateUsedOffTurn === true;

  if (options.isNauseated === true) {
    return {
      standardRemaining: 0,
      moveRemaining: Math.max(0, 1 + (options.extraMoveActions ?? 0)),
      movementRemainingFt: 0,
      swiftRemaining: 0,
      immediateUsedOffTurn: false,
      fiveFootStepAvailable: true,
      canMoveFurtherThisRound: true,
      distanceMovedThisRoundFt: 0,
      diagonalsMovedThisRound: 0,
      aooRemaining: aooMax,
      aooMax,
      isFlatFooted,
      hasCombatReflexes,
      reactorsThisOpportunity: [],
      movementAoOReactorsThisRound: [],
      hasActedThisRound: false
    };
  }

  const isSingleActionRestricted = options.isSurpriseRound === true || options.singleActionOnly === true;
  const baseStandard = 1;
  const baseMove = isSingleActionRestricted ? 0 : 1;

  return {
    standardRemaining: Math.max(0, baseStandard + (options.extraStandardActions ?? 0)),
    moveRemaining: Math.max(0, baseMove + (options.extraMoveActions ?? 0)),
    movementRemainingFt: 0,
    swiftRemaining: consumedSwift ? 0 : Math.max(0, 1 + (options.extraSwiftActions ?? 0)),
    immediateUsedOffTurn: false,
    fiveFootStepAvailable: true,
    canMoveFurtherThisRound: true,
    distanceMovedThisRoundFt: 0,
    diagonalsMovedThisRound: 0,
    aooRemaining: aooMax,
    aooMax,
    isFlatFooted,
    hasCombatReflexes,
    reactorsThisOpportunity: [],
    movementAoOReactorsThisRound: [],
    hasActedThisRound: false
  };
}

/**
 * Consumes a Standard action from `budget`. If the actor has already moved this round
 * (`distanceMovedThisRoundFt > 0`), any remaining partial movement pool from that earlier Move
 * action is forfeited in accordance with PHB p. 138 (unless another Move action remains).
 *
 * @param budget Current `DnD35ActionBudget`.
 * @returns Updated `DnD35ActionBudget` and whether a Standard action was available.
 */
export function consumeStandardActionFromBudget(budget: DnD35ActionBudget): {
  readonly allowed: boolean;
  readonly budget: DnD35ActionBudget;
} {
  if (budget.standardRemaining < 1) {
    return { allowed: false, budget };
  }
  const nextStd = budget.standardRemaining - 1;
  const movedAlready = budget.distanceMovedThisRoundFt > 0;
  const nextMovementFt = movedAlready ? 0 : budget.movementRemainingFt;
  return {
    allowed: true,
    budget: {
      ...budget,
      standardRemaining: nextStd,
      movementRemainingFt: nextMovementFt,
      fiveFootStepAvailable: movedAlready ? false : budget.fiveFootStepAvailable,
      canMoveFurtherThisRound: movedAlready ? budget.moveRemaining > 0 : budget.canMoveFurtherThisRound,
      hasActedThisRound: true
    }
  };
}

/**
 * Consumes a non-walking Move action (e.g. picking up/equipping an item or interacting with a door),
 * downgrading a Standard action if no Move action remains and clearing any unspent partial walking feet.
 *
 * @param budget Current `DnD35ActionBudget`.
 * @returns Updated `DnD35ActionBudget` and whether a Move (or convertible Standard) action was available.
 */
export function consumeMoveActionFromBudget(budget: DnD35ActionBudget): {
  readonly allowed: boolean;
  readonly budget: DnD35ActionBudget;
} {
  if (budget.moveRemaining > 0) {
    const nextMove = budget.moveRemaining - 1;
    return {
      allowed: true,
      budget: {
        ...budget,
        moveRemaining: nextMove,
        movementRemainingFt: 0,
        fiveFootStepAvailable: false,
        canMoveFurtherThisRound: nextMove > 0 || budget.standardRemaining > 0,
        hasActedThisRound: true
      }
    };
  }
  if (budget.standardRemaining > 0) {
    const nextStd = budget.standardRemaining - 1;
    return {
      allowed: true,
      budget: {
        ...budget,
        standardRemaining: nextStd,
        movementRemainingFt: 0,
        fiveFootStepAvailable: false,
        canMoveFurtherThisRound: nextStd > 0,
        hasActedThisRound: true
      }
    };
  }
  return { allowed: false, budget };
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
 *
 * @param budget Current `DnD35ActionBudget`.
 * @param actorSpeedFt Actor's tactical movement speed in feet (e.g. `30`).
 * @param stepDistanceFt Base distance of the step (`5` or `10` ft).
 * @param isDifficultTerrain True if entering a Difficult Terrain square (`2x` cost).
 * @returns `{ allowed: boolean, budget: DnD35ActionBudget }`.
 */
/** Alternating diagonal square multiplier (`2` = `10 ft` for every 2nd diagonal). */
const EVEN_DIAGONAL_MULTIPLIER = 2;

export function consumeMovementStepFt(
  budget: DnD35ActionBudget,
  actorSpeedFt: number,
  stepDistanceFt: number,
  stepMultiplierOrDifficult: boolean | number = false,
  isDiagonal = false
): {
  readonly allowed: boolean;
  readonly budget: DnD35ActionBudget;
} {
  if (!budget.canMoveFurtherThisRound) {
    return { allowed: false, budget };
  }

  const prevDiags = budget.diagonalsMovedThisRound ?? 0;
  const diagonalBaseFt = isDiagonal && prevDiags % 2 === 1 ? stepDistanceFt * EVEN_DIAGONAL_MULTIPLIER : stepDistanceFt;
  const multiplier =
    typeof stepMultiplierOrDifficult === 'boolean'
      ? stepMultiplierOrDifficult
        ? DIFFICULT_TERRAIN_MULTIPLIER
        : 1
      : Math.max(1, stepMultiplierOrDifficult);
  const effectiveCostFt = diagonalBaseFt * multiplier;
  const nextDiags = isDiagonal ? prevDiags + 1 : prevDiags;

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
      // Minimum Movement rule (PHB p. 147): when hampered so even a Double Move cannot cover
      // 1 square, a fresh actor may spend a Full-Round action (Move + Standard) to move 5 ft (1 square).
      if (budget.distanceMovedThisRoundFt === 0 && budget.moveRemaining >= 1 && budget.standardRemaining >= 1) {
        return {
          allowed: true,
          budget: {
            ...budget,
            standardRemaining: 0,
            moveRemaining: 0,
            movementRemainingFt: 0,
            distanceMovedThisRoundFt: effectiveCostFt,
            diagonalsMovedThisRound: nextDiags,
            fiveFootStepAvailable: false,
            canMoveFurtherThisRound: false,
            hasActedThisRound: true
          }
        };
      }
      return { allowed: false, budget };
    }
  }

  return {
    allowed: true,
    budget: {
      ...nextBudget,
      movementRemainingFt: nextBudget.movementRemainingFt - effectiveCostFt,
      distanceMovedThisRoundFt: nextBudget.distanceMovedThisRoundFt + effectiveCostFt,
      diagonalsMovedThisRound: nextDiags,
      fiveFootStepAvailable: false,
      hasActedThisRound: true
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
  isHamperedOrDifficultTerrain: boolean | number = false
): {
  readonly allowed: boolean;
  readonly budget: DnD35ActionBudget;
} {
  const isHampered =
    typeof isHamperedOrDifficultTerrain === 'boolean' ? isHamperedOrDifficultTerrain : isHamperedOrDifficultTerrain > 1;
  if (!budget.fiveFootStepAvailable || budget.distanceMovedThisRoundFt > 0 || isHampered) {
    return { allowed: false, budget };
  }

  return {
    allowed: true,
    budget: {
      ...budget,
      fiveFootStepAvailable: false,
      canMoveFurtherThisRound: false,
      movementRemainingFt: 0,
      distanceMovedThisRoundFt: FEET_PER_GRID_SQUARE,
      hasActedThisRound: true
    }
  };
}
