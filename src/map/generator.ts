import * as ROT from 'rot-js';
import { type GameMap, type Tile } from '../types/game-state.types.ts';
import { coordToIndex } from '../utils/grid.ts';
import { type CampaignData, type AreaConnection } from '../types/campaign.types.ts';
import { parseStaticMap } from './static-parser.ts';
import { runEncounterDirector, type DirectorContext, type DirectorReceipt } from './encounter_director.ts';

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
    | ReadonlyArray<{ readonly templateId: string; readonly x: number; readonly y: number }>
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

  // 2. Create the digger generator
  // ROT.Map.Digger internally queries the global ROT.RNG instance (which we configured in core/rng.ts)
  const digger = new ROT.Map.Digger(width, height, {
    roomWidth: [rules.minRoomWidth, rules.maxRoomWidth],
    roomHeight: [rules.minRoomHeight, rules.maxRoomHeight],
    corridorLength: [rules.minCorridorLength, rules.maxCorridorLength],
    dugPercentage: rules.dugPercentage
  });

  // 3. Dig the dungeon!
  digger.create((x: number, y: number, value: number) => {
    // value === 0 means empty space (floor/corridor)
    if (value === 0) {
      const index = coordToIndex(x, y, width);
      const tile = tiles[index];
      if (tile !== undefined) {
        tiles[index] = {
          ...tile,
          tileId: palette.floor
        };
      }
    }
  });

  // 4. Get generated rooms to place stairs and find start position
  const rooms = digger.getRooms();
  if (rooms.length === 0) {
    throw new Error('Dungeon generation failed: No rooms were created.');
  }

  // First room is the player's entry point
  const firstRoom = rooms[0];
  if (firstRoom === undefined) {
    throw new Error('Dungeon generation failed: First room is undefined.');
  }
  const [startX, startY] = firstRoom.getCenter();
  if (startX === undefined || startY === undefined) {
    throw new Error('Dungeon generation failed: Start position coordinates are undefined.');
  }

  const portals: Array<{ x: number; y: number; connection: AreaConnection }> = [];
  const portalRoomIndices = new Set<number>();

  if (areaDef.connections) {
    areaDef.connections.forEach((conn, index) => {
      const roomIndex = index % rooms.length;
      portalRoomIndices.add(roomIndex);
      const room = rooms[roomIndex];
      if (room) {
        const [px, py] = room.getCenter();
        const pIndex = coordToIndex(px!, py!, width);
        const tile = tiles[pIndex];
        if (tile) {
          tiles[pIndex] = { ...tile, tileId: palette.floor };
          portals.push({ x: px!, y: py!, connection: conn });
        }
      }
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
        // Scatter some shallow water
        if (ROT.RNG.getUniform() < 0.05) {
          // 5% chance for a floor tile to be water
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

  const finalPlacedEntities = areaDef.placedEntities ? [...areaDef.placedEntities] : [];

  const parsedRooms = rooms.map((r, index) => {
    // Mark room 0 (start pos) and any room with a portal as a "safe" room
    // to prevent the Encounter Director from dropping hazards or bosses directly on the player
    const isSafe = index === 0 || portalRoomIndices.has(index);

    r.getDoors((x: number, y: number) => {
      const idx = coordToIndex(x, y, width);
      const tile = tiles[idx];
      if (tile) {
        // Place floor underneath
        tiles[idx] = { ...tile, tileId: palette.floor };
        // Place door entity
        finalPlacedEntities.push({ templateId: palette.door, x, y });
      }
    });

    const center = r.getCenter();
    return {
      left: r.getLeft(),
      right: r.getRight(),
      top: r.getTop(),
      bottom: r.getBottom(),
      centerX: center[0]!,
      centerY: center[1]!,
      isSafe
    };
  });

  const directorResult = runEncounterDirector(campaign, areaDef, map, parsedRooms, finalPlacedEntities, context);

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
