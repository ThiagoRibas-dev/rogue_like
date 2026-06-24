import type { EntityId } from '../game-state.types.ts';
import type { Verb } from '../../constants/verbs.constants.ts';
import { IntentType } from './intent.enum.ts';
import type { BaseIntent } from './core.intents.ts';

/** Target pointing to the self (actor). */
export interface SelfTarget {
  readonly type: 'self';
}

/** Target pointing to a specific entity ID. */
export interface EntityTarget {
  readonly type: 'entity';
  readonly entityId: EntityId;
}

/** Target pointing to a specific item entity ID. */
export interface ItemTarget {
  readonly type: 'item';
  readonly itemEntityId: EntityId;
}

/** Target pointing to a specific coordinate tile on the map. */
export interface TileTarget {
  readonly type: 'tile';
  readonly x: number;
  readonly y: number;
}

/** Union type representing all possible target selections for applying intents. */
export type ApplyIntentTarget = SelfTarget | EntityTarget | ItemTarget | TileTarget;

/**
 * The canonical intent for applying a verb to a target.
 * M29 Unified Apply Intent plumbing.
 */
export interface ApplyIntent extends BaseIntent {
  readonly type: IntentType.Apply;
  readonly verb: Verb;
  readonly target: ApplyIntentTarget;
  readonly toolEntityId?: EntityId | undefined;
}

/** Legacy intent for interacting with a target entity. */
export interface InteractIntent extends BaseIntent {
  readonly type: IntentType.Interact;
  readonly targetId: EntityId;
}

/** Intent representing speech/barks emitted by an entity. */
export interface SayIntent extends BaseIntent {
  readonly type: IntentType.Say;
  readonly entityId: EntityId;
  readonly message: string;
  readonly volume?: number | undefined;
}
