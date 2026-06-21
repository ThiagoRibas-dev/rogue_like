import type { GameState } from '../types/game-state.types.ts';
import type { SayIntent } from '../types/intents/interaction.intents.ts';
import { GameEventType, type GameEvent, type SayResolvedEvent } from '../types/events.types.ts';
import { getComponent } from '../core/ecs.ts';
import { ComponentType } from '../types/components.types.ts';
import { addMessage, MessageLogCategory } from '../systems/message.system.ts';

/**
 * Resolves a SayIntent. Emits a SayResolvedEvent and adds a message to the message log.
 */
export function processSayIntent(
  state: GameState,
  intent: SayIntent
): { state: GameState; success: boolean; events?: readonly GameEvent[] } {
  const { entityId, message } = intent;

  const identity = getComponent(state, entityId, ComponentType.Identity);
  const name = identity ? identity.name : 'Someone';

  const logMessage = `"${message}" - ${name}`;

  // Note: we can expand this to emit floating text overhead if we wanted to
  const nextState = addMessage(state, logMessage, MessageLogCategory.Flavor);

  const event: SayResolvedEvent = {
    type: GameEventType.SayResolved,
    entityId,
    message
  };

  // We could assign an energyCost here if saying something costs a turn,
  // but for barks, typically it's considered free or handled differently.
  // Since action registry currently expects intents to be processed by `applyIntentWithCost`
  // if they cost energy, and we just dispatch it.
  // Wait, in `action.registry.ts` the return type is just `{state, success, events}` without energyCost.
  // Energy cost is handled by the caller, which uses intent rules.

  return {
    state: nextState,
    success: true,
    events: [event]
  };
}
