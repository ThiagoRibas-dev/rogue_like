import type { ApplyFailedEvent, GameEvent } from '../types/events.types.ts';
import { GameEventType } from '../types/events.types.ts';
import type { GameState } from '../types/game-state.types.ts';
import type { ApplyIntent } from '../types/intents/interaction.intents.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';
import { processProjectileThrow } from './projectile.system.ts';
import { processWandZap } from './zap.system.ts';
import { processReactions } from './reaction.system.ts';

/**
 * Processes an ApplyIntent, which represents a generic attempt by an actor
 * to apply a specific verb to a specific target, optionally using a tool.
 *
 * @param state The current GameState.
 * @param intent The ApplyIntent to process.
 * @returns A result object containing the potentially modified state, success flag, and emitted events.
 */
export function processApplyIntent(
  state: GameState,
  intent: ApplyIntent
): { state: GameState; success: boolean; events?: readonly GameEvent[] } {
  if (intent.verb === 'throw' && intent.toolEntityId) {
    return processProjectileThrow(state, intent);
  }

  if (intent.verb === 'zap' && intent.toolEntityId) {
    return processWandZap(state, intent);
  }

  const result = processReactions(state, intent.verb, intent.entityId, intent.target, intent.toolEntityId);

  if (result.success) {
    return {
      state: result.state,
      success: true
    };
  }

  const failedEvent: ApplyFailedEvent = {
    type: GameEventType.ApplyFailed,
    entityId: intent.entityId,
    verb: intent.verb,
    target: intent.target,
    toolEntityId: intent.toolEntityId,
    reason: 'No reaction matched this combination.'
  };

  const stateWithMessage = addMessage(state, `Nothing interesting happens.`, MessageLogCategory.System);

  return {
    state: stateWithMessage,
    success: false,
    events: [failedEvent]
  };
}
