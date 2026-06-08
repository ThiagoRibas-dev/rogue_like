import { ITEM_EFFECTS } from '../constants/effects.constants.ts';
import { getComponent } from '../core/ecs.ts';
import { ComponentType } from '../types/components.types.ts';
import { type EntityId, type GameState } from '../types/game-state.types.ts';
import { type Intent, IntentType } from '../types/intents.types.ts';
import { isHostile } from '../utils/faction.ts';

/**
 * Ranged behavior: finds the nearest hostile entity within range.
 * If one is found, fires a ranged attack (represented by an effect).
 */
export function rangedBehavior(
  state: GameState,
  entityId: EntityId,
  params: Readonly<Record<string, unknown>>
): Intent | null {
  const pos = getComponent(state, entityId, ComponentType.Position);
  if (!pos) return null;

  const range = (params.range as number) ?? 6;

  let nearestTarget: EntityId | undefined;
  let minDistance = Infinity;

  // Find nearest hostile
  for (const id of state.entities) {
    if (id === entityId) continue;

    const otherPos = getComponent(state, id, ComponentType.Position);
    const otherFighter = getComponent(state, id, ComponentType.Fighter);

    if (otherPos && otherFighter && isHostile(state, entityId, id)) {
      const dx = otherPos.x - pos.x;
      const dy = otherPos.y - pos.y;
      const distance = Math.max(Math.abs(dx), Math.abs(dy)); // Chebyshev distance

      // Needs to be > 1 to prefer ranged over melee, but AI pipeline orders matter.
      // Usually, we just fire if within range.
      if (distance <= range && distance < minDistance) {
        minDistance = distance;
        nearestTarget = id;
      }
    }
  }

  if (!nearestTarget) return null;

  // For a generic ranged attack, we can use a hardcoded 'damage_nearest' effect or pass it via params.
  const effectId = (params.effectId as string) ?? ITEM_EFFECTS.damage_nearest_10;
  const abilityName = (params.abilityName as string) ?? 'bow';

  // Ensure effect exists
  if (!ITEM_EFFECTS[effectId]) return null;

  // Fire!
  return {
    type: IntentType.UseAbility,
    entityId,
    effectId,
    abilityName
  };
}
