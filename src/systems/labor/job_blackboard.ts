import type { ColonySimulationState, JobReservationToken } from '../../types/colony.types.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';

/** Default lease duration (turns) for an atomic blackboard reservation before automatic expiry. */
export const DEFAULT_RESERVATION_TTL_TURNS = 40 as const;

/** Ensures `state.colonyState` exists with empty registries when initialized lazily. */
export function ensureColonyState(state: GameState): ColonySimulationState {
  return (
    state.colonyState ?? {
      designations: {},
      stockpiles: {},
      reservations: {},
      workshops: {},
      timedTerrainReverts: []
    }
  );
}

/** Builds a canonical resource lock key for a 3D map voxel inside `areaId`. */
export function tileResourceKey(areaId: string, x: number, y: number, z = 0): string {
  return `tile:${areaId}:${x},${y},${z}`;
}

/** Builds a canonical resource lock key for a target entity or loose item. */
export function entityResourceKey(entityId: EntityId): string {
  return `entity:${entityId}`;
}

/** Builds a canonical resource lock key for a workshop station entity. */
export function workshopResourceKey(workshopEntityId: EntityId): string {
  return `workshop:${workshopEntityId}`;
}

/** Returns `true` when `resourceKey` currently holds an unexpired lease belonging to a different worker. */
export function isResourceReservedByOther(
  state: Readonly<GameState>,
  resourceKey: string,
  workerEntityId: EntityId
): boolean {
  const token = state.colonyState?.reservations[resourceKey];
  if (!token) return false;
  if (state.globalTurn >= token.expiresAtTurn) return false;
  return token.workerEntityId !== workerEntityId;
}

/**
 * Atomically claims all `resourceKeys` for `workerEntityId` and `jobId`.
 * Fails cleanly with zero partial locks if any requested key is already reserved by another active worker.
 */
export function tryAcquireReservation(
  state: GameState,
  resourceKeys: ReadonlyArray<string>,
  jobId: string,
  workerEntityId: EntityId,
  ttlTurns: number = DEFAULT_RESERVATION_TTL_TURNS
): { readonly state: GameState; readonly acquired: boolean } {
  if (resourceKeys.length === 0) {
    return { state, acquired: true };
  }

  const colony = ensureColonyState(state);
  const currentTurn = state.globalTurn ?? 0;

  for (const key of resourceKeys) {
    const existing = colony.reservations[key];
    if (existing && currentTurn < existing.expiresAtTurn && existing.workerEntityId !== workerEntityId) {
      return { state, acquired: false };
    }
  }

  const nextReservations: Record<string, JobReservationToken> = { ...colony.reservations };
  const expiresAtTurn = currentTurn + Math.max(1, ttlTurns);

  for (const key of resourceKeys) {
    nextReservations[key] = {
      tokenId: `${jobId}:${key}:${workerEntityId}`,
      resourceKey: key,
      jobId,
      workerEntityId,
      acquiredTurn: currentTurn,
      expiresAtTurn
    };
  }

  return {
    state: {
      ...state,
      colonyState: {
        ...colony,
        reservations: nextReservations
      }
    },
    acquired: true
  };
}

/** Releases explicit reservation keys held by `workerEntityId` (or all if omitted). */
export function releaseReservation(
  state: GameState,
  resourceKeys: ReadonlyArray<string>,
  workerEntityId?: EntityId
): GameState {
  const colony = state.colonyState;
  if (!colony || resourceKeys.length === 0) return state;

  let changed = false;
  const nextReservations: Record<string, JobReservationToken> = { ...colony.reservations };
  for (const key of resourceKeys) {
    const existing = nextReservations[key];
    if (!existing) continue;
    if (workerEntityId !== undefined && existing.workerEntityId !== workerEntityId) continue;
    delete nextReservations[key];
    changed = true;
  }

  if (!changed) return state;
  return {
    ...state,
    colonyState: {
      ...colony,
      reservations: nextReservations
    }
  };
}

/** Releases every active reservation token held by `workerEntityId` (used on death or chunk sleep eviction). */
export function releaseAllWorkerReservations(state: GameState, workerEntityId: EntityId): GameState {
  const colony = state.colonyState;
  if (!colony) return state;

  let changed = false;
  const nextReservations: Record<string, JobReservationToken> = {};
  for (const [key, token] of Object.entries(colony.reservations)) {
    if (token.workerEntityId === workerEntityId) {
      changed = true;
    } else {
      nextReservations[key] = token;
    }
  }

  if (!changed) return state;
  return {
    ...state,
    colonyState: {
      ...colony,
      reservations: nextReservations
    }
  };
}

/** Purges all expired reservation tokens from `state.colonyState.reservations`. */
export function pruneExpiredReservations(state: GameState): GameState {
  const colony = state.colonyState;
  if (!colony) return state;

  const currentTurn = state.globalTurn ?? 0;
  let changed = false;
  const nextReservations: Record<string, JobReservationToken> = {};
  for (const [key, token] of Object.entries(colony.reservations)) {
    if (currentTurn >= token.expiresAtTurn) {
      changed = true;
    } else {
      nextReservations[key] = token;
    }
  }

  if (!changed) return state;
  return {
    ...state,
    colonyState: {
      ...colony,
      reservations: nextReservations
    }
  };
}
