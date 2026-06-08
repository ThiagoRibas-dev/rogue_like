import { type GameState, type EntityId } from '../types/game-state.types.ts';
import { type Intent, IntentType } from '../types/intents.types.ts';
import * as ROT from 'rot-js';

const DIRECTIONS = [
  { dx: 0, dy: -1 }, // up
  { dx: 0, dy: 1 }, // down
  { dx: -1, dy: 0 }, // left
  { dx: 1, dy: 0 }, // right
  { dx: -1, dy: -1 }, // up-left
  { dx: 1, dy: -1 }, // up-right
  { dx: -1, dy: 1 }, // down-left
  { dx: 1, dy: 1 } // down-right
];

/**
 * Wander behavior: picks a random adjacent direction.
 * Note: the movement system will handle blocking/bumping.
 */
export function wanderBehavior(
  _state: GameState,
  entityId: EntityId,
  _params: Readonly<Record<string, unknown>>
): Intent | null {
  const randomDir = ROT.RNG.getItem(DIRECTIONS);
  if (!randomDir) return null;

  return {
    type: IntentType.Move,
    entityId,
    dx: randomDir.dx,
    dy: randomDir.dy
  };
}
