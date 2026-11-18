import { getComponent } from '../../core/ecs.ts';
import {
  ComponentType,
  type EquipmentComponent,
  type EquipmentSlotInstance,
  type ItemComponent,
  type TacticalDoctrineComponent
} from '../../types/components.types.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';
import { getSlotLimbGroupKey, isHandWieldSlot, isItemAnimatedHandFree } from '../../utils/equipment.ts';
import { evaluateNonproficiencyPenalty, resolveEffectiveItemDefinition } from './equipment/item_inheritance.ts';
import {
  buildUnarmedProfile,
  collectEffectiveItemTags,
  type EquippedWeaponProfile,
  parseEquippedItem,
  type ResolvedActorWeapons,
  resolveWeaponWieldabilityFromTags
} from './equipment/weapon_profile_parser.ts';
import { getDnD35EntityData } from './srd_registry.ts';
import type { CreatureSizeCategory, DnD35EntityData } from './types/dnd35e.types.ts';
import type { DnD35ClassDefinition, DnD35ItemDefinition } from './types/dnd35e_system.types.ts';

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
  const dndData = (rulesetComp?.rulesetId === 'dnd35e' ? rulesetComp.payload : getDnD35EntityData(state, entityId)) as
    Partial<DnD35EntityData> | undefined;
  const wielderSize = effectiveWielderSizeOverride ?? dndData?.sizeCategory ?? 'medium';

  const doctrine = getComponent(state, entityId, ComponentType.TacticalDoctrine) as
    TacticalDoctrineComponent | undefined;
  const requestedGrip = doctrine?.gripMode;

  const equipment = getComponent(state, entityId, ComponentType.Equipment) as EquipmentComponent | undefined;

  const handSlots = (equipment?.slots ?? []).filter((s) => s.suppressed !== true && isHandWieldSlot(s));

  const isSlotHandFreed = (s: EquipmentSlotInstance): boolean => {
    if (s.equippedItem === null) return true;
    const itemComp = getComponent(state, s.equippedItem, ComponentType.Item) as ItemComponent | undefined;
    if (!itemComp) return true;
    const rawDef = state.campaign.items[itemComp.itemId] as DnD35ItemDefinition | undefined;
    if (!rawDef) return false;
    return isItemAnimatedHandFree(resolveEffectiveItemDefinition(rawDef, state.campaign.items, itemComp));
  };

  const primarySlot = pickPrimaryWeaponHandSlot(handSlots, state, wielderSize, dndData, true);

  const occupiedLimbGroups = new Set<string>();
  for (const s of equipment?.slots ?? []) {
    if (s.equippedItem !== null && s.suppressed !== true && s.limbGroupId) {
      if (isHandWieldSlot(s) && isSlotHandFreed(s)) {
        continue;
      }
      occupiedLimbGroups.add(s.limbGroupId);
    }
  }

  const primaryLimbKey = primarySlot ? getSlotLimbGroupKey(primarySlot) : undefined;
  const otherHandSlots = handSlots.filter(
    (s) => s !== primarySlot && (primaryLimbKey === undefined || getSlotLimbGroupKey(s) !== primaryLimbKey)
  );
  const emptyHandSlots = otherHandSlots.filter(
    (s) =>
      s.occupiedBySlotId === undefined &&
      isSlotHandFreed(s) &&
      (!s.limbGroupId || !occupiedLimbGroups.has(s.limbGroupId))
  );
  const hasFreeHand = emptyHandSlots.length > 0;

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

    const classesRegistry = state.campaign.systemContent?.['classes'] as
      Record<string, DnD35ClassDefinition> | undefined;
    const rawWeaponDef = parsedPrimary.weaponItemId
      ? (state.campaign.items[parsedPrimary.weaponItemId] as DnD35ItemDefinition | undefined)
      : undefined;
    const twoHandedNonprof = parsedPrimary.isExotic1HMartial2H
      ? evaluateNonproficiencyPenalty(
          parsedPrimary.weaponItemId,
          parsedPrimary.baseWeaponId,
          parsedPrimary.isExotic1HMartial2H,
          'two_handed',
          dndData,
          rawWeaponDef?.weaponStats?.familiaritySubtypes ?? [],
          rawWeaponDef?.weaponStats?.proficiencyCategory,
          classesRegistry
        )
      : parsedPrimary.nonproficiencyPenalty;

    const primaryWeapon: EquippedWeaponProfile = {
      ...parsedPrimary,
      handedness: 'two_handed',
      nonproficiencyPenalty: twoHandedNonprof
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

function pickPrimaryWeaponHandSlot(
  handSlots: ReadonlyArray<EquipmentSlotInstance>,
  state: GameState,
  wielderSize: CreatureSizeCategory,
  dndData?: Partial<DnD35EntityData>,
  allowFallbackNonWeapon = false
): EquipmentSlotInstance | undefined {
  return (
    handSlots.find(
      (s) =>
        s.equippedItem !== null &&
        (s.slotType === 'main_hand' || s.id === 'main_hand_1') &&
        parseEquippedItem(state, s, wielderSize, dndData) !== undefined
    ) ??
    handSlots.find((s) => s.equippedItem !== null && parseEquippedItem(state, s, wielderSize, dndData) !== undefined) ??
    (allowFallbackNonWeapon
      ? (handSlots.find((s) => s.equippedItem !== null && (s.slotType === 'main_hand' || s.id === 'main_hand_1')) ??
        handSlots.find((s) => s.equippedItem !== null))
      : undefined)
  );
}

/**
 * Evaluates how many hands/limbs an item requires under D&D 3.5e wielding rules
 * (accounting for weapon effort, animated shields, and actor size category).
 */
export function resolveDnD35eItemHandRequirement(
  state: GameState,
  entityId: EntityId,
  itemEntityId: EntityId
): { readonly requiredHands: number; readonly blockedReason?: string } {
  const itemComp = getComponent(state, itemEntityId, ComponentType.Item) as ItemComponent | undefined;
  if (!itemComp) return { requiredHands: 1 };

  const rawDef = state.campaign.items[itemComp.itemId] as DnD35ItemDefinition | undefined;
  if (!rawDef) return { requiredHands: 1 };

  const effectiveDef = resolveEffectiveItemDefinition(rawDef, state.campaign.items, itemComp);
  if (isItemAnimatedHandFree(effectiveDef)) {
    return { requiredHands: 0 };
  }

  const itemTags = collectEffectiveItemTags(state, itemEntityId, itemComp, effectiveDef);
  if (effectiveDef.category === 'weapon' || effectiveDef.weaponStats !== undefined) {
    const dndData = getDnD35EntityData(state, entityId);
    const wielderSize = dndData?.sizeCategory ?? 'medium';
    const { wieldProfile } = resolveWeaponWieldabilityFromTags(effectiveDef, itemTags, wielderSize);
    if (!wieldProfile.wieldable) {
      return {
        requiredHands: 2,
        blockedReason: wieldProfile.reason ?? `${effectiveDef.name} cannot be wielded at your current size.`
      };
    }
    if (wieldProfile.effectiveHandedness === 'two_handed') {
      return { requiredHands: 2 };
    }
    return { requiredHands: 1 };
  }

  if (effectiveDef.equippable?.slot === 'two_handed' || itemTags.includes('two_handed')) {
    return { requiredHands: 2 };
  }
  return { requiredHands: 1 };
}

/**
 * Returns true only when toggling between 1-handed and 2-handed grip is mechanically valid
 * (wielding an armed, wieldable one-handed weapon with at least one other free hand).
 */
export function canToggleTwoHandedGrip(state: GameState, entityId: EntityId): boolean {
  const equipment = getComponent(state, entityId, ComponentType.Equipment) as EquipmentComponent | undefined;
  if (!equipment) return false;

  const dndData = getDnD35EntityData(state, entityId);
  const wielderSize = dndData?.sizeCategory ?? 'medium';

  const handSlots = equipment.slots.filter((s) => s.suppressed !== true && isHandWieldSlot(s));
  const primarySlot = pickPrimaryWeaponHandSlot(handSlots, state, wielderSize, dndData);
  if (!primarySlot) return false;

  const parsedPrimary = parseEquippedItem(state, primarySlot, wielderSize, dndData);
  if (
    !parsedPrimary ||
    !parsedPrimary.isArmed ||
    !parsedPrimary.wieldable ||
    parsedPrimary.isDoubleWeapon ||
    parsedPrimary.cannotTwoHandStr ||
    parsedPrimary.effectiveEffort !== 'one_handed'
  ) {
    return false;
  }

  const primaryLimbKey = getSlotLimbGroupKey(primarySlot);
  const occupiedLimbKeys = new Set<string>();
  for (const s of handSlots) {
    if (s.equippedItem === null) continue;
    const req = resolveDnD35eItemHandRequirement(state, entityId, s.equippedItem);
    if (req.requiredHands > 0) {
      occupiedLimbKeys.add(getSlotLimbGroupKey(s));
    }
  }

  return handSlots.some((s) => {
    const limbKey = getSlotLimbGroupKey(s);
    return limbKey !== primaryLimbKey && s.occupiedBySlotId === undefined && !occupiedLimbKeys.has(limbKey);
  });
}
