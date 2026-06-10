import { type GameState, type EntityId } from '../types/game-state.types.ts';
import { type Intent, IntentType } from '../types/intents.types.ts';
import { ComponentType } from '../types/components.types.ts';
import { getComponent } from '../core/ecs.ts';
import { isHostile } from '../utils/faction.ts';
import { computeFOV } from '../map/fov.ts';
import { coordToIndex } from '../utils/grid.ts';

interface AbilityDef {
  readonly effectId: string;
  readonly range: number;
  readonly cooldown: number;
}

/**
 * Spell casting behavior: evaluates a list of abilities and casts the first valid one
 * on the nearest hostile target in range.
 * Note: Cooldowns are not fully implemented in state yet, so they act as simple priority
 * lists for MVP. In the future, track cooldowns on the AI component.
 */
export function spellBehavior(
  state: GameState,
  entityId: EntityId,
  params: Readonly<Record<string, unknown>>
): Intent | null {
  const pos = getComponent(state, entityId, ComponentType.Position);
  if (!pos) return null;

  const abilities = (params.abilities as ReadonlyArray<AbilityDef>) ?? [];
  if (abilities.length === 0) return null;

  const maxRange = Math.max(...abilities.map((a) => a.range));
  const fov = computeFOV(state, pos.x, pos.y, maxRange);

  const aiComp = getComponent(state, entityId, ComponentType.AI);
  const cooldowns = aiComp?.cooldowns ?? {};

  // Find nearest hostile
  let nearestTarget: EntityId | undefined;
  let minDistance = Infinity;

  for (const id of state.entities) {
    if (id === entityId) continue;

    const otherPos = getComponent(state, id, ComponentType.Position);
    const otherFighter = getComponent(state, id, ComponentType.Fighter);

    if (otherPos && otherFighter && isHostile(state, entityId, id)) {
      const targetIndex = coordToIndex(otherPos.x, otherPos.y, state.map.width);
      if (!fov.has(targetIndex)) continue;

      const dx = otherPos.x - pos.x;
      const dy = otherPos.y - pos.y;
      const distance = Math.max(Math.abs(dx), Math.abs(dy));

      if (distance < minDistance) {
        minDistance = distance;
        nearestTarget = id;
      }
    }
  }

  if (!nearestTarget) return null;

  // Try to use the first ability that is in range and not on cooldown
  for (const ability of abilities) {
    if (minDistance <= ability.range) {
      const isOnCooldown = (cooldowns[ability.effectId] ?? 0) > 0;
      if (!isOnCooldown) {
        const effectDef = state.campaign.effects[ability.effectId];
        if (effectDef) {
          return {
            type: IntentType.UseAbility,
            entityId,
            effectId: ability.effectId,
            abilityName: 'spell',
            cooldown: ability.cooldown
          };
        }
      }
    }
  }

  return null;
}
