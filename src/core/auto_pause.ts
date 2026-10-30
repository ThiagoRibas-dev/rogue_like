import { getComponent } from './ecs.ts';
import { getSettings } from './settings.ts';
import { addMessage, MessageLogCategory } from '../systems/message.system.ts';
import { type EntityId, type GameState, EngineMode } from '../types/game-state.types.ts';
import { ComponentType } from '../types/components.types.ts';
import { AUTOPAUSE_REASON_LABELS, type AutoPauseReason } from '../constants/autopause.constants.ts';
import { detectAutoPauseSignals } from './auto_pause_signals.ts';

export { resetAutoPauseTracking } from './auto_pause_signals.ts';

/**
 * Evaluates every configured auto-pause trigger for a completed intent and pauses
 * the simulation when one fires in RTwP mode.
 *
 * Runs after all stabilisation and cadence systems but before the event drain, so
 * any `EntitySpotted` events appended by the sighting signal are ledgered and
 * presented in the same turn.
 *
 * Only player-initiated intents can trigger a pause, so hostile AI turns never
 * interrupt the simulation.
 *
 * @param before State prior to the intent, used for status-effect diffing.
 * @param after State after stabilisation and cadence systems ran.
 * @param actorEntityId The entity whose intent was resolved.
 * @returns The resulting state, paused and with sighting events appended when applicable.
 */
export function evaluateAutoPause(before: GameState, after: GameState, actorEntityId: EntityId): GameState {
  const isPlayerAction = getComponent(after, actorEntityId, ComponentType.Player) !== undefined;
  if (!isPlayerAction) return after;
  if (after.engineMode !== EngineMode.RTwP) return after;
  if (after.rtwpState.paused) return after;

  const signals = detectAutoPauseSignals(before, after, getSettings().autoPause);
  if (signals.reason === undefined) return signals.state;

  return pauseWithMessage(signals.state, signals.reason);
}

/**
 * Pauses the simulation and records why, so the player always understands the stop.
 *
 * @param state The current GameState.
 * @param reason The trigger that fired.
 * @returns The paused GameState with a system message appended.
 */
function pauseWithMessage(state: GameState, reason: AutoPauseReason): GameState {
  const paused: GameState = { ...state, rtwpState: { ...state.rtwpState, paused: true } };
  return addMessage(paused, `Auto-paused: ${AUTOPAUSE_REASON_LABELS[reason]}.`, MessageLogCategory.System);
}
