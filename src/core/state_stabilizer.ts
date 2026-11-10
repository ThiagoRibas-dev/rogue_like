import type { GameState } from '../types/game-state.types.ts';
import { ComponentType } from '../types/components.types.ts';
import { queryEntities } from './ecs.ts';
import { processDamageSystem } from '../systems/damage.system.ts';
import { processDeathSystem } from '../systems/death.system.ts';
import { processGlobalTriggers } from '../systems/trigger.system.ts';
import { MAX_STABILIZATION_ITERATIONS } from '../constants/pacing.constants.ts';

/**
 * Iteratively drains pending damage, death reactions, and global triggers
 * up to MAX_STABILIZATION_ITERATIONS so secondary consequences settle deterministically.
 *
 * @param state The game state to stabilize.
 * @returns The fully stabilized game state.
 */
export function resolveStateStabilization(state: GameState): GameState {
  let nextState = state;
  let iteration = 0;
  let processedEventIndex = 0;

  while (iteration < MAX_STABILIZATION_ITERATIONS) {
    iteration++;
    const prevEventCount = nextState.events.length;

    nextState = processDamageSystem(nextState);
    nextState = processDeathSystem(nextState);
    const triggerResult = processGlobalTriggers(nextState, processedEventIndex);
    nextState = triggerResult.state;
    processedEventIndex = triggerResult.nextEventIndex;

    const hasPendingDamage = queryEntities(nextState, [ComponentType.Damage]).length > 0;
    const hasPendingDeath = queryEntities(nextState, [ComponentType.Death]).length > 0;
    const newEventsEmitted = nextState.events.length > prevEventCount;

    if (!hasPendingDamage && !hasPendingDeath && !newEventsEmitted) {
      break;
    }
  }

  return nextState;
}
