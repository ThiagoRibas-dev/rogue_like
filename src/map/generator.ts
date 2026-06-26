import * as ROT from 'rot-js';
import { type AreaConnection, type CampaignData } from '../types/campaign.types.ts';
import { type EntityId, type GameMap, type Tile } from '../types/game-state.types.ts';
import { coordToIndex } from '../utils/grid.ts';
import { runEncounterDirector, type DirectorContext, type DirectorReceipt } from './encounter_director.ts';
import { parseStaticMap } from './static-parser.ts';
import {
  DIJKSTRA_TOPOLOGY,
  DEFAULT_HOT_PATH_RADIUS,
  CELLULAR_HOT_PATH_RADIUS_DENOMINATOR,
  MIN_CELLULAR_HOT_PATH_RADIUS
} from '../constants/spawning.constants.ts';

/**
 * Output data resulting from map generation, containing tiles, portals, rooms, and entities.
 */
export interface GeneratedArea {
  readonly map: GameMap;
  readonly startPos: { readonly x: number; readonly y: number };
  readonly portals: ReadonlyArray<{ readonly x: number; readonly y: number; readonly connection: AreaConnection }>;
  readonly rooms: ReadonlyArray<{
    readonly left: number;
    readonly right: number;
    readonly top: number;
    readonly bottom: number;
    readonly centerX: number;
    readonly centerY: number;
  }>;
  readonly placedEntities?:
    | ReadonlyArray<{
        readonly templateId: string;
        readonly x: number;
        readonly y: number;
        readonly dynamicTraits?: ReadonlyArray<string> | undefined;
        readonly inventory?: ReadonlyArray<string> | undefined;
        readonly preExistingEntityId?: EntityId | undefined;
      }>
    | undefined;
  readonly directorReceipt?: DirectorReceipt | undefined;
}

/**
 * Generates an area map based on its definition using ROT.js.
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

  const rules = campaign.rules.map;
  const width = rules.width;
  const height = rules.height;

  const palette = areaDef.proceduralPalette || {
    wall: 'stone_wall',
    floor: 'stone_floor',
    door: 'wooden_door',
    water: 'shallow_water'
  };

  // 1. Initialize empty flat array of tiles filled with walls
  const tiles: Tile[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      tiles.push({
        tileId: palette.wall,
        x,
        y,
        explored: false
      });
    }
  }

  let startX = -1;
  let startY = -1;
  const portals: Array<{ x: number; y: number; connection: AreaConnection }> = [];

  type PlacedEntityDef = {
    templateId: string;
    x: number;
    y: number;
    dynamicTraits?: ReadonlyArray<string> | undefined;
    inventory?: ReadonlyArray<string> | undefined;
  };
  const finalPlacedEntities: PlacedEntityDef[] = areaDef.placedEntities ? [...areaDef.placedEntities] : [];

  let parsedRooms: Array<{
    readonly left: number;
    readonly right: number;
    readonly top: number;
    readonly bottom: number;
    readonly centerX: number;
    readonly centerY: number;
    readonly isSafe?: boolean;
    readonly tags?: string[];
  }> = [];

  if (areaDef.generatorType === 'cellular') {
    // 2a. Cellular Generator
    const cellular = new ROT.Map.Cellular(width, height);
    cellular.randomize(0.5);
    for (let i = 0; i < 4; i++) {
      cellular.create();
    }

    cellular.connect((x: number, y: number, value: number) => {
      if (value === 0) {
        // 0 is empty space in ROT.js cellular topological connections
        const index = coordToIndex(x, y, width);
        const tile = tiles[index];
        if (tile !== undefined) {
          tiles[index] = { ...tile, tileId: palette.floor };
        }
      }
    }, 0);

    // 3a. Collect floor tiles to pick start position and portals
    const floorCoords: Array<{ x: number; y: number }> = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = coordToIndex(x, y, width);
        if (tiles[idx] && tiles[idx].tileId === palette.floor) {
          floorCoords.push({ x, y });
        }
      }
    }

    if (floorCoords.length === 0) {
      throw new Error('Cellular generation failed: No floor tiles were created.');
    }

    const startTile = ROT.RNG.getItem(floorCoords)!;
    startX = startTile.x;
    startY = startTile.y;

    if (areaDef.connections) {
      areaDef.connections.forEach((conn) => {
        const pt = ROT.RNG.getItem(floorCoords)!;
        portals.push({ x: pt.x, y: pt.y, connection: conn });
      });
    }
  } else {
    // 2b. Digger Generator
    const digger = new ROT.Map.Digger(width, height, {
      roomWidth: [rules.minRoomWidth, rules.maxRoomWidth],
      roomHeight: [rules.minRoomHeight, rules.maxRoomHeight],
      corridorLength: [rules.minCorridorLength, rules.maxCorridorLength],
      dugPercentage: rules.dugPercentage
    });

    digger.create((x: number, y: number, value: number) => {
      if (value === 0) {
        const index = coordToIndex(x, y, width);
        const tile = tiles[index];
        if (tile !== undefined) {
          tiles[index] = { ...tile, tileId: palette.floor };
        }
      }
    });

    const rooms = digger.getRooms();
    if (rooms.length === 0) throw new Error('Dungeon generation failed: No rooms were created.');

    const firstRoom = rooms[0];
    if (firstRoom === undefined) throw new Error('Dungeon generation failed: First room is undefined.');

    const center = firstRoom.getCenter();
    startX = center[0]!;
    startY = center[1]!;

    const portalRoomIndices = new Set<number>();
    if (areaDef.connections) {
      areaDef.connections.forEach((conn, index) => {
        let roomIndex = index % rooms.length;

        if (conn.direction === 'portal' || conn.direction === 'edge') {
          const side = conn.placementSide || 'any';
          if (side !== 'any') {
            let bestIndex = roomIndex;
            let bestScore = -Infinity;
            rooms.forEach((r, idx) => {
              const score =
                side === 'top'
                  ? -r.getTop()
                  : side === 'bottom'
                    ? r.getBottom()
                    : side === 'left'
                      ? -r.getLeft()
                      : side === 'right'
                        ? r.getRight()
                        : 0;
              const noisyScore = score + ROT.RNG.getUniform();
              if (noisyScore > bestScore) {
                bestScore = noisyScore;
                bestIndex = idx;
              }
            });
            roomIndex = bestIndex;
          }
        }

        portalRoomIndices.add(roomIndex);
        const room = rooms[roomIndex];
        if (room) {
          let px: number, py: number;

          if (conn.direction === 'portal' || conn.direction === 'edge') {
            const side = conn.placementSide || 'any';
            const candidates: Array<{ x: number; y: number }> = [];
            const rLeft = room.getLeft();
            const rRight = room.getRight();
            const rTop = room.getTop();
            const rBottom = room.getBottom();

            for (let wx = rLeft - 1; wx <= rRight + 1; wx++) {
              for (let wy = rTop - 1; wy <= rBottom + 1; wy++) {
                // Ensure we do not place portal on the absolute edge of the map to prevent index errors
                if (wx > 0 && wx < width - 1 && wy > 0 && wy < height - 1) {
                  const isTopWall = wy === rTop - 1 && wx >= rLeft && wx <= rRight;
                  const isBottomWall = wy === rBottom + 1 && wx >= rLeft && wx <= rRight;
                  const isLeftWall = wx === rLeft - 1 && wy >= rTop && wy <= rBottom;
                  const isRightWall = wx === rRight + 1 && wy >= rTop && wy <= rBottom;

                  let validWall = false;
                  if (side === 'top' && isTopWall) validWall = true;
                  else if (side === 'bottom' && isBottomWall) validWall = true;
                  else if (side === 'left' && isLeftWall) validWall = true;
                  else if (side === 'right' && isRightWall) validWall = true;
                  else if (side === 'any' && (isTopWall || isBottomWall || isLeftWall || isRightWall)) validWall = true;

                  if (validWall) {
                    candidates.push({ x: wx, y: wy });
                  }
                }
              }
            }

            if (candidates.length > 0) {
              const chosen = ROT.RNG.getItem(candidates)!;
              px = chosen.x;
              py = chosen.y;
            } else {
              const center = room.getCenter();
              px = center[0]!;
              py = center[1]!;
            }
          } else {
            const center = room.getCenter();
            px = center[0]!;
            py = center[1]!;
          }

          const pIndex = coordToIndex(px, py, width);
          const tile = tiles[pIndex];
          if (tile) {
            tiles[pIndex] = { ...tile, tileId: palette.floor };
            portals.push({ x: px, y: py, connection: conn });
          }
        }
      });
    }

    const subBiomeEntries = areaDef.subBiomes ? Object.entries(areaDef.subBiomes) : [];
    parsedRooms = rooms.map((r, index) => {
      const isSafe = index === 0 || portalRoomIndices.has(index);

      r.getDoors((dx: number, dy: number) => {
        const idx = coordToIndex(dx, dy, width);
        const tile = tiles[idx];
        if (tile) {
          tiles[idx] = { ...tile, tileId: palette.floor };
          finalPlacedEntities.push({ templateId: palette.door, x: dx, y: dy });
        }
      });

      const roomTags: string[] = [];
      if (!isSafe && subBiomeEntries.length > 0) {
        for (const [tag, probability] of subBiomeEntries) {
          if (ROT.RNG.getUniform() < probability) roomTags.push(tag);
        }
      }

      const roomCenter = r.getCenter();
      const baseRoom = {
        left: r.getLeft(),
        right: r.getRight(),
        top: r.getTop(),
        bottom: r.getBottom(),
        centerX: roomCenter[0]!,
        centerY: roomCenter[1]!,
        isSafe
      };
      return roomTags.length > 0 ? { ...baseRoom, tags: roomTags } : baseRoom;
    });
  }

  // 5. Cull deep walls (replace walls that don't border a floor with empty_space)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = coordToIndex(x, y, width);
      const tile = tiles[idx];
      if (tile && tile.tileId === palette.wall) {
        let bordersFloor = false;
        // Check 8 neighbors
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              const nIdx = coordToIndex(nx, ny, width);
              if (tiles[nIdx]?.tileId === palette.floor || tiles[nIdx]?.tileId === palette.water) {
                bordersFloor = true;
                break;
              }
            }
          }
          if (bordersFloor) break;
        }
        if (!bordersFloor) {
          tiles[idx] = { ...tile, tileId: 'empty_space' };
        }
      } else if (tile && tile.tileId === palette.floor) {
        // Scatter some shallow water at data-driven probability
        if (ROT.RNG.getUniform() < rules.waterScatterChance) {
          tiles[idx] = { ...tile, tileId: palette.water };
        }
      }
    }
  }

  const map: GameMap = {
    width,
    height,
    tiles
  };

  // Compute Hot Path from starting position to all portals
  const hotPathCoords = new Set<string>();

  if (portals.length > 0) {
    const passableCallback = (x: number, y: number) => {
      const idx = coordToIndex(x, y, width);
      const tile = tiles[idx];
      return tile !== undefined && (tile.tileId === palette.floor || tile.tileId === palette.water);
    };

    // Determine thickness radius based on data override or biome/generator heuristic fallback
    const radius =
      areaDef.hotPathRadius ??
      (areaDef.generatorType === 'cellular'
        ? Math.max(
            MIN_CELLULAR_HOT_PATH_RADIUS,
            Math.floor(Math.min(width, height) / CELLULAR_HOT_PATH_RADIUS_DENOMINATOR)
          )
        : DEFAULT_HOT_PATH_RADIUS);

    for (const portal of portals) {
      const dijkstra = new ROT.Path.Dijkstra(portal.x, portal.y, passableCallback, { topology: DIJKSTRA_TOPOLOGY });
      dijkstra.compute(startX, startY, (x, y) => {
        // Expand coordinates within the calculated radius/thickness
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              hotPathCoords.add(`${nx},${ny}`);
            }
          }
        }
      });
    }
  }

  const effectiveContext: DirectorContext = {
    playerLevel: context?.playerLevel ?? 1,
    tokenPool: context?.tokenPool ?? new Set<string>(),
    areaMutation: context?.areaMutation,
    reservedTokens: context?.reservedTokens,
    hotPathCoords
  };

  const directorResult = runEncounterDirector(
    campaign,
    areaDef,
    map,
    parsedRooms,
    finalPlacedEntities,
    effectiveContext
  );

  if (directorResult.newEntities.length > 0) {
    finalPlacedEntities.push(...directorResult.newEntities);
  }

  return {
    map,
    startPos: { x: startX, y: startY },
    portals,
    rooms: parsedRooms,
    placedEntities: finalPlacedEntities.length > 0 ? finalPlacedEntities : undefined,
    directorReceipt: directorResult.receipt
  };
}
