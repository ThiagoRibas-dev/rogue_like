/**
 * Enum defining the types of components available in the Entity-Component-System.
 */
export const enum ComponentType {
  Position = 'Position',
  Renderable = 'Renderable',
  Coating = 'Coating',
  Player = 'Player',
  Actor = 'Actor',
  Interactable = 'Interactable',
  GodMode = 'GodMode',
  Fighter = 'Fighter',
  AI = 'AI',
  Item = 'Item',
  Inventory = 'Inventory',
  Equipment = 'Equipment',
  StatusEffects = 'StatusEffects',
  Faction = 'Faction',
  Hunger = 'Hunger',
  Trap = 'Trap',
  Tags = 'Tags',
  Traits = 'Traits',
  Portal = 'Portal',
  EdgeTransition = 'EdgeTransition',
  Persistent = 'Persistent',
  Memory = 'Memory',
  QuestLog = 'QuestLog',
  Template = 'Template',
  Damage = 'Damage',
  Death = 'Death',
  Scheme = 'Scheme',
  Agreement = 'Agreement',
  Clue = 'Clue',
  Lock = 'Lock',
  Field = 'Field',
  Dialogue = 'Dialogue',
  Attitude = 'Attitude',
  Identity = 'Identity',
  Chronicle = 'Chronicle',
  Shop = 'Shop',
  Services = 'Services',
  Nemesis = 'Nemesis',
  InteractionScore = 'InteractionScore',
  DirectorBudget = 'DirectorBudget',
  RulesetData = 'RulesetData',
  PropertyOverlay = 'PropertyOverlay',
  ControllerLink = 'ControllerLink',
  ResourcePool = 'ResourcePool',
  TacticalDoctrine = 'TacticalDoctrine'
}

/**
 * Component representing the coordinates of an entity on the grid.
 */
export interface PositionComponent {
  readonly type: ComponentType.Position;
  readonly x: number;
  readonly y: number;
}

/**
 * Component representing the visual properties of an entity.
 */
export interface RenderableComponent {
  readonly type: ComponentType.Renderable;
  readonly glyph: string;
  readonly fg: string;
  readonly bg: string;
  readonly spriteId?: string;
}

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
 * Component indicating the entity can be interacted with, yielding Intents.
 */
import type { Intent } from './intents/intent.union.ts';
import type { EntityId } from './game-state.types.ts';
import type { EquipmentSlot } from './campaign.types.ts';
import type { PhaseBlock } from './campaign/social.ts';

/**
 * A branded string type uniquely identifying a single item instance.
 * Two items with the same itemId (same template) will have different instanceIds.
 * Critical for future stacking and save/load disambiguation (M7/M8/M9).
 */
export type ItemInstanceId = string & { readonly __brand: unique symbol };

/**
 * Helper to cast a string to ItemInstanceId.
 * @param id The raw string to cast.
 * @returns The branded ItemInstanceId.
 */
export function toItemInstanceId(id: string): ItemInstanceId {
  return id as ItemInstanceId;
}

/**
 * Component that makes an entity interactable, holding the list of supported intents.
 */
export interface InteractableComponent {
  readonly type: ComponentType.Interactable;
  readonly intents: ReadonlyArray<Intent>;
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
 * Component tagging an entity as an item and linking it to its ITEM_REGISTRY definition.
 * Every field here is serializable — no functions or closures.
 */
export interface ItemComponent {
  readonly type: ComponentType.Item;
  /** String key into ITEM_REGISTRY identifying the item type. */
  readonly itemId: string;
  /**
   * Unique per-instance ID. Two health potions will have different instanceIds.
   * Generated from GameState.nextItemInstanceId counter.
   */
  readonly instanceId: ItemInstanceId;
  /** Remaining charges for consumables with multiple uses (M8 prep for wands). */
  readonly charges?: number;
}

/**
 * Component applied to an item representing a temporary coating or buff (e.g., dipped in poison).
 */
export interface CoatingComponent {
  readonly type: ComponentType.Coating;
  readonly statusId: string;
  readonly charges: number;
  readonly duration: number;
}

/**
 * Component attached to entities that can hold items (player, containers).
 * Effective capacity = baseCapacity + bonuses from equipment/effects.
 */
export interface InventoryComponent {
  readonly type: ComponentType.Inventory;
  /** Ordered list of item entity IDs currently in this inventory. */
  readonly items: ReadonlyArray<EntityId>;
  /**
   * Base inventory size before equipment/effect bonuses.
   * Use getEffectiveCapacity() from stats.ts to get the true available slots.
   */
  readonly baseCapacity: number;
}

/**
 * Component attached to entities that can equip gear.
 * Slots hold EntityId references to equipped item entities (which may also be in inventory).
 * null means the slot is empty.
 */
export interface EquipmentSlotInstance {
  readonly id: string; // Unique instance ID, e.g., "head_1", "arm_2", "finger_3"
  readonly slotType: EquipmentSlot;
  readonly equippedItem: EntityId | null;
  readonly limbGroupId?: string | undefined;
  readonly occupiedBySlotId?: string | undefined;
  readonly suppressed?: boolean | undefined;
}

/**
 * Component tracking the equipment slots and equipped items of an entity.
 */
export interface EquipmentComponent {
  readonly type: ComponentType.Equipment;
  readonly slots: EquipmentSlotInstance[];
}

/**
 * An instance of a status effect applied to an entity.
 */
export interface ActiveStatusEffect {
  readonly effectId: string; // Key to STATUS_EFFECTS registry
  readonly duration: number; // Turns remaining
  readonly sourceEntityId?: EntityId; // The entity that applied this effect
}

/**
 * Component holding all active status effects on an entity.
 */
export interface StatusEffectsComponent {
  readonly type: ComponentType.StatusEffects;
  readonly activeEffects: ReadonlyArray<ActiveStatusEffect>;
}

/**
 * Component representing the faction an entity belongs to.
 */
export interface FactionComponent {
  readonly type: ComponentType.Faction;
  readonly factionId: string;
}

/**
 * Component representing an entity's hunger state.
 */
export interface HungerComponent {
  readonly type: ComponentType.Hunger;
  readonly satiation: number;
}

/**
 * Component representing a hidden trap that triggers when stepped on.
 */
export interface TrapComponent {
  readonly type: ComponentType.Trap;
  readonly triggerId: string;
  readonly triggered: boolean;
}

/**
 * Component holding semantic string tags (e.g., 'undead', 'fire_aligned')
 */
export interface TagsComponent {
  readonly type: ComponentType.Tags;
  readonly tags: ReadonlyArray<string>;
}

/**
 * Component holding mechanical traits (e.g., 'Regeneration', 'Fragile')
 */
export interface TraitsComponent {
  readonly type: ComponentType.Traits;
  readonly traits: ReadonlyArray<string>;
}

/**
 * Component representing a portal to another area.
 */
export interface PortalComponent {
  readonly type: ComponentType.Portal;
  readonly targetAreaId: string;
  readonly targetX?: number | undefined;
  readonly targetY?: number | undefined;
}

/**
 * Component marking an entity that has walked off the edge of the map.
 */
export interface EdgeTransitionComponent {
  readonly type: ComponentType.EdgeTransition;
  readonly targetAreaId: string;
}

/**
 * Component marking an entity as persistent (survives map transitions).
 */
export interface PersistentComponent {
  readonly type: ComponentType.Persistent;
}

/**
 * Stores the original ID of the template from which this entity was spawned.
 */
export interface TemplateComponent {
  readonly type: ComponentType.Template;
  readonly templateId: string;
}

/**
 * Component for tracking access state on doors, chests, and containers.
 */
export interface LockComponent {
  readonly type: ComponentType.Lock;
  readonly difficulty: number; // For lockpicking attempts
  readonly keyTag?: string | undefined; // Tag required on an item to open this lock (e.g., 'key:bronze')
  readonly locked: boolean;
  readonly jammed?: boolean | undefined; // True if broken/unpickable
  readonly breakable?: boolean | undefined; // True if it can be kicked down or destroyed
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
 * Represents the state of a single quest.
 */
export interface QuestState {
  readonly questId: string;
  readonly status: 'active' | 'completed' | 'failed';
  readonly objectiveProgress: Record<string, number>;
}

/**
 * Tracks active and completed quests for an entity (usually the player).
 */
export interface QuestLogComponent {
  readonly type: ComponentType.QuestLog;
  readonly quests: Readonly<Record<string, QuestState>>;
  readonly activeTriggers?: Readonly<Record<string, ReadonlyArray<string>>>;
}

/**
 * Represents a single instance of damage, containing amounts, source, and tags.
 */
export interface DamageInstance {
  readonly amount: number;
  readonly sourceEntityId?: EntityId | undefined;
  readonly tags: ReadonlyArray<string>; // e.g. ['melee', 'physical'], ['spell', 'fire']
}

/**
 * Component holding incoming damage events to be processed by the damage system.
 */
export interface DamageComponent {
  readonly type: ComponentType.Damage;
  readonly instances: ReadonlyArray<DamageInstance>;
}

/**
 * Component marking an entity as dead, to be processed by the death system.
 */
export interface DeathComponent {
  readonly type: ComponentType.Death;
  readonly killerId?: EntityId | undefined;
  readonly causeOfDeath?: string | undefined;
}

// ==========================================
// ADVERSARIAL LAYER COMPONENTS
// ==========================================

/**
 * Component tracking villainous mastermind schemes and their phases.
 */
export interface SchemeComponent {
  readonly type: ComponentType.Scheme;
  readonly recipeId: string;
  readonly currentPhase: number;
  readonly activeMinions: ReadonlyArray<EntityId>;
  readonly phases: ReadonlyArray<PhaseBlock>;
  readonly schemeTargetId?: EntityId | undefined;
  readonly isLeaderless?: boolean | undefined;
  readonly conspiracyAwareness?: number | undefined;
}

/**
 * Component representing an agreement/contract between masterminds and minions.
 */
export interface AgreementComponent {
  readonly type: ComponentType.Agreement;
  readonly mastermindId: EntityId;
  readonly agreementId: string;
  readonly leverageUsed: 'money' | 'ideology' | 'coercion' | 'ego';
  readonly targetAreaId?: string | undefined;
  readonly isFulfilled?: boolean | undefined;
}

/**
 * Component marking an item or entity as a discoverable clue.
 */
export interface ClueComponent {
  readonly type: ComponentType.Clue;
  readonly clueId: string;
  readonly text: string;
  readonly implicatesEntityId: EntityId;
}

/**
 * Component representing a hazard field tile or mobile aura/emanation (like fire, poison gas, or silence/antimagic).
 */
export interface FieldComponent {
  readonly type: ComponentType.Field;
  readonly fieldType: string;
  readonly intensity: number;
  readonly duration: number;
  readonly spreadRuleId?: string | undefined;
  readonly anchorEntityId?: EntityId | undefined;
  readonly radiusFt?: number | undefined;
  readonly sourceEntityId?: EntityId | undefined;
  readonly blocksLoS?: boolean | undefined;
  readonly blocksLoE?: boolean | undefined;
  readonly suppressedTags?: ReadonlyArray<string> | undefined;
  readonly movementCostMultiplier?: number | undefined;
}

/**
 * Component identifying that an NPC supports dialogue conversations.
 */
export interface DialogueComponent {
  readonly type: ComponentType.Dialogue;
  readonly dialogueId: string;
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
 * Represents a recorded event in a promoted entity's timeline/history.
 */
export interface ChronicleEvent {
  readonly turn: number;
  readonly type: string; // e.g., "Promotion", "Humiliation"
  readonly summary: string;
  readonly relatedEntityIds?: ReadonlyArray<EntityId> | undefined;
}

/**
 * Component tracking player interaction scores, scars, and history of a promoted entity.
 */
export interface ChronicleComponent {
  readonly type: ComponentType.Chronicle;
  readonly pis: number; // Player Interaction Score
  readonly scars: ReadonlyArray<string>;
  readonly coreMemories: ReadonlyArray<string>; // For M43 internal mutation
  readonly eventExcerpts: ReadonlyArray<string>; // Array of GameEvent IDs
}

/**
 * Component defining merchant data including inventory, markup, and trade rules.
 */
export interface ShopComponent {
  readonly type: ComponentType.Shop;
  readonly inventory: ReadonlyArray<EntityId>;
  readonly markupMultiplier: number;
  readonly buyTags: ReadonlyArray<string>;
  readonly sellTags: ReadonlyArray<string>;
  readonly supplierHierarchyId?: string | undefined;
}

/**
 * Defines a service that can be purchased from an NPC.
 */
export interface ServiceDefinition {
  readonly serviceId: string;
  readonly name: string;
  readonly cost: number;
  readonly effectId: string;
}

/**
 * Component representing services offered by an NPC.
 */
export interface ServicesComponent {
  readonly type: ComponentType.Services;
  readonly services: ReadonlyArray<ServiceDefinition>;
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
 * Component defining the Director's budget modifier and scaling for an area or mastermind.
 */
export interface DirectorBudgetComponent {
  readonly type: ComponentType.DirectorBudget;
  readonly budgetModifier: number;
}

/**
 * Component storing isolated, JSON-serializable ruleset cartridge state on an entity
 * without polluting shared core components with ruleset-specific optional fields.
 */
export interface RulesetDataComponent {
  readonly type: ComponentType.RulesetData;
  readonly rulesetId: 'classic' | 'dnd35e';
  readonly payload: Readonly<Record<string, unknown>>;
}

/**
 * A single composable layer within a PropertyOverlayComponent stack.
 */
export interface PropertyOverlayLayer {
  readonly layerId: string;
  readonly source: string;
  readonly priority: number;
  readonly durationTurns?: number | undefined;
  readonly statOverrides?: Readonly<Record<string, number>> | undefined;
  readonly sizeCategoryOverride?: string | undefined;
  readonly creatureTypeOverride?: string | undefined;
  readonly movementModesOverride?: MovementModes | undefined;
  readonly grantedTags?: ReadonlyArray<string> | undefined;
  readonly suppressedTags?: ReadonlyArray<string> | undefined;
  readonly suppressedSlots?: ReadonlyArray<string> | undefined;
}

/**
 * Component representing a non-destructive property overlay or priority-ordered overlay stack
 * (Wild Shape, polymorph, Enlarge Person, possession, curses).
 */
export interface PropertyOverlayComponent {
  readonly type: ComponentType.PropertyOverlay;
  readonly source: string;
  readonly priority: number;
  readonly durationTurns?: number | undefined;
  readonly statOverrides?: Readonly<Record<string, number>> | undefined;
  readonly sizeCategoryOverride?: string | undefined;
  readonly creatureTypeOverride?: string | undefined;
  readonly movementModesOverride?: MovementModes | undefined;
  readonly grantedTags?: ReadonlyArray<string> | undefined;
  readonly suppressedTags?: ReadonlyArray<string> | undefined;
  readonly suppressedSlots?: ReadonlyArray<string> | undefined;
  readonly layers?: ReadonlyArray<PropertyOverlayLayer> | undefined;
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
 * Combat weapon grip modes for armed actors:
 * - 'one_handed': Wields a 1H weapon in 1 hand (or off-hand).
 * - 'two_handed': Wields a 1H weapon in 2 hands (if a free hand is available) or a 2H weapon in 2 hands.
 * - 'double_weapon_twf': Wields a double weapon using both ends as TWF (one-handed primary + light off-hand).
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

/**
 * Discriminated union of all component types in the game.
 */
export type Component =
  | PositionComponent
  | RenderableComponent
  | PlayerComponent
  | ActorComponent
  | InteractableComponent
  | GodModeComponent
  | FighterComponent
  | AIComponent
  | ItemComponent
  | InventoryComponent
  | EquipmentComponent
  | StatusEffectsComponent
  | FactionComponent
  | HungerComponent
  | TrapComponent
  | TagsComponent
  | TraitsComponent
  | PortalComponent
  | EdgeTransitionComponent
  | PersistentComponent
  | TemplateComponent
  | MemoryComponent
  | QuestLogComponent
  | DamageComponent
  | DeathComponent
  | SchemeComponent
  | AgreementComponent
  | ClueComponent
  | LockComponent
  | FieldComponent
  | CoatingComponent
  | DialogueComponent
  | AttitudeComponent
  | IdentityComponent
  | ChronicleComponent
  | ShopComponent
  | ServicesComponent
  | NemesisComponent
  | InteractionScoreComponent
  | DirectorBudgetComponent
  | RulesetDataComponent
  | PropertyOverlayComponent
  | ControllerLinkComponent
  | ResourcePoolComponent
  | TacticalDoctrineComponent;
