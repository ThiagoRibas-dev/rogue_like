import { VOID_TILE_PALETTE_INDEX } from '../constants/world_chunk.constants.ts';
import type { TileDefinition } from '../types/campaign/world.ts';
import type { TilePaletteRegistry } from '../types/world-chunk.types.ts';

/**
 * Builds a deterministic flyweight `TilePaletteRegistry` from campaign tile definitions.
 * Keys are sorted lexicographically so index `0` is always reserved for void/unloaded cells
 * and `1..N` map identically across worker threads, saves, and restarts.
 *
 * @param tiles Campaign tile definition registry.
 * @returns Immutable deterministic TilePaletteRegistry.
 */
export function buildTilePaletteRegistry(tiles: Readonly<Record<string, TileDefinition>>): TilePaletteRegistry {
  const sortedTileIds = Object.keys(tiles).sort();
  const indexToTileId: string[] = [''];
  const tileIdToIndex: Record<string, number> = {};

  for (const tileId of sortedTileIds) {
    const idx = indexToTileId.length;
    indexToTileId.push(tileId);
    tileIdToIndex[tileId] = idx;
  }

  return { indexToTileId, tileIdToIndex };
}

/**
 * Resolves a string tile ID from its compact palette index.
 *
 * @param palette Active TilePaletteRegistry.
 * @param index Compact Uint16Array tile index.
 * @returns Tile ID string, or `undefined` if `0` (void) or out of range.
 */
export function getTileIdFromPaletteIndex(palette: TilePaletteRegistry, index: number): string | undefined {
  if (index <= VOID_TILE_PALETTE_INDEX || index >= palette.indexToTileId.length) {
    return undefined;
  }
  return palette.indexToTileId[index];
}

/**
 * Looks up the compact Uint16Array index assigned to a campaign tile ID.
 *
 * @param palette Active TilePaletteRegistry.
 * @param tileId String tile ID.
 * @returns Palette index (`0` if unknown).
 */
export function getPaletteIndexForTileId(palette: TilePaletteRegistry, tileId: string): number {
  return palette.tileIdToIndex[tileId] ?? VOID_TILE_PALETTE_INDEX;
}
