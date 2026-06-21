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
  Chronicle = 'Chronicle'
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
}

/**
 * Tag component indicating that the entity is the player.
 */
export interface PlayerComponent {
  readonly type: ComponentType.Player;
}

/**
 * Component indicating the entity takes turns in the scheduler.
 */
export interface ActorComponent {
  readonly type: ComponentType.Actor;
  readonly speed: number;
}

/**
 * Component indicating the entity can be interacted with, yielding Intents.
 */
import type { Intent } from './intents/intent.union.ts';
import type { EntityId } from './game-state.types.ts';
import type { EquipmentSlot } from './campaign.types.ts';

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
}

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
 * Component tracking an entity's memories, grudges, and faction reputations.
 */
export interface MemoryComponent {
  readonly type: ComponentType.Memory;
  readonly grudges: ReadonlyArray<string>;
  readonly factionStandings: Record<string, number>;
  readonly facts: ReadonlyArray<string>;
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

export interface SchemeComponent {
  readonly type: ComponentType.Scheme;
  readonly schemeId: string;
  readonly currentPhase: number;
  readonly activeMinions: ReadonlyArray<EntityId>;
  readonly schemeTargetId?: EntityId | undefined;
}

export interface AgreementComponent {
  readonly type: ComponentType.Agreement;
  readonly mastermindId: EntityId;
  readonly agreementId: string;
  readonly leverageUsed: 'money' | 'ideology' | 'coercion' | 'ego';
  readonly targetAreaId?: string | undefined;
  readonly isFulfilled?: boolean | undefined;
}

export interface ClueComponent {
  readonly type: ComponentType.Clue;
  readonly clueId: string;
  readonly text: string;
  readonly implicatesEntityId: EntityId;
}

export interface FieldComponent {
  readonly type: ComponentType.Field;
  readonly fieldType: string;
  readonly intensity: number;
  readonly duration: number;
  readonly spreadRuleId?: string | undefined;
}

export interface DialogueComponent {
  readonly type: ComponentType.Dialogue;
  readonly dialogueId: string;
}

export interface AttitudeComponent {
  readonly type: ComponentType.Attitude;
  readonly attitude: 'hostile' | 'neutral' | 'friendly';
}

export interface IdentityComponent {
  readonly type: ComponentType.Identity;
  readonly name: string;
  readonly title?: string | undefined;
  readonly mannerisms: ReadonlyArray<string>;
  readonly colorOverride?: string | undefined;
}

export interface ChronicleEvent {
  readonly turn: number;
  readonly type: string; // e.g., "Promotion", "Humiliation"
  readonly summary: string;
  readonly relatedEntityIds?: ReadonlyArray<EntityId> | undefined;
}

export interface ChronicleComponent {
  readonly type: ComponentType.Chronicle;
  readonly pis: number; // Player Interaction Score
  readonly scars: ReadonlyArray<string>;
  readonly coreMemories: ReadonlyArray<string>; // For M43 internal mutation
  readonly eventExcerpts: ReadonlyArray<ChronicleEvent>;
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
  | ChronicleComponent;
