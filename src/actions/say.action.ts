import type { GameState } from '../types/game-state.types.ts';
import type { SayIntent } from '../types/intents/interaction.intents.ts';
import type { GameEvent } from '../types/events.types.ts';
import { executeSay } from '../systems/message.system.ts';

/**
 * Resolves a SayIntent. Emits a SayResolvedEvent and adds a message to the message log.
 */
export function processSayIntent(
  state: GameState,
  intent: SayIntent
): { state: GameState; success: boolean; events?: readonly GameEvent[] } {
  const { state: nextState, event } = executeSay(state, intent.entityId, intent.message);

  return {
    state: nextState,
    success: true,
    events: [event]
  };
}
