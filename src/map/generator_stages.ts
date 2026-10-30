import * as ROT from 'rot-js';
import type { AreaConnection, AreaDefinition, CampaignData } from '../types/campaign.types.ts';
import type { Tile } from '../types/game-state.types.ts';
import type { RoomBounds } from '../types/encounter.types.ts';
import { coordToIndex } from '../utils/grid.ts';
import { runDLA } from './dla.ts';
import { applyVoronoiBiomes } from './voronoi.ts';
import {
  DIJKSTRA_TOPOLOGY,
  DEFAULT_HOT_PATH_RADIUS,
  CELLULAR_HOT_PATH_RADIUS_DENOMINATOR,
  MIN_CELLULAR_HOT_PATH_RADIUS
} from '../constants/spawning.constants.ts';

/** Procedural tile palette resolved for an area. */
export interface ResolvedPalette {
  readonly wall: string;
  readonly floor: string;
  readonly door: string;
  readonly water: string;
}

/** Entity placement definition populated during generation stages. */
export interface PlacedEntityDef {
  readonly templateId: string;
  readonly x: number;
  readonly y: number;
  readonly dynamicTraits?: ReadonlyArray<string> | undefined;
  readonly inventory?: ReadonlyArray<string> | undefined;
}

export type DiggerRoom = ReturnType<InstanceType<typeof ROT.Map.Digger>['getRooms']>[number];

/** Result of the initial base geometry carving stage. */
export interface BaseCarveResult {
  readonly tiles: Tile[];
  readonly diggerRooms?: DiggerRoom[] | undefined;
}

/** Result of the room and portal placement stage. */
export interface RoomsAndPortalsResult {
  readonly startPos: { readonly x: number; readonly y: number };
  readonly portals: ReadonlyArray<{ readonly x: number; readonly y: number; readonly connection: AreaConnection }>;
  readonly rooms: ReadonlyArray<RoomBounds>;
  readonly placedEntities: PlacedEntityDef[];
}

/** Resolves procedural tile palette overrides with default stone theme fallback. */
export function resolvePalette(areaDef: AreaDefinition): ResolvedPalette {
  return (
    areaDef.proceduralPalette || {
      wall: 'stone_wall',
      floor: 'stone_floor',
      door: 'wooden_door',
      water: 'shallow_water'
    }
  );
}

/** Carves initial cavern or dungeon boundary geometry into a tile array. */
export function carveBaseGeometry(
  areaDef: AreaDefinition,
  width: number,
  height: number,
  palette: ResolvedPalette,
  rules: CampaignData['rules']['map']
): BaseCarveResult {
  const tiles: Tile[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      tiles.push({ tileId: palette.wall, x, y, explored: false });
    }
  }

  if (areaDef.generatorType === 'cellular') {
    const cellular = new ROT.Map.Cellular(width, height);
    cellular.randomize(0.5);
    for (let i = 0; i < 4; i++) {
      cellular.create();
    }
    cellular.connect((x: number, y: number, value: number) => {
      if (value === 0) {
        const index = coordToIndex(x, y, width);
        const tile = tiles[index];
        if (tile !== undefined) {
          tiles[index] = { ...tile, tileId: palette.floor };
        }
      }
    }, 0);
    return { tiles };
  }

  if (areaDef.generatorType === 'dla') {
    const percentage = areaDef.dlaTargetFloorPercentage ?? 0.3;
    const targetFloorCount = Math.floor(width * height * percentage);
    const dlaFloors = runDLA(width, height, targetFloorCount);
    dlaFloors.forEach((coordStr) => {
      const [xStr, yStr] = coordStr.split(',');
      const x = Number(xStr);
      const y = Number(yStr);
      const index = coordToIndex(x, y, width);
      const tile = tiles[index];
      if (tile !== undefined) {
        tiles[index] = { ...tile, tileId: palette.floor };
      }
    });
    return { tiles };
  }

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
  return { tiles, diggerRooms: rooms };
}

/** Carves portals, resolves start position, and extracts room boundaries. */
export function carveRoomsAndPortals(
  areaDef: AreaDefinition,
  width: number,
  height: number,
  palette: ResolvedPalette,
  tiles: Tile[],
  diggerRooms?: DiggerRoom[]
): RoomsAndPortalsResult {
  let startX = -1;
  let startY = -1;
  const portals: Array<{ x: number; y: number; connection: AreaConnection }> = [];
  const finalPlacedEntities: PlacedEntityDef[] = areaDef.placedEntities ? [...areaDef.placedEntities] : [];
  let parsedRooms: Array<RoomBounds> = [];

  if (areaDef.generatorType === 'cellular' || areaDef.generatorType === 'dla') {
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
      throw new Error(`${areaDef.generatorType === 'cellular' ? 'Cellular' : 'DLA'} generation failed: No floor tiles were created.`);
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
  } else if (diggerRooms && diggerRooms.length > 0) {
    const firstRoom = diggerRooms[0];
    if (firstRoom === undefined) throw new Error('Dungeon generation failed: First room is undefined.');
    const center = firstRoom.getCenter();
    startX = center[0]!;
    startY = center[1]!;

    if (areaDef.connections) {
      areaDef.connections.forEach((conn, index) => {
        let roomIndex = index % diggerRooms.length;
        if (conn.direction === 'portal' || conn.direction === 'edge') {
          const side = conn.placementSide || 'any';
          if (side !== 'any') {
            let bestIndex = roomIndex;
            let bestScore = -Infinity;
            diggerRooms.forEach((r, idx) => {
              const score = side === 'top' ? -r.getTop() : side === 'bottom' ? r.getBottom() : side === 'left' ? -r.getLeft() : side === 'right' ? r.getRight() : 0;
              const noisyScore = score + ROT.RNG.getUniform();
              if (noisyScore > bestScore) {
                bestScore = noisyScore;
                bestIndex = idx;
              }
            });
            roomIndex = bestIndex;
          }
        }

        const room = diggerRooms[roomIndex];
        if (room) {
          let px = room.getCenter()[0]!;
          let py = room.getCenter()[1]!;
          if (conn.direction === 'portal' || conn.direction === 'edge') {
            const side = conn.placementSide || 'any';
            const candidates: Array<{ x: number; y: number }> = [];
            const rLeft = room.getLeft();
            const rRight = room.getRight();
            const rTop = room.getTop();
            const rBottom = room.getBottom();

            for (let wx = rLeft - 1; wx <= rRight + 1; wx++) {
              for (let wy = rTop - 1; wy <= rBottom + 1; wy++) {
                if (wx > 0 && wx < width - 1 && wy > 0 && wy < height - 1) {
                  const isTop = wy === rTop - 1 && wx >= rLeft && wx <= rRight;
                  const isBottom = wy === rBottom + 1 && wx >= rLeft && wx <= rRight;
                  const isLeft = wx === rLeft - 1 && wy >= rTop && wy <= rBottom;
                  const isRight = wx === rRight + 1 && wy >= rTop && wy <= rBottom;
                  const matchesSide = side === 'any' ? (isTop || isBottom || isLeft || isRight) : side === 'top' ? isTop : side === 'bottom' ? isBottom : side === 'left' ? isLeft : isRight;
                  if (matchesSide) candidates.push({ x: wx, y: wy });
                }
              }
            }
            if (candidates.length > 0) {
              const chosen = ROT.RNG.getItem(candidates)!;
              px = chosen.x;
              py = chosen.y;
            }
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
    parsedRooms = diggerRooms.map((r, index) => {
      const isSafe = index === 0;
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

  return { startPos: { x: startX, y: startY }, portals, rooms: parsedRooms, placedEntities: finalPlacedEntities };
}

/** Partitions sub-biomes with Voronoi, culls non-bordering walls, and scatters water. */
export function applyBiomesAndCull(
  areaDef: AreaDefinition,
  width: number,
  height: number,
  palette: ResolvedPalette,
  tiles: Tile[],
  rooms: ReadonlyArray<RoomBounds>,
  waterScatterChance: number
): ReadonlyArray<RoomBounds> {
  const allFloorCoords: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = coordToIndex(x, y, width);
      if (tiles[idx] && tiles[idx].tileId === palette.floor) {
        allFloorCoords.push({ x, y });
      }
    }
  }

  const updatedRooms: RoomBounds[] = [...rooms];
  if (areaDef.voronoiSubBiomes && areaDef.voronoiSubBiomes.length > 0 && allFloorCoords.length > 0) {
    const voronoiZones = applyVoronoiBiomes(allFloorCoords, areaDef.voronoiSubBiomes);
    for (const [tag, coordSet] of Object.entries(voronoiZones)) {
      if (coordSet.size === 0) continue;
      let left = width;
      let right = 0;
      let top = height;
      let bottom = 0;
      coordSet.forEach((c) => {
        const [xStr, yStr] = c.split(',');
        const x = Number(xStr);
        const y = Number(yStr);
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      });
      updatedRooms.push({
        left,
        right,
        top,
        bottom,
        centerX: Math.floor((left + right) / 2),
        centerY: Math.floor((top + bottom) / 2),
        isSafe: false,
        tags: [tag],
        exactTiles: Array.from(coordSet)
      });
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = coordToIndex(x, y, width);
      const tile = tiles[idx];
      if (tile && tile.tileId === palette.wall) {
        let bordersFloor = false;
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
        if (ROT.RNG.getUniform() < waterScatterChance) {
          tiles[idx] = { ...tile, tileId: palette.water };
        }
      }
    }
  }

  return updatedRooms;
}

/** Computes Dijkstra hot-path coordinates connecting startPos to every portal. */
export function computeHotPathDijkstra(
  startX: number,
  startY: number,
  portals: ReadonlyArray<{ readonly x: number; readonly y: number }>,
  tiles: Tile[],
  width: number,
  height: number,
  palette: ResolvedPalette,
  areaDef: AreaDefinition
): Set<string> {
  const hotPathCoords = new Set<string>();
  if (portals.length === 0) return hotPathCoords;

  const passableCallback = (x: number, y: number): boolean => {
    const idx = coordToIndex(x, y, width);
    const tile = tiles[idx];
    return tile !== undefined && (tile.tileId === palette.floor || tile.tileId === palette.water);
  };

  const radius =
    areaDef.hotPathRadius ??
    (areaDef.generatorType === 'cellular'
      ? Math.max(MIN_CELLULAR_HOT_PATH_RADIUS, Math.floor(Math.min(width, height) / CELLULAR_HOT_PATH_RADIUS_DENOMINATOR))
      : DEFAULT_HOT_PATH_RADIUS);

  for (const portal of portals) {
    const dijkstra = new ROT.Path.Dijkstra(portal.x, portal.y, passableCallback, { topology: DIJKSTRA_TOPOLOGY });
    dijkstra.compute(startX, startY, (x, y) => {
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

  return hotPathCoords;
}
