import type { GameState, EntityId } from '../types/game-state.types.ts';
import type { Intent } from '../types/intents/intent.union.ts';
import { dispatchAction } from '../actions/action.registry.ts';
import { ComponentType } from '../types/components.types.ts';
import { getComponent } from '../core/ecs.ts';
import { IntentType } from '../types/intents/intent.enum.ts';
import * as ROT from 'rot-js';
import { type AIBehaviorFn } from '../types/ai.types.ts';
import { huntBehavior } from '../ai/hunt.behavior.ts';
import { wanderBehavior } from '../ai/wander.behavior.ts';
import { fleeBehavior } from '../ai/flee.behavior.ts';
import { rangedBehavior } from '../ai/ranged.behavior.ts';
import { spellBehavior } from '../ai/spell.behavior.ts';

const BEHAVIOR_REGISTRY: Record<string, AIBehaviorFn> = {
  hunt: huntBehavior,
  wander: wanderBehavior,
  flee: fleeBehavior,
  ranged: rangedBehavior,
  spell: spellBehavior
};

/**
 * Evaluates an AI entity's state and returns its chosen Intent.
 * @param state The current GameState.
 * @param entityId The AI entity taking its turn.
 * @returns The Intent the AI wants to execute, or null if waiting.
 */
export function processAITurn(state: GameState, entityId: EntityId): { intent: Intent | null; state: GameState } {
  const ai = getComponent(state, entityId, ComponentType.AI);
  const pos = getComponent(state, entityId, ComponentType.Position);

  // If dead or missing components, do nothing
  if (!ai || !pos) return { intent: null, state };

  const statuses = getComponent(state, entityId, ComponentType.StatusEffects);
  const isConfused = statuses?.activeEffects.some((e) => state.campaign.status[e.effectId]?.flags?.confused);

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
        intent: {
          type: IntentType.Move,
          entityId,
          dx: randomDir.dx,
          dy: randomDir.dy
        },
        state
      };
    }
    return { intent: null, state };
  }

  const profileId = ai.profileId;
  const profile = state.campaign.ai[profileId];
  if (!profile) return { intent: null, state };

  const memory = getComponent(state, entityId, ComponentType.Memory);
  const facets = memory?.facets || {};

  // Map behaviors to evaluated scores
  const evaluatedBehaviors = profile.behaviors.map((entry, index) => {
    // Base priority: preserve array order (higher index = lower priority)
    let score = (profile.behaviors.length - index) * 1000;

    // Apply facet weight modifiers
    if (entry.weightModifiers) {
      for (const [facetName, multiplier] of Object.entries(entry.weightModifiers)) {
        if (facets[facetName] !== undefined) {
          score += facets[facetName]! * multiplier;
        }
      }
    }
    return { entry, score };
  });

  // Sort descending by score
  evaluatedBehaviors.sort((a, b) => b.score - a.score);

  let nextState = state;

  // Run behavior pipeline in prioritized order
  for (const { entry } of evaluatedBehaviors) {
    const behaviorFn = BEHAVIOR_REGISTRY[entry.behaviorId];
    if (behaviorFn) {
      // Merge component overrides with profile params
      const params = {
        ...entry,
        ...(ai.aggroRadius !== undefined ? { aggroRadius: ai.aggroRadius } : {}),
        ...(ai.wanders !== undefined ? { wanders: ai.wanders } : {})
      };

      const intent = behaviorFn(nextState, entityId, params);
      if (intent !== null) {
        // AI decided to do this. Check if they should bark.
        if (profile.barks && profile.barks[entry.behaviorId]) {
          const barkList = profile.barks[entry.behaviorId]!;
          // 25% chance to bark if they have barks for this behavior
          if (barkList.length > 0 && ROT.RNG.getUniform() < 0.25) {
            const barkMsg = ROT.RNG.getItem(barkList);
            if (barkMsg) {
              const sayResult = dispatchAction(nextState, {
                type: IntentType.Say,
                entityId,
                message: barkMsg
              });
              nextState = sayResult.state;
              if (sayResult.events && sayResult.events.length > 0) {
                nextState = { ...nextState, events: [...nextState.events, ...sayResult.events] };
              }
            }
          }
        }

        return { intent, state: nextState };
      }
    }
  }

  // Otherwise, wait
  return { intent: null, state: nextState };
}
