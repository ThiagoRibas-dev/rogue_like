import { type GameMap, type Tile } from '../types/game-state.types.ts';
import { type AreaDefinition } from '../types/campaign.types.ts';

/** Parsed entity placement emitted from a static ASCII map's `entityLegend`. */
export interface ParsedStaticEntity {
  readonly templateId: string;
  readonly x: number;
  readonly y: number;
  readonly z?: number | undefined;
}

/**
 * Result of parsing a single-layer or multi-Z static ASCII map layout.
 */
export interface ParsedStaticMap {
  map: GameMap;
  parsedEntities: ParsedStaticEntity[];
}

function parseAsciiSlice(
  layout: ReadonlyArray<string>,
  legend: Readonly<Record<string, string>>,
  entityLegend: Readonly<Record<string, string>> | undefined,
  z: number,
  width: number,
  height: number
): { readonly tiles: Tile[]; readonly entities: ParsedStaticEntity[] } {
  const tiles: Tile[] = [];
  const entities: ParsedStaticEntity[] = [];

  for (let y = 0; y < height; y++) {
    const row = layout[y] || '';
    for (let x = 0; x < width; x++) {
      const char = row[x] || ' ';
      let tileId = legend[char];

      if (entityLegend && entityLegend[char]) {
        entities.push({
          templateId: entityLegend[char]!,
          x,
          y,
          ...(z !== 0 ? { z } : {})
        });
        if (!tileId) {
          tileId = 'stone_floor';
        }
      }

      if (!tileId) {
        tileId = 'stone_wall';
      }

      tiles.push({
        tileId,
        x,
        y,
        ...(z !== 0 ? { z } : {}),
        explored: false
      });
    }
  }

  return { tiles, entities };
}

/**
 * Parses a static ASCII map layout (with optional `zLevels` slices) into a GameMap and extracts entities.
 *
 * @param staticMap The static map layout, legend, and optional `zLevels` from the Area definition.
 * @returns The generated GameMap and any parsed entities.
 */
export function parseStaticMap(staticMap: NonNullable<AreaDefinition['staticMap']>): ParsedStaticMap {
  let height = staticMap.layout.length;
  let width = staticMap.layout.reduce((max, row) => Math.max(max, row.length), 0);

  if (staticMap.zLevels) {
    for (const sliceLayout of Object.values(staticMap.zLevels)) {
      height = Math.max(height, sliceLayout.length);
      for (const row of sliceLayout) {
        width = Math.max(width, row.length);
      }
    }
  }

  const parsedEntities: ParsedStaticEntity[] = [];
  const z0Result = parseAsciiSlice(staticMap.layout, staticMap.legend, staticMap.entityLegend, 0, width, height);
  parsedEntities.push(...z0Result.entities);

  if (!staticMap.zLevels || Object.keys(staticMap.zLevels).length === 0) {
    return {
      map: {
        width,
        height,
        tiles: z0Result.tiles,
        isFullyExplored: false
      },
      parsedEntities
    };
  }

  const zSlices: Record<number, Tile[]> = { 0: z0Result.tiles };
  let minZ = 0;
  let maxZ = 0;

  for (const [zKey, sliceLayout] of Object.entries(staticMap.zLevels)) {
    const z = Number(zKey);
    if (!Number.isInteger(z)) continue;
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
    const sliceResult = parseAsciiSlice(sliceLayout, staticMap.legend, staticMap.entityLegend, z, width, height);
    zSlices[z] = sliceResult.tiles;
    if (z === 0) {
      // Allow explicit zLevels['0'] override if provided while deduplicating base entities
      parsedEntities.length = 0;
      parsedEntities.push(...sliceResult.entities);
    } else {
      parsedEntities.push(...sliceResult.entities);
    }
  }

  return {
    map: {
      width,
      height,
      tiles: zSlices[0] ?? z0Result.tiles,
      zSlices,
      minZ,
      maxZ,
      isFullyExplored: false
    },
    parsedEntities
  };
}
