import type { GameState, EntityId } from '../types/game-state.types.ts';
import type { Intent } from '../types/intents.types.ts';
import { ComponentType } from '../types/components.types.ts';
import { getComponent } from '../core/ecs.ts';
import { STATUS_EFFECTS } from '../constants/status.constants.ts';
import { IntentType } from '../types/intents.types.ts';
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
 * Evaluates an AI entity's state and returns its chosen Intent.
 * @param state The current GameState.
 * @param entityId The AI entity taking its turn.
 * @returns The Intent the AI wants to execute, or null if waiting.
 */
export function processAITurn(state: GameState, entityId: EntityId): Intent | null {
  const ai = getComponent(state, entityId, ComponentType.AI);
  const pos = getComponent(state, entityId, ComponentType.Position);

  // If dead or missing components, do nothing
  if (!ai || !pos) return null;

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
      return {
        type: IntentType.Move,
        entityId,
        dx: randomDir.dx,
        dy: randomDir.dy
      };
    }
    return null;
  }

  const profileId = ai.profileId;
  const profile = AI_PROFILES[profileId];
  if (!profile) return null;

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
        return intent;
      }
    }
  }

  // Otherwise, wait
  return null;
}
