import { canActorPerformIntent, hasActorActedThisTurn } from '../systems/lifecycle.system.ts';
import { type GameState, type EntityId } from '../types/game-state.types.ts';
import { type Intent } from '../types/intents/intent.union.ts';
import { IntentType } from '../types/intents/intent.enum.ts';
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
 * Wander behavior: picks a random adjacent direction once at the start of an idle actor's turn.
 * Respects `wanders: false`, prevents multi-step random drifting within the same round, and
 * validates movement eligibility against the active ruleset budget.
 */
export function wanderBehavior(
  state: GameState,
  entityId: EntityId,
  params: Readonly<Record<string, unknown>>
): Intent | null {
  if (params.wanders === false) return null;
  if (hasActorActedThisTurn(state, entityId)) return null;

  const randomDir = ROT.RNG.getItem(DIRECTIONS);
  if (!randomDir) return null;

  const moveIntent: Intent = {
    type: IntentType.Move,
    entityId,
    dx: randomDir.dx,
    dy: randomDir.dy
  };
  return canActorPerformIntent(state, moveIntent) ? moveIntent : null;
}
