import { type GameState } from '../types/game-state.types.ts';
import { type ToggleTargetingIntent, type MoveTargetIntent, type FireAimedIntent } from '../types/intents.types.ts';
import { getComponent } from '../core/ecs.ts';
import { ComponentType } from '../types/components.types.ts';
import { addMessage } from './message.system.ts';

/**
 * Toggles targeting mode on or off.
 */
export function processToggleTargetingIntent(state: GameState, intent: ToggleTargetingIntent): GameState {
  if (state.targetingMode?.active) {
    // Turn off targeting mode
    const { targetingMode, ...restState } = state;
    return addMessage(restState as GameState, 'Targeting cancelled.', 'system');
  }

  // Turn on targeting mode, default target to the entity's current position
  const pos = getComponent(state, intent.entityId, ComponentType.Position);
  if (!pos) return state;

  return addMessage({
    ...state,
    targetingMode: {
      active: true,
      x: pos.x,
      y: pos.y
    }
  }, 'Targeting mode active. Move cursor to aim.', 'system');
}

/**
 * Moves the targeting crosshair.
 */
export function processMoveTargetIntent(state: GameState, intent: MoveTargetIntent): GameState {
  if (!state.targetingMode?.active) return state;

  const newX = state.targetingMode.x + intent.dx;
  const newY = state.targetingMode.y + intent.dy;

  // Clamp to map boundaries
  if (newX < 0 || newX >= state.map.width || newY < 0 || newY >= state.map.height) {
    return state;
  }

  return {
    ...state,
    targetingMode: {
      ...state.targetingMode,
      x: newX,
      y: newY
    }
  };
}

/**
 * Fires the aimed action at the targeted tile and turns off targeting mode.
 */
export function processFireAimedIntent(state: GameState, _intent: FireAimedIntent): GameState {
  if (!state.targetingMode?.active) return state;

  const targetX = state.targetingMode.x;
  const targetY = state.targetingMode.y;

  // In Milestone 3, we just log a message as a stub, since Combat comes in M4.
  const stateWithMsg = addMessage(state, `You target the tile at ${targetX}, ${targetY}.`, 'combat');

  // Turn off targeting
  const { targetingMode, ...restState } = stateWithMsg;
  return restState as GameState;
}
