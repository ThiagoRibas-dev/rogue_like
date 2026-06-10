import type { GameState } from '../types/game-state.types.ts';
import type { ToggleInspectIntent, MoveInspectIntent } from '../actions/inspect.actions.ts';
import { ComponentType } from '../types/components.types.ts';
import { getComponent } from '../core/ecs.ts';
import { coordToIndex } from '../utils/grid.ts';

/**
 * Toggles inspect mode on or off. Centers the cursor on the player when opening.
 */
export function processToggleInspectIntent(
  state: GameState,
  intent: ToggleInspectIntent
): { state: GameState; success: boolean } {
  if (state.inspectMode?.active) {
    return { state: { ...state, inspectMode: undefined }, success: false };
  }

  const pos = getComponent(state, intent.entityId, ComponentType.Position);
  if (!pos) return { state, success: false };

  // Cannot inspect while targeting
  if (state.targetingMode?.active) return { state, success: false };

  return {
    state: {
      ...state,
      inspectMode: {
        active: true,
        x: pos.x,
        y: pos.y
      }
    },
    success: false
  };
}

/**
 * Moves the inspect cursor if inspect mode is active.
 */
export function processMoveInspectIntent(
  state: GameState,
  intent: MoveInspectIntent
): { state: GameState; success: boolean } {
  if (!state.inspectMode?.active) return { state, success: false };

  const newX = state.inspectMode.x + intent.dx;
  const newY = state.inspectMode.y + intent.dy;

  // Restrict to map bounds
  if (newX < 0 || newX >= state.map.width || newY < 0 || newY >= state.map.height) {
    return { state, success: false };
  }

  // Restrict to explored tiles (can't inspect unrevealed fog of war)
  const idx = coordToIndex(newX, newY, state.map.width);
  const tile = state.map.tiles[idx];
  if (!tile || (!tile.explored && !state.map.isFullyExplored)) {
    return { state, success: false };
  }

  return {
    state: {
      ...state,
      inspectMode: {
        ...state.inspectMode,
        x: newX,
        y: newY
      }
    },
    success: false
  };
}
