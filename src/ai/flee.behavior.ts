import { type GameState, type EntityId } from '../types/game-state.types.ts';
import { type Intent, IntentType } from '../types/intents.types.ts';
import { ComponentType } from '../types/components.types.ts';
import { getComponent } from '../core/ecs.ts';
import { isHostile } from '../utils/faction.ts';

/**
 * Flee behavior: runs away from the nearest hostile entity if HP is below the threshold.
 * Currently uses simple opposite-direction movement.
 * TODO(M9+): Implement ROT.js Dijkstra map for proper pathfinding away from threats.
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

  // Only flee if below threshold
  if (hpRatio >= threshold) return null;

  let nearestThreat: EntityId | undefined;
  let minDistance = Infinity;
  let threatDx = 0;
  let threatDy = 0;

  // Find nearest hostile threat
  for (const id of state.entities) {
    if (id === entityId) continue;

    const otherPos = getComponent(state, id, ComponentType.Position);
    const otherFighter = getComponent(state, id, ComponentType.Fighter);

    if (otherPos && otherFighter && isHostile(state, entityId, id)) {
      const dx = otherPos.x - pos.x;
      const dy = otherPos.y - pos.y;
      const distance = Math.max(Math.abs(dx), Math.abs(dy));

      if (distance < minDistance) {
        minDistance = distance;
        nearestThreat = id;
        threatDx = dx;
        threatDy = dy;
      }
    }
  }

  // No threats nearby
  if (!nearestThreat) return null;

  // Flee in opposite direction
  return {
    type: IntentType.Move,
    entityId,
    dx: -Math.sign(threatDx),
    dy: -Math.sign(threatDy)
  };
}
