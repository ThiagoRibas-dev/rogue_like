import type { EntityId } from '../game-state.types.ts';
import type { Verb } from '../../constants/verbs.constants.ts';
import { IntentType } from './intent.enum.ts';
import type { BaseIntent } from './core.intents.ts';

export interface SelfTarget {
  readonly type: 'self';
}

export interface EntityTarget {
  readonly type: 'entity';
  readonly entityId: EntityId;
}

export interface ItemTarget {
  readonly type: 'item';
  readonly itemEntityId: EntityId;
}

export interface TileTarget {
  readonly type: 'tile';
  readonly x: number;
  readonly y: number;
}

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
