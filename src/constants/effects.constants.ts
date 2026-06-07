/**
 * Enum defining all item effect types supported by the effect processor.
 * Adding a new effect type requires: one entry here, one case in effects.system.ts,
 * and one entry in ITEM_EFFECTS. This is the M9 extensibility point.
 */
export const enum ItemEffectType {
  Heal = 'heal',
  DamageNearest = 'damage_nearest',
  DamageArea = 'damage_area'
}

/**
 * Declarative definition of a single item effect.
 * Effects are pure data — the effect processor interprets them.
 * This ensures effects are serializable (M7) and can be loaded from JSON (M9).
 */
export interface ItemEffectDefinition {
  /** Unique string key matching the effectId on ItemDefinition.consumable. */
  readonly id: string;
  /** The type of effect, dispatched by the effect processor. */
  readonly type: ItemEffectType;
  /** Primary numeric value — HP restored, damage dealt, etc. */
  readonly value: number;
  /** Range in tiles for targeted effects (DamageNearest). */
  readonly range?: number;
  /** Radius in tiles for area effects (DamageArea — M8 prep). */
  readonly radius?: number;
  /**
   * Log message template.
   * Supports {item} and {value} placeholders for substitution.
   */
  readonly message: string;
}

/**
 * The global Item Effects Registry — maps effectId strings to their definitions.
 * The effect processor (effects.system.ts) dispatches based on ItemEffectType,
 * reading parameters from these definitions rather than hardcoding values.
 */
export const ITEM_EFFECTS: Readonly<Record<string, ItemEffectDefinition>> = {
  heal_5: {
    id: 'heal_5',
    type: ItemEffectType.Heal,
    value: 5,
    message: 'You drink the {item}. You recover {value} HP.'
  },
  damage_nearest_10: {
    id: 'damage_nearest_10',
    type: ItemEffectType.DamageNearest,
    value: 10,
    range: 8,
    message: 'A bolt of lightning strikes {target} for {value} damage!'
  }
} satisfies Record<string, ItemEffectDefinition>;
