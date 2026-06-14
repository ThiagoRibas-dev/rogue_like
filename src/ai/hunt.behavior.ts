import { type GameState, type EntityId } from '../types/game-state.types.ts';
import { type Intent } from '../types/intents/intent.union.ts';
import { IntentType } from '../types/intents/intent.enum.ts';
import { ComponentType } from '../types/components.types.ts';
import { getComponent } from '../core/ecs.ts';
import { isHostile } from '../utils/faction.ts';

/**
 * Hunt behavior: finds the nearest hostile entity within aggroRadius.
 * If adjacent, returns a MeleeAttackIntent.
 * If further, returns a MoveIntent towards the target.
 */
export function huntBehavior(
  state: GameState,
  entityId: EntityId,
  params: Readonly<Record<string, unknown>>
): Intent | null {
  const pos = getComponent(state, entityId, ComponentType.Position);
  if (!pos) return null;

  const aggroRadius = (params.aggroRadius as number) ?? 5;

  let nearestTarget: EntityId | undefined;
  let minDistance = Infinity;
  let targetDx = 0;
  let targetDy = 0;

  // Find nearest hostile
  for (const id of state.entities) {
    if (id === entityId) continue;

    const otherPos = getComponent(state, id, ComponentType.Position);
    const otherFighter = getComponent(state, id, ComponentType.Fighter);

    if (otherPos && otherFighter && isHostile(state, entityId, id)) {
      const dx = otherPos.x - pos.x;
      const dy = otherPos.y - pos.y;
      const distance = Math.max(Math.abs(dx), Math.abs(dy)); // Chebyshev distance

      if (distance <= aggroRadius && distance < minDistance) {
        minDistance = distance;
        nearestTarget = id;
        targetDx = dx;
        targetDy = dy;
      }
    }
  }

  if (!nearestTarget) return null;

  // If adjacent, attack
  if (minDistance === 1) {
    return {
      type: IntentType.MeleeAttack,
      entityId,
      defenderId: nearestTarget
    };
  }

  // Otherwise, move towards target
  return {
    type: IntentType.Move,
    entityId,
    dx: Math.sign(targetDx),
    dy: Math.sign(targetDy)
  };
}
