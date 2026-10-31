import { describe, expect, test } from 'bun:test';
import { buildGameState, loadCampaignFromDisk } from './helpers.ts';
import { addComponent, getComponent, queryEntities, spawnItem } from '../src/core/ecs.ts';
import { deserializeGameState, pruneOrphanEntities, serializeGameState } from '../src/core/save.ts';
import { ComponentType, type EquipmentComponent, type InventoryComponent } from '../src/types/components.types.ts';
import { toEntityId } from '../src/types/game-state.types.ts';

describe('Save / Load Serialization Round-Trip & Orphan Pruning Invariants', () => {
  test('round-trips GameState across JSON.stringify / JSON.parse preserving Inventory, Equipment, and RulesetData', () => {
    const campaign = loadCampaignFromDisk('default');
    let state = buildGameState(campaign);

    const players = queryEntities(state, [ComponentType.Player, ComponentType.Position]);
    const playerId = players[0]!;
    const playerPos = getComponent(state, playerId, ComponentType.Position)!;

    const itemIds = Object.keys(campaign.items);
    const firstItemId = itemIds[0]!;
    const [afterItemSpawn, spawnedItemEntityId] = spawnItem(state, firstItemId, playerPos.x, playerPos.y);
    state = afterItemSpawn;

    const inv = getComponent(state, playerId, ComponentType.Inventory) as InventoryComponent | undefined;
    if (inv) {
      state = addComponent(state, playerId, {
        ...inv,
        items: [...inv.items, spawnedItemEntityId]
      });
    }

    const equip = getComponent(state, playerId, ComponentType.Equipment) as EquipmentComponent | undefined;
    if (equip && equip.slots.length > 0) {
      const firstSlot = equip.slots[0]!;
      state = addComponent(state, playerId, {
        ...equip,
        slots: [{ ...firstSlot, equippedItem: spawnedItemEntityId }, ...equip.slots.slice(1)]
      });
    }

    state = addComponent(state, playerId, {
      type: ComponentType.RulesetData,
      rulesetId: 'classic',
      data: { customRank: 3, badge: 'veteran' }
    });

    const dto = serializeGameState(state);
    const rawJson = JSON.stringify(dto);
    const parsedDto = JSON.parse(rawJson);
    const rehydrated = deserializeGameState(parsedDto, campaign, 'default');

    expect(rehydrated.entities).toEqual(state.entities);
    expect(rehydrated.currentAreaId).toBe(state.currentAreaId);
    expect(rehydrated.nextEntityId).toBe(state.nextEntityId);

    const rehydratedRulesetData = getComponent(rehydrated, playerId, ComponentType.RulesetData);
    expect(rehydratedRulesetData).toEqual({
      type: ComponentType.RulesetData,
      rulesetId: 'classic',
      data: { customRank: 3, badge: 'veteran' }
    });

    const rehydratedInv = getComponent(rehydrated, playerId, ComponentType.Inventory);
    expect(rehydratedInv?.items.includes(spawnedItemEntityId)).toBe(true);
    expect(getComponent(rehydrated, spawnedItemEntityId, ComponentType.Item)?.itemId).toBe(firstItemId);
  });

  test('pruneOrphanEntities purges unreferenced component records while retaining owned inventory/equipment items', () => {
    const campaign = loadCampaignFromDisk('default');
    let state = buildGameState(campaign);

    const players = queryEntities(state, [ComponentType.Player]);
    const playerId = players[0]!;
    const firstItemId = Object.keys(campaign.items)[0]!;

    const [withItem, ownedItemEntityId] = spawnItem(state, firstItemId, 1, 1);
    state = withItem;

    // Remove ownedItemEntityId from floor entities array so it is ONLY reachable via player's Inventory foreign key
    state = {
      ...state,
      entities: state.entities.filter((id) => id !== ownedItemEntityId)
    };
    const inv = getComponent(state, playerId, ComponentType.Inventory)!;
    state = addComponent(state, playerId, {
      ...inv,
      items: [...inv.items, ownedItemEntityId]
    });

    // Inject a truly orphaned entity record into state.components
    const orphanId = toEntityId(999999);
    const nextComponents = new Map(state.components);
    nextComponents.set(orphanId, {
      [ComponentType.Position]: { type: ComponentType.Position, x: 0, y: 0 }
    });
    state = { ...state, components: nextComponents };

    const pruned = pruneOrphanEntities(state);
    expect(pruned.components.has(orphanId)).toBe(false);
    expect(pruned.components.has(ownedItemEntityId)).toBe(true);
  });
});
