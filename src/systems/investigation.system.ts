import { type GameState, type EntityId } from '../types/game-state.types.ts';
import { GameEventType, type ClueDiscoveredEvent, type SchemeMutatedAreaEvent } from '../types/events.types.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';
import { INVESTIGATION_STALL_THRESHOLD } from '../constants/investigation.constants.ts';
import { ComponentType, type MemoryComponent } from '../types/components.types.ts';
import { getComponent, addComponent } from '../core/ecs.ts';

/**
 * Processes investigation-related events.
 * Currently listens for ClueDiscoveredEvent to update the player's MemoryComponent knowledge.
 */
export function processInvestigationEvents(state: GameState): GameState {
  let nextState = state;
  let investigationUpdated = false;

  const newKnownActors = new Set(nextState.investigation.knownActors);
  const newExposedAgreements = [...nextState.investigation.exposedAgreements];

  let newLastClueTurn = nextState.investigation.lastClueTurn ?? state.globalTurn;
  let newLastStallTriggerTurn = nextState.investigation.lastStallTriggerTurn;

  // Find player to update their MemoryComponent
  let playerId: EntityId | undefined;
  let playerMemory: MemoryComponent | undefined;
  for (const entityId of state.entities) {
    if (getComponent(state, entityId, ComponentType.Player)) {
      playerId = entityId;
      playerMemory = getComponent(state, entityId, ComponentType.Memory) as MemoryComponent | undefined;
      break;
    }
  }

  const nextKnowledge = playerMemory?.knowledge ? { ...playerMemory.knowledge } : {};
  let knowledgeUpdated = false;

  for (const event of state.events) {
    if (event.type === GameEventType.ClueDiscovered) {
      const clueEvent = event as ClueDiscoveredEvent;

      if (!nextKnowledge[clueEvent.clueId]) {
        nextKnowledge[clueEvent.clueId] = {
          id: clueEvent.clueId,
          type: 'secret',
          description: `Clue: ${clueEvent.clueId}`,
          tags: []
        };
        knowledgeUpdated = true;
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
        // ...
      }
    } else if (event.type === GameEventType.SchemeMutatedArea) {
      const mutateEvent = event as SchemeMutatedAreaEvent;
      const clueText = `Rumor: ${mutateEvent.areaId} is now ${mutateEvent.tagsAdded.join(', ')} (Fortification rating +${mutateEvent.budgetModifier})`;
      if (!nextKnowledge[clueText]) {
        nextKnowledge[clueText] = {
          id: mutateEvent.areaId,
          type: 'rumor',
          description: clueText,
          tags: mutateEvent.tagsAdded
        };
        knowledgeUpdated = true;
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

  if (knowledgeUpdated && playerId !== undefined && playerMemory) {
    nextState = addComponent(nextState, playerId, {
      ...playerMemory,
      knowledge: nextKnowledge
    });
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
        exposedAgreements: newExposedAgreements,
        lastClueTurn: newLastClueTurn,
        lastStallTriggerTurn: newLastStallTriggerTurn
      }
    };
  }

  return nextState;
}
