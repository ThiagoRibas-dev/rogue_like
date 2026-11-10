import type { ComponentType } from '../components.types.ts';
import type { EntityId } from '../game-state.types.ts';
import type { EquipmentSlot } from '../campaign.types.ts';
import type { MovementModes } from './actor_components.types.ts';

/**
 * A branded string type uniquely identifying a single item instance.
 * Two items with the same itemId (same template) will have different instanceIds.
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
 * Component tagging an entity as an item and linking it to its ITEM_REGISTRY definition.
 * Every field here is serializable — no functions or closures.
 */
export interface ItemComponent {
  readonly type: ComponentType.Item;
  readonly itemId: string;
  readonly instanceId: ItemInstanceId;
  readonly charges?: number | undefined;
  readonly customName?: string | undefined;
  readonly customDescription?: string | undefined;
  readonly specialMaterial?: string | undefined;
  readonly enhancementBonus?: number | undefined;
  readonly enhancements?: ReadonlyArray<string> | undefined;
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
 */
export interface InventoryComponent {
  readonly type: ComponentType.Inventory;
  readonly items: ReadonlyArray<EntityId>;
  readonly baseCapacity: number;
}

/**
 * Component attached to entities that can equip gear.
 */
export interface EquipmentSlotInstance {
  readonly id: string;
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
