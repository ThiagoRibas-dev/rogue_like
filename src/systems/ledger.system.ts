import type { GameState } from '../types/game-state.types.ts';
import type { GameEvent } from '../types/events.types.ts';
import { rng } from '../core/rng.ts';
import { ComponentType, type InteractionScoreComponent } from '../types/components.types.ts';
import { getComponent, addComponent } from '../core/ecs.ts';

/**
 * Processes transient events generated during a tick, filtering out high/normal importance
 * events and pushing them to the durable historicalLedger. Also generates unique IDs for them.
 * Handles deterministic decay of Player Interaction Scores (PIS) across factions and areas.
 *
 * @param state The current GameState at the end of the game loop tick.
 * @param didGlobalTurnAdvance True if the global turn counter incremented during this tick.
 * @returns The next GameState with updated ledger and PIS.
 */
export function processLedgerSystem(state: GameState, didGlobalTurnAdvance: boolean): GameState {
  const newLedger = [...state.historicalLedger];
  let ledgerModified = false;

  for (let i = 0; i < state.events.length; i++) {
    const event = state.events[i]!;
    if (event.importance === 'high' || event.importance === 'normal') {
      // Ensure the event has a unique ID if it doesn't already
      const id = event.id ?? `evt_${state.globalTurn}_${i}_${Math.floor(rng.getUniform() * 10000)}`;
      newLedger.push({ ...event, id } as GameEvent);
      ledgerModified = true;
    }
  }

  let nextState = state;
  if (ledgerModified) {
    nextState = { ...nextState, historicalLedger: newLedger };
  }

  // Deterministic decay of PIS every 100 turns
  if (didGlobalTurnAdvance && nextState.globalTurn > 0 && nextState.globalTurn % 100 === 0) {
    const allEntityIds = [...Object.values(nextState.factionEntityIds), ...Object.values(nextState.areaEntityIds)];

    for (const entId of allEntityIds) {
      const piComp = getComponent(nextState, entId, ComponentType.InteractionScore) as
        | InteractionScoreComponent
        | undefined;
      if (piComp) {
        const decayed = Math.floor(piComp.score * 0.95);
        if (decayed !== piComp.score) {
          nextState = addComponent(nextState, entId, { ...piComp, score: decayed });
        }
      }
    }
  }

  return nextState;
}
