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
  ItemUnequipped = 'ItemUnequipped',
  ClueDiscovered = 'ClueDiscovered',
  TileEntered = 'TileEntered',
  DialogueSelected = 'DialogueSelected',
  TrapTriggered = 'TrapTriggered',
  QuestStageChanged = 'QuestStageChanged',
  QuestCompleted = 'QuestCompleted',
  DebugTriggerTrace = 'DebugTriggerTrace'
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
  readonly victimId: EntityId;
  readonly killerId?: EntityId;
  readonly tags: ReadonlyArray<string>;
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

export interface ClueDiscoveredEvent extends BaseGameEvent {
  readonly type: GameEventType.ClueDiscovered;
  readonly clueId: string;
  readonly sourceEntityId: EntityId;
  readonly implicatesEntityId?: EntityId | undefined;
}

export interface TileEnteredEvent extends BaseGameEvent {
  readonly type: GameEventType.TileEntered;
  readonly entityId: EntityId;
  readonly x: number;
  readonly y: number;
  readonly tileTag: string;
}

export interface DialogueSelectedEvent extends BaseGameEvent {
  readonly type: GameEventType.DialogueSelected;
  readonly dialogueId: string;
  readonly optionId: string;
}

export interface TrapTriggeredEvent extends BaseGameEvent {
  readonly type: GameEventType.TrapTriggered;
  readonly entityId: EntityId;
  readonly triggerId: string;
}

export interface QuestStageChangedEvent extends BaseGameEvent {
  readonly type: GameEventType.QuestStageChanged;
  readonly questId: string;
  readonly objectiveId: string;
}

export interface QuestCompletedEvent extends BaseGameEvent {
  readonly type: GameEventType.QuestCompleted;
  readonly questId: string;
}

export interface DebugTriggerTraceEvent extends BaseGameEvent {
  readonly type: GameEventType.DebugTriggerTrace;
  readonly triggerId: string;
  readonly triggeringEvent: Readonly<GameEvent>;
  readonly executedConsequences: ReadonlyArray<string>;
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
  | ItemDroppedEvent
  | ClueDiscoveredEvent
  | TileEnteredEvent
  | DialogueSelectedEvent
  | TrapTriggeredEvent
  | QuestStageChangedEvent
  | QuestCompletedEvent
  | DebugTriggerTraceEvent;
