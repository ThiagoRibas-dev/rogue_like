import type { EntityId } from './game-state.types.ts';
import type { IntentType } from './intents/intent.enum.ts';

/**
 * Discriminated union of causal frames in a runtime `InteractionChain`.
 * Fully JSON-serializable (no functions, Maps, or Sets).
 */
export type InteractionFrame =
  | {
      readonly kind: 'intent';
      readonly intentType: IntentType;
      readonly actorId: EntityId;
      readonly targetId?: EntityId | undefined;
    }
  | {
      readonly kind: 'action';
      readonly actionId: string;
      readonly actorId: EntityId;
    }
  | {
      readonly kind: 'strike';
      readonly attackerId: EntityId;
      readonly defenderId: EntityId;
      readonly strikeIndex: number;
      readonly attackSource: string;
    }
  | {
      readonly kind: 'item';
      readonly itemEntityId: EntityId;
      readonly itemId: string;
      readonly role: 'weapon' | 'tool' | 'consumable' | 'deployed_source';
      readonly slotId?: string | undefined;
    }
  | {
      readonly kind: 'effect';
      readonly effectId: string;
      readonly effectKind: 'coating' | 'rider' | 'spell' | 'status' | 'reaction' | 'field_interaction';
      readonly sourcePath?: string | undefined;
    }
  | {
      readonly kind: 'field';
      readonly fieldEntityId: EntityId;
      readonly fieldType: string;
    }
  | {
      readonly kind: 'trigger';
      readonly triggerId: string;
      readonly triggeringEntityId?: EntityId | undefined;
    };

/** Canonical discriminator kind for an `InteractionFrame`. */
export type InteractionFrameKind = InteractionFrame['kind'];

/**
 * Serializable runtime causal ancestry chain recording the originating entity
 * and every intermediate intent, action, strike, item, effect, field, or trigger frame.
 */
export interface InteractionChain {
  readonly originatorEntityId: EntityId;
  readonly frames: ReadonlyArray<InteractionFrame>;
}
