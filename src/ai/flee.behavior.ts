import { type GameState, type EntityId } from '../types/game-state.types.ts';
import { type Intent } from '../types/intents/intent.union.ts';
import { IntentType } from '../types/intents/intent.enum.ts';
import { ComponentType } from '../types/components.types.ts';
import { getComponent } from '../core/ecs.ts';
import { getTileDefAt, isInMapBounds } from '../map/map_accessor.ts';
import { isHostile } from '../utils/faction.ts';
import { computeOrGetFlowField } from './flow_field.ts';
import { packWorldCoord3D } from '../utils/grid.ts';

const FLEE_OFFSETS_2D: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
  [1, -1],
  [1, 1],
  [-1, 1],
  [-1, -1]
];

/**
 * Flee behavior: runs away from the nearest hostile entity if HP is below the threshold,
 * consulting the shared 3D Dijkstra flow field from the threat to maximize retreat distance around walls.
 */
export function fleeBehavior(
  state: GameState,
  entityId: EntityId,
  params: Readonly<Record<string, unknown>>
): Intent | null {
  const pos = getComponent(state, entityId, ComponentType.Position);
  const fighter = getComponent(state, entityId, ComponentType.Fighter);

  if (!pos || !fighter) return null;

  const threshold = (params.threshold as number) ?? 0.3;
  const hpRatio = fighter.hp / fighter.maxHp;

  if (hpRatio >= threshold) return null;

  const selfZ = pos.z ?? 0;
  let nearestThreat: EntityId | undefined;
  let minDistance = Infinity;
  let threatX = pos.x;
  let threatY = pos.y;
  let threatZ = selfZ;

  for (const id of state.entities) {
    if (id === entityId) continue;

    const otherPos = getComponent(state, id, ComponentType.Position);
    const otherFighter = getComponent(state, id, ComponentType.Fighter);

    if (otherPos && otherFighter && otherFighter.hp > 0 && isHostile(state, entityId, id)) {
      const dx = otherPos.x - pos.x;
      const dy = otherPos.y - pos.y;
      const dz = (otherPos.z ?? 0) - selfZ;
      const distance = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));

      if (distance < minDistance) {
        minDistance = distance;
        nearestThreat = id;
        threatX = otherPos.x;
        threatY = otherPos.y;
        threatZ = otherPos.z ?? 0;
      }
    }
  }

  if (!nearestThreat) return null;

  const threatField = computeOrGetFlowField(state, threatX, threatY, threatZ);
  let bestScore = -Infinity;
  let bestDx = -Math.sign(threatX - pos.x);
  let bestDy = -Math.sign(threatY - pos.y);

  for (const [dx, dy] of FLEE_OFFSETS_2D) {
    const nx = pos.x + dx;
    const ny = pos.y + dy;
    if (!isInMapBounds(state.map, nx, ny, selfZ)) continue;
    const def = getTileDefAt(state, nx, ny, selfZ);
    if (!def?.walkable) continue;
    const fieldDist =
      threatField.distances.get(packWorldCoord3D(nx, ny, selfZ)) ??
      Math.hypot(nx - threatX, ny - threatY, (selfZ - threatZ) * 2);
    if (fieldDist > bestScore) {
      bestScore = fieldDist;
      bestDx = dx;
      bestDy = dy;
    }
  }

  if (bestDx === 0 && bestDy === 0) return null;

  return {
    type: IntentType.Move,
    entityId,
    dx: bestDx,
    dy: bestDy
  };
}
