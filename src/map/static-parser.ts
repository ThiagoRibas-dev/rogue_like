import { type GameMap, type Tile } from '../types/game-state.types.ts';
import { type AreaDefinition } from '../types/campaign.types.ts';

/**
 * Parses a static ASCII map layout into a GameMap.
 *
 * @param staticMap The static map layout and legend from the Area definition.
 * @returns The generated GameMap.
 */
export function parseStaticMap(staticMap: NonNullable<AreaDefinition['staticMap']>): GameMap {
  const height = staticMap.layout.length;
  const width = staticMap.layout[0]?.length ?? 0;
  const tiles: Tile[] = [];

  for (let y = 0; y < height; y++) {
    const row = staticMap.layout[y] || '';
    for (let x = 0; x < width; x++) {
      const char = row[x] || ' ';
      const tileId = staticMap.legend[char] ?? 'stone_wall'; // Default fallback

      tiles.push({
        tileId,
        x,
        y,
        explored: false
      });
    }
  }

  return {
    width,
    height,
    tiles,
    isFullyExplored: false
  };
}
