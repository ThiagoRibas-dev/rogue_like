import type { EntityId } from './game-state.types.ts';

/**
 * Enum defining the types of events that can be emitted to the global event ledger.
 */
export const enum GameEventType {
  EntityMoved = 'EntityMoved',
  EntityDamaged = 'EntityDamaged',
  EntityDied = 'EntityDied',
  EntityHealed = 'EntityHealed',
  ItemPickedUp = 'ItemPickedUp',
  ItemDropped = 'ItemDropped',
  ItemUsed = 'ItemUsed',
  ItemEquipped = 'ItemEquipped',
  ItemUnequipped = 'ItemUnequipped'
}

export interface BaseGameEvent {
  readonly type: GameEventType;
}

export interface EntityMovedEvent extends BaseGameEvent {
  readonly type: GameEventType.EntityMoved;
  readonly entityId: EntityId;
  readonly x: number;
  readonly y: number;
}

export interface EntityDamagedEvent extends BaseGameEvent {
  readonly type: GameEventType.EntityDamaged;
  readonly entityId: EntityId;
  readonly amount: number;
  readonly sourceEntityId?: EntityId;
}

export interface EntityDiedEvent extends BaseGameEvent {
  readonly type: GameEventType.EntityDied;
  readonly entityId: EntityId;
  readonly killerEntityId?: EntityId;
}

export interface EntityHealedEvent extends BaseGameEvent {
  readonly type: GameEventType.EntityHealed;
  readonly entityId: EntityId;
  readonly amount: number;
}

export interface ItemPickedUpEvent extends BaseGameEvent {
  readonly type: GameEventType.ItemPickedUp;
  readonly entityId: EntityId;
  readonly itemId: EntityId;
}

export interface ItemDroppedEvent extends BaseGameEvent {
  readonly type: GameEventType.ItemDropped;
  readonly entityId: EntityId;
  readonly itemId: EntityId;
}

/**
 * Discriminated union of all possible GameEvents.
 */
export type GameEvent =
  | EntityMovedEvent
  | EntityDamagedEvent
  | EntityDiedEvent
  | EntityHealedEvent
  | ItemPickedUpEvent
  | ItemDroppedEvent;
