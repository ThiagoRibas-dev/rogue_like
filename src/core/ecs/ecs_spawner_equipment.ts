import { addComponent, getComponent, removeComponent } from './ecs_core.ts';
import { spawnItem } from './ecs_item_promoter.ts';
import { ComponentType, type EquipmentComponent, type InventoryComponent } from '../../types/components.types.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';
import type { EntityTemplate } from '../../types/campaign/entity.ts';
import { buildAnatomyEquipmentSlots, type AnatomyBodyPlan } from '../../systems/inventory/equipment_slots.ts';

/**
 * Initializes an actor's anatomical `EquipmentComponent` and `InventoryComponent`.
 * If `template.equipmentSlots` is specified, it builds flat slots from the template.
 * Otherwise, it resolves `anatomyBodyPlan` (`humanoid_biped`, `quadruped`, `marilith_6arm`, `avian`, `serpentine`)
 * from system content race/archetype registries and constructs anatomical slots with proper `limbGroupId`s.
 *
 * @param state GameState.
 * @param entityId Spawned entity ID.
 * @param templateId Entity template identifier.
 * @param template Entity template.
 * @returns Updated GameState.
 */
export function initializeActorEquipmentAndInventory(
  state: GameState,
  entityId: EntityId,
  templateId: string,
  template: EntityTemplate
): GameState {
  let nextState = state;

  if (template.inventoryConfig) {
    const inventoryCmp: InventoryComponent = {
      type: ComponentType.Inventory,
      items: [],
      baseCapacity: template.inventoryConfig.baseCapacity
    };
    nextState = addComponent(nextState, entityId, inventoryCmp);
  } else if (template.isActor) {
    const inventoryCmp: InventoryComponent = {
      type: ComponentType.Inventory,
      items: [],
      baseCapacity: 20
    };
    nextState = addComponent(nextState, entityId, inventoryCmp);
  }

  if (template.equipmentSlots) {
    let armIdx = 0;
    let handIdx = 0;
    const equipmentCmp: EquipmentComponent = {
      type: ComponentType.Equipment,
      slots: template.equipmentSlots.map((slotType, index) => {
        let limbGroupId: string | undefined;
        if (slotType === 'arm') {
          armIdx += 1;
          limbGroupId = `arm_group_${armIdx}`;
        } else if (slotType === 'hand' || slotType === 'held' || slotType === 'main_hand' || slotType === 'off_hand') {
          handIdx += 1;
          limbGroupId = `arm_group_${handIdx}`;
        }
        return {
          id: `${slotType}_${index}`,
          slotType,
          equippedItem: null,
          ...(limbGroupId !== undefined ? { limbGroupId } : {})
        };
      })
    };
    nextState = addComponent(nextState, entityId, equipmentCmp);
  } else if (template.isActor) {
    const archetypeKey = template.archetypeId ?? templateId;
    const sysRaces = state.campaign.systemContent?.['races'] as
      Record<string, { anatomyBodyPlan?: AnatomyBodyPlan }> | undefined;
    const sysArchetypes = state.campaign.systemContent?.['archetypes'] as
      Record<string, { anatomyBodyPlan?: AnatomyBodyPlan }> | undefined;
    const bodyPlan: AnatomyBodyPlan =
      sysRaces?.[archetypeKey]?.anatomyBodyPlan ?? sysArchetypes?.[archetypeKey]?.anatomyBodyPlan ?? 'humanoid_biped';

    const equipmentCmp: EquipmentComponent = {
      type: ComponentType.Equipment,
      slots: buildAnatomyEquipmentSlots(bodyPlan)
    };
    nextState = addComponent(nextState, entityId, equipmentCmp);
  }

  return nextState;
}

/**
 * Automatically spawns and equips default armaments (`defaultEquipment`) for non-player actors.
 *
 * @param state GameState.
 * @param entityId Spawned actor EntityId.
 * @param templateId Race or archetype identifier.
 * @param x Spawn X coordinate.
 * @param y Spawn Y coordinate.
 * @returns Updated GameState with items spawned and equipped.
 */
export function equipActorDefaultArmaments(
  state: GameState,
  entityId: EntityId,
  templateId: string,
  x: number,
  y: number
): GameState {
  if (templateId === 'player') return state;

  const template = state.campaign.entities[templateId];
  const archetypeKey = template?.archetypeId ?? templateId;
  const sysRaces = state.campaign.systemContent?.['races'] as
    Record<string, { defaultEquipment?: ReadonlyArray<{ itemId: string; equipSlot?: string }> }> | undefined;
  const sysArchetypes = state.campaign.systemContent?.['archetypes'] as
    Record<string, { defaultEquipment?: ReadonlyArray<{ itemId: string; equipSlot?: string }> }> | undefined;

  const defaultEquipment =
    sysRaces?.[archetypeKey]?.defaultEquipment ?? sysArchetypes?.[archetypeKey]?.defaultEquipment ?? [];

  if (defaultEquipment.length === 0) return state;

  let nextState = state;
  const inventory = getComponent(nextState, entityId, ComponentType.Inventory) as InventoryComponent | undefined;
  const equipment = getComponent(nextState, entityId, ComponentType.Equipment) as EquipmentComponent | undefined;
  if (!inventory) return nextState;

  const spawnedItemIds: EntityId[] = [];
  const updatedSlots = equipment ? equipment.slots.map((s) => ({ ...s })) : [];

  for (const entry of defaultEquipment) {
    if (!state.campaign.items[entry.itemId]) continue;
    let itemEntityId: EntityId;
    [nextState, itemEntityId] = spawnItem(nextState, entry.itemId, x, y);
    nextState = removeComponent(nextState, itemEntityId, ComponentType.Position);
    spawnedItemIds.push(itemEntityId);

    if (entry.equipSlot && updatedSlots.length > 0) {
      const targetSlotType = entry.equipSlot;
      let slot = updatedSlots.find((s) => s.equippedItem === null && s.slotType === targetSlotType);
      if (!slot) {
        slot = updatedSlots.find((s) => {
          if (s.equippedItem !== null) return false;
          if (targetSlotType === 'main_hand' || targetSlotType === 'off_hand') {
            return s.slotType === 'held' || s.slotType === 'hand';
          }
          return targetSlotType === 'torso' ? s.slotType === 'body' : false;
        });
      }
      if (slot) {
        (slot as { equippedItem: EntityId | null }).equippedItem = itemEntityId;
      }
    }
  }

  if (spawnedItemIds.length > 0) {
    nextState = addComponent(nextState, entityId, {
      ...inventory,
      items: [...inventory.items, ...spawnedItemIds]
    });
  }
  if (equipment && updatedSlots.length > 0) {
    nextState = addComponent(nextState, entityId, { ...equipment, slots: updatedSlots });
  }

  return nextState;
}
