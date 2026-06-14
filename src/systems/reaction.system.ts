import type { GameState, EntityId } from '../types/game-state.types.ts';
import { getComponent } from '../core/ecs.ts';
import { ComponentType } from '../types/components.types.ts';
import { applyConsequence } from './trigger.system.ts';
import { GameEventType, type GameEvent } from '../types/events.types.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';

/**
 * Processes declarative reactions between game entities based on their tags.
 * Currently supports 'item_combine'.
 */
export function processReactions(
  state: GameState,
  sourceEntityId: EntityId,
  targetEntityId: EntityId,
  triggerType: 'item_combine'
): { state: GameState; success: boolean } {
  const sourceItem = getComponent(state, sourceEntityId, ComponentType.Item);
  const targetItem = getComponent(state, targetEntityId, ComponentType.Item);

  if (!sourceItem || !targetItem) return { state, success: false };

  const sourceDef = state.campaign.items[sourceItem.itemId];
  const targetDef = state.campaign.items[targetItem.itemId];

  if (!sourceDef || !targetDef) return { state, success: false };

  const sourceTags = sourceDef.tags || [];
  const targetTags = targetDef.tags || [];

  let nextState = state;
  let reactionTriggered = false;

  for (const reaction of state.campaign.reactions) {
    if (reaction.trigger !== triggerType) continue;

    if (sourceTags.includes(reaction.sourceTag) && targetTags.includes(reaction.targetTag)) {
      // Reaction matched!
      reactionTriggered = true;

      // Log the message
      if (reaction.message) {
        nextState = addMessage(nextState, reaction.message, MessageLogCategory.System);
      }

      // Apply the consequence
      // We use a dummy event to satisfy the trigger system signature since this is an emergent interaction.
      const dummyEvent = {
        type: GameEventType.ItemUnequipped,
        entityId: sourceEntityId,
        itemId: 'dummy'
      } as unknown as GameEvent;

      const evalCons = {
        ...reaction.result,
        _npcEntityId: targetEntityId,
        _playerEntityId: sourceEntityId
      };

      nextState = applyConsequence(nextState, dummyEvent, evalCons);
    }
  }

  return { state: nextState, success: reactionTriggered };
}
