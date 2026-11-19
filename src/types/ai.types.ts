import { type GameState, type EntityId } from './game-state.types.ts';
import { type Intent } from './intents/intent.union.ts';

/**
 * A function that encapsulates a single AI behavior.
 * @param state The current GameState.
 * @param entityId The EntityId taking its turn.
 * @param params Behavior-specific configuration (e.g. { threshold: 0.3 }).
 * @returns An Intent to execute, or null if the behavior decides not to act.
 */
export type AIBehaviorFn = (
  state: GameState,
  entityId: EntityId,
  params: Readonly<Record<string, unknown>>
) => Intent | null;
