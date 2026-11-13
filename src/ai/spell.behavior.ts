import { type GameState, type EntityId } from '../types/game-state.types.ts';
import { type Intent } from '../types/intents/intent.union.ts';
import { IntentType } from '../types/intents/intent.enum.ts';
import { ComponentType } from '../types/components.types.ts';
import { getComponent } from '../core/ecs.ts';
import { computeFOV } from '../map/fov.ts';
import { resolveAITarget } from './companion_targeting.ts';

interface AbilityDef {
  readonly effectId: string;
  readonly abilityName?: string;
  readonly range: number;
  readonly cooldown: number;
}

/**
 * Spell casting behavior: evaluates a list of abilities and casts the first valid one
 * on the highest-priority hostile target in range.
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

  const resolved = resolveAITarget(state, entityId, maxRange, fov, false);
  if (!resolved) return null;

  const minDistance = resolved.distance;

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
            abilityName: ability.abilityName ?? 'spell',
            cooldown: ability.cooldown
          };
        }
      }
    }
  }

  return null;
}
