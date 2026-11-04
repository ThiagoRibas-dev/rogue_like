import type { GameState, EntityId } from '../../types/game-state.types.ts';
import { ComponentType, type EquipmentComponent, type EquipmentSlotInstance } from '../../types/components.types.ts';
import { getComponent, addComponent } from '../../core/ecs.ts';
import { addMessage, MessageLogCategory } from '../message.system.ts';
import { GameEventType, type GameEvent } from '../../types/events.types.ts';

/**
 * Processes an EquipItem intent.
 * Moves the item from inventory into the appropriate equipment slot.
 * If a slot is already occupied, the old item is swapped back to inventory.
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
  if (!def?.equippable) {
    const isIdentified = state.identifiedItems.has(def?.id ?? '');
    const itemName =
      (isIdentified ? def?.name : (state.itemUnidentifiedNames.get(def?.id ?? '') ?? def?.unidentifiedName)) ??
      itemComp.itemId;
    return {
      state: addMessage(state, `The ${itemName} cannot be equipped.`, MessageLogCategory.System),
      success: false
    };
  }

  const slotType = def.equippable.slot;
  const isIdentified = state.identifiedItems.has(def.id);
  const itemName =
    (isIdentified ? def?.name : (state.itemUnidentifiedNames.get(def.id) ?? def?.unidentifiedName)) ?? itemComp.itemId;

  const matchingSlots = equipment.slots.filter((s) => s.slotType === slotType && s.suppressed !== true);
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

  let targetSlot = matchingSlots.find((s) => s.equippedItem === null);
  if (!targetSlot) {
    targetSlot = matchingSlots[0]!;
  }

  let nextState = state;
  if (targetSlot.equippedItem !== null && targetSlot.equippedItem !== itemEntityId) {
    const oldDef = state.campaign.items[getComponent(state, targetSlot.equippedItem, ComponentType.Item)?.itemId ?? ''];
    const oldName = oldDef?.name ?? 'item';
    nextState = addMessage(nextState, `You unequip the ${oldName}.`, MessageLogCategory.System);
  }

  const nextEquipment: EquipmentComponent = {
    ...equipment,
    slots: equipment.slots.map((s) => (s.id === targetSlot!.id ? { ...s, equippedItem: itemEntityId } : s))
  };

  nextState = addComponent(nextState, entityId, nextEquipment);

  return {
    state: addMessage(nextState, `You equip the ${itemName}.`, MessageLogCategory.System),
    success: true,
    events: [{ type: GameEventType.ItemEquipped, entityId, itemId: itemEntityId }]
  };
}

/**
 * Processes an UnequipItem intent.
 * Moves the item in the given slot back to inventory, if capacity allows.
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
  const isIdentified = state.identifiedItems.has(def.id);
  const itemName =
    (isIdentified ? def?.name : (state.itemUnidentifiedNames.get(def.id) ?? def?.unidentifiedName)) ?? itemComp.itemId;

  const nextEquipment: EquipmentComponent = {
    ...equipment,
    slots: equipment.slots.map((s) => (s.id === slotId ? { ...s, equippedItem: null } : s))
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
