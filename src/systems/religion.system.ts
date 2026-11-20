import { addComponent, getComponent, resolveEntityDisplayName } from '../core/ecs.ts';
import { ComponentType, type ReligionComponent } from '../types/components.types.ts';
import type { EntityId, GameState } from '../types/game-state.types.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';

/** Default penance debt added when an actor violates one of their deity/patron's taboos (`10`). */
export const DEFAULT_TABOO_PENANCE_DEBT = 10;

/** Favor penalty applied when an actor violates a taboo (`-15`). */
export const DEFAULT_TABOO_FAVOR_PENALTY = -15;

/**
 * Adjusts an actor's `ReligionComponent.favorScore` with their patron deity (`deityOrPatronId`),
 * initializing the component if not yet present.
 *
 * @param state Current immutable GameState.
 * @param actorId Worshipping actor EntityId.
 * @param delta Signed favor adjustment (`+` for offerings/vows, `-` for transgressions).
 * @param deityOrPatronId Optional deity ID if initializing a new `ReligionComponent`.
 * @returns Updated GameState and new `favorScore`.
 */
export function recordDeityFavorDelta(
  state: GameState,
  actorId: EntityId,
  delta: number,
  deityOrPatronId = 'pelor'
): { readonly state: GameState; readonly favorScore: number } {
  const existing = getComponent(state, actorId, ComponentType.Religion) as ReligionComponent | undefined;
  const nextFavor = (existing?.favorScore ?? 0) + Math.trunc(delta);
  const updated: ReligionComponent = {
    type: ComponentType.Religion,
    deityOrPatronId: existing?.deityOrPatronId ?? deityOrPatronId,
    favorScore: nextFavor,
    penanceDebt: existing?.penanceDebt ?? 0,
    taboosViolated: existing?.taboosViolated ?? []
  };

  const nextState = addComponent(state, actorId, updated);
  return { state: nextState, favorScore: nextFavor };
}

/**
 * Records a taboo violation against the actor's deity/patron, incrementing `penanceDebt`,
 * reducing `favorScore`, and appending `tabooId` to `taboosViolated`.
 *
 * @param state Current immutable GameState.
 * @param actorId Actor EntityId.
 * @param tabooId Identifier of the violated taboo (e.g. `'desecrate_altar'`, `'cast_evil_descriptor'`).
 * @param penanceAdded Penance debt added (defaults to `DEFAULT_TABOO_PENANCE_DEBT`).
 * @returns Updated GameState.
 */
export function recordTabooViolation(
  state: GameState,
  actorId: EntityId,
  tabooId: string,
  penanceAdded = DEFAULT_TABOO_PENANCE_DEBT
): GameState {
  const existing = getComponent(state, actorId, ComponentType.Religion) as ReligionComponent | undefined;
  const deityId = existing?.deityOrPatronId ?? 'pelor';
  const nextFavor = (existing?.favorScore ?? 0) + DEFAULT_TABOO_FAVOR_PENALTY;
  const nextPenance = (existing?.penanceDebt ?? 0) + Math.max(1, Math.trunc(penanceAdded));
  const nextTaboos = Array.from(new Set([...(existing?.taboosViolated ?? []), tabooId]));

  let nextState = addComponent(state, actorId, {
    type: ComponentType.Religion,
    deityOrPatronId: deityId,
    favorScore: nextFavor,
    penanceDebt: nextPenance,
    taboosViolated: nextTaboos
  });

  const actorName = resolveEntityDisplayName(nextState, actorId, 'The devotee');
  nextState = addMessage(
    nextState,
    `${actorName} violates a sacred taboo of ${deityId} (${tabooId})! Penance debt is now ${nextPenance}.`,
    MessageLogCategory.System
  );
  return nextState;
}

/**
 * Clears or reduces an actor's `penanceDebt` and `taboosViolated` when praying/offering at a sacred altar or shrine.
 *
 * @param state Current immutable GameState.
 * @param actorId Actor praying or making an offering at an altar.
 * @param atonementAmount Amount of penance debt cleared (defaults to full clearance).
 * @param favorGranted Bonus favor granted upon atonement (defaults to `5`).
 * @returns `{ state, success, remainingPenanceDebt }`.
 */
export function atonePenanceAtAltar(
  state: GameState,
  actorId: EntityId,
  atonementAmount?: number,
  favorGranted = 5
): {
  readonly state: GameState;
  readonly success: boolean;
  readonly remainingPenanceDebt: number;
} {
  const existing = getComponent(state, actorId, ComponentType.Religion) as ReligionComponent | undefined;
  if (!existing) {
    return { state, success: false, remainingPenanceDebt: 0 };
  }

  const cleared = atonementAmount !== undefined ? Math.max(0, Math.trunc(atonementAmount)) : existing.penanceDebt;
  const remainingPenanceDebt = Math.max(0, existing.penanceDebt - cleared);
  const nextFavor = existing.favorScore + Math.trunc(favorGranted);

  let nextState = addComponent(state, actorId, {
    ...existing,
    favorScore: nextFavor,
    penanceDebt: remainingPenanceDebt,
    taboosViolated: remainingPenanceDebt === 0 ? [] : existing.taboosViolated
  });

  const actorName = resolveEntityDisplayName(nextState, actorId, 'The devotee');
  nextState = addMessage(
    nextState,
    `${actorName} atones at the altar of ${existing.deityOrPatronId} (Favor: ${nextFavor}, Penance Debt: ${remainingPenanceDebt}).`,
    MessageLogCategory.System
  );

  return {
    state: nextState,
    success: true,
    remainingPenanceDebt
  };
}
