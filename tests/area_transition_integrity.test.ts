import { describe, expect, test } from 'bun:test';
import { buildGameState, loadCampaignFromDisk } from './helpers.ts';
import { addComponent, getComponent, queryEntities, removeComponent, spawnItem } from '../src/core/ecs.ts';
import { processChangeAreaIntent } from '../src/systems/map.system.ts';
import { ComponentType } from '../src/types/components.types.ts';
import { IntentType } from '../src/types/intents/intent.enum.ts';

describe('ECS State Boundaries & Floor Transition Foreign-Key Integrity', () => {
  test('migrates player-owned inventory & equipped items across floor transitions and isolates cold-stored AreaData maps', () => {
    const campaign = loadCampaignFromDisk('default');
    let state = buildGameState(campaign);

    const areaIds = Object.keys(campaign.areas);
    expect(areaIds.length).toBeGreaterThanOrEqual(2);
    const startAreaId = state.currentAreaId;
    const targetAreaId = areaIds.find((id) => id !== startAreaId) ?? startAreaId;

    const playerId = queryEntities(state, [ComponentType.Player])[0]!;
    const itemKeys = Object.keys(campaign.items);
    const itemKeyA = itemKeys[0]!;
    const itemKeyB = itemKeys[1] ?? itemKeys[0]!;

    let itemEntityA;
    let itemEntityB;
    [state, itemEntityA] = spawnItem(state, itemKeyA, 1, 1);
    [state, itemEntityB] = spawnItem(state, itemKeyB, 1, 1);
    state = removeComponent(state, itemEntityA, ComponentType.Position);
    state = removeComponent(state, itemEntityB, ComponentType.Position);

    const inv = getComponent(state, playerId, ComponentType.Inventory)!;
    state = addComponent(state, playerId, {
      ...inv,
      items: [...inv.items, itemEntityA]
    });

    const equip = getComponent(state, playerId, ComponentType.Equipment)!;
    if (equip.slots.length > 0) {
      state = addComponent(state, playerId, {
        ...equip,
        slots: [{ ...equip.slots[0]!, equippedItem: itemEntityB }, ...equip.slots.slice(1)]
      });
    }

    // Transition to targetAreaId
    const resForward = processChangeAreaIntent(state, {
      type: IntentType.ChangeArea,
      entityId: playerId,
      targetAreaId
    });
    expect(resForward.success).toBe(true);
    const stateOnFloor2 = resForward.state;

    expect(stateOnFloor2.currentAreaId).toBe(targetAreaId);
    expect(stateOnFloor2.entities.includes(playerId)).toBe(true);
    expect(stateOnFloor2.entities.includes(itemEntityA)).toBe(true);
    expect(stateOnFloor2.entities.includes(itemEntityB)).toBe(true);
    expect(getComponent(stateOnFloor2, itemEntityA, ComponentType.Item)?.itemId).toBe(itemKeyA);
    expect(getComponent(stateOnFloor2, itemEntityB, ComponentType.Item)?.itemId).toBe(itemKeyB);

    // Cold-stored startAreaId must not share a mutable Map reference with stateOnFloor2.components
    const coldStartArea = stateOnFloor2.areas.get(startAreaId);
    expect(coldStartArea).toBeDefined();
    expect(coldStartArea!.components).not.toBe(stateOnFloor2.components);
    expect(coldStartArea!.entities.includes(playerId)).toBe(false);
    expect(coldStartArea!.entities.includes(itemEntityA)).toBe(false);

    // Transition back to startAreaId
    const resBack = processChangeAreaIntent(stateOnFloor2, {
      type: IntentType.ChangeArea,
      entityId: playerId,
      targetAreaId: startAreaId
    });
    expect(resBack.success).toBe(true);
    const stateBackOnFloor1 = resBack.state;
    expect(stateBackOnFloor1.currentAreaId).toBe(startAreaId);
    expect(getComponent(stateBackOnFloor1, itemEntityA, ComponentType.Item)?.itemId).toBe(itemKeyA);
    expect(getComponent(stateBackOnFloor1, itemEntityB, ComponentType.Item)?.itemId).toBe(itemKeyB);
  });
});
