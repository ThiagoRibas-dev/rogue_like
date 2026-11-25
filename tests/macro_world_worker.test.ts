import { describe, expect, test } from 'bun:test';
import * as ROT from 'rot-js';
import { CHUNK_FLAG_OUTDOOR, DEFAULT_AMBIENT_TEMP_C } from '../src/constants/world_chunk.constants.ts';
import { getComponent, spawnEntity } from '../src/core/ecs.ts';
import { deserializeGameState, serializeGameState } from '../src/core/save.ts';
import { processTier3GlobalCadence } from '../src/core/simulation_cadence.ts';
import { createInitialStreamingGrid } from '../src/map/chunk_generator.ts';
import { deliverPendingRumorsToArea, tickPendingRumors } from '../src/systems/gossip.system.ts';
import { buildLegendsInputFromCampaign, generateLegendsWorldSync, seedGameStateFromLegends } from '../src/systems/macro/legends_simulator.ts';
import {
  advanceMacroWorldTicks,
  applyMacroTickBatchToGameState,
  buildMacroSimContext,
  getActiveOutdoorWeatherAt
} from '../src/systems/macro/macro_world.system.ts';
import { flushMacroWorldSyncForBulkTurns, syncMacroWorldAtTurnBoundary } from '../src/systems/macro/macro_world_sync.ts';
import { processDirtyTemperatureChunks } from '../src/systems/physics/temperature_physics.ts';
import { readSeasonalCalendar } from '../src/systems/world_clock.system.ts';
import { advanceWorldTimeBulk } from '../src/systems/world_time_skip.ts';
import { ComponentType, type MemoryComponent } from '../src/types/components.types.ts';
import type { GameState } from '../src/types/game-state.types.ts';
import { awaitPendingMacroTickJob, resetMacroWorldWorker } from '../src/worker/worker_bridge.ts';
import { buildGameState, loadCampaignFromDisk } from './helpers.ts';

describe('Phase 48 M184: Ring 2 Parallel Macro-World Simulation & Weather', () => {
  test('advanceMacroWorldTicks is strictly deterministic and leaves global ROT.RNG state untouched', () => {
    const campaign = loadCampaignFromDisk('default');
    const context = buildMacroSimContext(campaign);
    const input = buildLegendsInputFromCampaign(campaign, 48184);
    const initialMacro = generateLegendsWorldSync({ ...input, historyYears: 30, siteCount: 8 });

    ROT.RNG.setSeed(777);
    const rngStateBefore = ROT.RNG.getState();

    const batchA = advanceMacroWorldTicks(initialMacro, 12, context);
    const rngStateAfter = ROT.RNG.getState();
    const batchB = advanceMacroWorldTicks(initialMacro, 12, context);

    expect(rngStateAfter).toEqual(rngStateBefore);
    expect(batchA).toEqual(batchB);
    expect(batchA.fromTick).toBe(0);
    expect(batchA.toTick).toBe(12);
    expect(batchA.nextMacroWorld.currentTick).toBe(12);
    expect(batchA.newLegendsEvents.length).toBeGreaterThan(0);
  });

  test('Ring 2 tick advances settlements, caravans, armies, rumors, and serializes cleanly via save.ts', () => {
    const campaign = loadCampaignFromDisk('default');
    let state = buildGameState(campaign, 4802);
    const input = buildLegendsInputFromCampaign(campaign, 4802);
    const initialMacro = generateLegendsWorldSync({
      ...input,
      historyYears: 25,
      siteCount: 8,
      tickIntervalTurns: 10
    });
    state = seedGameStateFromLegends(state, initialMacro);

    const context = buildMacroSimContext(campaign);
    const batch = advanceMacroWorldTicks(state.macroWorld!, 20, context);
    const updated = applyMacroTickBatchToGameState(state, batch);

    expect(updated.macroWorld?.currentTick).toBe(20);
    // Monotonic guard ignores stale/duplicate batches
    const duplicate = applyMacroTickBatchToGameState(updated, batch);
    expect(duplicate).toBe(updated);

    // Round-trip save/load preserves macroWorld cleanly without Map/Set corruption
    const serialized = serializeGameState(updated);
    expect(serialized.macroWorld?.currentTick).toBe(20);
    const rehydrated = deserializeGameState(serialized, campaign, 'default');
    expect(rehydrated.macroWorld?.currentTick).toBe(20);
    expect(Object.keys(rehydrated.macroWorld?.sites ?? {}).length).toBe(
      Object.keys(updated.macroWorld?.sites ?? {}).length
    );
  });

  test('Seasonal calendar progresses smoothly and weather fronts modulate outdoor thermal ambient', () => {
    const campaign = loadCampaignFromDisk('default');
    let state = buildGameState(campaign, 4803);
    const input = buildLegendsInputFromCampaign(campaign, 4803);
    const initialMacro = generateLegendsWorldSync({ ...input, historyYears: 20, siteCount: 6 });

    const centerX = Math.floor(initialMacro.continent.width / 2);
    const centerY = Math.floor(initialMacro.continent.height / 2);
    state = seedGameStateFromLegends(state, {
      ...initialMacro,
      weatherFronts: [
        {
          id: 'test_blizzard',
          kind: 'blizzard',
          x: centerX,
          y: centerY,
          radiusCells: 6,
          dx: 0,
          dy: 0,
          remainingTicks: 10
        }
      ]
    });

    const weather = getActiveOutdoorWeatherAt(state, 0, 0);
    expect(weather?.kind).toBe('blizzard');
    expect(weather?.tempDeltaC).toBe(-22);

    // Streaming outdoor chunk without manual dirtyFlags gets auto-flagged by applyMacroTickBatchToGameState
    const frontierDef = campaign.areas['endless_frontier']!;
    const grid = createInitialStreamingGrid(campaign, frontierDef, 0, 0);
    const firstKey = Array.from(grid.chunks.keys()).find((k) => grid.chunks.get(k)?.cz === 0)!;
    const chunk = grid.chunks.get(firstKey)!;
    const nextFlags = new Uint8Array(chunk.flags);
    nextFlags.fill(CHUNK_FLAG_OUTDOOR);
    const outdoorChunks = new Map(grid.chunks);
    outdoorChunks.set(firstKey, {
      ...chunk,
      flags: nextFlags
    });

    let outdoorState: GameState = {
      ...state,
      currentAreaId: 'endless_frontier',
      map: {
        width: 0,
        height: 0,
        tiles: [],
        chunkGrid: { ...grid, chunks: outdoorChunks }
      }
    };
    const blizzardMacro = state.macroWorld!;
    outdoorState = applyMacroTickBatchToGameState(outdoorState, {
      fromTick: 0,
      toTick: 1,
      nextMacroWorld: { ...blizzardMacro, currentTick: 1, lastDispatchedTick: 1 },
      newSiteDeltas: [],
      newLegendsEvents: [],
      newRumors: [],
      areaMutations: []
    });
    outdoorState = processDirtyTemperatureChunks(outdoorState);
    const updatedTemp = outdoorState.map.chunkGrid!.chunks.get(firstKey)!.temperature[0]!;
    expect(updatedTemp).toBeLessThan(DEFAULT_AMBIENT_TEMP_C);

    // Seasonal progression over world turns matches Ring 2 event calendar
    const springCal = readSeasonalCalendar(state);
    expect(springCal.season).toBe('spring');
    const summerCal = readSeasonalCalendar({ ...state, globalTurn: 450000 });
    expect(summerCal.season).toBe('summer');
    const syncedSummerBatch = advanceMacroWorldTicks(
      { ...initialMacro, tickIntervalTurns: 1000, currentTick: 432, lastDispatchedTick: 432 },
      450,
      buildMacroSimContext(campaign)
    );
    expect(syncedSummerBatch.nextMacroWorld.currentTick).toBe(450);
    expect(syncedSummerBatch.newLegendsEvents.length).toBeGreaterThan(0);
    for (const evt of syncedSummerBatch.newLegendsEvents) {
      expect(evt.season).toBe('summer');
    }
  });

  test('Ring 2 rumors deliver into NPC MemoryComponent pools, raiderFactionTags work, and save clamps mid-flight tick', async () => {
    resetMacroWorldWorker();
    const campaign = loadCampaignFromDisk('default');
    const taggedCampaign = {
      ...campaign,
      factions: {
        ...campaign.factions,
        nomad: { player: 'neutral' as const, town: 'neutral' as const, bandits: 'neutral' as const, monster: 'neutral' as const }
      },
      entities: {
        ...campaign.entities,
        nomad_scout: {
          ...campaign.entities['scout']!,
          faction: 'nomad',
          tags: ['actor', 'nomad_raider']
        }
      },
      rules: {
        ...campaign.rules,
        macroWorld: {
          ...campaign.rules.macroWorld!,
          raiderFactionTags: ['nomad_raider']
        }
      }
    };
    const ctx = buildMacroSimContext(taggedCampaign);
    expect(ctx.raiderFactionIds).toContain('nomad');

    let state = buildGameState(taggedCampaign, 4805);
    const macro = generateLegendsWorldSync({
      ...buildLegendsInputFromCampaign(taggedCampaign, 4805),
      historyYears: 20,
      siteCount: 6,
      tickIntervalTurns: 10
    });
    state = seedGameStateFromLegends(state, macro);

    const npcTplId = Object.entries(taggedCampaign.entities).find(
      ([id, tpl]) => id !== 'player' && tpl.isActor === true && tpl.tags?.includes('town')
    )?.[0]!;
    let npcId: number;
    [state, npcId] = spawnEntity(state, npcTplId, 2, 2);

    state = applyMacroTickBatchToGameState(state, {
      fromTick: 0,
      toTick: 1,
      nextMacroWorld: { ...state.macroWorld!, currentTick: 1, lastDispatchedTick: 1 },
      newSiteDeltas: [],
      newLegendsEvents: [],
      newRumors: [
        {
          id: 'macro_rumor_test_1',
          factSummary: 'Ashwatch suffered a midnight orc raid.',
          siteId: 'site_1',
          factionId: 'orc',
          originTick: 1
        }
      ],
      areaMutations: []
    });
    expect(state.pendingRumors.some((r) => r.rumorItem.id === 'macro_rumor_test_1')).toBe(true);

    // Advance remainingDelay -> 0 and deliver to active NPCs
    for (let t = 0; t < 6; t++) {
      state = tickPendingRumors(state);
    }
    state = deliverPendingRumorsToArea(state, state.currentAreaId);
    const npcMem = getComponent(state, npcId, ComponentType.Memory) as MemoryComponent | undefined;
    expect(npcMem?.rumorPool?.some((r) => r.id === 'macro_rumor_test_1')).toBe(true);
    expect(state.pendingRumors.some((r) => r.rumorItem.id === 'macro_rumor_test_1')).toBe(false);

    // Save/load clamp recovery: mid-flight lastDispatchedTick > currentTick clamps & recovers cleanly
    const staleSaved = serializeGameState({
      ...state,
      globalTurn: 30,
      macroWorld: {
        ...state.macroWorld!,
        currentTick: 1,
        lastDispatchedTick: 3
      }
    });
    const rehydrated = deserializeGameState(staleSaved, taggedCampaign, 'default');
    expect(rehydrated.macroWorld?.lastDispatchedTick).toBe(1);
    const recovered = syncMacroWorldAtTurnBoundary(rehydrated);
    await awaitPendingMacroTickJob();
    const synced = syncMacroWorldAtTurnBoundary(recovered);
    expect(synced.macroWorld?.currentTick).toBe(3);
    resetMacroWorldWorker();
  });

  test('processTier3GlobalCadence and advanceWorldTimeBulk synchronize Ring 2 ticks at turn boundaries', async () => {
    resetMacroWorldWorker();
    const campaign = loadCampaignFromDisk('default');
    let state = buildGameState(campaign, 4804);
    const input = buildLegendsInputFromCampaign(campaign, 4804);
    const initialMacro = generateLegendsWorldSync({
      ...input,
      historyYears: 20,
      siteCount: 6,
      tickIntervalTurns: 10
    });
    state = seedGameStateFromLegends(state, initialMacro);

    // Advance via Tier 3 turn boundary at turn 10 (awaits async Web Worker completion if active)
    state = { ...state, globalTurn: 9 };
    state = processTier3GlobalCadence(state, true);
    expect(state.globalTurn).toBe(10);
    await awaitPendingMacroTickJob();
    // Next turn-boundary tick drains and merges the completed worker batch cleanly
    state = processTier3GlobalCadence(state, true);
    expect(state.macroWorld?.currentTick).toBe(1);

    // Advance via bulk world time skip to reach tick >= 5 synchronously
    const bulkRes = advanceWorldTimeBulk(state, 40);
    expect(bulkRes.state.globalTurn).toBe(51);
    expect(bulkRes.state.macroWorld?.currentTick).toBe(5);

    const flushed = flushMacroWorldSyncForBulkTurns({ ...bulkRes.state, globalTurn: 70 });
    expect(flushed.macroWorld?.currentTick).toBe(7);
    resetMacroWorldWorker();
  });
});
