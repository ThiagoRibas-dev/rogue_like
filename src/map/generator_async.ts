import * as ROT from 'rot-js';
import type { CampaignData } from '../types/campaign.types.ts';
import type { GameMap } from '../types/game-state.types.ts';
import type { DirectorContext } from '../types/encounter.types.ts';
import { runEncounterDirector } from './encounter_director.ts';
import { parseStaticMap } from './static-parser.ts';
import type { GeneratedArea } from './generator.ts';
import { MapGenStage, MAP_GEN_STAGE_LABELS } from '../constants/scheduler.constants.ts';
import {
  resolvePalette,
  carveBaseGeometry,
  carveRoomsAndPortals,
  applyBiomesAndCull,
  computeHotPathDijkstra,
  type PlacedEntityDef
} from './generator_stages.ts';

/** Progress update emitted by the asynchronous generator pipeline. */
export interface GenerationProgress {
  readonly stage: MapGenStage;
  readonly progress: number; // 0.0 to 1.0
  readonly message: string;
}

/**
 * Asynchronously generates an area map stage-by-stage, yielding progress checkpoints.
 * Strictly snapshots and restores ROT.RNG state across yield boundaries to guarantee determinism.
 */
export function* generateAreaAsync(
  campaign: CampaignData,
  areaId: string,
  context?: DirectorContext
): Generator<GenerationProgress, GeneratedArea, void> {
  const areaDef = campaign.areas[areaId];
  if (!areaDef) {
    throw new Error(`Area ${areaId} not found in campaign.`);
  }

  // Handle static map generation
  if (areaDef.generatorType === 'static' && areaDef.staticMap) {
    let rngState = ROT.RNG.getState();
    yield { stage: MapGenStage.Init, progress: 0.1, message: MAP_GEN_STAGE_LABELS[MapGenStage.Init] };
    ROT.RNG.setState(rngState);

    const { map, parsedEntities } = parseStaticMap(areaDef.staticMap);
    const portals = (areaDef.connections ?? []).map((conn, idx) => ({
      x: conn.placementX ?? 1 + idx,
      y: conn.placementY ?? 1,
      connection: conn
    }));

    rngState = ROT.RNG.getState();
    yield { stage: MapGenStage.Complete, progress: 1.0, message: MAP_GEN_STAGE_LABELS[MapGenStage.Complete] };
    ROT.RNG.setState(rngState);

    return {
      map,
      startPos: { x: Math.floor(map.width / 2), y: Math.floor(map.height / 2) },
      portals,
      rooms: [],
      placedEntities: [...(areaDef.placedEntities || []), ...parsedEntities]
    };
  }

  const rules = campaign.rules.map;
  const width = rules.width;
  const height = rules.height;
  const palette = resolvePalette(areaDef);

  // Stage 1: Init checkpoint
  let rngState = ROT.RNG.getState();
  yield { stage: MapGenStage.Init, progress: 0.1, message: MAP_GEN_STAGE_LABELS[MapGenStage.Init] };
  ROT.RNG.setState(rngState);

  // Stage 2: Base geometry carving
  const baseCarve = carveBaseGeometry(areaDef, width, height, palette, rules);
  rngState = ROT.RNG.getState();
  yield { stage: MapGenStage.Carving, progress: 0.3, message: MAP_GEN_STAGE_LABELS[MapGenStage.Carving] };
  ROT.RNG.setState(rngState);

  // Stage 3: Portals and room boundaries
  const portalsResult = carveRoomsAndPortals(areaDef, width, height, palette, baseCarve.tiles, baseCarve.diggerRooms);
  rngState = ROT.RNG.getState();
  yield { stage: MapGenStage.Portals, progress: 0.5, message: MAP_GEN_STAGE_LABELS[MapGenStage.Portals] };
  ROT.RNG.setState(rngState);

  // Stage 4: Biomes, culling, and water scatter
  const rooms = applyBiomesAndCull(
    areaDef,
    width,
    height,
    palette,
    baseCarve.tiles,
    portalsResult.rooms,
    rules.waterScatterChance
  );
  rngState = ROT.RNG.getState();
  yield { stage: MapGenStage.Biomes, progress: 0.7, message: MAP_GEN_STAGE_LABELS[MapGenStage.Biomes] };
  ROT.RNG.setState(rngState);

  const map: GameMap = {
    width,
    height,
    tiles: baseCarve.tiles
  };

  // Stage 5: Tactical hot-path Dijkstra computation
  const hotPathCoords = computeHotPathDijkstra(
    portalsResult.startPos.x,
    portalsResult.startPos.y,
    portalsResult.portals,
    baseCarve.tiles,
    width,
    height,
    palette,
    areaDef
  );
  rngState = ROT.RNG.getState();
  yield { stage: MapGenStage.Dijkstra, progress: 0.85, message: MAP_GEN_STAGE_LABELS[MapGenStage.Dijkstra] };
  ROT.RNG.setState(rngState);

  const effectiveContext: DirectorContext = {
    playerLevel: context?.playerLevel ?? 1,
    tokenPool: context?.tokenPool ?? new Set<string>(),
    areaMutation: context?.areaMutation,
    reservedTokens: context?.reservedTokens,
    hotPathCoords
  };

  // Stage 6: Encounter ecology synthesis
  const extraOccupiedCoordinates = new Set<string>();
  if (portalsResult.startPos.x >= 0 && portalsResult.startPos.y >= 0) {
    extraOccupiedCoordinates.add(`${portalsResult.startPos.x},${portalsResult.startPos.y}`);
  }
  for (const p of portalsResult.portals) {
    extraOccupiedCoordinates.add(`${p.x},${p.y}`);
  }

  const finalPlacedEntities: PlacedEntityDef[] = [...portalsResult.placedEntities];
  const directorResult = runEncounterDirector(
    campaign,
    areaDef,
    map,
    rooms,
    finalPlacedEntities,
    effectiveContext,
    extraOccupiedCoordinates
  );

  if (directorResult.newEntities.length > 0) {
    finalPlacedEntities.push(...directorResult.newEntities);
  }

  rngState = ROT.RNG.getState();
  yield { stage: MapGenStage.Encounters, progress: 1.0, message: MAP_GEN_STAGE_LABELS[MapGenStage.Complete] };
  ROT.RNG.setState(rngState);

  return {
    map,
    startPos: portalsResult.startPos,
    portals: portalsResult.portals,
    rooms,
    placedEntities: finalPlacedEntities.length > 0 ? finalPlacedEntities : undefined,
    directorReceipt: directorResult.receipt
  };
}
