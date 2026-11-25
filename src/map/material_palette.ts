import { VOID_MATERIAL_PALETTE_INDEX } from '../constants/world_chunk.constants.ts';
import type { MaterialDefinition } from '../types/campaign/meta.ts';
import type { MaterialPaletteRegistry } from '../types/world-chunk.types.ts';

/**
 * Builds a deterministic flyweight `MaterialPaletteRegistry` from configured material definitions.
 * Keys are sorted lexicographically so index `0` is always reserved for default/unspecified material
 * and `1..N` map identically across worker threads, saves, and restarts.
 *
 * @param materials Material definition dictionary (`campaign.rules.materials`).
 * @returns Immutable deterministic MaterialPaletteRegistry.
 */
export function buildMaterialPaletteRegistry(
  materials: Readonly<Record<string, MaterialDefinition>> | undefined
): MaterialPaletteRegistry {
  const sortedIds = Object.keys(materials ?? {}).sort();
  const indexToMaterialId: string[] = [''];
  const materialIdToIndex: Record<string, number> = {};

  for (const materialId of sortedIds) {
    const idx = indexToMaterialId.length;
    indexToMaterialId.push(materialId);
    materialIdToIndex[materialId] = idx;
  }

  return { indexToMaterialId, materialIdToIndex };
}

/**
 * Resolves a string material ID from its compact Uint16Array palette index.
 *
 * @param palette Active MaterialPaletteRegistry.
 * @param index Compact Uint16Array material index.
 * @returns Material ID string, or `undefined` if `0` (unspecified) or out of range.
 */
export function getMaterialIdFromPaletteIndex(palette: MaterialPaletteRegistry, index: number): string | undefined {
  if (index <= VOID_MATERIAL_PALETTE_INDEX || index >= palette.indexToMaterialId.length) {
    return undefined;
  }
  return palette.indexToMaterialId[index];
}

/**
 * Looks up the compact Uint16Array index assigned to a material ID.
 *
 * @param palette Active MaterialPaletteRegistry.
 * @param materialId String material ID.
 * @returns Palette index (`0` if unknown).
 */
export function getPaletteIndexForMaterialId(palette: MaterialPaletteRegistry, materialId: string): number {
  return palette.materialIdToIndex[materialId] ?? VOID_MATERIAL_PALETTE_INDEX;
}
