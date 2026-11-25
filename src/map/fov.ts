import { type GameState } from '../types/game-state.types.ts';
import { computeFOV3D } from './fov_3d.ts';

/**
 * Computes the Field of View from a specific center point using Precise Shadowcasting (3D Z-aware on multi-Z maps).
 * Returns a Set of numeric coordinate keys (`coordToIndex` on finite Z=0 maps, `packWorldCoord3D` on 3D/chunked maps)
 * representing visible cells.
 *
 * @param state The current GameState.
 * @param px The center grid x coordinate (usually player position).
 * @param py The center grid y coordinate (usually player position).
 * @param radius Optional sight radius override.
 * @param pz Optional center grid z coordinate (defaults to `0`).
 * @returns A Set containing numeric tile keys of visible coordinates.
 */
export function computeFOV(state: GameState, px: number, py: number, radius?: number, pz = 0): Set<number> {
  return computeFOV3D(state, px, py, pz, radius);
}
