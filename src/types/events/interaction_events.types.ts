import type { EntityId } from '../game-state.types.ts';
import type { BaseGameEvent, GameEvent, GameEventType } from '../events.types.ts';

/** Fired when an entity moves to new grid coordinates. */
export interface EntityMovedEvent extends BaseGameEvent {
  readonly type: GameEventType.EntityMoved;
  readonly entityId: EntityId;
  readonly x: number;
  readonly y: number;
}

/** Fired when an entity picks up an item from the map. */
export interface ItemPickedUpEvent extends BaseGameEvent {
  readonly type: GameEventType.ItemPickedUp;
  readonly entityId: EntityId;
  readonly itemId: EntityId;
}

/** Fired when an entity drops an item onto the map. */
export interface ItemDroppedEvent extends BaseGameEvent {
  readonly type: GameEventType.ItemDropped;
  readonly entityId: EntityId;
  readonly itemId: EntityId;
}

/** Fired when an entity consumes or uses an item. */
export interface ItemUsedEvent extends BaseGameEvent {
  readonly type: GameEventType.ItemUsed;
  readonly entityId: EntityId;
  readonly itemId: EntityId;
}

/** Fired when an entity equips an item into a slot. */
export interface ItemEquippedEvent extends BaseGameEvent {
  readonly type: GameEventType.ItemEquipped;
  readonly entityId: EntityId;
  readonly itemId: EntityId;
}

/** Fired when an entity removes an item from an equipment slot. */
export interface ItemUnequippedEvent extends BaseGameEvent {
  readonly type: GameEventType.ItemUnequipped;
  readonly entityId: EntityId;
  readonly itemId: EntityId;
}

/** Fired when the player discovers a plot clue. */
export interface ClueDiscoveredEvent extends BaseGameEvent {
  readonly type: GameEventType.ClueDiscovered;
  readonly clueId: string;
  readonly sourceEntityId: EntityId;
  readonly implicatesEntityId?: EntityId | undefined;
}

/** Fired when an entity steps on a specific grid tile. */
export interface TileEnteredEvent extends BaseGameEvent {
  readonly type: GameEventType.TileEntered;
  readonly entityId: EntityId;
  readonly x: number;
  readonly y: number;
  readonly tileTag: string;
}

/**
 * Fired when a hostile or nemesis entity newly enters the player's field of view.
 */
export interface EntitySpottedEvent extends BaseGameEvent {
  readonly type: GameEventType.EntitySpotted;
  readonly entityId: EntityId;
  readonly x: number;
  readonly y: number;
  readonly isNemesis: boolean;
  readonly tags: ReadonlyArray<string>;
}

/** Fired when the player selects an option inside dialogue. */
export interface DialogueSelectedEvent extends BaseGameEvent {
  readonly type: GameEventType.DialogueSelected;
  readonly dialogueId: string;
  readonly optionId: string;
}

/** Fired when progress on a quest objective updates. */
export interface QuestStageChangedEvent extends BaseGameEvent {
  readonly type: GameEventType.QuestStageChanged;
  readonly questId: string;
  readonly objectiveId: string;
}

/** Fired when a quest is fully resolved and completed. */
export interface QuestCompletedEvent extends BaseGameEvent {
  readonly type: GameEventType.QuestCompleted;
  readonly questId: string;
}

/** Fired when a quest is failed. */
export interface QuestFailedEvent extends BaseGameEvent {
  readonly type: GameEventType.QuestFailed;
  readonly questId: string;
}

/** Fired during debug triggers execution tracing. */
export interface DebugTriggerTraceEvent extends BaseGameEvent {
  readonly type: GameEventType.DebugTriggerTrace;
  readonly triggerId: string;
  readonly triggeringEvent: Readonly<GameEvent>;
  readonly executedConsequences: ReadonlyArray<string>;
  readonly rejectionReason?: string | undefined;
}

/** Fired when a verb application is successfully resolved. */
export interface ApplyResolvedEvent extends BaseGameEvent {
  readonly type: GameEventType.ApplyResolved;
  readonly entityId: EntityId;
  readonly verb: string;
  readonly target: unknown;
  readonly toolEntityId?: EntityId | undefined;
}

/** Fired when a verb application fails to resolve. */
export interface ApplyFailedEvent extends BaseGameEvent {
  readonly type: GameEventType.ApplyFailed;
  readonly entityId: EntityId;
  readonly verb: string;
  readonly target: unknown;
  readonly toolEntityId?: EntityId | undefined;
  readonly reason: string;
}

/** Fired when a tag-driven reaction resolves successfully. */
export interface ReactionResolvedEvent extends BaseGameEvent {
  readonly type: GameEventType.ReactionResolved;
  readonly reactionId: string;
  readonly verb: string;
  readonly sourceId: EntityId;
  readonly target: unknown;
  readonly whyMatched: string;
}

/** Fired when a scheme phase alters area tags/spawns. */
export interface SchemeMutatedAreaEvent extends BaseGameEvent {
  readonly type: GameEventType.SchemeMutatedArea;
  readonly areaId: string;
  readonly tagsAdded: ReadonlyArray<string>;
  readonly budgetModifier: number;
}

/** Fired when an NPC vocalizes a bark or line. */
export interface SayResolvedEvent extends BaseGameEvent {
  readonly type: GameEventType.SayResolved;
  readonly entityId: EntityId;
  readonly message: string;
}

/** Fired when a stress event violates an NPC's values. */
export interface CoreValueViolatedEvent extends BaseGameEvent {
  readonly type: GameEventType.CoreValueViolated;
  readonly entityId: EntityId;
  readonly eventSummary: string;
}

/** Fired when a mastermind scheme advances to a new phase. */
export interface SchemeAdvancedEvent extends BaseGameEvent {
  readonly type: GameEventType.SchemeAdvanced;
  readonly schemeId: string;
  readonly newPhase: number;
  readonly targetAreaId?: string | undefined;
}

/** Fired when the player disrupts a mastermind scheme minion/node. */
export interface SchemeNodeDisruptedEvent extends BaseGameEvent {
  readonly type: GameEventType.SchemeNodeDisrupted;
  readonly schemeId: string;
  readonly mastermindId: EntityId;
  readonly minionId: EntityId;
}

/** Fired when mastermind escalates scheme difficulty/countermeasures. */
export interface SchemeEscalatedEvent extends BaseGameEvent {
  readonly type: GameEventType.SchemeEscalated;
  readonly schemeId: string;
  readonly mastermindId: EntityId;
}

/** Fired when the Encounter Director repopulates a cleared area. */
export interface AreaRespawnedEvent extends BaseGameEvent {
  readonly type: GameEventType.AreaRespawned;
  readonly areaId: string;
  readonly newEntitiesSpawned: number;
}

/** Fired when the player goes too many turns without discovering a plot clue. */
export interface InvestigationStalledEvent extends BaseGameEvent {
  readonly type: GameEventType.InvestigationStalled;
  readonly turnsStalled: number;
}

/** Fired when a background world event occurs for an Area or Faction. */
export interface WorldEventFiredEvent extends BaseGameEvent {
  readonly type: GameEventType.WorldEventFired;
  readonly entityId?: EntityId;
}
