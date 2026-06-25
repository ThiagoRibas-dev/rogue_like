import { type GameState } from '../types/game-state.types.ts';
import { GameEventType, type ClueDiscoveredEvent, type SchemeMutatedAreaEvent } from '../types/events.types.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';
import { INVESTIGATION_STALL_THRESHOLD } from '../constants/investigation.constants.ts';

/**
 * Processes investigation-related events.
 * Currently listens for ClueDiscoveredEvent to update the player's InvestigationKnowledge.
 */
export function processInvestigationEvents(state: GameState): GameState {
  let nextState = state;
  let investigationUpdated = false;

  const newKnownActors = new Set(nextState.investigation.knownActors);
  const newDiscoveredClues = new Set(nextState.investigation.discoveredClues);
  const newExposedAgreements = [...nextState.investigation.exposedAgreements];

  let newLastClueTurn = nextState.investigation.lastClueTurn ?? state.globalTurn;
  let newLastStallTriggerTurn = nextState.investigation.lastStallTriggerTurn;

  for (const event of state.events) {
    if (event.type === GameEventType.ClueDiscovered) {
      const clueEvent = event as ClueDiscoveredEvent;

      if (!newDiscoveredClues.has(clueEvent.clueId)) {
        newDiscoveredClues.add(clueEvent.clueId);
        investigationUpdated = true;
        newLastClueTurn = state.globalTurn;

        nextState = addMessage(nextState, `Clue added to your investigation board!`, MessageLogCategory.System);
      }

      if (clueEvent.implicatesEntityId && !newKnownActors.has(clueEvent.implicatesEntityId)) {
        newKnownActors.add(clueEvent.implicatesEntityId);
        investigationUpdated = true;
        nextState = addMessage(
          nextState,
          `A new suspect has been added to your investigation board!`,
          MessageLogCategory.System
        );
      }

      // If we have both the minion and the mastermind, link them
      if (clueEvent.implicatesEntityId) {
        // TODO: Technically, sourceEntityId here is the Item that was dropped.
        // But the item doesn't know who dropped it right now unless we added that to ClueComponent.
        // Since we did not add the minionId to the ClueComponent (only implicatesEntityId),
        // we can't fully draw the edge yet. We'd need to update ClueComponent to hold `minionId`.
        // For MVP, we will just track the exposed Agreements via implicates.
      }
    } else if (event.type === GameEventType.SchemeMutatedArea) {
      const mutateEvent = event as SchemeMutatedAreaEvent;
      const clueText = `Rumor: ${mutateEvent.areaId} is now ${mutateEvent.tagsAdded.join(', ')} (Fortification rating +${mutateEvent.budgetModifier})`;
      if (!newDiscoveredClues.has(clueText)) {
        newDiscoveredClues.add(clueText);
        investigationUpdated = true;
        newLastClueTurn = state.globalTurn;
        nextState = addMessage(
          nextState,
          `Rumor added to board: ${mutateEvent.areaId} has changed!`,
          MessageLogCategory.System
        );
      }
    }
  }

  // Stall Detector Logic
  const turnsSinceLastClue = state.globalTurn - newLastClueTurn;
  const turnsSinceLastStallEvent =
    newLastStallTriggerTurn !== undefined ? state.globalTurn - newLastStallTriggerTurn : Infinity;

  // If stalled, and we haven't recently triggered a stall event (to prevent spamming it every turn)
  if (
    turnsSinceLastClue >= INVESTIGATION_STALL_THRESHOLD &&
    turnsSinceLastStallEvent >= INVESTIGATION_STALL_THRESHOLD
  ) {
    nextState = {
      ...nextState,
      events: [
        ...nextState.events,
        {
          type: GameEventType.InvestigationStalled,
          turnsStalled: turnsSinceLastClue
        }
      ]
    };
    newLastStallTriggerTurn = state.globalTurn;
    investigationUpdated = true;
  }

  if (investigationUpdated) {
    nextState = {
      ...nextState,
      investigation: {
        knownActors: Array.from(newKnownActors),
        discoveredClues: Array.from(newDiscoveredClues),
        exposedAgreements: newExposedAgreements,
        lastClueTurn: newLastClueTurn,
        lastStallTriggerTurn: newLastStallTriggerTurn
      }
    };
  }

  return nextState;
}
