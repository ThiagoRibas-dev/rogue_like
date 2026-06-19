import { type GameMap, type Tile } from '../types/game-state.types.ts';
import { type AreaDefinition } from '../types/campaign.types.ts';

/**
 * Parses a static ASCII map layout into a GameMap.
 *
 * @param staticMap The static map layout and legend from the Area definition.
 * @returns The generated GameMap.
 */
export interface ParsedStaticMap {
  map: GameMap;
  parsedEntities: { templateId: string; x: number; y: number }[];
}

/**
 * Parses a static ASCII map layout into a GameMap and extracts entities.
 *
 * @param staticMap The static map layout and legend from the Area definition.
 * @returns The generated GameMap and any parsed entities.
 */
export function parseStaticMap(staticMap: NonNullable<AreaDefinition['staticMap']>): ParsedStaticMap {
  const height = staticMap.layout.length;
  const width = staticMap.layout.reduce((max, row) => Math.max(max, row.length), 0);
  const tiles: Tile[] = [];
  const parsedEntities: { templateId: string; x: number; y: number }[] = [];

  for (let y = 0; y < height; y++) {
    const row = staticMap.layout[y] || '';
    for (let x = 0; x < width; x++) {
      const char = row[x] || ' ';

      let tileId = staticMap.legend[char];

      // If the character is in the entity legend, spawn an entity and place a floor (or the legend tile if defined)
      if (staticMap.entityLegend && staticMap.entityLegend[char]) {
        parsedEntities.push({ templateId: staticMap.entityLegend[char]!, x, y });
        // Default to a basic floor if the character wasn't also in the regular legend
        if (!tileId) {
          tileId = 'stone_floor';
        }
      }

      if (!tileId) {
        tileId = 'stone_wall'; // Default fallback
      }

      tiles.push({
        tileId,
        x,
        y,
        explored: false
      });
    }
  }

  return {
    map: {
      width,
      height,
      tiles,
      isFullyExplored: false
    },
    parsedEntities
  };
}
