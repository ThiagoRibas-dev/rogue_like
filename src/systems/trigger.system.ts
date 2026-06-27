import type { GameState } from '../types/game-state.types.ts';
import type { GameEvent } from '../types/events.types.ts';
import { GameEventType } from '../types/events.types.ts';
import type { ConditionPredicate, ConsequenceAction } from '../types/trigger.types.ts';
import type { TrapTriggeredEvent, DebugTriggerTraceEvent } from '../types/events.types.ts';
import { evaluatePacing, applyPacingCosts } from './pacing.system.ts';

// Import sub-domain modules
import { playerConditions, playerConsequences } from './trigger/player.ts';
import { socialConditions, socialConsequences } from './trigger/social.ts';
import { questConditions, questConsequences } from './trigger/quest.ts';
import { systemicConsequences, processTraps } from './trigger/systemic.ts';

// Re-export processTraps to preserve public API contract
export { processTraps };

type ConditionEvaluatorMap = {
  [K in ConditionPredicate['type']]: (
    state: Readonly<GameState>,
    event: GameEvent,
    condition: Extract<ConditionPredicate, { type: K }>
  ) => boolean;
};

type ConsequenceApplierMap = {
  [K in ConsequenceAction['type']]: (
    state: GameState,
    event: GameEvent,
    consequence: Extract<ConsequenceAction, { type: K }>,
    apply: (state: GameState, event: GameEvent, consequence: ConsequenceAction) => GameState
  ) => GameState;
};

// Combine and type-check evaluators for full exhaustiveness
const conditionEvaluators: ConditionEvaluatorMap = {
  ...playerConditions,
  ...socialConditions,
  ...questConditions
};

// Combine and type-check appliers for full exhaustiveness
const consequenceAppliers: ConsequenceApplierMap = {
  ...playerConsequences,
  ...socialConsequences,
  ...questConsequences,
  ...systemicConsequences
};

/**
 * Evaluates a single condition predicate against the game state and event.
 * @param state The current readonly game state.
 * @param event The game event being evaluated.
 * @param condition The condition predicate from the campaign data.
 * @returns True if the condition is met, false otherwise.
 */
export function evaluateCondition(
  state: Readonly<GameState>,
  event: GameEvent,
  condition: ConditionPredicate
): boolean {
  const evaluator = conditionEvaluators[condition.type];
  if (!evaluator) {
    throw new Error(`Unhandled condition type: ${condition.type}`);
  }

  // Safely narrow parameter types without using 'any'
  const typedEvaluator = evaluator as (
    state: Readonly<GameState>,
    event: GameEvent,
    cond: ConditionPredicate
  ) => boolean;

  return typedEvaluator(state, event, condition);
}

/**
 * Applies a single consequence to the game state.
 * @param state The current game state.
 * @param event The game event that triggered this consequence.
 * @param consequence The consequence action to apply.
 * @returns The updated game state after applying the consequence.
 */
export function applyConsequence(state: GameState, event: GameEvent, consequence: ConsequenceAction): GameState {
  const applier = consequenceAppliers[consequence.type];
  if (!applier) {
    throw new Error(`Unhandled consequence type: ${consequence.type}`);
  }

  // Safely narrow parameter types without using 'any'
  const typedApplier = applier as (
    state: GameState,
    event: GameEvent,
    cons: ConsequenceAction,
    apply: typeof applyConsequence
  ) => GameState;

  return typedApplier(state, event, consequence, applyConsequence);
}

/**
 * Processes all global events against the declarative trigger system.
 * @param state The current game state containing events.
 * @returns The updated game state with triggered consequences applied.
 */
export function processGlobalTriggers(state: GameState): GameState {
  if (state.events.length === 0) return state;

  let nextState = state;

  let eventIndex = 0;
  // Using while loop to process newly pushed events from consequences recursively.
  while (eventIndex < nextState.events.length) {
    const event = nextState.events[eventIndex]!;
    eventIndex++;

    // O(1) bucket routing
    const triggers = nextState.campaign.triggerBuckets?.[event.type] ?? [];

    for (const trigger of triggers) {
      if (event.type === GameEventType.TrapTriggered) {
        const trapEvent = event as TrapTriggeredEvent;
        // The trigger ID in the JSON must match the triggerId in the trap.
        if (trapEvent.triggerId !== trigger.id) {
          continue; // Skip if this trap trigger doesn't match the physical triggerId
        }
      }

      const conditionsMet = trigger.conditions.every((c) => evaluateCondition(nextState, event, c));
      if (conditionsMet) {
        const pacingResult = evaluatePacing(nextState, trigger);
        if (pacingResult.allowed) {
          if (trigger.pacing) {
            nextState = applyPacingCosts(nextState, trigger);
          }
          for (const consequence of trigger.consequences) {
            nextState = applyConsequence(nextState, event, consequence);
          }
          const traceEvent: DebugTriggerTraceEvent = {
            type: GameEventType.DebugTriggerTrace,
            triggerId: trigger.id,
            triggeringEvent: event,
            executedConsequences: trigger.consequences.map((c) => c.type)
          };
          nextState = {
            ...nextState,
            events: [...nextState.events, traceEvent as unknown as GameEvent]
          };
        } else {
          const fallbacks = trigger.fallbackConsequences || [];
          for (const consequence of fallbacks) {
            nextState = applyConsequence(nextState, event, consequence);
          }
          const traceEvent: DebugTriggerTraceEvent = {
            type: GameEventType.DebugTriggerTrace,
            triggerId: trigger.id,
            triggeringEvent: event,
            executedConsequences: fallbacks.map((c) => c.type),
            rejectionReason: pacingResult.reason
          };
          nextState = {
            ...nextState,
            events: [...nextState.events, traceEvent as unknown as GameEvent]
          };
        }
      }
    }
  }

  return nextState;
}
