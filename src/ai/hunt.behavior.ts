import { type GameState, type EntityId } from '../types/game-state.types.ts';
import { type Intent } from '../types/intents/intent.union.ts';
import { IntentType } from '../types/intents/intent.enum.ts';
import { ComponentType } from '../types/components.types.ts';
import { getComponent } from '../core/ecs.ts';
import { DEFAULT_AI_AGGRO_RADIUS, resolveAITarget } from './companion_targeting.ts';
import { computeNextStepToward } from './follow.behavior.ts';
import { canActorPerformIntent, hasActorMovementInProgress } from '../systems/lifecycle.system.ts';
import { getEntitySpatialProfile } from '../systems/movement_footprint.ts';

/**
 * Hunt behavior: finds the highest-priority hostile entity within aggroRadius
 * (respecting companion stances, focus-target orders, and leash bounds).
 * If adjacent, returns a MeleeAttackIntent (when attack action is available).
 * If further (and not holding position), returns a path-aware MoveIntent towards the target
 * only when the actor can still attack upon arrival or is continuing an active Move pool.
 */
export function huntBehavior(
  state: GameState,
  entityId: EntityId,
  params: Readonly<Record<string, unknown>>
): Intent | null {
  const aggroRadius = typeof params.aggroRadius === 'number' ? params.aggroRadius : DEFAULT_AI_AGGRO_RADIUS;
  const resolved = resolveAITarget(state, entityId, aggroRadius, undefined, true);
  if (!resolved) return null;

  const attackIntent: Intent = {
    type: IntentType.MeleeAttack,
    entityId,
    defenderId: resolved.targetId
  };

  const naturalReachTiles = getEntitySpatialProfile(state, entityId).naturalReachTiles;
  if (resolved.distance <= naturalReachTiles) {
    return canActorPerformIntent(state, attackIntent) ? attackIntent : null;
  }

  const link = getComponent(state, entityId, ComponentType.ControllerLink);
  if (link?.stance === 'hold') {
    return null;
  }

  // Prevent ranged/caster units (or already-attacked units) from starting a fresh melee charge
  // after spending their Standard action, while still allowing mid-move entities to finish stepping.
  const canStillAttack = canActorPerformIntent(state, attackIntent);
  if (!canStillAttack && !hasActorMovementInProgress(state, entityId)) {
    return null;
  }

  const pos = getComponent(state, entityId, ComponentType.Position);
  if (!pos) return null;

  const step = computeNextStepToward(state, entityId, pos.x, pos.y, pos.x + resolved.dx, pos.y + resolved.dy);
  if (!step) return null;

  const moveIntent: Intent = {
    type: IntentType.Move,
    entityId,
    dx: step.dx,
    dy: step.dy
  };
  return canActorPerformIntent(state, moveIntent) ? moveIntent : null;
}
