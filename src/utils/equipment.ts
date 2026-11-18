import type { EquipmentSlotInstance } from '../types/components.types.ts';

/** Canonical anatomical slot types classified as weapon/shield hand-wield slots. */
export const HAND_WIELD_SLOT_TYPES: ReadonlySet<string> = new Set([
  'hand',
  'held',
  'main_hand',
  'off_hand',
  'two_handed'
]);

/**
 * Shape subset of an item definition checked when determining whether an item hovers
 * hands-free (e.g., an animated shield).
 */
export interface AnimatedHandFreeItemShape {
  readonly tags?: ReadonlyArray<string> | undefined;
  readonly enhancements?: ReadonlyArray<string> | undefined;
  readonly magicalProperties?: unknown;
}

/**
 * Reports whether an anatomical equipment slot represents a physical hand-wielding slot.
 *
 * @param slot Equipment slot instance to inspect.
 * @returns True if the slot represents a hand, main-hand, off-hand, or two-handed wield slot.
 */
export function isHandWieldSlot(slot: EquipmentSlotInstance): boolean {
  return (
    HAND_WIELD_SLOT_TYPES.has(slot.slotType) ||
    slot.id.startsWith('hand_') ||
    slot.id.startsWith('main_hand') ||
    slot.id.startsWith('off_hand')
  );
}

/**
 * Resolves the canonical limb-group identifier used to deduplicate physical hands across
 * co-located anatomical slots (e.g., `hand_1` and `main_hand_1` sharing `arm_group_1`).
 *
 * @param slot Equipment slot instance.
 * @returns Physical limb identifier.
 */
export function getSlotLimbGroupKey(slot: EquipmentSlotInstance): string {
  return slot.limbGroupId ?? slot.id;
}

/**
 * Reports whether an item floats/acts autonomously without occupying an actor's hand
 * (e.g., an *Animated* shield).
 *
 * @param itemDef Item definition (or effective merged definition) to check.
 * @returns True if the item does not consume a physical hand while equipped.
 */
export function isItemAnimatedHandFree(itemDef: AnimatedHandFreeItemShape | undefined): boolean {
  if (!itemDef) return false;
  const tags = itemDef.tags ?? [];
  const magic =
    typeof itemDef.magicalProperties === 'object' && itemDef.magicalProperties !== null
      ? (itemDef.magicalProperties as {
          readonly animated?: unknown;
          readonly enhancements?: unknown;
        })
      : undefined;
  const magicEnhancements = Array.isArray(magic?.enhancements)
    ? magic.enhancements.filter((e): e is string => typeof e === 'string')
    : [];
  const enhancements = [...(itemDef.enhancements ?? []), ...magicEnhancements];
  return (
    magic?.animated === true ||
    tags.includes('animated') ||
    tags.includes('shield:animated') ||
    enhancements.includes('animated')
  );
}
