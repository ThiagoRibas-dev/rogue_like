/**
 * Enum defining the types of components available in the Entity-Component-System.
 */
export const enum ComponentType {
  Position = 'Position',
  Renderable = 'Renderable',
  Player = 'Player',
  Actor = 'Actor',
  Interactable = 'Interactable',
  GodMode = 'GodMode',
  Fighter = 'Fighter',
  AI = 'AI',
  Item = 'Item',
  Inventory = 'Inventory',
  Equipment = 'Equipment'
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
import type { Intent } from './intents.types.ts';
import type { EntityId } from './game-state.types.ts';

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
}

/**
 * Enum defining the types of AI behavior.
 */
export const enum AIBehavior {
  BasicMelee = 'basic_melee'
}

/**
 * Component representing the AI behavior type of an entity.
 */
export interface AIComponent {
  readonly type: ComponentType.AI;
  readonly behavior: AIBehavior;
  readonly aggroRadius?: number;
  readonly wanders?: boolean;
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
  /** Whether the player knows the item's true name (M8 prep, defaults true for MVP). */
  readonly identified: boolean;
  /** Remaining charges for consumables with multiple uses (M8 prep for wands). */
  readonly charges?: number;
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
export interface EquipmentComponent {
  readonly type: ComponentType.Equipment;
  readonly weapon: EntityId | null;
  readonly armor: EntityId | null;
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
  | EquipmentComponent;
