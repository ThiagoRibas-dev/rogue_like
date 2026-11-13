import { getComponent } from '../core/ecs.ts';
import { ComponentType } from '../types/components.types.ts';
import { type EntityId, type GameState } from '../types/game-state.types.ts';
import { type Intent } from '../types/intents/intent.union.ts';
import { IntentType } from '../types/intents/intent.enum.ts';

import { computeFOV } from '../map/fov.ts';
import { DEFAULT_RANGED_SPELL_RANGE, resolveAITarget } from './companion_targeting.ts';

/**
 * Ranged behavior: finds the highest-priority hostile entity within range.
 * If one is found, fires a ranged attack (represented by an effect or throwable).
 */
export function rangedBehavior(
  state: GameState,
  entityId: EntityId,
  params: Readonly<Record<string, unknown>>
): Intent | null {
  const pos = getComponent(state, entityId, ComponentType.Position);
  if (!pos) return null;

  // 1. Determine available spells and throwables
  // If no spell is explicitly configured, default spellRange to 0 so we don't hallucinate spells.
  const spellRange = params.effectId ? ((params.range as number) ?? DEFAULT_RANGED_SPELL_RANGE) : 0;
  const spellEffectId = params.effectId as string | undefined;

  let maxThrowableRange = 0;
  let bestThrowableId: EntityId | undefined;

  const inventory = getComponent(state, entityId, ComponentType.Inventory);
  if (inventory && 'items' in inventory) {
    for (const itemId of inventory.items) {
      const itemComp = getComponent(state, itemId, ComponentType.Item);
      if (itemComp && 'itemId' in itemComp) {
        const itemDef = state.campaign.items[itemComp.itemId];
        if (itemDef?.throwable) {
          if (itemDef.throwable.range > maxThrowableRange) {
            maxThrowableRange = itemDef.throwable.range;
            bestThrowableId = itemId;
          }
        }
      }
    }
  }

  const effectiveRange = Math.max(spellRange, maxThrowableRange);
  if (effectiveRange === 0) return null; // No ranged capabilities

  const fov = computeFOV(state, pos.x, pos.y, effectiveRange);
  const resolved = resolveAITarget(state, entityId, effectiveRange, fov, false);
  if (!resolved) return null;

  const nearestTarget = resolved.targetId;
  const minDistance = resolved.distance;

  // 2. Decide action
  // Prefer spell if we have one and it's in range
  if (spellEffectId && minDistance <= spellRange) {
    // Ensure effect exists
    if (!state.campaign.effects[spellEffectId]) return null;

    return {
      type: IntentType.UseAbility,
      entityId,
      effectId: spellEffectId,
      abilityName: (params.abilityName as string) ?? 'spell'
    };
  }

  // Otherwise fallback to throwable
  if (bestThrowableId && minDistance <= maxThrowableRange) {
    return {
      type: IntentType.Apply,
      entityId,
      verb: 'throw',
      target: { type: 'entity', entityId: nearestTarget },
      toolEntityId: bestThrowableId
    };
  }

  return null;
}
