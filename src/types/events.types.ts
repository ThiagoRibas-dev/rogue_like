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
  RivalryFailed = 'RivalryFailed'
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

export interface ItemUsedEvent extends BaseGameEvent {
  readonly type: GameEventType.ItemUsed;
  readonly entityId: EntityId;
  readonly itemId: EntityId;
}

export interface ItemEquippedEvent extends BaseGameEvent {
  readonly type: GameEventType.ItemEquipped;
  readonly entityId: EntityId;
  readonly itemId: EntityId;
}

export interface ItemUnequippedEvent extends BaseGameEvent {
  readonly type: GameEventType.ItemUnequipped;
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

export interface ApplyResolvedEvent extends BaseGameEvent {
  readonly type: GameEventType.ApplyResolved;
  readonly entityId: EntityId;
  readonly verb: string;
  readonly target: unknown;
  readonly toolEntityId?: EntityId | undefined;
}

export interface ApplyFailedEvent extends BaseGameEvent {
  readonly type: GameEventType.ApplyFailed;
  readonly entityId: EntityId;
  readonly verb: string;
  readonly target: unknown;
  readonly toolEntityId?: EntityId | undefined;
  readonly reason: string;
}

export interface ReactionResolvedEvent extends BaseGameEvent {
  readonly type: GameEventType.ReactionResolved;
  readonly reactionId: string;
  readonly verb: string;
  readonly sourceId: EntityId;
  readonly target: unknown;
  readonly whyMatched: string;
}

export interface SchemeMutatedAreaEvent extends BaseGameEvent {
  readonly type: GameEventType.SchemeMutatedArea;
  readonly areaId: string;
  readonly tagsAdded: ReadonlyArray<string>;
  readonly budgetModifier: number;
}

export interface SayResolvedEvent extends BaseGameEvent {
  readonly type: GameEventType.SayResolved;
  readonly entityId: EntityId;
  readonly message: string;
}

export interface CoreValueViolatedEvent extends BaseGameEvent {
  readonly type: GameEventType.CoreValueViolated;
  readonly entityId: EntityId;
  readonly eventSummary: string;
}

export interface SchemeAdvancedEvent extends BaseGameEvent {
  readonly type: GameEventType.SchemeAdvanced;
  readonly schemeId: string;
  readonly newPhase: number;
}

export interface NemesisPromotedEvent extends BaseGameEvent {
  readonly type: GameEventType.NemesisPromoted;
  readonly entityId: EntityId;
  readonly hierarchyId: string;
  readonly newRankId: string;
  readonly previousRankId?: string | undefined;
}

export interface NemesisVacancyEvent extends BaseGameEvent {
  readonly type: GameEventType.NemesisVacancy;
  readonly hierarchyId: string;
  readonly rankId: string;
  readonly vacatedByEntityId: EntityId;
}

export interface NemesisCheatedDeathEvent extends BaseGameEvent {
  readonly type: GameEventType.NemesisCheatedDeath;
  readonly entityId: EntityId;
  readonly killerId?: EntityId | undefined;
  readonly scarId?: string | undefined;
}

export interface NemesisReturnedEvent extends BaseGameEvent {
  readonly type: GameEventType.NemesisReturned;
  readonly entityId: EntityId;
  readonly areaId: string;
}

export interface NemesisScarredEvent extends BaseGameEvent {
  readonly type: GameEventType.NemesisScarred;
  readonly entityId: EntityId;
  readonly scarId: string;
}

export interface RivalryScheduledEvent extends BaseGameEvent {
  readonly type: GameEventType.RivalryScheduled;
  readonly rivalryId: string;
  readonly rivalryType: string;
  readonly sourceEntityId: EntityId;
  readonly targetEntityId?: EntityId;
  readonly resolutionTurn: number;
}

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

export interface RivalryFailedEvent extends BaseGameEvent {
  readonly type: GameEventType.RivalryFailed;
  readonly rivalryId: string;
  readonly reason: string;
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
  | RivalryFailedEvent;
