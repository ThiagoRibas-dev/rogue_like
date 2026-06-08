import type { GameState, EntityId } from '../types/game-state.types.ts';
import { ComponentType } from '../types/components.types.ts';
import { getComponent } from '../core/ecs.ts';
import { STATUS_EFFECTS } from '../constants/status.constants.ts';
import { IntentType } from '../types/intents.types.ts';
import { processMoveIntent } from './movement.system.ts';
import { processMeleeAttackIntent } from './combat.system.ts';
import * as ROT from 'rot-js';
import { AI_PROFILES, AIBehaviorId } from '../constants/ai.constants.ts';
import { type AIBehaviorFn } from '../types/ai.types.ts';
import { huntBehavior } from '../ai/hunt.behavior.ts';
import { wanderBehavior } from '../ai/wander.behavior.ts';
import { fleeBehavior } from '../ai/flee.behavior.ts';
import { rangedBehavior } from '../ai/ranged.behavior.ts';
import { spellBehavior } from '../ai/spell.behavior.ts';

const BEHAVIOR_REGISTRY: Record<string, AIBehaviorFn> = {
  [AIBehaviorId.Hunt]: huntBehavior,
  [AIBehaviorId.Wander]: wanderBehavior,
  [AIBehaviorId.Flee]: fleeBehavior,
  [AIBehaviorId.Ranged]: rangedBehavior,
  [AIBehaviorId.Spell]: spellBehavior
};

/**
 * Executes a turn for an AI entity, generating and applying its chosen Intent.
 * @param state The current GameState.
 * @param entityId The AI entity taking its turn.
 * @returns The updated GameState after the AI acts.
 */
export function processAITurn(state: GameState, entityId: EntityId): GameState {
  const ai = getComponent(state, entityId, ComponentType.AI);
  const pos = getComponent(state, entityId, ComponentType.Position);

  // If dead or missing components, do nothing
  if (!ai || !pos) return state;

  const statuses = getComponent(state, entityId, ComponentType.StatusEffects);
  const isConfused = statuses?.activeEffects.some((e) => STATUS_EFFECTS[e.effectId]?.flags?.confused);

  if (isConfused) {
    const directions = [
      { dx: 0, dy: -1 },
      { dx: 0, dy: 1 },
      { dx: -1, dy: 0 },
      { dx: 1, dy: 0 },
      { dx: -1, dy: -1 },
      { dx: 1, dy: -1 },
      { dx: -1, dy: 1 },
      { dx: 1, dy: 1 }
    ];
    const randomDir = ROT.RNG.getItem(directions);
    if (randomDir) {
      return processMoveIntent(state, {
        type: IntentType.Move,
        entityId,
        dx: randomDir.dx,
        dy: randomDir.dy
      });
    }
    return state;
  }

  const profileId = ai.profileId;
  const profile = AI_PROFILES[profileId];
  if (!profile) return state;

  // Run behavior pipeline in priority order
  for (const entry of profile.behaviors) {
    const behaviorFn = BEHAVIOR_REGISTRY[entry.behaviorId];
    if (behaviorFn) {
      // Merge component overrides with profile params
      const params = {
        ...entry.params,
        ...(ai.aggroRadius !== undefined ? { aggroRadius: ai.aggroRadius } : {}),
        ...(ai.wanders !== undefined ? { wanders: ai.wanders } : {})
      };

      const intent = behaviorFn(state, entityId, params);
      if (intent !== null) {
        // Dispatch intent
        if (intent.type === IntentType.Move) {
          return processMoveIntent(state, intent);
        }
        if (intent.type === IntentType.MeleeAttack) {
          return processMeleeAttackIntent(state, intent);
        }
        // Fallback/Unknown intent, just return state for now
        // We'll add UseItem / FireAimed in Phase C
        return state;
      }
    }
  }

  // Otherwise, wait
  return state;
}
