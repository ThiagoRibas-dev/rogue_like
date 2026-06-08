import * as ROT from 'rot-js';
import { type GameMap, type Tile } from '../types/game-state.types.ts';
import { coordToIndex } from '../utils/grid.ts';
import {
  MIN_ROOM_WIDTH,
  MAX_ROOM_WIDTH,
  MIN_ROOM_HEIGHT,
  MAX_ROOM_HEIGHT,
  MIN_CORRIDOR_LENGTH,
  MAX_CORRIDOR_LENGTH,
  DUG_PERCENTAGE,
  MAX_DUNGEON_DEPTH
} from '../constants/map.constants.ts';

/**
 * Generates a procedural room-and-corridor dungeon map using ROT.Map.Digger.
 * Places stairs up and down at the centers of rooms.
 *
 * @param width The width of the dungeon map.
 * @param height The height of the dungeon map.
 * @param depth The current dungeon depth.
 * @returns An object containing the generated GameMap and the player's starting coordinates.
 */
export function generateDungeon(
  width: number,
  height: number,
  depth: number
): {
  readonly map: GameMap;
  readonly startPos: { readonly x: number; readonly y: number };
  readonly stairs: ReadonlyArray<{ readonly x: number; readonly y: number; readonly direction: 'up' | 'down' }>;
  readonly rooms: ReadonlyArray<{
    readonly left: number;
    readonly right: number;
    readonly top: number;
    readonly bottom: number;
    readonly centerX: number;
    readonly centerY: number;
  }>;
} {
  // 1. Initialize empty flat array of tiles filled with walls
  const tiles: Tile[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      tiles.push({
        tileId: 'stone_wall',
        x,
        y,
        explored: false
      });
    }
  }

  // 2. Create the digger generator
  // ROT.Map.Digger internally queries the global ROT.RNG instance (which we configured in core/rng.ts)
  const digger = new ROT.Map.Digger(width, height, {
    roomWidth: [MIN_ROOM_WIDTH, MAX_ROOM_WIDTH],
    roomHeight: [MIN_ROOM_HEIGHT, MAX_ROOM_HEIGHT],
    corridorLength: [MIN_CORRIDOR_LENGTH, MAX_CORRIDOR_LENGTH],
    dugPercentage: DUG_PERCENTAGE
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
          tileId: 'stone_floor'
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

  const stairs: Array<{ readonly x: number; readonly y: number; readonly direction: 'up' | 'down' }> = [];

  // If depth > 1, place stairs up at the entry point
  if (depth > 1) {
    const startIndex = coordToIndex(startX, startY, width);
    const tile = tiles[startIndex];
    if (tile !== undefined) {
      tiles[startIndex] = {
        ...tile,
        tileId: 'stone_floor' // Ensure it's a floor underneath
      };
      stairs.push({ x: startX, y: startY, direction: 'up' });
    }
  }

  // Last room is the exit point
  const lastRoom = rooms[rooms.length - 1];
  if (lastRoom === undefined) {
    throw new Error('Dungeon generation failed: Last room is undefined.');
  }
  const [stairsDownX, stairsDownY] = lastRoom.getCenter();
  if (stairsDownX === undefined || stairsDownY === undefined) {
    throw new Error('Dungeon generation failed: Stairs down coordinates are undefined.');
  }

  // Place stairs down at the exit point (if we aren't at the maximum depth of MAX_DUNGEON_DEPTH)
  if (depth < MAX_DUNGEON_DEPTH) {
    const exitIndex = coordToIndex(stairsDownX, stairsDownY, width);
    const tile = tiles[exitIndex];
    if (tile !== undefined) {
      tiles[exitIndex] = {
        ...tile,
        tileId: 'stone_floor' // Ensure it's a floor underneath
      };
      stairs.push({ x: stairsDownX, y: stairsDownY, direction: 'down' });
    }
  }

  // 5. Cull deep walls (replace walls that don't border a floor with empty_space)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = coordToIndex(x, y, width);
      const tile = tiles[idx];
      if (tile && tile.tileId === 'stone_wall') {
        let bordersFloor = false;
        // Check 8 neighbors
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              const nIdx = coordToIndex(nx, ny, width);
              if (tiles[nIdx]?.tileId === 'stone_floor' || tiles[nIdx]?.tileId === 'shallow_water') {
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
      } else if (tile && tile.tileId === 'stone_floor') {
        // Scatter some shallow water
        if (ROT.RNG.getUniform() < 0.05) {
          // 5% chance for a floor tile to be water
          tiles[idx] = { ...tile, tileId: 'shallow_water' };
        }
      }
    }
  }

  const map: GameMap = {
    width,
    height,
    tiles
  };

  const parsedRooms = rooms.map((r) => {
    r.getDoors((x: number, y: number) => {
      const idx = coordToIndex(x, y, width);
      const tile = tiles[idx];
      if (tile) {
        // Only place doors occasionally to avoid over-cluttering, or place them everywhere?
        // Let's place them everywhere a door is defined.
        tiles[idx] = { ...tile, tileId: 'closed_door' };
      }
    });

    const center = r.getCenter();
    return {
      left: r.getLeft(),
      right: r.getRight(),
      top: r.getTop(),
      bottom: r.getBottom(),
      centerX: center[0]!,
      centerY: center[1]!
    };
  });

  return {
    map,
    startPos: { x: startX, y: startY },
    stairs,
    rooms: parsedRooms
  };
}
