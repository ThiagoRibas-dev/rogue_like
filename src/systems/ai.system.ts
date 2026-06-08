import type { GameState, EntityId } from '../types/game-state.types.ts';
import { ComponentType, type PositionComponent } from '../types/components.types.ts';
import { getComponent } from '../core/ecs.ts';
import { STATUS_EFFECTS } from '../constants/status.constants.ts';
import { IntentType, type Intent } from '../types/intents.types.ts';
import { processMoveIntent } from './movement.system.ts';
import { processMeleeAttackIntent } from './combat.system.ts';
import * as ROT from 'rot-js';

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

  // For basic_melee, we need the player's position
  // 1. Find the player
  let playerEntityId: EntityId | undefined;
  let playerPos: PositionComponent | undefined;

  for (const id of state.entities) {
    if (getComponent(state, id, ComponentType.Player)) {
      playerEntityId = id;
      playerPos = getComponent(state, id, ComponentType.Position);
      break;
    }
  }

  if (!playerEntityId || !playerPos) return state;

  // 2. Simple distance calculation
  const dx = playerPos.x - pos.x;
  const dy = playerPos.y - pos.y;
  const distance = Math.max(Math.abs(dx), Math.abs(dy)); // Chebyshev distance

  // If adjacent, attack!
  if (distance === 1) {
    const attackIntent: Intent = {
      type: IntentType.MeleeAttack,
      entityId,
      defenderId: playerEntityId
    };
    return processMeleeAttackIntent(state, attackIntent);
  }

  const aggroRadius = ai.aggroRadius ?? 5;
  const wanders = ai.wanders ?? false;

  // If within aggro radius, move towards player
  if (distance <= aggroRadius) {
    const moveDx = Math.sign(dx);
    const moveDy = Math.sign(dy);

    const moveIntent: Intent = {
      type: IntentType.Move,
      entityId,
      dx: moveDx,
      dy: moveDy
    };

    // Note: If blocked by another monster, processMoveIntent currently just returns state.
    // That's acceptable for MVP (they just get stuck behind each other).
    return processMoveIntent(state, moveIntent);
  }

  // Otherwise, wander if enabled
  if (wanders) {
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
      const moveIntent: Intent = {
        type: IntentType.Move,
        entityId,
        dx: randomDir.dx,
        dy: randomDir.dy
      };
      return processMoveIntent(state, moveIntent);
    }
  }

  // Otherwise, wait
  return state;
}
