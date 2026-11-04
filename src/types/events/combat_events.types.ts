import type { EntityId } from '../game-state.types.ts';
import type { BaseGameEvent, GameEventType } from '../events.types.ts';

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

/** Fired when a weapon is used to kill an entity (for artifact tracking). */
export interface ItemKillEvent extends BaseGameEvent {
  readonly type: GameEventType.ItemKill;
  readonly entityId: EntityId;
}

/** Fired when an entity triggers a trap tile. */
export interface TrapTriggeredEvent extends BaseGameEvent {
  readonly type: GameEventType.TrapTriggered;
  readonly entityId: EntityId;
  readonly triggerId: string;
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
