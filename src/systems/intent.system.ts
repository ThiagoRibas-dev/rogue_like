import type { GameState } from '../types/game-state.types.ts';
import type { InteractIntent } from '../types/intents/interaction.intents.ts';
import { getComponent } from '../core/ecs.ts';
import { ComponentType, type DialogueComponent } from '../types/components.types.ts';
import { processStartDialogueIntent } from '../actions/dialogue.actions.ts';
import { isHostile } from '../utils/faction.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';
import { IntentType } from '../types/intents/intent.enum.ts';

/**
 * Handles processing of an InteractIntent.
 * Validates if the target is hostile, resolves their DialogueComponent,
 * and boots the Dialogue system.
 *
 * @param state The current GameState.
 * @param intent The InteractIntent.
 * @returns The next GameState and a success flag.
 */
export function processInteractIntent(
  state: GameState,
  intent: InteractIntent
): { state: GameState; success: boolean } {
  const { entityId, targetId } = intent;

  const dialogueComp = getComponent(state, targetId, ComponentType.Dialogue) as DialogueComponent | undefined;

  if (!dialogueComp) {
    return {
      state: addMessage(state, 'They have nothing to say.', MessageLogCategory.System),
      success: false
    };
  }

  // Check hostility: Hostile NPCs refuse to talk.
  if (isHostile(state, targetId, entityId)) {
    return {
      state: addMessage(state, 'They are hostile and refuse to speak to you.', MessageLogCategory.System),
      success: false
    };
  }

  // Start dialogue tree
  return processStartDialogueIntent(state, {
    type: IntentType.StartDialogue,
    entityId,
    targetId,
    dialogueId: dialogueComp.dialogueId
  });
}
