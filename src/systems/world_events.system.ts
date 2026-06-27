import { type GameState } from '../types/game-state.types.ts';
import { ComponentType, type ChronicleComponent, type IdentityComponent } from '../types/components.types.ts';
import { getComponent } from '../core/ecs.ts';
import { rng } from '../core/rng.ts';
import { recordChronicleEvent } from './chronicle.system.ts';
import { GameEventType } from '../types/events.types.ts';
import {
  WORLD_EVENT_TICK_INTERVAL,
  WORLD_EVENT_AREA_CHANCE,
  WORLD_EVENT_FACTION_CHANCE
} from '../constants/pacing.constants.ts';
import { AREA_NARRATIVE_EVENTS, FACTION_NARRATIVE_EVENTS } from '../constants/world_events.constants.ts';

/**
 * Runs periodically to generate background narrative events for Regions and Factions.
 */
export function processWorldEvents(state: GameState): GameState {
  let nextState = state;

  // Run world events periodically
  if (nextState.globalTurn % WORLD_EVENT_TICK_INTERVAL !== 0) return nextState;

  // 1. Process Area Events
  for (const [areaId, entityId] of Object.entries(nextState.areaEntityIds)) {
    if (rng.getUniform() < WORLD_EVENT_AREA_CHANCE) {
      const chronicle = getComponent(nextState, entityId, ComponentType.Chronicle) as ChronicleComponent | undefined;
      const identity = getComponent(nextState, entityId, ComponentType.Identity) as IdentityComponent | undefined;
      const name = identity?.name || areaId;

      if (chronicle) {
        const eventPool = nextState.campaign.worldEvents?.areaEvents?.length
          ? nextState.campaign.worldEvents.areaEvents
          : [...AREA_NARRATIVE_EVENTS];
        const chosenEvent = rng.getItem(eventPool)!;

        const eventId = `evt_world_${nextState.globalTurn}_${areaId}`;

        nextState = {
          ...nextState,
          events: [
            ...nextState.events,
            {
              id: eventId,
              importance: 'normal',
              summary: `${name} ${chosenEvent}`,
              type: GameEventType.WorldEventFired,
              entityId
            }
          ]
        };

        nextState = recordChronicleEvent(nextState, entityId, eventId);
      }
    }
  }

  // 2. Process Faction Events
  for (const [factionId, entityId] of Object.entries(nextState.factionEntityIds)) {
    if (rng.getUniform() < WORLD_EVENT_FACTION_CHANCE) {
      const chronicle = getComponent(nextState, entityId, ComponentType.Chronicle) as ChronicleComponent | undefined;
      const identity = getComponent(nextState, entityId, ComponentType.Identity) as IdentityComponent | undefined;
      const name = identity?.name || factionId;

      if (chronicle) {
        const eventPool = nextState.campaign.worldEvents?.factionEvents?.length
          ? nextState.campaign.worldEvents.factionEvents
          : [...FACTION_NARRATIVE_EVENTS];
        const chosenEvent = rng.getItem(eventPool)!;

        const eventId = `evt_world_${nextState.globalTurn}_${factionId}`;

        nextState = {
          ...nextState,
          events: [
            ...nextState.events,
            {
              id: eventId,
              importance: 'normal',
              summary: `${name} ${chosenEvent}`,
              type: GameEventType.WorldEventFired,
              entityId
            }
          ]
        };

        nextState = recordChronicleEvent(nextState, entityId, eventId);
      }
    }
  }

  return nextState;
}
