import { afterEach, describe, expect, it } from 'bun:test';
import {
  clearChunkStoreScope,
  flushDirtyChunksToStore,
  loadWorldChunkDelta,
  rehydrateStreamingWorldAsync,
  resetInMemoryChunkStore
} from '../src/core/chunk_store.ts';
import { addComponent, getComponent, getEntitiesAtPosition, spawnEntity, updateSpatialIndex } from '../src/core/ecs.ts';
import { deserializeGameState, serializeGameState } from '../src/core/save.ts';
import { validateAreas } from '../src/editor/validator/area.validator.ts';
import { generateArea } from '../src/map/generator.ts';
import { getMapZBounds, getTileAt, isMultiZMap, setTileIdAt } from '../src/map/map_accessor.ts';
import { resolveGravityForEntity } from '../src/systems/gravity.system.ts';
import { processChangeAreaIntent } from '../src/systems/map.system.ts';
import { updateStreamingWorldWindow } from '../src/systems/map/chunk_streaming.ts';
import { processMoveIntent } from '../src/systems/movement.system.ts';
import { displaceEntityAlongVector } from '../src/systems/movement_displacement.ts';
import type { CampaignData } from '../src/types/campaign.types.ts';
import { ComponentType, type PositionComponent } from '../src/types/components.types.ts';
import type { GameState } from '../src/types/game-state.types.ts';
import { IntentType } from '../src/types/intents/intent.enum.ts';
import { packWorldCoord3D, toSpatialKey, unpackWorldCoord3D } from '../src/utils/grid.ts';
import { buildGameState, loadCampaignFromDisk } from './helpers.ts';

function buildStateForArea(campaign: CampaignData, areaId: string): GameState {
  const customCampaign: CampaignData = {
    ...campaign,
    rules: {
      ...campaign.rules,
      map: {
        ...campaign.rules.map,
        startingAreaId: areaId
      }
    }
  };
  return buildGameState(customCampaign);
}

afterEach(() => {
  resetInMemoryChunkStore();
});

describe('Milestone 176: True Multi-Z Voxel Space, Ramps/Stairs & Gravity/Falling', () => {
  it('packs/unpacks signed 3D chunk coordinates cleanly across negative and positive cz', () => {
    const coords = [
      { x: 0, y: 0, z: 0 },
      { x: -12, y: 45, z: -2 },
      { x: 1024, y: -900, z: 7 },
      { x: -5000, y: -321, z: -15 }
    ];
    for (const c of coords) {
      const packed = packWorldCoord3D(c.x, c.y, c.z);
      const unpacked = unpackWorldCoord3D(packed);
      expect(unpacked).toEqual(c);
    }
  });

  it('isolates ECS spatialIndex by (x, y, z) and maintains multi-Z footprints cleanly', () => {
    const campaign = loadCampaignFromDisk('default');
    const state0 = buildStateForArea(campaign, 'watchtower_overlook');

    const [s1, upperId] = spawnEntity(state0, 'goblin', 3, 3, undefined, undefined, 1);
    const [s2, lowerId] = spawnEntity(s1, 'goblin', 3, 3, undefined, undefined, -1);
    let state = s2;

    expect(toSpatialKey(3, 3, 1)).toBe('3,3,1');
    expect(getEntitiesAtPosition(state, 3, 3, 1)).toContain(upperId);
    expect(getEntitiesAtPosition(state, 3, 3, 1)).not.toContain(lowerId);
    expect(getEntitiesAtPosition(state, 3, 3, 0)).not.toContain(upperId);
    expect(getEntitiesAtPosition(state, 3, 3, -1)).toContain(lowerId);

    // Move upper entity down to z = 0 and verify index cleanliness
    state = addComponent(state, upperId, {
      type: ComponentType.Position,
      x: 3,
      y: 3,
      z: 0
    });
    state = updateSpatialIndex(state, upperId, { x: 3, y: 3, z: 1 });
    expect(getEntitiesAtPosition(state, 3, 3, 1)).not.toContain(upperId);
    expect(getEntitiesAtPosition(state, 3, 3, 0)).toContain(upperId);
  });

  it('parses watchtower_overlook multi-Z zLevels and allows < / > stairs, seamless ramps, and falling across open_air', () => {
    const campaign = loadCampaignFromDisk('default');
    const generated = generateArea(campaign, 'watchtower_overlook');
    expect(isMultiZMap(generated.map)).toBe(true);
    expect(getMapZBounds(generated.map)).toEqual({ minZ: -1, maxZ: 1 });

    // Parapet open_air on z=1, wooden_stairs_down 'D' at (9, 2, 1), stone_ramp '/' at (7, 3, 0) -> (8, 3, 1)
    expect(getTileAt(generated.map, 2, 2, 1)?.tileId).toBe('open_air');
    expect(getTileAt(generated.map, 9, 2, 1)?.tileId).toBe('wooden_stairs_down');
    expect(getTileAt(generated.map, 7, 3, 0)?.tileId).toBe('stone_ramp');

    let state = buildStateForArea(campaign, 'watchtower_overlook');
    const [s1, climberId] = spawnEntity(state, 'goblin', 9, 2, undefined, undefined, 0);
    state = addComponent(s1, climberId, {
      type: ComponentType.Player,
      name: 'Climber',
      visionRadius: 8
    });
    state = updateSpatialIndex(state, climberId);

    // Climb up stairs at (9, 2, 0) -> (9, 2, 1)
    const climbRes = processMoveIntent(state, {
      type: IntentType.Move,
      entityId: climberId,
      dx: 0,
      dy: 0,
      dz: 1
    });
    expect(climbRes.success).toBe(true);
    let pos = getComponent(climbRes.state, climberId, ComponentType.Position) as PositionComponent;
    expect(pos.z).toBe(1);

    // Standing on stairs_down-only tile at (2, 2, 0) and pressing < (dz: +1) is rejected (directionality check)
    const wrongWayState = addComponent(climbRes.state, climberId, {
      type: ComponentType.Position,
      x: 2,
      y: 2,
      z: 0
    });
    const wrongWayRes = processMoveIntent(updateSpatialIndex(wrongWayState, climberId), {
      type: IntentType.Move,
      entityId: climberId,
      dx: 0,
      dy: 0,
      dz: 1
    });
    expect(wrongWayRes.success).toBe(false);

    // Position on balcony edge at (9, 4, 1), voluntary step south onto open_air (9, 5, 1) is guarded
    state = addComponent(climbRes.state, climberId, {
      type: ComponentType.Position,
      x: 9,
      y: 4,
      z: 1
    });
    state = updateSpatialIndex(state, climberId, { x: 9, y: 2, z: 1 });

    const stepIntoOpenAir = processMoveIntent(state, {
      type: IntentType.Move,
      entityId: climberId,
      dx: 0,
      dy: 1
    });
    expect(stepIntoOpenAir.success).toBe(false);

    // Forced push south off balcony edge (9, 4, 1) -> (9, 5, 1) drops victim to z=0 via gravity and halts as hazard
    const pushedOffRes = displaceEntityAlongVector({
      state,
      entityId: climberId,
      maxSteps: 2,
      dx: 0,
      dy: 1,
      context: { mode: 'forced_push', isForced: true, provokesAoO: false }
    });
    expect(pushedOffRes.moved).toBe(true);
    expect(pushedOffRes.stopReason).toBe('hazard_halted');
    const pushedPos = getComponent(pushedOffRes.state, climberId, ComponentType.Position) as PositionComponent;
    expect(pushedPos.x).toBe(9);
    expect(pushedPos.y).toBe(5);
    expect(pushedPos.z ?? 0).toBe(0);

    // Climbing/dropping down stair shaft at (9, 2, 1) -> (9, 2, 0) works cleanly with dz: -1
    state = addComponent(state, climberId, {
      type: ComponentType.Position,
      x: 9,
      y: 2,
      z: 1
    });
    state = updateSpatialIndex(state, climberId, { x: 9, y: 4, z: 1 });
    const descendStairs = processMoveIntent(state, {
      type: IntentType.Move,
      entityId: climberId,
      dx: 0,
      dy: 0,
      dz: -1
    });
    expect(descendStairs.success).toBe(true);
    pos = getComponent(descendStairs.state, climberId, ComponentType.Position) as PositionComponent;
    expect(pos.z ?? 0).toBe(0);

    // Direct gravity check over open_air at (3, 2, 1) -> drops onto (3, 2, 0)
    const [sRamp, walkerId] = spawnEntity(descendStairs.state, 'goblin', 3, 2, undefined, undefined, 1);
    const manualFallCheck = resolveGravityForEntity(sRamp, walkerId);
    expect(manualFallCheck.fellLevels).toBe(1);
    expect(manualFallCheck.finalZ).toBe(0);

    // Actual watchtower_overlook ramp ascent (7, 3, 0) -> (8, 3, 1) and descent (8, 3, 1) -> (7, 3, 0)
    let rampState = addComponent(sRamp, walkerId, {
      type: ComponentType.Position,
      x: 7,
      y: 3,
      z: 0
    });
    rampState = updateSpatialIndex(rampState, walkerId, { x: 3, y: 2, z: 1 });
    const ascendRes = processMoveIntent(rampState, {
      type: IntentType.Move,
      entityId: walkerId,
      dx: 1,
      dy: 0
    });
    expect(ascendRes.success).toBe(true);
    const ascendedPos = getComponent(ascendRes.state, walkerId, ComponentType.Position) as PositionComponent;
    expect(ascendedPos).toMatchObject({ x: 8, y: 3, z: 1 });

    const descendRampRes = processMoveIntent(ascendRes.state, {
      type: IntentType.Move,
      entityId: walkerId,
      dx: -1,
      dy: 0
    });
    expect(descendRampRes.success).toBe(true);
    const descendedPos = getComponent(descendRampRes.state, walkerId, ComponentType.Position) as PositionComponent;
    expect(descendedPos.x).toBe(7);
    expect(descendedPos.y).toBe(3);
    expect(descendedPos.z ?? 0).toBe(0);
  });

  it('preserves coordinates on first area entry with preserveCoords and resets cameraZOffset on area change', () => {
    const campaign = loadCampaignFromDisk('default');
    let state = buildStateForArea(campaign, 'outer_crossroads');
    state = { ...state, cameraZOffset: 1 };
    const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined)!;

    const transition = processChangeAreaIntent(state, {
      type: IntentType.ChangeArea,
      entityId: playerId,
      targetAreaId: 'watchtower_overlook',
      targetX: 5,
      targetY: 5,
      targetZ: -1
    });
    expect(transition.success).toBe(true);
    expect(transition.state.cameraZOffset).toBe(0);
    const landedPos = getComponent(transition.state, playerId, ComponentType.Position) as PositionComponent;
    expect(landedPos.x).toBe(5);
    expect(landedPos.y).toBe(5);
    expect(landedPos.z).toBe(-1);
  });

  it('streams and delta-persists non-zero Z chunks cleanly in endless_frontier', async () => {
    clearChunkStoreScope('test_m176_z_persist');
    const campaign = loadCampaignFromDisk('default');
    let state = buildStateForArea(campaign, 'endless_frontier');
    expect(isMultiZMap(state.map)).toBe(true);
    expect(getMapZBounds(state.map)).toEqual({ minZ: -2, maxZ: 2 });

    // Modify a subterranean tile at z = -1 and flush dirty chunk delta
    state = { ...state, map: setTileIdAt(state.map, 4, 4, 'stone_floor', -1) };
    await flushDirtyChunksToStore(state, 'test_m176_z_persist');

    const delta = await loadWorldChunkDelta('test_m176_z_persist', 'endless_frontier', 0, 0, -1);
    expect(delta).not.toBeNull();
    expect(delta?.cz).toBe(-1);

    const saved = serializeGameState(state);
    const parsed = deserializeGameState(saved, state.campaign, 'test_m176_z_persist');
    const rehydrated = await rehydrateStreamingWorldAsync(parsed, 'test_m176_z_persist');
    const streamed = updateStreamingWorldWindow(rehydrated, 0, 0, { originZ: 0 });
    expect(getTileAt(streamed.map, 4, 4, -1)?.tileId).toBe('stone_floor');
  });

  it('validates preserveCoords and vertical stair alignment warnings in area validator', async () => {
    const campaign = loadCampaignFromDisk('default');
    const misAlignedCampaign: CampaignData = {
      ...campaign,
      areas: {
        ...campaign.areas,
        broken_shaft_test: {
          ...campaign.areas['watchtower_overlook']!,
          id: 'broken_shaft_test',
          connections: [],
          placedEntities: [],
          staticMap: {
            ...campaign.areas['watchtower_overlook']!.staticMap!,
            layout: ['####', '##.#', '#..#', '####'],
            zLevels: {
              '1': ['####', '#D.#', '#..#', '####']
            }
          }
        }
      }
    };
    const errors = await validateAreas(misAlignedCampaign);
    const shaftWarning = errors.find(
      (e) => e.path.includes('/areas/broken_shaft_test/') && e.message.includes('directly above solid tile')
    );
    expect(shaftWarning).toBeDefined();
    expect(shaftWarning?.severity).toBe('warning');
  });
});
