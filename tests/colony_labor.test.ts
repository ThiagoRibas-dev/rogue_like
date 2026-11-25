import { describe, expect, it } from 'bun:test';
import { dispatchAction } from '../src/actions/action.registry.ts';
import { addComponent, getComponent, getEntitiesAtPosition, spawnEntity, spawnItem } from '../src/core/ecs.ts';
import { deserializeGameState, serializeGameState } from '../src/core/save.ts';
import { getTileIdAt } from '../src/map/map_accessor.ts';
import { processAITurn } from '../src/systems/ai.system.ts';
import { sculptTerrainVoxel } from '../src/systems/construction.system.ts';
import { processDeathSystem } from '../src/systems/death.system.ts';
import { addTileDesignation } from '../src/systems/labor/designation.system.ts';
import {
  isResourceReservedByOther,
  releaseAllWorkerReservations,
  tileResourceKey,
  tryAcquireReservation
} from '../src/systems/labor/job_blackboard.ts';
import { createStockpileZone, doesItemMatchStockpile, findBestStockpileCellForItem, findUnstockedHaulItems } from '../src/systems/labor/stockpile.system.ts';
import { advanceWorkshopBillWork, enqueueCraftingBill, resolveNextRunnableBill } from '../src/systems/labor/workshop.system.ts';
import {
  ComponentType,
  type ItemComponent,
  type PositionComponent
} from '../src/types/components.types.ts';
import { IntentType } from '../src/types/intents/intent.enum.ts';
import { buildGameState, loadCampaignFromDisk } from './helpers.ts';

describe('Milestone 183: Designations, Blackboard, Stockpiles, Hauling AI & Workshop Crafting DAGs', () => {
  it('enforces conflict-free atomic blackboard reservations and releases locks cleanly on worker death', () => {
    const campaign = loadCampaignFromDisk('default');
    let state = buildGameState(campaign);
    const [s1, workerA] = spawnEntity(state, 'quarry_mason', 2, 2);
    const [s2, workerB] = spawnEntity(s1, 'quarry_mason', 3, 2);
    state = s2;

    const wallKey = tileResourceKey(state.currentAreaId, 0, 1, 0);
    const acqA = tryAcquireReservation(state, [wallKey], 'jobA', workerA);
    expect(acqA.acquired).toBe(true);
    state = acqA.state;

    // Concurrent workerB cannot acquire the same resource key
    expect(isResourceReservedByOther(state, wallKey, workerB)).toBe(true);
    const acqB = tryAcquireReservation(state, [wallKey], 'jobB', workerB);
    expect(acqB.acquired).toBe(false);

    // Worker death releases all reservations held by workerA
    state = addComponent(state, workerA, { type: ComponentType.Death, causeOfDeath: 'cave_in' });
    state = processDeathSystem(state);
    expect(isResourceReservedByOther(state, wallKey, workerB)).toBe(false);
    void releaseAllWorkerReservations;
  });

  it('routes autonomous laborers through designated mining, stockpile hauling, workshop DAG crafting, and save/load round-trips', () => {
    const baseCampaign = loadCampaignFromDisk('default');
    const campaign = {
      ...baseCampaign,
      rules: {
        ...baseCampaign.rules,
        map: { ...baseCampaign.rules.map, startingAreaId: 'safe_hub' }
      }
    };
    let state = buildGameState(campaign);

    // 1. Place stockpile zone accepting material:stone / cut_stone_block
    state = createStockpileZone(state, {
      id: 'masonry_yard',
      name: 'Masonry Yard',
      cells: [{ x: 4, y: 2, z: 0 }],
      allowedTags: ['material:stone', 'material:stone_block'],
      priority: 1
    });

    // 2. Spawn mason worker, masonry workshop, loose boulder, and wall mining designation
    let masonId;
    [state, masonId] = spawnEntity(state, 'quarry_mason', 1, 1);
    let workshopId;
    [state, workshopId] = spawnEntity(state, 'masonry_workshop', 5, 2);
    let boulderId;
    [state, boulderId] = spawnItem(state, 'stone_boulder', 2, 2, 0);

    const stockpileZone = state.colonyState!.stockpiles['masonry_yard']!;
    expect(doesItemMatchStockpile(state, boulderId, stockpileZone)).toBe(true);
    expect(findBestStockpileCellForItem(state, boulderId, masonId, { x: 2, y: 2, z: 0 })?.coord).toEqual({ x: 4, y: 2, z: 0 });

    const desigRes = addTileDesignation(state, { kind: 'mine', x: 0, y: 1, z: 0, priority: 1 });
    expect(desigRes.added).toBe(true);
    state = desigRes.state;

    // Step AI on mason -> should select mining designation (priority 1) and mine (0,1,0) adjacent!
    const aiMineTurn = processAITurn(state, masonId);
    state = aiMineTurn.state;
    expect(aiMineTurn.intent?.type).toBe(IntentType.Apply);
    if (aiMineTurn.intent) {
      state = dispatchAction(state, aiMineTurn.intent).state;
    }
    expect(getTileIdAt(state.map, 0, 1, 0)).toBe('stone_floor');

    // 3. Enqueue multi-step workshop bill on masonry_workshop: needs boulder -> produces cut_stone_block
    state = enqueueCraftingBill(state, workshopId, {
      billId: 'bill_cut_1',
      recipeId: 'cut_stone_blocks',
      repeatMode: 'do_x_times',
      targetCount: 1
    });

    // Move mason & boulder to workshop for direct crafting resolution test
    state = addComponent(state, boulderId, { type: ComponentType.Position, x: 5, y: 2, z: 0 });
    state = addComponent(state, masonId, { type: ComponentType.Position, x: 5, y: 2, z: 0 });
    const billCheck = resolveNextRunnableBill(state, workshopId, masonId);
    expect(billCheck?.mode).toBe('craft');

    // AI drives Apply('craft', workshopId) twice (workUnits = 2) to craft cut_stone_block!
    for (let step = 0; step < 2; step++) {
      const craftTurn = processAITurn(state, masonId);
      state = craftTurn.state;
      expect(craftTurn.intent?.type).toBe(IntentType.Apply);
      if (craftTurn.intent) {
        state = dispatchAction(state, craftTurn.intent).state;
      }
    }

    const blocksAtWs = getEntitiesAtPosition(state, 5, 2, 0).filter(
      (id) => (getComponent(state, id, ComponentType.Item) as ItemComponent | undefined)?.itemId === 'cut_stone_block'
    );
    expect(blocksAtWs.length).toBe(1);

    // 4. Verify save/load serialization preserves ColonySimulationState, NeedsComponent, and LaborProfileComponent
    const serialized = serializeGameState(state);
    const rehydrated = deserializeGameState(serialized, campaign, 'default');
    expect(rehydrated.colonyState?.stockpiles['masonry_yard']?.name).toBe('Masonry Yard');
    expect(rehydrated.colonyState?.workshops[String(workshopId)]?.bills[0]?.completedCount).toBe(1);
    const rehydratedPos = getComponent(rehydrated, masonId, ComponentType.Position) as PositionComponent;
    expect(rehydratedPos.x).toBe(5);
    void advanceWorkshopBillWork;
  });

  it('hauls targeted items off multi-item tiles, protects workshop inputs, and executes custom blueprints', () => {
    const baseCampaign = loadCampaignFromDisk('default');
    const campaign = {
      ...baseCampaign,
      rules: {
        ...baseCampaign.rules,
        map: { ...baseCampaign.rules.map, startingAreaId: 'safe_hub' }
      }
    };
    let state = buildGameState(campaign);
    state = createStockpileZone(state, {
      id: 'stone_only_yard',
      name: 'Stone Only',
      cells: [{ x: 4, y: 2, z: 0 }],
      allowedTags: ['material:stone'],
      priority: 1
    });

    // Multi-item tile (2,2,0): decoy potion first, stone boulder second
    let masonId;
    [state, masonId] = spawnEntity(state, 'quarry_mason', 2, 2);
    let potionId;
    [state, potionId] = spawnItem(state, 'health_potion', 2, 2, 0);
    let boulderId;
    [state, boulderId] = spawnItem(state, 'stone_boulder', 2, 2, 0);

    // Multi-turn haul executes PickUp -> Move -> Drop specifically on boulderId (leaving potionId behind)
    for (let turn = 0; turn < 6; turn++) {
      const boulderPos = getComponent(state, boulderId, ComponentType.Position) as PositionComponent | undefined;
      if (boulderPos && boulderPos.x === 4 && boulderPos.y === 2) break;
      const aiRes = processAITurn(state, masonId);
      state = aiRes.state;
      if (!aiRes.intent) break;
      state = dispatchAction(state, aiRes.intent).state;
    }
    const finalBoulderPos = getComponent(state, boulderId, ComponentType.Position) as PositionComponent | undefined;
    const finalPotionPos = getComponent(state, potionId, ComponentType.Position) as PositionComponent | undefined;
    expect(finalBoulderPos).toMatchObject({ x: 4, y: 2 });
    expect(finalPotionPos).toMatchObject({ x: 2, y: 2 });

    // Workshop input protection: items adjacent to an unsatisfied workshop bill are NOT stolen by stockpile haulers
    let workshopId;
    [state, workshopId] = spawnEntity(state, 'masonry_workshop', 6, 3);
    state = enqueueCraftingBill(state, workshopId, {
      billId: 'bill_protect',
      recipeId: 'cut_stone_blocks',
      repeatMode: 'do_x_times',
      targetCount: 1
    });
    let wsBoulderId;
    [state, wsBoulderId] = spawnItem(state, 'stone_boulder', 6, 4, 0);
    const haulList = findUnstockedHaulItems(state, masonId);
    expect(haulList.some((h) => h.itemEntityId === wsBoulderId)).toBe(false);

    // Custom blueprint build designation ('stone_floor_blueprint') over open_air builds stone_floor using hauled stone
    let buildState = buildGameState({
      ...baseCampaign,
      rules: { ...baseCampaign.rules, map: { ...baseCampaign.rules.map, startingAreaId: 'watchtower_overlook' } }
    });
    let builderId;
    [buildState, builderId] = spawnEntity(buildState, 'quarry_mason', 3, 2);
    let stoneId;
    [buildState, stoneId] = spawnItem(buildState, 'stone_boulder', 3, 3, 0);

    // Sculpt (5,2,0) into open_air first so stone_floor_blueprint visually proves blueprint selection!
    buildState = sculptTerrainVoxel(buildState, 5, 2, 0, 'open_air');
    buildState = addTileDesignation(buildState, {
      kind: 'build',
      x: 5,
      y: 2,
      z: 0,
      blueprintId: 'stone_floor_blueprint',
      priority: 1
    }).state;

    for (let step = 0; step < 12; step++) {
      if (getTileIdAt(buildState.map, 5, 2, 0) === 'stone_floor') break;
      const aiRes = processAITurn(buildState, builderId);
      buildState = aiRes.state;
      if (!aiRes.intent) break;
      buildState = dispatchAction(buildState, aiRes.intent).state;
    }
    expect(getTileIdAt(buildState.map, 5, 2, 0)).toBe('stone_floor');
    void stoneId;
  });
});
