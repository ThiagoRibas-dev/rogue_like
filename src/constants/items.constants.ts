import { COLOR_TRANSPARENT } from './colors.constants.ts';

/**
 * Enum categorizing items by their mechanical role.
 * Maps directly to future JSON schema categories for M9 data-driven loading.
 */
export const enum ItemCategory {
  Consumable = 'consumable',
  Weapon = 'weapon',
  Armor = 'armor'
}

/**
 * Enum defining the available equipment slots on an entity.
 * Extensible in Phase 2 to Ring, Amulet, etc.
 */
export const enum EquipmentSlot {
  Weapon = 'weapon',
  Armor = 'armor'
}

/**
 * Base inventory capacity for entities that can carry items.
 * Effective capacity = baseCapacity + equipment/effect bonuses.
 */
export const BASE_INVENTORY_CAPACITY = 10;

/** Maximum number of items that can spawn in a single room. */
export const MAX_ITEMS_PER_ROOM = 2;

/**
 * Definition of a single item type in the Item Registry.
 * Shaped like a future JSON schema for M9 modding support.
 */
export interface ItemDefinition {
  /** Unique string key for this item type. */
  readonly id: string;
  /** Display name shown when the item is identified. */
  readonly name: string;
  /** Display name shown before the item is identified (M8 prep). */
  readonly unidentifiedName: string;
  /** Flavor text for item inspection UI (M8 prep). */
  readonly description: string;
  /** ASCII glyph rendered on the map and in UI. */
  readonly glyph: string;
  /** Foreground color for the glyph. */
  readonly fg: string;
  /** Background color for the glyph. */
  readonly bg: string;
  /** Item category controlling which system handles it. */
  readonly category: ItemCategory;
  /**
   * Item weight in arbitrary units (M9 prep for encumbrance).
   * Currently unused — stored for future data-driven systems.
   */
  readonly weight: number;
  /** Consumable configuration. Present only if category === Consumable. */
  readonly consumable?: {
    /** String key into ITEM_EFFECTS registry. */
    readonly effectId: string;
    /** Number of uses. 1 for single-use potions, N for wands (M8 prep). */
    readonly charges: number;
  };
  /** Equipment configuration. Present only if category === Weapon or Armor. */
  readonly equippable?: {
    /** Which equipment slot this item occupies. */
    readonly slot: EquipmentSlot;
    /** Bonus added to the wielder's effective attack stat. */
    readonly attackBonus: number;
    /** Bonus added to the wielder's effective defense stat. */
    readonly defenseBonus: number;
    /** Bonus added to the wielder's effective max HP (M6 prep). */
    readonly maxHpBonus: number;
    /** Bonus added to the wielder's effective inventory capacity. */
    readonly carryBonus: number;
  };
}

/**
 * The global Item Registry — a data-driven lookup table of all item types.
 * Every string key matches the corresponding ItemDefinition.id.
 */
export const ITEM_REGISTRY: Readonly<Record<string, ItemDefinition>> = {
  health_potion: {
    id: 'health_potion',
    name: 'Health Potion',
    unidentifiedName: 'Red Potion',
    description: 'A vial of crimson liquid that restores vitality when consumed.',
    glyph: '!',
    fg: '#e74c3c',
    bg: COLOR_TRANSPARENT,
    category: ItemCategory.Consumable,
    weight: 1,
    consumable: { effectId: 'heal_5', charges: 1 }
  },
  scroll_of_lightning: {
    id: 'scroll_of_lightning',
    name: 'Scroll of Lightning',
    unidentifiedName: 'Strange Scroll',
    description: 'A crackling scroll that strikes the nearest enemy with a bolt of lightning.',
    glyph: '?',
    fg: '#f1c40f',
    bg: COLOR_TRANSPARENT,
    category: ItemCategory.Consumable,
    weight: 1,
    consumable: { effectId: 'damage_nearest_10', charges: 1 }
  },
  short_sword: {
    id: 'short_sword',
    name: 'Short Sword',
    unidentifiedName: 'Short Sword',
    description: 'A light, double-edged blade favored by adventurers for its speed.',
    glyph: '/',
    fg: '#bdc3c7',
    bg: COLOR_TRANSPARENT,
    category: ItemCategory.Weapon,
    weight: 3,
    equippable: {
      slot: EquipmentSlot.Weapon,
      attackBonus: 3,
      defenseBonus: 0,
      maxHpBonus: 0,
      carryBonus: 0
    }
  },
  leather_armor: {
    id: 'leather_armor',
    name: 'Leather Armor',
    unidentifiedName: 'Leather Armor',
    description: 'Tanned hide stitched into a vest. Provides modest protection.',
    glyph: '[',
    fg: '#a67c52',
    bg: COLOR_TRANSPARENT,
    category: ItemCategory.Armor,
    weight: 5,
    equippable: {
      slot: EquipmentSlot.Armor,
      attackBonus: 0,
      defenseBonus: 1,
      maxHpBonus: 2,
      carryBonus: 0
    }
  },
  backpack: {
    id: 'backpack',
    name: 'Backpack',
    unidentifiedName: 'Backpack',
    description: 'A sturdy pack that increases the amount of items you can carry.',
    glyph: 'b',
    fg: '#8e6b3e',
    bg: COLOR_TRANSPARENT,
    category: ItemCategory.Armor,
    weight: 2,
    equippable: {
      slot: EquipmentSlot.Armor,
      attackBonus: 0,
      defenseBonus: 0,
      maxHpBonus: 0,
      carryBonus: 5
    }
  }
} satisfies Record<string, ItemDefinition>;

/**
 * Weighted loot table controlling item spawn probability.
 * Keys are item IDs from ITEM_REGISTRY; values are relative weights.
 * Higher weight = more likely to spawn.
 */
export const LOOT_TABLE: Readonly<Record<string, number>> = {
  health_potion: 60,
  scroll_of_lightning: 15,
  short_sword: 10,
  leather_armor: 10,
  backpack: 5
};
