import * as ROT from 'rot-js';
import type { VoronoiSubBiomeRule } from '../types/campaign.types.ts';

/**
 * Noise factor added to Euclidean distance calculations to create organic, non-linear Voronoi borders.
 */
const VORONOI_BORDER_NOISE_SCALE = 2.0;

/**
 * Interface representing a seeded point for Voronoi cell partitioning.
 */
interface VoronoiSeed {
  readonly x: number;
  readonly y: number;
  readonly tag: string;
}

/**
 * Partitions floor coordinates into sub-biome zones using a randomized Voronoi algorithm.
 * Each tile is mapped to its nearest seed coordinate with additional noise for organic boundaries.
 *
 * @param floorCoords List of all passable floor tile coordinates in the map.
 * @param rules List of Voronoi sub-biome rules defining cell tags and seed point counts.
 * @returns A mapping of sub-biome tag to the Set of coordinate strings ("x,y") belonging to that zone.
 */
export function applyVoronoiBiomes(
  floorCoords: ReadonlyArray<{ readonly x: number; readonly y: number }>,
  rules: ReadonlyArray<VoronoiSubBiomeRule>
): Record<string, Set<string>> {
  const seeds: VoronoiSeed[] = [];

  // 1. Pick seeds from the available floor coordinates for each rule
  for (const rule of rules) {
    for (let i = 0; i < rule.seedPoints; i++) {
      const pt = ROT.RNG.getItem(floorCoords as Array<{ x: number; y: number }>);
      if (pt) {
        seeds.push({ x: pt.x, y: pt.y, tag: rule.tag });
      }
    }
  }

  const zones: Record<string, Set<string>> = {};
  if (seeds.length === 0) {
    return zones;
  }

  // 2. Assign each floor tile to the nearest seed with some noise
  for (const coord of floorCoords) {
    let bestSeed = seeds[0]!;
    let minScore = Infinity;

    for (const seed of seeds) {
      const dx = coord.x - seed.x;
      const dy = coord.y - seed.y;
      const dist = Math.hypot(dx, dy);

      // Add noise to make borders organic and jagged instead of straight lines
      const noisyDist = dist + ROT.RNG.getUniform() * VORONOI_BORDER_NOISE_SCALE;
      if (noisyDist < minScore) {
        minScore = noisyDist;
        bestSeed = seed;
      }
    }

    if (!zones[bestSeed.tag]) {
      zones[bestSeed.tag] = new Set<string>();
    }
    zones[bestSeed.tag]!.add(`${coord.x},${coord.y}`);
  }

  return zones;
}
