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

/**
 * An entry in an AI Profile's behavior pipeline.
 */
export interface AIBehaviorEntry {
  /** The string ID of the behavior to run (e.g. 'hunt', 'wander'). */
  readonly behaviorId: string;
  /** Parameters passed to the behavior function. */
  readonly params: Readonly<Record<string, unknown>>;
}

/**
 * A data-driven AI profile composed of multiple behaviors executed in priority order.
 */
export interface AIProfile {
  readonly id: string;
  /** Ordered list of behaviors. The first one to return a non-null Intent wins. */
  readonly behaviors: ReadonlyArray<AIBehaviorEntry>;
}
