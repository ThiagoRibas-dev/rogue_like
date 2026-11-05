import { getComponent } from '../../core/ecs.ts';
import {
  ComponentType,
  type EquipmentComponent,
  type EquipmentSlotInstance,
  type TacticalDoctrineComponent
} from '../../types/components.types.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';
import {
  buildUnarmedProfile,
  type EquippedWeaponProfile,
  parseEquippedItem,
  type ResolvedActorWeapons
} from './equipment/weapon_profile_parser.ts';
import type { CreatureSizeCategory, DnD35EntityData } from './types/dnd35e.types.ts';

export * from './equipment/special_materials.ts';
export * from './equipment/weapon_scaling.ts';
export * from './equipment/weapon_profile_parser.ts';

/**
 * Canonical Single Source of Truth for resolving all equipped weapons, grip modes,
 * effort shifting, double weapon splitting, and occupied limbs on an actor.
 *
 * @param state Current GameState.
 * @param entityId Target entity ID.
 * @param effectiveWielderSizeOverride Optional size override (e.g., from Stage 1 Stat DAG).
 * @returns Complete ResolvedActorWeapons.
 */
export function resolveAllEquippedWeaponProfiles(
  state: GameState,
  entityId: EntityId,
  effectiveWielderSizeOverride?: CreatureSizeCategory
): ResolvedActorWeapons {
  const rulesetComp = getComponent(state, entityId, ComponentType.RulesetData);
  const dndData = (rulesetComp?.rulesetId === 'dnd35e' ? rulesetComp.payload : undefined) as
    Partial<DnD35EntityData> | undefined;
  const wielderSize = effectiveWielderSizeOverride ?? dndData?.sizeCategory ?? 'medium';

  const doctrine = getComponent(state, entityId, ComponentType.TacticalDoctrine) as
    TacticalDoctrineComponent | undefined;
  const requestedGrip = doctrine?.gripMode;

  const equipment = getComponent(state, entityId, ComponentType.Equipment) as EquipmentComponent | undefined;

  const isHandSlot = (s: EquipmentSlotInstance): boolean =>
    s.suppressed !== true &&
    (s.slotType === 'held' ||
      s.slotType === 'hand' ||
      s.slotType === 'main_hand' ||
      s.slotType === 'off_hand' ||
      s.id.startsWith('hand_') ||
      s.id.startsWith('main_hand') ||
      s.id.startsWith('off_hand'));

  const handSlots = (equipment?.slots ?? []).filter(isHandSlot);

  const primarySlot =
    handSlots.find((s) => s.equippedItem !== null && (s.slotType === 'main_hand' || s.id === 'main_hand_1')) ??
    handSlots.find((s) => s.equippedItem !== null);

  const otherHandSlots = handSlots.filter((s) => s !== primarySlot);
  const emptyHandSlots = otherHandSlots.filter((s) => s.equippedItem === null);
  const hasFreeHand = emptyHandSlots.length > 0;

  const occupiedLimbGroups = new Set<string>();
  for (const s of equipment?.slots ?? []) {
    if (s.equippedItem !== null && s.suppressed !== true && s.limbGroupId) {
      occupiedLimbGroups.add(s.limbGroupId);
    }
  }

  // Branch 1: Unarmed
  if (!primarySlot || primarySlot.equippedItem === null) {
    const unarmed = buildUnarmedProfile(wielderSize, false);
    return {
      primaryWeapon: unarmed,
      offHandWeapons: [],
      occupiedLimbGroupIds: Array.from(occupiedLimbGroups),
      gripMode: 'one_handed'
    };
  }

  const parsedPrimary = parseEquippedItem(state, primarySlot, wielderSize, dndData);
  if (!parsedPrimary) {
    const unarmed = buildUnarmedProfile(wielderSize, false);
    return {
      primaryWeapon: unarmed,
      offHandWeapons: [],
      occupiedLimbGroupIds: Array.from(occupiedLimbGroups),
      gripMode: 'one_handed'
    };
  }

  // Branch 2: Double Weapon in TWF mode
  if (parsedPrimary.isDoubleWeapon && requestedGrip === 'double_weapon_twf') {
    const secondHandLimb = emptyHandSlots[0]?.limbGroupId ?? 'hand_off';
    occupiedLimbGroups.add(parsedPrimary.limbGroupId ?? 'hand_main');
    occupiedLimbGroups.add(secondHandLimb);

    const primaryWeapon: EquippedWeaponProfile = {
      ...parsedPrimary,
      handedness: 'one_handed'
    };

    const synthesizedOffHand: EquippedWeaponProfile = {
      ...parsedPrimary,
      weaponName: `${parsedPrimary.weaponName} (Off-Hand)`,
      inherentEffort: 'light',
      effectiveEffort: 'light',
      handedness: 'light',
      nonproficiencyPenalty: primaryWeapon.nonproficiencyPenalty,
      slotId: 'off_hand_double',
      limbGroupId: secondHandLimb
    };

    return {
      primaryWeapon,
      offHandWeapons: [synthesizedOffHand],
      occupiedLimbGroupIds: Array.from(occupiedLimbGroups),
      gripMode: 'double_weapon_twf'
    };
  }

  // Branch 3: Two-Handed Weapon (inherent or shifted)
  if (parsedPrimary.effectiveEffort === 'two_handed') {
    const secondHandLimb = emptyHandSlots[0]?.limbGroupId ?? 'hand_off';
    occupiedLimbGroups.add(parsedPrimary.limbGroupId ?? 'hand_main');
    occupiedLimbGroups.add(secondHandLimb);

    const primaryWeapon: EquippedWeaponProfile = {
      ...parsedPrimary,
      handedness: 'two_handed'
    };

    return {
      primaryWeapon,
      offHandWeapons: [],
      occupiedLimbGroupIds: Array.from(occupiedLimbGroups),
      gripMode: 'two_handed'
    };
  }

  // Branch 4: One-Handed Weapon gripped in two hands
  if (parsedPrimary.effectiveEffort === 'one_handed' && requestedGrip === 'two_handed' && hasFreeHand) {
    const secondHandLimb = emptyHandSlots[0]?.limbGroupId ?? 'hand_off';
    occupiedLimbGroups.add(parsedPrimary.limbGroupId ?? 'hand_main');
    occupiedLimbGroups.add(secondHandLimb);

    const primaryWeapon: EquippedWeaponProfile = {
      ...parsedPrimary,
      handedness: 'two_handed',
      nonproficiencyPenalty: parsedPrimary.isExotic1HMartial2H ? 0 : parsedPrimary.nonproficiencyPenalty
    };

    return {
      primaryWeapon,
      offHandWeapons: [],
      occupiedLimbGroupIds: Array.from(occupiedLimbGroups),
      gripMode: 'two_handed'
    };
  }

  // Branch 5: Light weapon gripped in two hands
  if (parsedPrimary.effectiveEffort === 'light' && requestedGrip === 'two_handed' && hasFreeHand) {
    const secondHandLimb = emptyHandSlots[0]?.limbGroupId ?? 'hand_off';
    occupiedLimbGroups.add(parsedPrimary.limbGroupId ?? 'hand_main');
    occupiedLimbGroups.add(secondHandLimb);

    const primaryWeapon: EquippedWeaponProfile = {
      ...parsedPrimary,
      handedness: 'light'
    };

    return {
      primaryWeapon,
      offHandWeapons: [],
      occupiedLimbGroupIds: Array.from(occupiedLimbGroups),
      gripMode: 'two_handed'
    };
  }

  // Branch 6: One-Handed or Light weapon wielded in one hand (plus any off-hand weapons)
  occupiedLimbGroups.add(parsedPrimary.limbGroupId ?? 'hand_main');

  const primaryWeapon: EquippedWeaponProfile = {
    ...parsedPrimary,
    handedness: parsedPrimary.effectiveEffort
  };

  const offHandWeapons: EquippedWeaponProfile[] = [];
  for (const slot of otherHandSlots) {
    if (slot.equippedItem !== null) {
      const parsedOffHand = parseEquippedItem(state, slot, wielderSize, dndData);
      if (parsedOffHand) {
        const offHandedness =
          parsedOffHand.effectiveEffort === 'two_handed' ? 'one_handed' : parsedOffHand.effectiveEffort;
        offHandWeapons.push({
          ...parsedOffHand,
          handedness: offHandedness
        });
      }
    }
  }

  return {
    primaryWeapon,
    offHandWeapons,
    occupiedLimbGroupIds: Array.from(occupiedLimbGroups),
    gripMode: 'one_handed'
  };
}

/**
 * Resolves the primary or off-hand equipped weapon profile for an actor.
 */
export function resolveEquippedWeaponProfile(
  state: GameState,
  entityId: EntityId,
  slotType: 'main_hand' | 'off_hand' = 'main_hand'
): EquippedWeaponProfile {
  const resolved = resolveAllEquippedWeaponProfiles(state, entityId);
  if (slotType === 'main_hand') {
    return resolved.primaryWeapon;
  }
  return resolved.offHandWeapons[0] ?? buildUnarmedProfile(resolved.primaryWeapon.weaponSize, true);
}
