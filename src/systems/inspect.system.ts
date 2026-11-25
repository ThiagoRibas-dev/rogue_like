import type { GameState } from '../types/game-state.types.ts';
import type { ToggleInspectIntent, MoveInspectIntent } from '../types/intents/inspect.intents.ts';
import { ComponentType } from '../types/components.types.ts';
import { getComponent } from '../core/ecs.ts';
import { getTileAt, isInMapBounds } from '../map/map_accessor.ts';

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
        y: pos.y,
        ...((pos.z ?? 0) !== 0 ? { z: pos.z } : {})
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
  const newZ = (state.inspectMode.z ?? 0) + (intent.dz ?? 0);

  // Restrict to map bounds
  if (!isInMapBounds(state.map, newX, newY, newZ)) {
    return { state, success: false };
  }

  // Restrict to explored tiles (can't inspect unrevealed fog of war)
  const tile = getTileAt(state.map, newX, newY, newZ);
  if (!tile || (!tile.explored && !state.map.isFullyExplored)) {
    return { state, success: false };
  }

  const { z: _oldZ, ...restInspect } = state.inspectMode;
  return {
    state: {
      ...state,
      inspectMode: {
        ...restInspect,
        x: newX,
        y: newY,
        ...(newZ !== 0 ? { z: newZ } : {})
      }
    },
    success: false
  };
}
