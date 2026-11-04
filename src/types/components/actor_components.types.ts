import type { ComponentType } from '../components.types.ts';
import type { EntityId } from '../game-state.types.ts';

/**
 * Tag component indicating that the entity is the player.
 */
export interface PlayerComponent {
  readonly type: ComponentType.Player;
}

/**
 * Maneuverability rating for flying creatures in D&D 3.5e.
 */
export type FlightManeuverability = 'clumsy' | 'poor' | 'average' | 'good' | 'perfect';

/**
 * Multi-mode movement speeds for creatures (land, burrow, climb, fly, swim).
 */
export interface MovementModes {
  readonly land: number;
  readonly burrow?: number | undefined;
  readonly climb?: number | undefined;
  readonly fly?: number | undefined;
  readonly swim?: number | undefined;
  readonly maneuverability?: FlightManeuverability | undefined;
}

/**
 * Component indicating the entity takes turns in the scheduler.
 */
export interface ActorComponent {
  readonly type: ComponentType.Actor;
  readonly speed: number;
  readonly movementModes?: MovementModes | undefined;
}

/**
 * Component indicating the entity takes no damage (cheat).
 */
export interface GodModeComponent {
  readonly type: ComponentType.GodMode;
}

/**
 * Component representing the combat stats of an entity.
 */
export interface FighterComponent {
  readonly type: ComponentType.Fighter;
  readonly maxHp: number;
  readonly hp: number;
  readonly attack: number;
  readonly defense: number;
  readonly xp: number;
  readonly level: number;
  readonly xpGiven: number;
}

/**
 * Component representing the AI behavior profile of an entity.
 */
export interface AIComponent {
  readonly type: ComponentType.AI;
  readonly profileId: string;
  readonly aggroRadius?: number;
  readonly wanders?: boolean;
  /** Map of effectId or ability name to remaining turns on cooldown */
  readonly cooldowns?: Readonly<Record<string, number>>;
}

/**
 * Component representing an entity's hunger state.
 */
export interface HungerComponent {
  readonly type: ComponentType.Hunger;
  readonly satiation: number;
}

/**
 * Component representing the faction an entity belongs to.
 */
export interface FactionComponent {
  readonly type: ComponentType.Faction;
  readonly factionId: string;
}

/**
 * An instance of a status effect applied to an entity.
 */
export interface ActiveStatusEffect {
  readonly effectId: string;
  readonly duration: number;
  readonly sourceEntityId?: EntityId;
}

/**
 * Component holding all active status effects on an entity.
 */
export interface StatusEffectsComponent {
  readonly type: ComponentType.StatusEffects;
  readonly activeEffects: ReadonlyArray<ActiveStatusEffect>;
}

/**
 * Standard 5-tier D&D 3.5e NPC attitude categories plus legacy 'neutral'.
 */
export type AttitudeTier = 'hostile' | 'unfriendly' | 'indifferent' | 'neutral' | 'friendly' | 'helpful';

/**
 * Component defining an NPC's attitude towards another entity or faction.
 */
export interface AttitudeComponent {
  readonly type: ComponentType.Attitude;
  readonly attitude: AttitudeTier;
}

/**
 * Component storing the generated identity details of a promoted entity (such as name, title, mannerisms).
 */
export interface IdentityComponent {
  readonly type: ComponentType.Identity;
  readonly name: string;
  readonly title?: string | undefined;
  readonly mannerisms: ReadonlyArray<string>;
  readonly colorOverride?: string | undefined;
}

/**
 * Represents a transient emotional reaction or thought of an entity.
 */
export interface Thought {
  readonly turn: number;
  readonly eventSummary: string;
  readonly stressDelta: number;
  readonly relatedEntityId?: EntityId | undefined;
}

/**
 * Represents an item of knowledge (such as secrets or rumors) stored by an entity.
 */
export interface KnowledgeItem {
  readonly id: string;
  readonly type: 'rumor' | 'location' | 'weakness' | 'secret';
  readonly description: string;
  readonly tags: ReadonlyArray<string>;
}

/**
 * Represents a rumor item template or instance within an entity's rumor pool.
 */
export interface RumorItem {
  readonly id: string;
  readonly text: string;
  readonly sourceEventId?: string | undefined;
  readonly turnCreated: number;
  readonly persistent?: boolean | undefined;
}

/**
 * Component tracking an entity's memories, grudges, and faction reputations.
 */
export interface MemoryComponent {
  readonly type: ComponentType.Memory;
  readonly grudges: ReadonlyArray<string>;
  readonly factionStandings: Record<string, number>;
  readonly facts: ReadonlyArray<string>;
  readonly facets?: Readonly<Record<string, number>> | undefined;
  readonly values?: Readonly<Record<string, number>> | undefined;
  readonly stress?: number | undefined;
  readonly thoughts?: ReadonlyArray<Thought> | undefined;
  readonly knowledge: Readonly<Record<string, KnowledgeItem>>;
  readonly timesTalked?: number | undefined;
  readonly timesTraded?: number | undefined;
  readonly timesIntimidated?: number | undefined;
  readonly timesHelped?: number | undefined;
  readonly timesBetrayed?: number | undefined;
  readonly patienceThreshold?: number | undefined;
  readonly annoyedDuration?: number | undefined;
  readonly gratefulDuration?: number | undefined;
  readonly deflectionLines?: ReadonlyArray<string> | undefined;
  readonly sessionMarkupModifier?: number | undefined;
  readonly rumorPool?: ReadonlyArray<RumorItem> | undefined;
  readonly compromiseScore?: number | undefined;
  readonly relationshipAxes?: Readonly<Record<string, number>> | undefined;
}

/**
 * Represents a recorded event in a promoted entity's timeline/history.
 */
export interface ChronicleEvent {
  readonly turn: number;
  readonly type: string;
  readonly summary: string;
  readonly relatedEntityIds?: ReadonlyArray<EntityId> | undefined;
}

/**
 * Component tracking player interaction scores, scars, and history of a promoted entity.
 */
export interface ChronicleComponent {
  readonly type: ComponentType.Chronicle;
  readonly pis: number;
  readonly scars: ReadonlyArray<string>;
  readonly coreMemories: ReadonlyArray<string>;
  readonly eventExcerpts: ReadonlyArray<string>;
}

/**
 * Component tracking hierarchy rank, cheat death count, and nemesis status.
 */
export interface NemesisComponent {
  readonly type: ComponentType.Nemesis;
  readonly hierarchyId: string;
  readonly rankId: string;
  readonly tier: number;
  readonly cheatedDeathCount: number;
  readonly lastDeathTurn: number;
  readonly returnDelay?: number | undefined;
  readonly targetAreaId?: string | undefined;
  readonly lastEncounterTurn?: number | undefined;
}

/**
 * Component tracking player interaction scores that decay over time.
 */
export interface InteractionScoreComponent {
  readonly type: ComponentType.InteractionScore;
  readonly score: number;
}

/**
 * Component linking an entity to its controller/master (minions, companions, familiars, eidolons, summons).
 */
export interface ControllerLinkComponent {
  readonly type: ComponentType.ControllerLink;
  readonly controllerEntityId: EntityId;
  readonly relationship: 'minion' | 'companion' | 'familiar' | 'eidolon' | 'mount' | 'summon';
  readonly shareInitiative?: boolean | undefined;
  readonly expirationTurn?: number | undefined;
}

/**
 * Canonical recharge cycle for modular resource pools.
 */
export type ResourceRefreshCycle = 'round' | 'encounter' | 'short_rest' | 'rest_8h';

/**
 * Pool entry for modular character resources (rage uses, turn undead, smite, ki).
 */
export interface ResourcePoolEntry {
  readonly current: number;
  readonly max: number;
  readonly resetOnRest: boolean;
  readonly label?: string | undefined;
  readonly refreshCycle?: ResourceRefreshCycle | undefined;
}

/**
 * Component tracking named modular resource pools.
 */
export interface ResourcePoolComponent {
  readonly type: ComponentType.ResourcePool;
  readonly pools: Readonly<Record<string, ResourcePoolEntry>>;
}

/**
 * Combat weapon grip modes for armed actors.
 */
export type WeaponGripMode = 'one_handed' | 'two_handed' | 'double_weapon_twf';

/**
 * Component storing active tactical stances and combat trade-offs (Power Attack, Combat Expertise, Fighting Defensively)
 * as well as data-driven doctrine settings and weapon grip mode.
 */
export interface TacticalDoctrineComponent {
  readonly type: ComponentType.TacticalDoctrine;
  readonly powerAttackAmount?: number | undefined;
  readonly combatExpertiseAmount?: number | undefined;
  readonly fightingDefensively?: boolean | undefined;
  readonly totalDefense?: boolean | undefined;
  readonly gripMode?: WeaponGripMode | undefined;
  readonly settings?: Readonly<Record<string, boolean | number | string>> | undefined;
}
