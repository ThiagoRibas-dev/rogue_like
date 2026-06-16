import type { EntityId } from '../types/game-state.types.ts';
import type { Verb } from '../constants/verbs.constants.ts';
import type { ApplyIntent, ApplyIntentTarget } from '../types/intents/interaction.intents.ts';
import { IntentType } from '../types/intents/intent.enum.ts';

/**
 * Creates an ApplyIntent.
 *
 * @param entityId The entity performing the action.
 * @param verb The verb to apply.
 * @param target The target of the action (self, entity, item, tile).
 * @param toolEntityId The optional tool being used.
 * @returns The formed ApplyIntent.
 */
export function createApplyAction(
  entityId: EntityId,
  verb: Verb,
  target: ApplyIntentTarget,
  toolEntityId?: EntityId
): ApplyIntent {
  return {
    type: IntentType.Apply,
    entityId,
    verb,
    target,
    toolEntityId
  };
}
