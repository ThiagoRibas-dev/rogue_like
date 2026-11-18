import type { GameState, EntityId } from '../../types/game-state.types.ts';
import { ComponentType, type EquipmentComponent, type EquipmentSlotInstance } from '../../types/components.types.ts';
import { getComponent, addComponent } from '../../core/ecs.ts';
import { getActiveRuleset } from '../../rulesets/registry.ts';
import { addMessage, MessageLogCategory } from '../message.system.ts';
import { GameEventType, type GameEvent } from '../../types/events.types.ts';
import {
  getSlotLimbGroupKey,
  HAND_WIELD_SLOT_TYPES,
  isHandWieldSlot,
  isItemAnimatedHandFree
} from '../../utils/equipment.ts';

const SINGLE_HAND_FALLBACK_REQUIRED = 1;
const TWO_HAND_REQUIRED = 2;

function clearGripLockIfMatching(
  slot: EquipmentSlotInstance,
  releasedParentIds: ReadonlySet<string>
): EquipmentSlotInstance {
  if (slot.occupiedBySlotId === undefined || !releasedParentIds.has(slot.occupiedBySlotId)) {
    return slot;
  }
  const { occupiedBySlotId: _cleared, ...rest } = slot;
  return rest;
}

function resolveDisplayItemName(state: GameState, itemEntityId: EntityId): string {
  const itemComp = getComponent(state, itemEntityId, ComponentType.Item);
  if (!itemComp) return 'item';
  const def = state.campaign.items[itemComp.itemId];
  const isIdentified = state.identifiedItems.has(def?.id ?? itemComp.itemId);
  return (
    (isIdentified
      ? def?.name
      : (state.itemUnidentifiedNames.get(def?.id ?? itemComp.itemId) ?? def?.unidentifiedName)) ?? itemComp.itemId
  );
}

function resolveHandRequirementFallback(
  state: GameState,
  itemEntityId: EntityId
): {
  readonly requiredHands: number;
  readonly blockedReason?: string;
} {
  const itemComp = getComponent(state, itemEntityId, ComponentType.Item);
  const def = itemComp ? state.campaign.items[itemComp.itemId] : undefined;
  const tags = def?.tags ?? [];
  if (isItemAnimatedHandFree(def)) {
    return { requiredHands: 0 };
  }
  if (def?.equippable?.slot === 'two_handed' || tags.includes('two_handed')) {
    return { requiredHands: TWO_HAND_REQUIRED };
  }
  return { requiredHands: SINGLE_HAND_FALLBACK_REQUIRED };
}

function resolveItemHands(
  state: GameState,
  entityId: EntityId,
  itemEntityId: EntityId
): { readonly requiredHands: number; readonly blockedReason?: string } {
  const hook = getActiveRuleset(state).resolveItemHandRequirement;
  if (hook) {
    return hook(state, entityId, itemEntityId);
  }
  return resolveHandRequirementFallback(state, itemEntityId);
}

function findMatchingSlotsForRequestedType(
  slots: ReadonlyArray<EquipmentSlotInstance>,
  slotType: string
): EquipmentSlotInstance[] {
  const active = slots.filter((s) => s.suppressed !== true);
  const exact = active.filter((s) => s.slotType === slotType);
  if (exact.length > 0) return exact;
  if (slotType === 'two_handed' || slotType === 'main_hand' || slotType === 'off_hand') {
    return active.filter((s) => s.slotType === 'hand' || s.slotType === 'held' || s.slotType === 'main_hand');
  }
  return [];
}

/**
 * Processes an EquipItem intent.
 * Moves the item from inventory into the appropriate equipment slot, enforcing hand-count and
 * two-handed grip constraints (auto-unequipping conflicting hand items when enough hands exist).
 *
 * @param state The current GameState.
 * @param entityId The entity equipping the item.
 * @param itemIndex The index of the item in the inventory array.
 * @returns The updated GameState.
 */
export function processEquipItemIntent(
  state: GameState,
  entityId: EntityId,
  itemIndex: number
): { state: GameState; success: boolean; events?: GameEvent[] } {
  const inventory = getComponent(state, entityId, ComponentType.Inventory);
  const equipment = getComponent(state, entityId, ComponentType.Equipment);
  if (!inventory || !equipment) return { state, success: false };

  const itemEntityId = inventory.items[itemIndex];
  if (itemEntityId === undefined) return { state, success: false };

  const itemComp = getComponent(state, itemEntityId, ComponentType.Item);
  if (!itemComp) return { state, success: false };

  const def = state.campaign.items[itemComp.itemId];
  const itemName = resolveDisplayItemName(state, itemEntityId);
  if (!def?.equippable) {
    return {
      state: addMessage(state, `The ${itemName} cannot be equipped.`, MessageLogCategory.System),
      success: false
    };
  }

  const slotType = def.equippable.slot;
  const matchingSlots = findMatchingSlotsForRequestedType(equipment.slots, slotType);
  if (matchingSlots.length === 0) {
    return {
      state: addMessage(
        state,
        `You have no available ${slotType} slot to equip the ${itemName}.`,
        MessageLogCategory.System
      ),
      success: false
    };
  }

  if (matchingSlots.some((s) => s.equippedItem === itemEntityId)) {
    return {
      state: addMessage(state, `The ${itemName} is already equipped.`, MessageLogCategory.System),
      success: false
    };
  }

  if (!HAND_WIELD_SLOT_TYPES.has(slotType)) {
    let targetSlot = matchingSlots.find((s) => s.equippedItem === null);
    if (!targetSlot) {
      targetSlot = matchingSlots[0]!;
    }
    let nextState = state;
    const events: GameEvent[] = [];
    if (targetSlot.equippedItem !== null && targetSlot.equippedItem !== itemEntityId) {
      const oldName = resolveDisplayItemName(nextState, targetSlot.equippedItem);
      nextState = addMessage(nextState, `You unequip the ${oldName}.`, MessageLogCategory.System);
      events.push({ type: GameEventType.ItemUnequipped, entityId, itemId: targetSlot.equippedItem });
    }
    const nextEquipment: EquipmentComponent = {
      ...equipment,
      slots: equipment.slots.map((s) => (s.id === targetSlot!.id ? { ...s, equippedItem: itemEntityId } : s))
    };
    nextState = addComponent(nextState, entityId, nextEquipment);
    events.push({ type: GameEventType.ItemEquipped, entityId, itemId: itemEntityId });
    return {
      state: addMessage(nextState, `You equip the ${itemName}.`, MessageLogCategory.System),
      success: true,
      events
    };
  }

  const handReq = resolveItemHands(state, entityId, itemEntityId);
  if (handReq.blockedReason) {
    return {
      state: addMessage(state, handReq.blockedReason, MessageLogCategory.System),
      success: false
    };
  }

  const allHandSlots = equipment.slots.filter((s) => s.suppressed !== true && isHandWieldSlot(s));
  const distinctHands = new Set<string>(allHandSlots.map(getSlotLimbGroupKey));
  if (handReq.requiredHands > distinctHands.size) {
    return {
      state: addMessage(
        state,
        `You do not have enough free hands to equip the ${itemName}.`,
        MessageLogCategory.System
      ),
      success: false
    };
  }

  const targetSlot =
    matchingSlots.find((s) => s.equippedItem === null && s.occupiedBySlotId === undefined) ??
    matchingSlots.find((s) => s.equippedItem === null) ??
    matchingSlots[0]!;

  const companionSlots: EquipmentSlotInstance[] = [];
  if (handReq.requiredHands >= TWO_HAND_REQUIRED) {
    const usedLimbKeys = new Set<string>([getSlotLimbGroupKey(targetSlot)]);
    const neededExtra = handReq.requiredHands - 1;
    const preferredOrder = [
      ...allHandSlots.filter((s) => s.equippedItem === null && s.occupiedBySlotId === undefined),
      ...allHandSlots.filter((s) => s.equippedItem === null && s.occupiedBySlotId !== undefined),
      ...allHandSlots
    ];
    for (const candidate of preferredOrder) {
      if (companionSlots.length >= neededExtra) break;
      const limbKey = getSlotLimbGroupKey(candidate);
      if (usedLimbKeys.has(limbKey)) continue;
      usedLimbKeys.add(limbKey);
      companionSlots.push(candidate);
    }
    if (companionSlots.length < neededExtra) {
      return {
        state: addMessage(
          state,
          `You do not have enough free hands to equip the ${itemName}.`,
          MessageLogCategory.System
        ),
        success: false
      };
    }
  }

  const consumedHandsByTarget = handReq.requiredHands;
  const slotsToClear = new Set<string>();
  const limbsBeingClaimed = new Set<string>();
  if (consumedHandsByTarget > 0) {
    limbsBeingClaimed.add(getSlotLimbGroupKey(targetSlot));
    for (const comp of companionSlots) {
      limbsBeingClaimed.add(getSlotLimbGroupKey(comp));
    }
  }

  if (targetSlot.equippedItem !== null) {
    slotsToClear.add(targetSlot.id);
  }
  if (consumedHandsByTarget > 0 && targetSlot.occupiedBySlotId !== undefined) {
    slotsToClear.add(targetSlot.occupiedBySlotId);
  }

  for (const s of allHandSlots) {
    if (limbsBeingClaimed.has(getSlotLimbGroupKey(s)) && s.occupiedBySlotId !== undefined) {
      slotsToClear.add(s.occupiedBySlotId);
    }
    if (s.equippedItem === null || s.id === targetSlot.id) continue;
    if (!limbsBeingClaimed.has(getSlotLimbGroupKey(s))) continue;
    const existingReq = resolveItemHands(state, entityId, s.equippedItem);
    if (existingReq.requiredHands > 0) {
      slotsToClear.add(s.id);
    }
  }

  const releasedParentIds = new Set<string>([targetSlot.id, ...slotsToClear]);
  const companionLimbKeys = new Set<string>(companionSlots.map(getSlotLimbGroupKey));

  let nextState = state;
  const events: GameEvent[] = [];
  for (const slot of equipment.slots) {
    if (slotsToClear.has(slot.id) && slot.equippedItem !== null && slot.equippedItem !== itemEntityId) {
      const oldName = resolveDisplayItemName(nextState, slot.equippedItem);
      nextState = addMessage(nextState, `You unequip the ${oldName}.`, MessageLogCategory.System);
      events.push({ type: GameEventType.ItemUnequipped, entityId, itemId: slot.equippedItem });
    }
  }

  const updatedSlots = equipment.slots.map((s) => {
    const unlocked = clearGripLockIfMatching(s, releasedParentIds);
    if (unlocked.id === targetSlot.id) {
      return { ...unlocked, equippedItem: itemEntityId };
    }
    const base = slotsToClear.has(unlocked.id) ? { ...unlocked, equippedItem: null } : unlocked;
    if (isHandWieldSlot(base) && base.suppressed !== true && companionLimbKeys.has(getSlotLimbGroupKey(base))) {
      return { ...base, occupiedBySlotId: targetSlot.id };
    }
    return base;
  });

  const nextEquipment: EquipmentComponent = {
    ...equipment,
    slots: updatedSlots
  };

  nextState = addComponent(nextState, entityId, nextEquipment);
  events.push({ type: GameEventType.ItemEquipped, entityId, itemId: itemEntityId });

  return {
    state: addMessage(nextState, `You equip the ${itemName}.`, MessageLogCategory.System),
    success: true,
    events
  };
}

/**
 * Processes an UnequipItem intent.
 * Moves the item in the given slot back to inventory, clearing any linked 2H grip locks.
 *
 * @param state The current GameState.
 * @param entityId The entity unequipping the item.
 * @param slotId The equipment slot to unequip from.
 * @returns The updated GameState.
 */
export function processUnequipItemIntent(
  state: GameState,
  entityId: EntityId,
  slotId: string
): { state: GameState; success: boolean; events?: GameEvent[] } {
  const inventory = getComponent(state, entityId, ComponentType.Inventory);
  const equipment = getComponent(state, entityId, ComponentType.Equipment);
  if (!inventory || !equipment) return { state, success: false };

  const targetSlot = equipment.slots.find((s) => s.id === slotId);
  if (!targetSlot || targetSlot.equippedItem === null) {
    return { state: addMessage(state, 'Nothing equipped in that slot.', MessageLogCategory.System), success: false };
  }
  const itemEntityId = targetSlot.equippedItem;
  const itemComp = getComponent(state, itemEntityId, ComponentType.Item);
  const def = itemComp ? state.campaign.items[itemComp.itemId] : undefined;
  if (!itemComp || !def) return { state, success: false };
  const itemName = resolveDisplayItemName(state, itemEntityId);

  const releasedParents = new Set<string>([slotId]);
  const nextEquipment: EquipmentComponent = {
    ...equipment,
    slots: equipment.slots.map((s) => {
      const unlocked = clearGripLockIfMatching(s, releasedParents);
      return unlocked.id === slotId ? { ...unlocked, equippedItem: null } : unlocked;
    })
  };

  const nextState = addComponent(state, entityId, nextEquipment);

  return {
    state: addMessage(nextState, `You unequip the ${itemName}.`, MessageLogCategory.System),
    success: true,
    events: [{ type: GameEventType.ItemUnequipped, entityId, itemId: itemEntityId }]
  };
}

/**
 * Known body anatomy topology plans.
 */
export type AnatomyBodyPlan = 'humanoid_biped' | 'quadruped' | 'marilith_6arm' | 'avian' | 'serpentine';

/**
 * Builds an array of EquipmentSlotInstance objects for a given anatomical body plan.
 * Encapsulates multi-armed (e.g. Marilith 6 arms), quadruped (4 legs/feet, no hands),
 * avian (wings, talons), and serpentine (no legs/feet) morphologies.
 *
 * @param bodyPlan AnatomyBodyPlan topology identifier.
 * @returns Array of EquipmentSlotInstance records.
 */
export function buildAnatomyEquipmentSlots(bodyPlan: AnatomyBodyPlan): EquipmentSlotInstance[] {
  switch (bodyPlan) {
    case 'humanoid_biped':
      return [
        { id: 'head_1', slotType: 'head', equippedItem: null },
        { id: 'eyes_1', slotType: 'eyes', equippedItem: null },
        { id: 'neck_1', slotType: 'neck', equippedItem: null },
        { id: 'shoulders_1', slotType: 'shoulders', equippedItem: null },
        { id: 'torso_1', slotType: 'torso', equippedItem: null },
        { id: 'body_1', slotType: 'body', equippedItem: null },
        { id: 'waist_1', slotType: 'waist', equippedItem: null },
        { id: 'arm_1', slotType: 'arm', equippedItem: null, limbGroupId: 'arm_group_1' },
        { id: 'arm_2', slotType: 'arm', equippedItem: null, limbGroupId: 'arm_group_2' },
        { id: 'hand_1', slotType: 'hand', equippedItem: null, limbGroupId: 'arm_group_1' },
        { id: 'hand_2', slotType: 'hand', equippedItem: null, limbGroupId: 'arm_group_2' },
        { id: 'finger_1', slotType: 'finger', equippedItem: null },
        { id: 'finger_2', slotType: 'finger', equippedItem: null },
        { id: 'leg_1', slotType: 'leg', equippedItem: null },
        { id: 'leg_2', slotType: 'leg', equippedItem: null },
        { id: 'foot_1', slotType: 'foot', equippedItem: null },
        { id: 'foot_2', slotType: 'foot', equippedItem: null },
        { id: 'main_hand_1', slotType: 'main_hand', equippedItem: null, limbGroupId: 'arm_group_1' },
        { id: 'off_hand_1', slotType: 'off_hand', equippedItem: null, limbGroupId: 'arm_group_2' }
      ];

    case 'quadruped':
      return [
        { id: 'head_1', slotType: 'head', equippedItem: null },
        { id: 'eyes_1', slotType: 'eyes', equippedItem: null },
        { id: 'neck_1', slotType: 'neck', equippedItem: null },
        { id: 'torso_1', slotType: 'torso', equippedItem: null },
        { id: 'body_1', slotType: 'body', equippedItem: null },
        { id: 'waist_1', slotType: 'waist', equippedItem: null },
        { id: 'foot_1', slotType: 'foot', equippedItem: null, limbGroupId: 'foreleg_left' },
        { id: 'foot_2', slotType: 'foot', equippedItem: null, limbGroupId: 'foreleg_right' },
        { id: 'foot_3', slotType: 'foot', equippedItem: null, limbGroupId: 'hindleg_left' },
        { id: 'foot_4', slotType: 'foot', equippedItem: null, limbGroupId: 'hindleg_right' }
      ];

    case 'marilith_6arm':
      return [
        { id: 'head_1', slotType: 'head', equippedItem: null },
        { id: 'eyes_1', slotType: 'eyes', equippedItem: null },
        { id: 'neck_1', slotType: 'neck', equippedItem: null },
        { id: 'shoulders_1', slotType: 'shoulders', equippedItem: null },
        { id: 'torso_1', slotType: 'torso', equippedItem: null },
        { id: 'body_1', slotType: 'body', equippedItem: null },
        { id: 'waist_1', slotType: 'waist', equippedItem: null },
        { id: 'arm_1', slotType: 'arm', equippedItem: null, limbGroupId: 'arm_group_1' },
        { id: 'arm_2', slotType: 'arm', equippedItem: null, limbGroupId: 'arm_group_2' },
        { id: 'arm_3', slotType: 'arm', equippedItem: null, limbGroupId: 'arm_group_3' },
        { id: 'arm_4', slotType: 'arm', equippedItem: null, limbGroupId: 'arm_group_4' },
        { id: 'arm_5', slotType: 'arm', equippedItem: null, limbGroupId: 'arm_group_5' },
        { id: 'arm_6', slotType: 'arm', equippedItem: null, limbGroupId: 'arm_group_6' },
        { id: 'hand_1', slotType: 'hand', equippedItem: null, limbGroupId: 'arm_group_1' },
        { id: 'hand_2', slotType: 'hand', equippedItem: null, limbGroupId: 'arm_group_2' },
        { id: 'hand_3', slotType: 'hand', equippedItem: null, limbGroupId: 'arm_group_3' },
        { id: 'hand_4', slotType: 'hand', equippedItem: null, limbGroupId: 'arm_group_4' },
        { id: 'hand_5', slotType: 'hand', equippedItem: null, limbGroupId: 'arm_group_5' },
        { id: 'hand_6', slotType: 'hand', equippedItem: null, limbGroupId: 'arm_group_6' },
        { id: 'finger_1', slotType: 'finger', equippedItem: null },
        { id: 'finger_2', slotType: 'finger', equippedItem: null },
        { id: 'finger_3', slotType: 'finger', equippedItem: null },
        { id: 'finger_4', slotType: 'finger', equippedItem: null },
        { id: 'finger_5', slotType: 'finger', equippedItem: null },
        { id: 'finger_6', slotType: 'finger', equippedItem: null },
        { id: 'main_hand_1', slotType: 'main_hand', equippedItem: null, limbGroupId: 'arm_group_1' },
        { id: 'off_hand_1', slotType: 'off_hand', equippedItem: null, limbGroupId: 'arm_group_2' },
        { id: 'off_hand_2', slotType: 'off_hand', equippedItem: null, limbGroupId: 'arm_group_3' },
        { id: 'off_hand_3', slotType: 'off_hand', equippedItem: null, limbGroupId: 'arm_group_4' },
        { id: 'off_hand_4', slotType: 'off_hand', equippedItem: null, limbGroupId: 'arm_group_5' },
        { id: 'off_hand_5', slotType: 'off_hand', equippedItem: null, limbGroupId: 'arm_group_6' }
      ];

    case 'avian':
      return [
        { id: 'head_1', slotType: 'head', equippedItem: null },
        { id: 'eyes_1', slotType: 'eyes', equippedItem: null },
        { id: 'neck_1', slotType: 'neck', equippedItem: null },
        { id: 'torso_1', slotType: 'torso', equippedItem: null },
        { id: 'body_1', slotType: 'body', equippedItem: null },
        { id: 'arm_1', slotType: 'arm', equippedItem: null, limbGroupId: 'wing_left' },
        { id: 'arm_2', slotType: 'arm', equippedItem: null, limbGroupId: 'wing_right' },
        { id: 'foot_1', slotType: 'foot', equippedItem: null, limbGroupId: 'talon_left' },
        { id: 'foot_2', slotType: 'foot', equippedItem: null, limbGroupId: 'talon_right' }
      ];

    case 'serpentine':
      return [
        { id: 'head_1', slotType: 'head', equippedItem: null },
        { id: 'eyes_1', slotType: 'eyes', equippedItem: null },
        { id: 'neck_1', slotType: 'neck', equippedItem: null },
        { id: 'torso_1', slotType: 'torso', equippedItem: null },
        { id: 'body_1', slotType: 'body', equippedItem: null },
        { id: 'waist_1', slotType: 'waist', equippedItem: null }
      ];
  }
}
