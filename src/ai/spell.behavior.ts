import { type GameState, type EntityId } from '../types/game-state.types.ts';
import { type Intent } from '../types/intents/intent.union.ts';
import { IntentType } from '../types/intents/intent.enum.ts';
import { ComponentType } from '../types/components.types.ts';
import { getComponent } from '../core/ecs.ts';
import { computeFOV } from '../map/fov.ts';
import { matchesTargetFilters } from '../systems/effects/spatial_effects.ts';
import { isHostile } from '../utils/faction.ts';
import { resolveAITarget } from './companion_targeting.ts';

interface AbilityDef {
  readonly effectId: string;
  readonly abilityName?: string;
  readonly range: number;
  readonly cooldown: number;
  readonly aoeRadiusTiles?: number;
  readonly skipAlliesInAoE?: boolean;
}

function wouldAbilityHarmFriendlies(
  state: GameState,
  casterId: EntityId,
  centerX: number,
  centerY: number,
  radiusTiles: number,
  checkSelf: boolean
): boolean {
  for (const id of state.entities) {
    const fighter = getComponent(state, id, ComponentType.Fighter);
    const otherPos = getComponent(state, id, ComponentType.Position);
    if (!fighter || fighter.hp <= 0 || !otherPos) continue;
    const dist = Math.hypot(otherPos.x - centerX, otherPos.y - centerY);
    if (dist > radiusTiles) continue;
    if (id === casterId) {
      if (checkSelf) return true;
      continue;
    }
    if (!isHostile(state, casterId, id)) return true;
  }
  return false;
}

/**
 * Spell casting behavior: evaluates a list of abilities and casts the first valid one
 * on the highest-priority hostile target in range while avoiding AoE friendly fire.
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
  const targetX = pos.x + resolved.dx;
  const targetY = pos.y + resolved.dy;

  // Try to use the first ability that is in range, off cooldown, and safe from AoE friendly fire
  for (const ability of abilities) {
    if (minDistance > ability.range) continue;
    if ((cooldowns[ability.effectId] ?? 0) > 0) continue;

    const effectDef = state.campaign.effects[ability.effectId];
    if (!effectDef) continue;

    if (!ability.skipAlliesInAoE) {
      if (effectDef.type === 'damage_area') {
        const radius = ability.aoeRadiusTiles ?? effectDef.radius ?? 3;
        const hitsFriendly = state.entities.some((id) => {
          if (id === entityId) return false;
          const f = getComponent(state, id, ComponentType.Fighter);
          const p = getComponent(state, id, ComponentType.Position);
          if (!f || f.hp <= 0 || !p) return false;
          if (!matchesTargetFilters(state, entityId, id, effectDef)) return false;
          return Math.hypot(p.x - pos.x, p.y - pos.y) <= radius && !isHostile(state, entityId, id);
        });
        if (hitsFriendly) continue;
      } else if ((ability.aoeRadiusTiles ?? 0) > 0) {
        if (wouldAbilityHarmFriendlies(state, entityId, targetX, targetY, ability.aoeRadiusTiles!, true)) {
          continue;
        }
      }
    }

    return {
      type: IntentType.UseAbility,
      entityId,
      effectId: ability.effectId,
      abilityName: ability.abilityName ?? 'spell',
      cooldown: ability.cooldown
    };
  }

  return null;
}
