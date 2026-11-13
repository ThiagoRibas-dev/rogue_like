import { type GameState, type EntityId } from '../types/game-state.types.ts';
import { type Intent } from '../types/intents/intent.union.ts';
import { IntentType } from '../types/intents/intent.enum.ts';
import { ComponentType } from '../types/components.types.ts';
import { getComponent } from '../core/ecs.ts';
import { DEFAULT_AI_AGGRO_RADIUS, resolveAITarget } from './companion_targeting.ts';
import { computeNextStepToward } from './follow.behavior.ts';

/**
 * Hunt behavior: finds the highest-priority hostile entity within aggroRadius
 * (respecting companion stances, focus-target orders, and leash bounds).
 * If adjacent, returns a MeleeAttackIntent.
 * If further (and not holding position), returns a path-aware MoveIntent towards the target.
 */
export function huntBehavior(
  state: GameState,
  entityId: EntityId,
  params: Readonly<Record<string, unknown>>
): Intent | null {
  const aggroRadius = typeof params.aggroRadius === 'number' ? params.aggroRadius : DEFAULT_AI_AGGRO_RADIUS;
  const resolved = resolveAITarget(state, entityId, aggroRadius, undefined, true);
  if (!resolved) return null;

  if (resolved.distance === 1) {
    return {
      type: IntentType.MeleeAttack,
      entityId,
      defenderId: resolved.targetId
    };
  }

  const link = getComponent(state, entityId, ComponentType.ControllerLink);
  if (link?.stance === 'hold') {
    return null;
  }

  const pos = getComponent(state, entityId, ComponentType.Position);
  if (!pos) return null;

  const step = computeNextStepToward(state, entityId, pos.x, pos.y, pos.x + resolved.dx, pos.y + resolved.dy);
  if (!step) return null;

  return {
    type: IntentType.Move,
    entityId,
    dx: step.dx,
    dy: step.dy
  };
}
