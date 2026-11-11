import { addComponent, getComponent } from '../core/ecs.ts';
import { resolveStateStabilization } from '../core/state_stabilizer.ts';
import { getRuleset } from '../rulesets/registry.ts';
import { ComponentType, type AIComponent, type TacticalDoctrineComponent } from '../types/components.types.ts';
import type { EntityId, GameState } from '../types/game-state.types.ts';
import type { Intent } from '../types/intents/intent.union.ts';
import { syncAnchoredFieldsForEntity } from './field.system.ts';
import { resetTriggeredReactionsForNewRound } from './stance.system.ts';
import { processStatusEffectsTick } from './status-effect.system.ts';
import { processTraps } from './trigger.system.ts';

/**
 * Universal Tier 1 Console Actor Turn-Start lifecycle window:
 * 1. Ticks active status effects on the actor (`processStatusEffectsTick`).
 * 2. Runs state stabilization to drain any damage or death consequences.
 * 3. Resets Tier 1 per-round triggered reaction quotas (`resetTriggeredReactionsForNewRound`).
 * 4. Ticks down positive AI action cooldowns.
 * 5. Invokes ruleset-specific turn-start lifecycle hook (`onActorTurnStart`).
 *
 * @param state Current immutable GameState.
 * @param entityId The actor whose turn is starting.
 * @returns Updated GameState after turn-start processing.
 */
export function runActorTurnStart(state: GameState, entityId: EntityId): GameState {
  let nextState = processStatusEffectsTick(state, entityId);
  nextState = resolveStateStabilization(nextState);

  // 1. Reset Tier 1 per-round triggered reaction quotas (e.g. retaliation riders)
  const doctrine = getComponent(nextState, entityId, ComponentType.TacticalDoctrine) as
    TacticalDoctrineComponent | undefined;
  if (doctrine?.triggeredUsesThisRound && Object.keys(doctrine.triggeredUsesThisRound).length > 0) {
    nextState = addComponent(nextState, entityId, resetTriggeredReactionsForNewRound(doctrine));
  }

  // 2. Tick AI cooldowns if present
  const aiComp = getComponent(nextState, entityId, ComponentType.AI) as AIComponent | undefined;
  if (aiComp?.cooldowns) {
    const newCooldowns: Record<string, number> = {};
    let changed = false;
    for (const [key, val] of Object.entries(aiComp.cooldowns)) {
      if (val > 0) {
        newCooldowns[key] = val - 1;
        changed = true;
      } else {
        newCooldowns[key] = 0;
      }
    }
    if (changed) {
      nextState = addComponent(nextState, entityId, { ...aiComp, cooldowns: newCooldowns });
    }
  }

  // 3. Delegate to active ruleset cartridge turn-start hook
  const ruleset = getRuleset(nextState.campaign?.manifest?.rulesetId);
  if (ruleset.onActorTurnStart) {
    nextState = ruleset.onActorTurnStart(nextState, entityId);
  }

  return nextState;
}

/**
 * Universal Tier 1 Console Actor Movement-Step lifecycle window:
 * 1. Synchronizes coordinates of all mobile emanation fields anchored to the mover (`syncAnchoredFieldsForEntity`).
 * 2. Triggers physical floor traps at the destination square (`processTraps`).
 * 3. Invokes ruleset-specific movement step lifecycle hook (`onActorMovementStep`).
 *
 * @param state Current immutable GameState.
 * @param entityId The moving entity.
 * @param fromPos Origin tile coordinates.
 * @param toPos Destination tile coordinates.
 * @returns Updated GameState after movement-step processing.
 */
export function runActorMovementStep(
  state: GameState,
  entityId: EntityId,
  fromPos: { readonly x: number; readonly y: number },
  toPos: { readonly x: number; readonly y: number }
): GameState {
  // 1. Immediately synchronize any anchored mobile fields
  let nextState = syncAnchoredFieldsForEntity(state, entityId, toPos.x, toPos.y);

  // 2. Physical floor traps
  nextState = processTraps(nextState, entityId);

  // 3. Ruleset-specific step hook (e.g. D&D 3.5e aura entry saves and terrain cost)
  const ruleset = getRuleset(nextState.campaign?.manifest?.rulesetId);
  if (ruleset.onActorMovementStep) {
    nextState = ruleset.onActorMovementStep(nextState, entityId, fromPos, toPos);
  }

  return nextState;
}

/**
 * Universal Tier 1 Console Action Energy Cost resolver:
 * Delegates to ruleset-specific action cost resolution if provided; otherwise falls back to
 * default Console energy cost calculation.
 *
 * @param state Current immutable GameState.
 * @param intent The intent being applied.
 * @param baseEnergyCost The baseline energy cost calculated by Console.
 * @returns Updated GameState and effective energy cost.
 */
export function resolveActorActionEnergyCost(
  state: GameState,
  intent: Intent,
  baseEnergyCost: number
): { readonly state: GameState; readonly energyCost: number } {
  const ruleset = getRuleset(state.campaign?.manifest?.rulesetId);
  if (ruleset.resolveActionEnergyCost) {
    return ruleset.resolveActionEnergyCost(state, intent, baseEnergyCost);
  }
  return { state, energyCost: baseEnergyCost };
}
