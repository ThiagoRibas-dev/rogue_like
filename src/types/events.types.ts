import type { EntityId } from './game-state.types.ts';

/**
 * Enum defining the types of events that can be emitted to the global event ledger.
 */
export enum GameEventType {
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
  DebugTriggerTrace = 'DebugTriggerTrace',
  ApplyResolved = 'ApplyResolved',
  ApplyFailed = 'ApplyFailed',
  ReactionResolved = 'ReactionResolved',
  SchemeMutatedArea = 'SchemeMutatedArea',
  SayResolved = 'SayResolved',
  CoreValueViolated = 'CoreValueViolated',
  SchemeAdvanced = 'SchemeAdvanced',
  NemesisPromoted = 'NemesisPromoted',
  NemesisVacancy = 'NemesisVacancy',
  NemesisCheatedDeath = 'NemesisCheatedDeath',
  NemesisReturned = 'NemesisReturned',
  NemesisScarred = 'NemesisScarred',
  RivalryScheduled = 'RivalryScheduled',
  RivalryResolved = 'RivalryResolved',
  RivalryFailed = 'RivalryFailed',
  SchemeNodeDisrupted = 'SchemeNodeDisrupted',
  SchemeEscalated = 'SchemeEscalated',
  AreaRespawned = 'AreaRespawned',
  InvestigationStalled = 'InvestigationStalled'
}

/** Base interface for all ledger events. */
export interface BaseGameEvent {
  readonly type: GameEventType;
}

/** Fired when an entity moves to new grid coordinates. */
export interface EntityMovedEvent extends BaseGameEvent {
  readonly type: GameEventType.EntityMoved;
  readonly entityId: EntityId;
  readonly x: number;
  readonly y: number;
}

/** Fired when an entity takes damage. */
export interface EntityDamagedEvent extends BaseGameEvent {
  readonly type: GameEventType.EntityDamaged;
  readonly entityId: EntityId;
  readonly amount: number;
  readonly sourceEntityId?: EntityId;
}

/** Fired when an entity dies. */
export interface EntityDiedEvent extends BaseGameEvent {
  readonly type: GameEventType.EntityDied;
  readonly victimId: EntityId;
  readonly killerId?: EntityId;
  readonly tags: ReadonlyArray<string>;
}

/** Fired when an entity recovers health. */
export interface EntityHealedEvent extends BaseGameEvent {
  readonly type: GameEventType.EntityHealed;
  readonly entityId: EntityId;
  readonly amount: number;
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

/** Fired when the player selects an option inside dialogue. */
export interface DialogueSelectedEvent extends BaseGameEvent {
  readonly type: GameEventType.DialogueSelected;
  readonly dialogueId: string;
  readonly optionId: string;
}

/** Fired when an entity triggers a trap tile. */
export interface TrapTriggeredEvent extends BaseGameEvent {
  readonly type: GameEventType.TrapTriggered;
  readonly entityId: EntityId;
  readonly triggerId: string;
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

/** Fired during debug triggers execution tracing. */
export interface DebugTriggerTraceEvent extends BaseGameEvent {
  readonly type: GameEventType.DebugTriggerTrace;
  readonly triggerId: string;
  readonly triggeringEvent: Readonly<GameEvent>;
  readonly executedConsequences: ReadonlyArray<string>;
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
}

/** Fired when an NPC rises/promotes in faction ranks. */
export interface NemesisPromotedEvent extends BaseGameEvent {
  readonly type: GameEventType.NemesisPromoted;
  readonly entityId: EntityId;
  readonly hierarchyId: string;
  readonly newRankId: string;
  readonly previousRankId?: string | undefined;
}

/** Fired when a hierarchy rank slot is vacated due to death or promotion. */
export interface NemesisVacancyEvent extends BaseGameEvent {
  readonly type: GameEventType.NemesisVacancy;
  readonly hierarchyId: string;
  readonly rankId: string;
  readonly vacatedByEntityId: EntityId;
}

/** Fired when a nemesis survives fatal blow and retreats. */
export interface NemesisCheatedDeathEvent extends BaseGameEvent {
  readonly type: GameEventType.NemesisCheatedDeath;
  readonly entityId: EntityId;
  readonly killerId?: EntityId | undefined;
  readonly scarId?: string | undefined;
}

/** Fired when a dead nemesis returns back to the map floor. */
export interface NemesisReturnedEvent extends BaseGameEvent {
  readonly type: GameEventType.NemesisReturned;
  readonly entityId: EntityId;
  readonly areaId: string;
}

/** Fired when a nemesis gains a permanent physical or mental scar. */
export interface NemesisScarredEvent extends BaseGameEvent {
  readonly type: GameEventType.NemesisScarred;
  readonly entityId: EntityId;
  readonly scarId: string;
}

/** Fired when a background rivalry struggle is scheduled. */
export interface RivalryScheduledEvent extends BaseGameEvent {
  readonly type: GameEventType.RivalryScheduled;
  readonly rivalryId: string;
  readonly rivalryType: string;
  readonly sourceEntityId: EntityId;
  readonly targetEntityId?: EntityId;
  readonly resolutionTurn: number;
}

/** Fired when a scheduled rivalry resolves with clear outcomes. */
export interface RivalryResolvedEvent extends BaseGameEvent {
  readonly type: GameEventType.RivalryResolved;
  readonly rivalryId: string;
  readonly rivalryType: string;
  readonly sourceEntityId: EntityId;
  readonly targetEntityId?: EntityId;
  readonly winnerId?: EntityId;
  readonly loserId?: EntityId;
  readonly consequences: ReadonlyArray<string>;
}

/** Fired when a rivalry fails to resolve (e.g., target dies beforehand). */
export interface RivalryFailedEvent extends BaseGameEvent {
  readonly type: GameEventType.RivalryFailed;
  readonly rivalryId: string;
  readonly reason: string;
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
  | ItemUsedEvent
  | ItemEquippedEvent
  | ItemUnequippedEvent
  | ClueDiscoveredEvent
  | TileEnteredEvent
  | DialogueSelectedEvent
  | TrapTriggeredEvent
  | QuestStageChangedEvent
  | QuestCompletedEvent
  | DebugTriggerTraceEvent
  | ApplyResolvedEvent
  | ApplyFailedEvent
  | ReactionResolvedEvent
  | SchemeMutatedAreaEvent
  | SayResolvedEvent
  | CoreValueViolatedEvent
  | SchemeAdvancedEvent
  | NemesisPromotedEvent
  | NemesisVacancyEvent
  | NemesisCheatedDeathEvent
  | NemesisReturnedEvent
  | NemesisScarredEvent
  | RivalryScheduledEvent
  | RivalryResolvedEvent
  | RivalryFailedEvent
  | SchemeNodeDisruptedEvent
  | SchemeEscalatedEvent
  | AreaRespawnedEvent
  | InvestigationStalledEvent;
