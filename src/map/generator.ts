import { type CampaignData } from '../types/campaign.types.ts';
import { type GameMap } from '../types/game-state.types.ts';
import { runEncounterDirector } from './encounter_director.ts';
import type { DirectorContext } from '../types/encounter.types.ts';
import type { GeneratedArea } from '../types/generation.types.ts';
import { parseStaticMap } from './static-parser.ts';
import { createInitialStreamingGrid } from './chunk_generator.ts';
import {
  resolvePalette,
  carveBaseGeometry,
  carveRoomsAndPortals,
  applyBiomesAndCull,
  computeHotPathDijkstra,
  type PlacedEntityDef
} from './generator_stages.ts';

export type { GeneratedArea };

/**
 * Generates an area map based on its definition using modular generator stages.
 */
export function generateArea(campaign: CampaignData, areaId: string, context?: DirectorContext): GeneratedArea {
  const areaDef = campaign.areas[areaId];
  if (!areaDef) {
    throw new Error(`Area ${areaId} not found in campaign.`);
  }

  if (areaDef.generatorType === 'static' && areaDef.staticMap) {
    const { map, parsedEntities } = parseStaticMap(areaDef.staticMap);
    const portals = (areaDef.connections ?? []).map((conn, idx) => ({
      x: conn.placementX ?? 1 + idx,
      y: conn.placementY ?? 1,
      ...(conn.placementZ !== undefined ? { z: conn.placementZ } : {}),
      connection: conn
    }));
    return {
      map,
      startPos: { x: Math.floor(map.width / 2), y: Math.floor(map.height / 2) },
      portals,
      rooms: [],
      placedEntities: [...(areaDef.placedEntities || []), ...parsedEntities]
    };
  }

  if (areaDef.generatorType === 'streaming_overworld') {
    const chunkGrid = createInitialStreamingGrid(campaign, areaDef, 0, 0);
    const portals = (areaDef.connections ?? []).map((conn, idx) => ({
      x: conn.placementX ?? idx + 1,
      y: conn.placementY ?? 0,
      ...(conn.placementZ !== undefined ? { z: conn.placementZ } : {}),
      connection: conn
    }));
    return {
      map: {
        width: 0,
        height: 0,
        tiles: [],
        minZ: chunkGrid.minZ,
        maxZ: chunkGrid.maxZ,
        chunkGrid
      },
      startPos: { x: 0, y: 0 },
      portals,
      rooms: [],
      placedEntities: areaDef.placedEntities
    };
  }

  const rules = campaign.rules.map;
  const width = rules.width;
  const height = rules.height;
  const palette = resolvePalette(areaDef);

  // Stage 1: Base geometry carving
  const baseCarve = carveBaseGeometry(areaDef, width, height, palette, rules);

  // Stage 2: Rooms and portals carving
  const portalsResult = carveRoomsAndPortals(areaDef, width, height, palette, baseCarve.tiles, baseCarve.diggerRooms);

  // Stage 3: Biomes partitioning, wall culling, and water scatter (protecting start & portal tiles)
  const protectedCoords = new Set<string>([`${portalsResult.startPos.x},${portalsResult.startPos.y}`]);
  for (const p of portalsResult.portals) {
    protectedCoords.add(`${p.x},${p.y}`);
  }
  const rooms = applyBiomesAndCull(
    areaDef,
    width,
    height,
    palette,
    baseCarve.tiles,
    portalsResult.rooms,
    rules.waterScatterChance,
    protectedCoords
  );

  const map: GameMap = {
    width,
    height,
    tiles: baseCarve.tiles
  };

  // Stage 4: Hot-path Dijkstra computation
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

  const effectiveContext: DirectorContext = {
    playerLevel: context?.playerLevel ?? 1,
    tokenPool: context?.tokenPool ?? new Set<string>(),
    areaMutation: context?.areaMutation,
    reservedTokens: context?.reservedTokens,
    hotPathCoords
  };

  // Stage 5: Encounter ecology synthesis
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

  return {
    map,
    startPos: portalsResult.startPos,
    portals: portalsResult.portals,
    rooms,
    placedEntities: finalPlacedEntities.length > 0 ? finalPlacedEntities : undefined,
    directorReceipt: directorResult.receipt
  };
}
