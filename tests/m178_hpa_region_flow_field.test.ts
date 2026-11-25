import { beforeEach, describe, expect, it } from 'bun:test';
import {
  clearFlowFieldCache,
  computeOrGetFlowField,
  lookupFlowFieldStep,
  resolveHpaIntermediateWaypoint
} from '../src/ai/flow_field.ts';
import { followBehavior } from '../src/ai/follow.behavior.ts';
import { computeHierarchicalNextStep } from '../src/ai/pathfinding_hpa.ts';
import { addComponent, getComponent, spawnEntity, updateSpatialIndex } from '../src/core/ecs.ts';
import { getTileDefAt, isInMapBounds, setTileIdAt } from '../src/map/map_accessor.ts';
import {
  buildOrUpdateRegionGraph,
  clearRegionGraphCache,
  getRegionKeyAt,
  isRegionGraphDirty
} from '../src/map/region_graph.ts';
import { syncStructuralDoorState } from '../src/systems/durability.system.ts';
import type { CampaignData } from '../src/types/campaign.types.ts';
import { ComponentType } from '../src/types/components.types.ts';
import type { GameState } from '../src/types/game-state.types.ts';
import { IntentType } from '../src/types/intents/intent.enum.ts';
import { packWorldCoord3D } from '../src/utils/grid.ts';
import { buildGameState, deepFreezeGameState, loadCampaignFromDisk } from './helpers.ts';

function buildWatchtowerState(campaign: CampaignData): GameState {
  return buildGameState({
    ...campaign,
    rules: {
      ...campaign.rules,
      map: {
        ...campaign.rules.map,
        startingAreaId: 'watchtower_overlook'
      }
    }
  });
}

beforeEach(() => {
  clearRegionGraphCache();
  clearFlowFieldCache();
});

describe('Milestone 178: HPA* 3D Region Pathfinding & Shared Dijkstra Flow Fields', () => {
  it('partitions multi-Z strata into connected regions linked by vertical stair/ramp portals and detects islands', () => {
    const campaign = loadCampaignFromDisk('default');
    const state = buildWatchtowerState(campaign);

    const graph = buildOrUpdateRegionGraph(state);
    const groundRegion = getRegionKeyAt(graph, 3, 4, 0);
    const rooftopRegion = getRegionKeyAt(graph, 10, 2, 1);
    const cellarRegion = getRegionKeyAt(graph, 4, 3, -1);

    expect(groundRegion).toBeDefined();
    expect(rooftopRegion).toBeDefined();
    expect(cellarRegion).toBeDefined();
    expect(groundRegion).not.toBe(rooftopRegion);

    // Seal a 1x1 stone_floor pocket surrounded by stone_wall -> verify O(1) region isolation / zero portal edges
    let isolatedMap = setTileIdAt(state.map, 1, 1, 'stone_floor', 0);
    isolatedMap = setTileIdAt(isolatedMap, 2, 1, 'stone_wall', 0);
    isolatedMap = setTileIdAt(isolatedMap, 1, 2, 'stone_wall', 0);
    isolatedMap = setTileIdAt(isolatedMap, 2, 2, 'stone_wall', 0);
    clearRegionGraphCache();
    const isolatedGraph = buildOrUpdateRegionGraph({ ...state, map: isolatedMap });
    const pocketRegion = getRegionKeyAt(isolatedGraph, 1, 1, 0);
    expect(pocketRegion).toBeDefined();
    expect(pocketRegion).not.toBe(getRegionKeyAt(isolatedGraph, 3, 4, 0));
    expect((isolatedGraph.regionToNodes.get(pocketRegion!) ?? []).length).toBe(0);
  });

  it('routes across vertical Z stairs via HPA* and bounded 3D A* and shares cached Dijkstra flow fields', () => {
    const campaign = loadCampaignFromDisk('default');
    const state = buildWatchtowerState(campaign);

    // Shared flow field cache hit check for two actors targeting rooftop (10, 2, 1)
    const fieldA = computeOrGetFlowField(state, 10, 2, 1);
    const fieldB = computeOrGetFlowField(state, 10, 2, 1);
    expect(fieldB).toBe(fieldA);

    // Actor standing at base of stairs (9, 2, 0) steps up to (9, 2, 1)
    const stepFromStairs = lookupFlowFieldStep(state, 9, 2, 0, 10, 2, 1);
    expect(stepFromStairs).not.toBeNull();
    expect(stepFromStairs?.dz).toBe(1);

    // HPA* cross-Z routing from east foyer (10, 2, 0) up stairs at (9, 2, 0->1) to rooftop (10, 2, 1)
    const isPassable = (nx: number, ny: number, nz: number, px: number, py: number, pz: number): boolean => {
      if (!isInMapBounds(state.map, nx, ny, nz)) return false;
      const def = getTileDefAt(state, nx, ny, nz);
      if (!def) return false;
      if (nz !== pz) {
        const prevDef = getTileDefAt(state, px, py, pz);
        return prevDef?.verticalLink !== undefined || def.verticalLink !== undefined;
      }
      return def.walkable === true || def.verticalLink !== undefined;
    };

    const waypoint = resolveHpaIntermediateWaypoint(state, 10, 2, 0, 10, 2, 1);
    expect(waypoint).not.toBeNull();

    const firstStep = computeHierarchicalNextStep(state, 10, 2, 0, 10, 2, 1, isPassable);
    expect(firstStep).not.toBeNull();
  });

  it('invalidates cached region graphs and flow fields when a structural door changes state', () => {
    const campaign = loadCampaignFromDisk('default');
    let state = buildWatchtowerState(campaign);

    const initialGraph = buildOrUpdateRegionGraph(state);
    const initialField = computeOrGetFlowField(state, 3, 4, 0);

    const [sDoor, doorId] = spawnEntity(state, 'goblin', 5, 4, undefined, undefined, 0);
    state = addComponent(sDoor, doorId, {
      type: ComponentType.Structural,
      material: 'wood',
      hp: 10,
      maxHp: 10,
      hardness: 5,
      isDoor: true,
      isOpen: false
    });
    state = updateSpatialIndex(state, doorId);

    state = syncStructuralDoorState(state, doorId, {
      type: ComponentType.Structural,
      material: 'wood',
      hp: 10,
      maxHp: 10,
      hardness: 5,
      isDoor: true,
      isOpen: true
    });

    const rebuiltGraph = buildOrUpdateRegionGraph(state);
    const rebuiltField = computeOrGetFlowField(state, 3, 4, 0);
    expect(rebuiltGraph).not.toBe(initialGraph);
    expect(rebuiltField).not.toBe(initialField);
  });

  it('preserves deepFreezeGameState immutability without dirty thrash, blocks flow-field wall leaks, and guides companions up stairs', () => {
    const campaign = loadCampaignFromDisk('default');
    const frontierState = buildGameState({
      ...campaign,
      rules: {
        ...campaign.rules,
        map: {
          ...campaign.rules.map,
          startingAreaId: 'endless_frontier'
        }
      }
    });

    // Deep-frozen finite multi-Z state builds cleanly with zero in-place mutations
    const wtState = buildWatchtowerState(campaign);
    const frozenWtState = deepFreezeGameState(wtState);
    const frozenGraph = buildOrUpdateRegionGraph(frozenWtState);
    expect(frozenGraph.clusters.size).toBeGreaterThan(0);
    expect(isRegionGraphDirty(frozenWtState)).toBe(false);
    expect(buildOrUpdateRegionGraph(frozenWtState)).toBe(frozenGraph);

    // Streaming chunked map: editing a chunk triggers CHUNK_DIRTY_REGION, rebuilds once without mutating chunk.regionId, then stays clean
    const editedMap = setTileIdAt(frontierState.map, 3, 3, 'stone_floor', 0);
    const chunkedState = { ...frontierState, map: editedMap };
    const sampleChunk = Array.from(editedMap.chunkGrid!.chunks.values())[0]!;
    const regionSumBefore = sampleChunk.regionId.reduce((acc, v) => acc + v, 0);
    const g1 = buildOrUpdateRegionGraph(chunkedState);
    expect(g1.clusters.size).toBeGreaterThan(0);
    expect(isRegionGraphDirty(chunkedState)).toBe(false);
    expect(buildOrUpdateRegionGraph(chunkedState)).toBe(g1);
    expect(sampleChunk.regionId.reduce((acc, v) => acc + v, 0)).toBe(regionSumBefore);

    // Watchtower: solid wall beside stairs should NEVER receive flow distances, nor non-ramp diagonal Z steps
    const wtUnfrozen = buildWatchtowerState(campaign);
    const wallField = computeOrGetFlowField(wtUnfrozen, 9, 2, 0);
    // (8, 2, 1) is solid stone_wall directly next to rooftop stair (9, 2, 1) -> must remain unreachable
    expect(wallField.distances.get(packWorldCoord3D(8, 2, 1))).toBeUndefined();
    // Standing at (2, 1, 0) north of stairs_down (2, 2, 0): diagonal-Z step to cellar (2, 2, -1) is illegal
    const illegalDiagStep = lookupFlowFieldStep(wtUnfrozen, 2, 1, 0, 3, 2, -1);
    if (illegalDiagStep) {
      expect(illegalDiagStep.dz ?? 0).toBe(0);
    }

    // Companion directly below controller on (9, 2, 0) while controller is at (10, 2, 1) still follows up stairs even with followDistance=2!
    const playerId = wtUnfrozen.entities.find((id) => getComponent(wtUnfrozen, id, ComponentType.Player) !== undefined)!;
    let compState = addComponent(wtUnfrozen, playerId, {
      type: ComponentType.Position,
      x: 10,
      y: 2,
      z: 1
    });
    const [sComp, compId] = spawnEntity(compState, 'goblin', 9, 2, undefined, undefined, 0);
    compState = addComponent(sComp, compId, {
      type: ComponentType.ControllerLink,
      controllerEntityId: playerId,
      stance: 'aggressive',
      followDistance: 2
    });
    compState = updateSpatialIndex(compState, compId);
    const followIntent = followBehavior(compState, compId, {});
    expect(followIntent).not.toBeNull();
    expect(followIntent?.type).toBe(IntentType.Move);
    if (followIntent?.type === IntentType.Move) {
      expect(followIntent.dz).toBe(1);
    }
  });
});
