/**
 * @file Pure projection helpers for the D&D 3.5e Cartridge UI Adapter.
 * Converts live ECS equipment slots, inventory items, attack strikes, and feature entries
 * into unified Tier 1 Console UI models without hardcoded showcase data.
 */

import { getComponent } from '../../../core/ecs.ts';
import {
  ComponentType,
  type EquipmentSlotInstance,
  type StatusEffectsComponent
} from '../../../types/components.types.ts';
import type { EntityId, GameState } from '../../../types/game-state.types.ts';
import type {
  UIAnatomicalSlotDescriptor,
  UIAttackGroupModel,
  UIFeatureEntryModel,
  UIInventoryItem
} from '../../../types/ui_adapter.types.ts';
import type { DnD35ResolvedStrikeProfile } from '../combat/attack_routine.ts';
import type { DnD35EntityData } from '../types/dnd35e.types.ts';
import type { DnD35SystemContent } from '../types/dnd35e_system.types.ts';

const NATURAL_20 = 20;
const ASCII_LOWERCASE_A = 97;
const MAX_HOTKEY_INDEX = 26;
const DEFAULT_ITEM_PRICE_GP = 20;
const DEFAULT_ITEM_WEIGHT_LBS = 1.0;

export function formatSigned(val: number): string {
  return val >= 0 ? `+${val}` : `${val}`;
}

export const SLOT_VISUAL_MAP: Readonly<
  Record<string, { label: string; glyph: string; rail: 'left' | 'right'; slotType: string }>
> = {
  head: { label: 'Head', glyph: '🪖', rail: 'left', slotType: 'head' },
  cloak: { label: 'Cloak', glyph: '🧥', rail: 'left', slotType: 'shoulders' },
  shoulders: { label: 'Cloak', glyph: '🧥', rail: 'left', slotType: 'shoulders' },
  ring_1: { label: 'Ring 1', glyph: '💍', rail: 'left', slotType: 'ring' },
  ring_left: { label: 'Ring L', glyph: '💍', rail: 'left', slotType: 'ring' },
  hands: { label: 'Gloves', glyph: '🧤', rail: 'left', slotType: 'hands' },
  hand: { label: 'Gloves', glyph: '🧤', rail: 'left', slotType: 'hands' },
  main_hand: { label: 'Main Hand', glyph: '⚔️', rail: 'left', slotType: 'main_hand' },
  ammo: { label: 'Ammo', glyph: '🏹', rail: 'left', slotType: 'ranged' },
  ranged: { label: 'Ammo', glyph: '🏹', rail: 'left', slotType: 'ranged' },
  neck: { label: 'Neck', glyph: '📿', rail: 'right', slotType: 'neck' },
  torso: { label: 'Armor', glyph: '🛡️', rail: 'right', slotType: 'torso' },
  body: { label: 'Armor', glyph: '🛡️', rail: 'right', slotType: 'torso' },
  waist: { label: 'Belt', glyph: '🎗️', rail: 'right', slotType: 'waist' },
  ring_2: { label: 'Ring 2', glyph: '💍', rail: 'right', slotType: 'ring' },
  ring_right: { label: 'Ring R', glyph: '💍', rail: 'right', slotType: 'ring' },
  feet: { label: 'Boots', glyph: '🥾', rail: 'right', slotType: 'feet' },
  foot: { label: 'Boots', glyph: '🥾', rail: 'right', slotType: 'feet' },
  off_hand: { label: 'Off Hand', glyph: '🗡️', rail: 'right', slotType: 'off_hand' }
};

const DEFAULT_SLOT_IDS = [
  'head',
  'cloak',
  'ring_1',
  'hands',
  'main_hand',
  'ammo',
  'neck',
  'torso',
  'waist',
  'ring_2',
  'feet',
  'off_hand'
] as const;

export const DEFAULT_HUMANOID_SLOTS: ReadonlyArray<UIAnatomicalSlotDescriptor> = DEFAULT_SLOT_IDS.map((id) => {
  const v = SLOT_VISUAL_MAP[id]!;
  return { slotId: id, slotType: v.slotType, label: v.label, emptyGlyph: v.glyph, rail: v.rail, equippedItem: null };
});

const PRIMARY_SLOT_DEFS: Readonly<Record<string, { rail: 'left' | 'right'; label: string; emptyGlyph: string }>> = {
  head: { rail: 'left', label: 'Head', emptyGlyph: '🪖' },
  back: { rail: 'left', label: 'Cloak / Back', emptyGlyph: '🧥' },
  shoulders: { rail: 'left', label: 'Cloak / Back', emptyGlyph: '🧥' },
  cloak: { rail: 'left', label: 'Cloak / Back', emptyGlyph: '🧥' },
  finger_0: { rail: 'left', label: 'Ring L', emptyGlyph: '💍' },
  finger_1: { rail: 'right', label: 'Ring R', emptyGlyph: '💍' },
  arm_0: { rail: 'left', label: 'Bracers L', emptyGlyph: '🧤' },
  arm_1: { rail: 'right', label: 'Bracers R', emptyGlyph: '🧤' },
  arms_0: { rail: 'left', label: 'Bracers L', emptyGlyph: '🧤' },
  arms_1: { rail: 'right', label: 'Bracers R', emptyGlyph: '🧤' },
  main_hand: { rail: 'left', label: 'Main Hand', emptyGlyph: '⚔️' },
  hand_0: { rail: 'left', label: 'Main Hand', emptyGlyph: '⚔️' },
  hand_1: { rail: 'right', label: 'Off Hand', emptyGlyph: '🗡️' },
  ammo: { rail: 'left', label: 'Ammo', emptyGlyph: '🏹' },
  ranged: { rail: 'left', label: 'Ammo', emptyGlyph: '🏹' },
  neck: { rail: 'right', label: 'Neck', emptyGlyph: '📿' },
  torso: { rail: 'right', label: 'Armor / Torso', emptyGlyph: '🛡️' },
  chest: { rail: 'right', label: 'Armor / Torso', emptyGlyph: '🛡️' },
  armor: { rail: 'right', label: 'Armor / Torso', emptyGlyph: '🛡️' },
  body: { rail: 'right', label: 'Armor / Torso', emptyGlyph: '🛡️' },
  waist: { rail: 'right', label: 'Waist / Greaves', emptyGlyph: '🎗️' },
  belt: { rail: 'right', label: 'Waist / Greaves', emptyGlyph: '🎗️' },
  leg: { rail: 'left', label: 'Greaves / Legs', emptyGlyph: '🦵' },
  leg_0: { rail: 'left', label: 'Greaves / Legs', emptyGlyph: '🦵' },
  legs: { rail: 'left', label: 'Greaves / Legs', emptyGlyph: '🦵' },
  legs_0: { rail: 'left', label: 'Greaves / Legs', emptyGlyph: '🦵' },
  foot: { rail: 'right', label: 'Boots', emptyGlyph: '🥾' },
  feet: { rail: 'right', label: 'Boots', emptyGlyph: '🥾' },
  off_hand: { rail: 'right', label: 'Off Hand', emptyGlyph: '🗡️' }
};

/** Projects an ECS item entity into a `UIInventoryItem`. */
export function mapEntityItemToUI(
  state: GameState,
  itemEntityId: EntityId,
  isEquipped: boolean,
  inventoryIndex?: number
): UIInventoryItem | null {
  const itemComp = getComponent(state, itemEntityId, ComponentType.Item);
  if (!itemComp) return null;
  const def = state.campaign?.items?.[itemComp.itemId];
  const name = def?.name ?? itemComp.itemId.replace(/_/g, ' ');
  const renderable = getComponent(state, itemEntityId, ComponentType.Renderable);
  const slot = def?.equippable?.slot ?? 'held';
  const isWeapon = def?.category === 'weapon' || slot === 'main_hand' || slot === 'off_hand' || slot === 'two_handed';
  const isArmor = def?.category === 'armor' || slot === 'torso' || slot === 'body';
  const isConsumable = def?.category === 'consumable' || def?.consumable !== undefined;
  const weight = def?.weight ?? DEFAULT_ITEM_WEIGHT_LBS;
  const metrics = [
    ...(def?.equippable?.attackBonus ? [{ label: 'Attack Bonus', value: `+${def.equippable.attackBonus}` }] : []),
    ...(def?.equippable?.defenseBonus ? [{ label: 'Defense Bonus', value: `+${def.equippable.defenseBonus} AC` }] : []),
    { label: 'Slot', value: String(slot).toUpperCase() },
    { label: 'Weight', value: `${weight.toFixed(1)} lbs` }
  ];
  return {
    id: inventoryIndex !== undefined ? `${itemComp.itemId}_${inventoryIndex}` : itemComp.itemId,
    entityId: itemEntityId,
    ...(inventoryIndex !== undefined ? { inventoryIndex } : {}),
    ...(inventoryIndex !== undefined && inventoryIndex < MAX_HOTKEY_INDEX
      ? { hotkeyLabel: String.fromCharCode(ASCII_LOWERCASE_A + inventoryIndex) }
      : {}),
    name,
    iconUrl: isWeapon ? '⚔️' : isArmor ? '🛡️' : isConsumable ? '🧪' : (renderable?.glyph ?? '📦'),
    category: isWeapon ? 'weapon' : isArmor ? 'armor' : isConsumable ? 'consumable' : 'accessory',
    quantity: itemComp.charges ?? 1,
    priceGp: def?.baseValue ?? DEFAULT_ITEM_PRICE_GP,
    weightLbs: weight,
    isEquipped,
    inspectData: {
      title: `${name}${isEquipped ? ' (Equipped)' : ''}`,
      loreText: def?.description ?? 'Adventuring equipment.',
      baseMetrics: metrics,
      specialProperties: (def?.tags ?? []).map((t) => ({ text: `Property: ${t}`, colorHint: 'green' as const }))
    }
  };
}

/** Projects `EquipmentSlotInstance[]` into `UIAnatomicalSlotDescriptor[]`. */
export function buildAnatomicalSlotsFromEquipment(
  slots: ReadonlyArray<EquipmentSlotInstance> | undefined,
  state?: GameState
): ReadonlyArray<UIAnatomicalSlotDescriptor> {
  if (!slots || slots.length === 0) return DEFAULT_HUMANOID_SLOTS;
  const occurrenceCount = new Map<string, number>();

  return slots.map((slot) => {
    const baseType: string = slot.slotType || slot.id.replace(/_\d+$/, '');
    const count = occurrenceCount.get(baseType) ?? 0;
    occurrenceCount.set(baseType, count + 1);

    const lookupKey = `${baseType}_${count}`;
    const mapped = PRIMARY_SLOT_DEFS[lookupKey] ?? (count === 0 ? PRIMARY_SLOT_DEFS[baseType] : undefined);
    const direct = count === 0 ? SLOT_VISUAL_MAP[slot.id] : undefined;

    const rail = mapped?.rail ?? direct?.rail ?? 'extra';
    const label = mapped?.label ?? direct?.label ?? `${baseType.replace(/_/g, ' ')} ${count + 1}`;
    const emptyGlyph = mapped?.emptyGlyph ?? direct?.glyph ?? '🦾';

    const equippedItem = state && slot.equippedItem !== null ? mapEntityItemToUI(state, slot.equippedItem, true) : null;
    return {
      slotId: slot.id,
      slotType: slot.slotType,
      label,
      emptyGlyph,
      rail,
      suppressed: slot.suppressed === true,
      ...(slot.occupiedBySlotId ? { occupiedBySlotId: slot.occupiedBySlotId } : {}),
      isExtraLimb: rail === 'extra',
      equippedItem
    };
  });
}

/** Groups resolved strike profiles into `UIAttackGroupModel[]`, falling back to Unarmed Strike or natural weapons. */
export function buildAttackGroupsFromStrikes(
  strikes: ReadonlyArray<DnD35ResolvedStrikeProfile>,
  dndData: Partial<DnD35EntityData>,
  bab: number,
  strMod: number
): ReadonlyArray<UIAttackGroupModel> {
  if (strikes.length > 0) {
    const map = new Map<string, { bonuses: string[]; first: DnD35ResolvedStrikeProfile }>();
    for (const s of strikes) {
      const key = `${s.attackSource}::${s.weaponId ?? s.naturalWeaponId ?? s.label}`;
      const existing = map.get(key);
      if (existing) existing.bonuses.push(formatSigned(s.attackBonus));
      else map.set(key, { bonuses: [formatSigned(s.attackBonus)], first: s });
    }
    return Array.from(map.entries()).map(([key, { bonuses, first: s }]) => {
      const dmgBonus = s.strDamageBonus + s.doctrineDamageBonus + s.flatDamageBonus;
      const critPrefix = s.critThreatMin < NATURAL_20 ? `${s.critThreatMin}-20` : '20';
      const isPrim = s.attackSource === 'manufactured_primary';
      const isOff = s.attackSource === 'manufactured_offhand';
      const isNatP = s.attackSource === 'natural_primary';
      return {
        id: key,
        label: s.label.replace(/\s+#\d+$/, ''),
        subtitle: isPrim
          ? `Primary Hand (${s.handedness.replace(/_/g, ' ')})`
          : isOff
            ? 'Off-Hand (TWF)'
            : isNatP
              ? 'Natural Primary'
              : 'Natural Secondary (-5)',
        category: isPrim ? 'manufactured' : isOff ? 'off_hand' : isNatP ? 'natural_primary' : 'natural_secondary',
        attackBonuses: bonuses.join(' / '),
        damageFormula: `${s.weaponDice} ${formatSigned(dmgBonus)}`,
        criticalProfile: `${critPrefix} / x${s.critMultiplier}`,
        riderNotes: [s.weaponDamageType.toUpperCase(), ...s.bypassTags].join(' • ')
      };
    });
  }
  if (dndData.naturalWeapons && dndData.naturalWeapons.length > 0) {
    return dndData.naturalWeapons.map((nw) => ({
      id: nw.id,
      label: nw.name,
      subtitle: nw.isPrimary ? 'Natural Primary' : 'Natural Secondary (-5)',
      category: nw.isPrimary ? 'natural_primary' : 'natural_secondary',
      attackBonuses: formatSigned(bab + strMod + (nw.isPrimary ? 0 : -5)),
      damageFormula: `${nw.damageDice} ${formatSigned(nw.isPrimary ? strMod : Math.floor(strMod / 2))}`,
      criticalProfile: `${nw.critThreatMin < NATURAL_20 ? `${nw.critThreatMin}-20` : '20'} / x${nw.critMultiplier}`,
      riderNotes: nw.damageType.toUpperCase()
    }));
  }
  const weaponDice = dndData.weaponDice ?? '1d3';
  return [
    {
      id: 'unarmed_or_base',
      label: dndData.weaponDice && dndData.weaponDice !== '1d3' ? 'Equipped Weapon' : 'Unarmed Strike',
      subtitle: 'Primary Melee',
      category: 'manufactured',
      attackBonuses: formatSigned(bab + strMod),
      damageFormula: `${weaponDice} ${formatSigned(strMod)}`,
      criticalProfile: '20 / x2',
      riderNotes: (dndData.weaponDamageType ?? 'bludgeoning').toUpperCase()
    }
  ];
}

/** Projects Feats, Class Features, Domains, and Conditions into `UIFeatureEntryModel[]`. */
export function buildActorFeatureEntries(
  dndData: Partial<DnD35EntityData>,
  sys?: DnD35SystemContent,
  state?: GameState,
  entityId?: EntityId
): ReadonlyArray<UIFeatureEntryModel> {
  const entries: UIFeatureEntryModel[] = (dndData.feats ?? []).map((id) => {
    const def = sys?.feats?.[id];
    return {
      id,
      name: def?.name ?? id.replace(/_/g, ' '),
      category: 'feat',
      sourceLabel: 'Feat',
      ...(def?.description ? { description: def.description } : {})
    };
  });
  for (const id of dndData.activeClassFeatures ?? [])
    entries.push({ id, name: id.replace(/_/g, ' '), category: 'class_feature', sourceLabel: 'Class' });
  for (const id of dndData.domains ?? [])
    entries.push({ id, name: `Domain: ${id.toUpperCase()}`, category: 'domain', sourceLabel: 'Deity' });
  for (const c of dndData.conditions ?? [])
    entries.push({ id: c, name: c.toUpperCase(), category: 'condition', sourceLabel: 'Condition' });
  const status =
    state && entityId !== undefined
      ? (getComponent(state, entityId, ComponentType.StatusEffects) as StatusEffectsComponent | undefined)
      : undefined;
  for (const eff of status?.activeEffects ?? [])
    entries.push({
      id: eff.effectId,
      name: `${eff.effectId} (${eff.duration}t)`,
      category: 'condition',
      sourceLabel: 'Status'
    });
  return entries;
}
