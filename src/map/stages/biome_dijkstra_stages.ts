import * as ROT from 'rot-js';
import type { AreaDefinition } from '../../types/campaign.types.ts';
import type { Tile } from '../../types/game-state.types.ts';
import type { RoomBounds } from '../../types/encounter.types.ts';
import { coordToIndex } from '../../utils/grid.ts';
import { applyVoronoiBiomes } from '../voronoi.ts';
import {
  DIJKSTRA_TOPOLOGY,
  DEFAULT_HOT_PATH_RADIUS,
  CELLULAR_HOT_PATH_RADIUS_DENOMINATOR,
  MIN_CELLULAR_HOT_PATH_RADIUS
} from '../../constants/spawning.constants.ts';
import type { ResolvedPalette } from '../generator_stages.ts';

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
      ? Math.max(
          MIN_CELLULAR_HOT_PATH_RADIUS,
          Math.floor(Math.min(width, height) / CELLULAR_HOT_PATH_RADIUS_DENOMINATOR)
        )
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
