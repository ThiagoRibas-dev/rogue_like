import type { DnD35ActionBudget } from './types/dnd35e.types.ts';

/** Maximum recursion depth for nested Attacks of Opportunity (`AoO` chains). */
export const MAX_AOO_CHAIN_DEPTH = 4;

/**
 * Uses a `Swift` or `Immediate` action per `/docs/dnd35e/rules/actions/action-types.md`:
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
        swiftRemaining: budget.swiftRemaining - 1,
        hasActedThisRound: true
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
 * before the provoking action completes, enforcing Armed Threat, Cover, Concealment,
 * Flat-Footed / Combat Reflexes, and movement AoO deduplication.
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

/**
 * Resolves whether an actor can take an Immediate Action (such as Feather Fall, Wings of Cover, or Abrupt Jaunt).
 * Consumes the character's current swift action if it is their turn, or marks immediateUsedOffTurn if taken off-turn.
 *
 * @param budget Current DnD35ActionBudget of the reactor.
 * @param isActorTurn Whether the reaction is being taken during the reactor's own turn.
 * @returns Result with allowed flag and updated DnD35ActionBudget.
 */
export function resolveImmediateDefenseReaction(
  budget: DnD35ActionBudget,
  isActorTurn: boolean
): {
  readonly allowed: boolean;
  readonly updatedBudget: DnD35ActionBudget;
} {
  if (budget.isFlatFooted) {
    return { allowed: false, updatedBudget: budget };
  }

  if (isActorTurn) {
    if (budget.swiftRemaining < 1) {
      return { allowed: false, updatedBudget: budget };
    }
    return {
      allowed: true,
      updatedBudget: {
        ...budget,
        swiftRemaining: budget.swiftRemaining - 1,
        hasActedThisRound: true
      }
    };
  }

  if (budget.immediateUsedOffTurn) {
    return { allowed: false, updatedBudget: budget };
  }

  return {
    allowed: true,
    updatedBudget: {
      ...budget,
      immediateUsedOffTurn: true
    }
  };
}
