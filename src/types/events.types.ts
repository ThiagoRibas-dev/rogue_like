import type {
  EntityDamagedEvent,
  EntityDiedEvent,
  EntityHealedEvent,
  ItemKillEvent,
  NemesisCheatedDeathEvent,
  NemesisPromotedEvent,
  NemesisReturnedEvent,
  NemesisScarredEvent,
  NemesisVacancyEvent,
  RivalryFailedEvent,
  RivalryResolvedEvent,
  RivalryScheduledEvent,
  TrapTriggeredEvent
} from './events/combat_events.types.ts';
import type {
  ApplyFailedEvent,
  ApplyResolvedEvent,
  AreaRespawnedEvent,
  ClueDiscoveredEvent,
  CoreValueViolatedEvent,
  DebugTriggerTraceEvent,
  DialogueSelectedEvent,
  EntityMovedEvent,
  EntitySpottedEvent,
  InvestigationStalledEvent,
  ItemDroppedEvent,
  ItemEquippedEvent,
  ItemPickedUpEvent,
  ItemUnequippedEvent,
  ItemUsedEvent,
  QuestCompletedEvent,
  QuestFailedEvent,
  QuestStageChangedEvent,
  ReactionResolvedEvent,
  SayResolvedEvent,
  SchemeAdvancedEvent,
  SchemeEscalatedEvent,
  SchemeMutatedAreaEvent,
  SchemeNodeDisruptedEvent,
  TileEnteredEvent,
  WorldEventFiredEvent
} from './events/interaction_events.types.ts';

// Re-export Combat & Nemesis Events (AGENTS.md Rule 8 & 15)
export type {
  EntityDamagedEvent,
  EntityDiedEvent,
  EntityHealedEvent,
  ItemKillEvent,
  TrapTriggeredEvent,
  RivalryScheduledEvent,
  RivalryResolvedEvent,
  RivalryFailedEvent,
  NemesisPromotedEvent,
  NemesisVacancyEvent,
  NemesisCheatedDeathEvent,
  NemesisReturnedEvent,
  NemesisScarredEvent
} from './events/combat_events.types.ts';

// Re-export Interaction, Narrative & Scheme Events
export type {
  EntityMovedEvent,
  ItemPickedUpEvent,
  ItemDroppedEvent,
  ItemUsedEvent,
  ItemEquippedEvent,
  ItemUnequippedEvent,
  ClueDiscoveredEvent,
  TileEnteredEvent,
  EntitySpottedEvent,
  DialogueSelectedEvent,
  QuestStageChangedEvent,
  QuestCompletedEvent,
  QuestFailedEvent,
  DebugTriggerTraceEvent,
  ApplyResolvedEvent,
  ApplyFailedEvent,
  ReactionResolvedEvent,
  SchemeMutatedAreaEvent,
  SayResolvedEvent,
  CoreValueViolatedEvent,
  SchemeAdvancedEvent,
  SchemeNodeDisruptedEvent,
  SchemeEscalatedEvent,
  AreaRespawnedEvent,
  InvestigationStalledEvent,
  WorldEventFiredEvent
} from './events/interaction_events.types.ts';

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
  ItemKill = 'ItemKill',
  ClueDiscovered = 'ClueDiscovered',
  TileEntered = 'TileEntered',
  EntitySpotted = 'EntitySpotted',
  DialogueSelected = 'DialogueSelected',
  TrapTriggered = 'TrapTriggered',
  QuestStageChanged = 'QuestStageChanged',
  QuestCompleted = 'QuestCompleted',
  QuestFailed = 'QuestFailed',
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
  InvestigationStalled = 'InvestigationStalled',
  WorldEventFired = 'WorldEventFired'
}

/** Base interface for all ledger events. */
export interface BaseGameEvent {
  readonly id?: string;
  readonly type: GameEventType;
  readonly importance?: 'low' | 'normal' | 'high';
  readonly summary?: string;
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
  | ItemKillEvent
  | ClueDiscoveredEvent
  | TileEnteredEvent
  | EntitySpottedEvent
  | DialogueSelectedEvent
  | TrapTriggeredEvent
  | QuestStageChangedEvent
  | QuestCompletedEvent
  | QuestFailedEvent
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
  | InvestigationStalledEvent
  | WorldEventFiredEvent;
