import type { ApplyFailedEvent, ApplyResolvedEvent, GameEvent } from '../types/events.types.ts';
import { GameEventType } from '../types/events.types.ts';
import type { GameState } from '../types/game-state.types.ts';
import type { ApplyIntent } from '../types/intents/interaction.intents.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';
import { processProjectileThrow } from './projectile.system.ts';
import { processWandZap } from './zap.system.ts';
import { processReactions, getValidReactionsForTarget } from './reaction.system.ts';
import { VERBS, type Verb } from '../constants/verbs.constants.ts';
import { ComponentType, type ItemComponent } from '../types/components.types.ts';
import { getComponent } from '../core/ecs.ts';
import type { EntityId } from '../types/game-state.types.ts';
import type { ApplyIntentTarget } from '../types/intents/interaction.intents.ts';
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
    const resolvedEvent: ApplyResolvedEvent = {
      type: GameEventType.ApplyResolved,
      entityId: intent.entityId,
      verb: intent.verb,
      target: intent.target,
      toolEntityId: intent.toolEntityId
    };
    return {
      state: result.state,
      success: true,
      events: [resolvedEvent]
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

/**
 * Returns a list of valid verbs for a given target combination,
 * evaluating both hardcoded item mechanics (throw/zap) and data-driven reactions.
 */
export function getValidVerbsForTarget(
  state: GameState,
  sourceEntityId: EntityId,
  target: ApplyIntentTarget,
  toolEntityId?: EntityId
): Verb[] {
  const validVerbs = new Set<Verb>();

  // 1. Check hardcoded fallback verb systems (if holding a tool)
  if (toolEntityId) {
    const itemComp = getComponent(state, toolEntityId, ComponentType.Item) as ItemComponent | undefined;
    if (itemComp) {
      const itemDef = state.campaign.items[itemComp.itemId];
      if (itemDef) {
        if (itemDef.throwable) validVerbs.add('throw');
        if (itemDef.zappable) validVerbs.add('zap');
      }
    }
  }

  // 2. Check all verbs against data-driven reactions
  for (const verb of VERBS) {
    if (validVerbs.has(verb)) continue; // Already validated

    const matches = getValidReactionsForTarget(state, verb, sourceEntityId, target, toolEntityId);
    if (matches.length > 0) {
      validVerbs.add(verb);
    }
  }

  return Array.from(validVerbs);
}
