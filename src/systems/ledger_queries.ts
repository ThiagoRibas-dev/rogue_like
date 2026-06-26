import { type GameState, type EntityId } from '../types/game-state.types.ts';
import { type BaseGameEvent } from '../types/events.types.ts';

/**
 * Retrieves all events from the ledger that involve a specific entity.
 * Checks common event fields like entityId, targetEntityId, and implicatesEntityId.
 *
 * @param state The GameState containing the historical ledger.
 * @param entityId The EntityId to search for.
 * @returns An array of events involving the entity.
 */
export function getEventsForEntity(state: Readonly<GameState>, entityId: EntityId): ReadonlyArray<BaseGameEvent> {
  return state.historicalLedger.filter((event) => {
    const e = event as unknown as Record<string, unknown>;
    return (
      e.entityId === entityId ||
      e.targetEntityId === entityId ||
      e.implicatesEntityId === entityId ||
      e.sourceEntityId === entityId ||
      e.killerId === entityId
    );
  });
}

/**
 * Retrieves all high-importance events from the ledger.
 * Useful for building a macro-level chronicle of the game's drama.
 *
 * @param state The GameState containing the historical ledger.
 * @returns An array of high importance events.
 */
export function getHighImportanceEvents(state: Readonly<GameState>): ReadonlyArray<BaseGameEvent> {
  return state.historicalLedger.filter((event) => event.importance === 'high');
}

/**
 * Retrieves all events of a specific type.
 *
 * @param state The GameState containing the historical ledger.
 * @param type The type of event to filter by.
 * @returns An array of events matching the specified type.
 */
export function getEventsByType(state: Readonly<GameState>, type: string): ReadonlyArray<BaseGameEvent> {
  return state.historicalLedger.filter((event) => event.type === type);
}
