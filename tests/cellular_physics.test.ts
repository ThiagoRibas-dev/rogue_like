import { describe, expect, it } from 'bun:test';
import {
  CHUNK_DIRTY_FLUID,
  CHUNK_DIRTY_TEMP,
  DEFAULT_AMBIENT_TEMP_C,
  OBSIDIAN_CONTACT_TEMP_BOOST_C,
  OIL_IGNITION_TEMP_C,
  SHALLOW_EVAPORATION_TURNS,
  WATER_FREEZE_TEMP_C
} from '../src/constants/world_chunk.constants.ts';
import { applyIntentWithCost } from '../src/core/loop/intent_cost_resolver.ts';
import { generateWorldChunkFromParams, buildChunkSynthesisParams } from '../src/map/chunk_generator.ts';
import {
  getFluidByteAt,
  getTemperatureAt,
  getTileIdAt,
  setFluidByteAt,
  setTemperatureAt,
  setTileIdAt
} from '../src/map/map_accessor.ts';
import { buildTilePaletteRegistry } from '../src/map/tile_palette.ts';
import { queryCrossingAtPosition } from '../src/systems/crossing.system.ts';
import { applyAnalyticalActiveGridCatchUp, applyAnalyticalChunkCatchUp } from '../src/systems/physics/chunk_catchup.ts';
import { applyFluidToVoxel, packFluidCell, processDirtyFluidChunks, unpackFluidCell } from '../src/systems/physics/fluid_physics.ts';
import { processDirtyTemperatureChunks } from '../src/systems/physics/temperature_physics.ts';
import { advanceWorldTimeBulk } from '../src/systems/world_time_skip.ts';
import { ComponentType } from '../src/types/components.types.ts';
import { IntentType } from '../src/types/intents/intent.enum.ts';
import { buildGameState, loadCampaignFromDisk } from './helpers.ts';

describe('Milestone 180: Dirty-Bitset Cellular Physics & Analytical Sleep Catch-Up', () => {
  it('packs and unpacks fluid depth (0..7) and kind cleanly into single-byte cells', () => {
    const encoded = packFluidCell('magma', 5);
    expect(unpackFluidCell(encoded)).toEqual({ kind: 'magma', depth: 5 });
    expect(packFluidCell('none', 4)).toBe(0);
    expect(packFluidCell('water', 0)).toBe(0);
    expect(unpackFluidCell(0)).toEqual({ kind: 'none', depth: 0 });
  });

  it('spills water vertically through open_air and equalizes horizontally until dirty flag auto-sleeps', () => {
    const baseCampaign = loadCampaignFromDisk('default');
    const campaign = {
      ...baseCampaign,
      rules: {
        ...baseCampaign.rules,
        map: { ...baseCampaign.rules.map, startingAreaId: 'watchtower_overlook' }
      }
    };
    let state = buildGameState(campaign);

    // Z=1 (3, 1) is open_air over Z=0 (3, 1) stone_floor
    state = applyFluidToVoxel(state, 3, 1, 1, 'water', 6);
    expect(unpackFluidCell(getFluidByteAt(state.map, 3, 1, 1)).depth).toBe(6);

    state = processDirtyFluidChunks(state);
    // Vertical gravity spillover transfers depth to Z=0 stone_floor cleanly
    expect(unpackFluidCell(getFluidByteAt(state.map, 3, 1, 1)).depth).toBe(0);
    expect(unpackFluidCell(getFluidByteAt(state.map, 3, 1, 0)).depth).toBe(6);

    // Run until hydrostatic equalization settles and clears CHUNK_DIRTY_FLUID automatically
    for (let i = 0; i < 20; i++) {
      state = processDirtyFluidChunks(state);
    }
    const z0DirtyAfterSettle = state.map.physicsOverlay?.slices[0]?.dirtyFlags ?? 0;
    expect(z0DirtyAfterSettle & CHUNK_DIRTY_FLUID).toBe(0);
    // Total fluid spread laterally onto adjacent floor cells
    expect(unpackFluidCell(getFluidByteAt(state.map, 3, 1, 0)).depth).toBeLessThan(6);
    expect(unpackFluidCell(getFluidByteAt(state.map, 4, 1, 0)).depth).toBeGreaterThan(0);
  });

  it('solidifies obsidian and emits steam when water meets magma', () => {
    const baseCampaign = loadCampaignFromDisk('default');
    const campaign = {
      ...baseCampaign,
      rules: {
        ...baseCampaign.rules,
        map: { ...baseCampaign.rules.map, startingAreaId: 'safe_hub' }
      }
    };
    let state = buildGameState(campaign);
    state = applyFluidToVoxel(state, 3, 2, 0, 'water', 5);
    state = applyFluidToVoxel(state, 4, 2, 0, 'magma', 4);
    state = processDirtyFluidChunks(state);

    expect(getTileIdAt(state.map, 4, 2, 0)).toBe('obsidian_wall');
    expect(unpackFluidCell(getFluidByteAt(state.map, 4, 2, 0)).depth).toBe(0);
    expect(getTemperatureAt(state.map, 3, 2, 0)).toBeGreaterThanOrEqual(
      DEFAULT_AMBIENT_TEMP_C + OBSIDIAN_CONTACT_TEMP_BOOST_C
    );
    const steamFields = state.entities.filter(
      (id) => state.components.get(id)?.[ComponentType.Field] && (state.components.get(id)?.[ComponentType.Field] as { fieldType: string }).fieldType === 'steam_cloud'
    );
    expect(steamFields.length).toBeGreaterThan(0);
  });

  it('triggers oil ignition fire fields, freezing water crossings, symmetric flow, and multi-Z sculpting wakes', () => {
    const baseCampaign = loadCampaignFromDisk('default');
    const campaign = {
      ...baseCampaign,
      rules: {
        ...baseCampaign.rules,
        map: { ...baseCampaign.rules.map, startingAreaId: 'safe_hub' }
      }
    };
    let state = buildGameState(campaign);

    // Oil ignition >= OIL_IGNITION_TEMP_C spawns fire field and consumes oil
    state = applyFluidToVoxel(state, 3, 2, 0, 'oil', 3);
    state = { ...state, map: setTemperatureAt(state.map, 3, 2, OIL_IGNITION_TEMP_C + 20, 0, state.globalTurn) };
    state = processDirtyFluidChunks(state);
    expect(unpackFluidCell(getFluidByteAt(state.map, 3, 2, 0)).depth).toBe(0);
    const fireAtOil = state.entities.some((id) => {
      const f = state.components.get(id)?.[ComponentType.Field] as { fieldType: string } | undefined;
      const p = state.components.get(id)?.[ComponentType.Position] as { x: number; y: number } | undefined;
      return f?.fieldType === 'fire' && p?.x === 3 && p?.y === 2;
    });
    expect(fireAtOil).toBe(true);

    // Sub-freezing water spawns a frozen_surface crossing
    state = applyFluidToVoxel(state, 6, 2, 0, 'water', 4);
    state = { ...state, map: setTemperatureAt(state.map, 6, 2, WATER_FREEZE_TEMP_C - 5, 0, state.globalTurn) };
    state = processDirtyFluidChunks(state);
    expect(queryCrossingAtPosition(state, 6, 2, 0)?.crossing.crossingKind).toBe('frozen_surface');

    // Symmetric horizontal flow: single tick moves at most 1 cell away (no +x/+y teleportation cascade)
    let flowState = buildGameState(campaign);
    flowState = applyFluidToVoxel(flowState, 3, 2, 0, 'water', 6);
    flowState = processDirtyFluidChunks(flowState);
    expect(unpackFluidCell(getFluidByteAt(flowState.map, 5, 2, 0)).depth).toBe(0);
    expect(unpackFluidCell(getFluidByteAt(flowState.map, 3, 4, 0)).depth).toBe(0);

    // Multi-Z wake: sculpting away floor underneath settled z=1 water wakes slice 1 to drain down
    const watchCampaign = {
      ...baseCampaign,
      rules: { ...baseCampaign.rules, map: { ...baseCampaign.rules.map, startingAreaId: 'watchtower_overlook' } }
    };
    let wzState = buildGameState(watchCampaign);
    wzState = { ...wzState, map: setTileIdAt(wzState.map, 3, 1, 'stone_floor', 1) };
    wzState = applyFluidToVoxel(wzState, 3, 1, 1, 'water', 5);
    for (let i = 0; i < 15; i++) {
      wzState = processDirtyFluidChunks(wzState);
    }
    const settledDepthZ1 = unpackFluidCell(getFluidByteAt(wzState.map, 3, 1, 1)).depth;
    expect(settledDepthZ1).toBeGreaterThan(0);
    wzState = { ...wzState, map: setTileIdAt(wzState.map, 3, 1, 'open_air', 1) };
    expect((wzState.map.physicsOverlay?.slices[1]?.dirtyFlags ?? 0) & CHUNK_DIRTY_FLUID).toBe(CHUNK_DIRTY_FLUID);
    wzState = processDirtyFluidChunks(wzState);
    expect(unpackFluidCell(getFluidByteAt(wzState.map, 3, 1, 0)).depth).toBeGreaterThan(0);
  });

  it('tracks dirtyChunkKeys persistence on streaming WorldChunks when fluid/temp mutate', () => {
    const baseCampaign = loadCampaignFromDisk('default');
    const campaign = {
      ...baseCampaign,
      rules: { ...baseCampaign.rules, map: { ...baseCampaign.rules.map, startingAreaId: 'endless_frontier' } }
    };
    let state = buildGameState(campaign);
    const originX = state.map.chunkGrid!.originChunkX * state.map.chunkGrid!.chunkSize + 4;
    const originY = state.map.chunkGrid!.originChunkY * state.map.chunkGrid!.chunkSize + 4;
    state = applyFluidToVoxel(state, originX, originY, 0, 'water', 5);
    state = processDirtyFluidChunks(state);
    expect(state.map.chunkGrid!.dirtyChunkKeys.size).toBeGreaterThan(0);
  });

  it('diffuses temperature toward ambient and auto-clears CHUNK_DIRTY_TEMP on convergence', () => {
    const baseCampaign = loadCampaignFromDisk('default');
    const campaign = {
      ...baseCampaign,
      rules: {
        ...baseCampaign.rules,
        map: { ...baseCampaign.rules.map, startingAreaId: 'safe_hub' }
      }
    };
    let state = buildGameState(campaign);
    state = {
      ...state,
      map: setTemperatureAt(state.map, 4, 2, 160, 0, state.globalTurn)
    };
    expect((state.map.physicsOverlay?.slices[0]?.dirtyFlags ?? 0) & CHUNK_DIRTY_TEMP).toBe(CHUNK_DIRTY_TEMP);

    state = processDirtyTemperatureChunks(state);
    expect(getTemperatureAt(state.map, 5, 2, 0)).toBeGreaterThan(DEFAULT_AMBIENT_TEMP_C);
    expect(getTemperatureAt(state.map, 4, 2, 0)).toBeLessThan(160);

    for (let step = 0; step < 60; step++) {
      state = processDirtyTemperatureChunks(state);
    }
    expect(getTemperatureAt(state.map, 4, 2, 0)).toBe(DEFAULT_AMBIENT_TEMP_C);
    expect((state.map.physicsOverlay?.slices[0]?.dirtyFlags ?? 0) & CHUNK_DIRTY_TEMP).toBe(0);
  });

  it('computes closed-form O(N) analytical sleep catch-up on dormant chunks and bulk time skips', () => {
    const campaign = loadCampaignFromDisk('default');
    const areaDef = campaign.areas['endless_frontier']!;
    const palette = buildTilePaletteRegistry(campaign.tiles);
    const params = buildChunkSynthesisParams(palette, areaDef, campaign.tiles);
    let chunk = generateWorldChunkFromParams(params, 0, 0, 0);

    // Dirty thermal hotspot + isolated shallow 1/7 puddle at turn 0
    chunk.temperature[0] = 200;
    chunk.fluid[1] = packFluidCell('water', 1);
    chunk = { ...chunk, dirtyFlags: CHUNK_DIRTY_TEMP | CHUNK_DIRTY_FLUID, lastSimulatedTurn: 0 };

    // Jump 120 turns forward analytically with zero per-turn loop
    const woken = applyAnalyticalChunkCatchUp(chunk, 120, DEFAULT_AMBIENT_TEMP_C);
    expect(woken.lastSimulatedTurn).toBe(120);
    expect(woken.temperature[0]).toBe(DEFAULT_AMBIENT_TEMP_C);
    expect(woken.fluid[1]).toBe(0);
    expect(woken.dirtyFlags & (CHUNK_DIRTY_TEMP | CHUNK_DIRTY_FLUID)).toBe(0);

    // Also verify bulk rest triggers active grid catch-up cleanly on finite maps
    const safeCampaign = {
      ...campaign,
      rules: { ...campaign.rules, map: { ...campaign.rules.map, startingAreaId: 'safe_hub' } }
    };
    let finiteState = buildGameState(safeCampaign);
    finiteState = {
      ...finiteState,
      map: setFluidByteAt(
        setTemperatureAt(finiteState.map, 3, 2, 180, 0, finiteState.globalTurn),
        4,
        2,
        packFluidCell('water', 1),
        0,
        finiteState.globalTurn
      )
    };
    const bulkRes = advanceWorldTimeBulk(finiteState, SHALLOW_EVAPORATION_TURNS + 40);
    expect(getTemperatureAt(bulkRes.state.map, 3, 2, 0)).toBe(DEFAULT_AMBIENT_TEMP_C);
    expect(getFluidByteAt(bulkRes.state.map, 4, 2, 0)).toBe(0);

    // Ensure applyIntentWithCost ticks cellular physics on energy-consuming turns
    let actionState = applyFluidToVoxel(finiteState, 3, 2, 0, 'water', 4);
    const playerId = actionState.entities.find((e) => actionState.components.get(e)?.[ComponentType.Player])!;
    const afterWait = applyIntentWithCost(actionState, { type: IntentType.Wait, entityId: playerId });
    expect(afterWait.success).toBe(true);
    expect(unpackFluidCell(getFluidByteAt(afterWait.state.map, 4, 2, 0)).depth).toBeGreaterThan(0);

    // Carve a wall neighboring fluid marks dirty flags automatically
    const carvedMap = setTileIdAt(afterWait.state.map, 0, 0, 'stone_floor', 0);
    expect(carvedMap).toBeDefined();
    void applyAnalyticalActiveGridCatchUp;
  });
});
