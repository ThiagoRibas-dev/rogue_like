import { ComponentType } from '../types/components.types.ts';
import type { MemoryComponent } from '../types/components.types.ts';
import { getComponent } from '../core/ecs.ts';
import type { GameState } from '../types/game-state.types.ts';
import type { TriggerDefinition } from '../types/trigger.types.ts';
import { UIMode } from '../types/game-state.types.ts';

/**
 * Result of a pacing evaluation, containing whether the trigger is allowed and the reason for rejection if blocked.
 */
export interface PacingEvaluation {
  readonly allowed: boolean;
  readonly reason?: 'unsafe_context' | 'insufficient_budget' | 'cooldown_active' | 'foreshadowing_missing';
}

/**
 * Evaluates if a player has discovered clues or rumors matching all required foreshadowing tags.
 *
 * @param state The current read-only game state.
 * @param requiredTags The list of tags that must be found in the player's knowledge board.
 * @returns True if all required tags are present, false otherwise.
 */
export function evaluateForeshadowing(state: Readonly<GameState>, requiredTags: ReadonlyArray<string>): boolean {
  const playerEntityId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined);
  if (!playerEntityId) return false;

  const playerMemory = getComponent(state, playerEntityId, ComponentType.Memory) as MemoryComponent | undefined;
  if (!playerMemory || !playerMemory.knowledge) return false;

  const knownTags = new Set<string>();
  for (const item of Object.values(playerMemory.knowledge)) {
    if (item.tags) {
      for (const t of item.tags) {
        knownTags.add(t);
      }
    }
  }

  return requiredTags.every((tag) => knownTags.has(tag));
}

/**
 * Evaluates whether a trigger can be fired based on safety context, budget, cooldowns, and foreshadowing requirements.
 *
 * @param state The current read-only game state.
 * @param trigger The trigger definition to evaluate.
 * @returns A PacingEvaluation indicating if the trigger is allowed, and why if not.
 */
export function evaluatePacing(state: Readonly<GameState>, trigger: TriggerDefinition): PacingEvaluation {
  if (!trigger.pacing && !trigger.foreshadowing) {
    return { allowed: true };
  }

  // 1. Safe Context Check (e.g. must be in active Game mode, not menus/editor/trade)
  if (trigger.pacing?.requiresSafeContext && state.uiMode !== UIMode.Game) {
    return { allowed: false, reason: 'unsafe_context' };
  }

  // 2. Global Budget Check
  if (trigger.pacing?.dramaCost !== undefined) {
    if (state.dramaTracker.globalBudget < trigger.pacing.dramaCost) {
      return { allowed: false, reason: 'insufficient_budget' };
    }
  }

  // 3. Cooldown Check
  if (trigger.pacing?.cooldownId) {
    const expirationTurn = state.dramaTracker.activeCooldowns[trigger.pacing.cooldownId] || 0;
    if (state.globalTurn < expirationTurn) {
      return { allowed: false, reason: 'cooldown_active' };
    }
  }

  // 4. Foreshadowing Check
  if (trigger.foreshadowing?.requiredKnowledgeTags && trigger.foreshadowing.requiredKnowledgeTags.length > 0) {
    const foreshadowingMet = evaluateForeshadowing(state, trigger.foreshadowing.requiredKnowledgeTags);
    if (!foreshadowingMet) {
      return { allowed: false, reason: 'foreshadowing_missing' };
    }
  }

  return { allowed: true };
}

/**
 * Deducts budget costs and updates cooldown expiration turns when a paced trigger fires.
 *
 * @param state The current game state.
 * @param trigger The trigger definition that is being executed.
 * @returns The updated game state after applying pacing changes.
 */
export function applyPacingCosts(state: GameState, trigger: TriggerDefinition): GameState {
  if (!trigger.pacing) return state;

  const nextActiveCooldowns = { ...state.dramaTracker.activeCooldowns };
  if (trigger.pacing.cooldownId && trigger.pacing.cooldownTurns) {
    nextActiveCooldowns[trigger.pacing.cooldownId] = state.globalTurn + trigger.pacing.cooldownTurns;
  }

  return {
    ...state,
    dramaTracker: {
      ...state.dramaTracker,
      globalBudget: state.dramaTracker.globalBudget - (trigger.pacing.dramaCost || 0),
      activeCooldowns: nextActiveCooldowns,
      lastMajorEventTurn: state.globalTurn
    }
  };
}
