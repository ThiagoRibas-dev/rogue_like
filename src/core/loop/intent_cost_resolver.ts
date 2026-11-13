import { dispatchAction } from '../../actions/action.registry.ts';
import { syncShareInitiativeCompanionsOnMove } from '../../ai/follow.behavior.ts';
import { ComponentType } from '../../types/components.types.ts';
import { EngineMode, type GameState } from '../../types/game-state.types.ts';
import { IntentType } from '../../types/intents/intent.enum.ts';
import type { ActionResult, Intent } from '../../types/intents/intent.union.ts';
import { getComponent, tickControllerLinksAndOverlays } from '../ecs.ts';
import { pushTelemetryEvents } from '../telemetry.ts';
import { recordTurnSample } from '../performance.ts';
import { getEffectiveStats } from '../../utils/stats.ts';
import type { GameEvent } from '../../types/events.types.ts';
import { resolveActorActionEnergyCost } from '../../systems/lifecycle.system.ts';
import { updateExploredTiles } from '../../systems/map.system.ts';
import { evaluateAutoPause } from '../auto_pause.ts';
import { coordToIndex } from '../../utils/grid.ts';
import { resolveStateStabilization } from '../state_stabilizer.ts';
import { processInvestigationEvents } from '../../systems/investigation.system.ts';
import { processFieldsTick } from '../../systems/field.system.ts';
import { processTier2LocalCadence, processTier3GlobalCadence } from '../simulation_cadence.ts';
import { processLedgerSystem } from '../../systems/ledger.system.ts';

/**
 * Executes an intent and computes its energy cost based on success, ticking systemic narrative side effects.
 *
 * @param state The current game state.
 * @param intent The intent to execute.
 * @returns The updated state, success status, and calculated energy cost.
 */
export function applyIntentWithCost(state: GameState, intent: Intent): ActionResult {
  const turnTime0 = performance.now();
  const result = dispatchAction(state, intent);
  let nextState = result.state;

  let baseEnergyCost = 100;
  if (!result.success) {
    baseEnergyCost = 0;
  } else if ('isImmediate' in intent && intent.isImmediate) {
    baseEnergyCost = 0;
  } else if (intent.type === IntentType.Move) {
    const posAfter = getComponent(nextState, intent.entityId, ComponentType.Position);
    if (posAfter) {
      const tileIdx = coordToIndex(posAfter.x, posAfter.y, state.map.width);
      const tile = state.map.tiles[tileIdx];
      if (tile) {
        baseEnergyCost = state.campaign.tiles[tile.tileId]?.movementCost ?? 100;
      }
    }
  }

  const costResult = resolveActorActionEnergyCost(nextState, intent, baseEnergyCost);
  nextState = costResult.state;
  let energyCost = costResult.energyCost;

  if (energyCost > 0) {
    const actor = getComponent(state, intent.entityId, ComponentType.Actor);
    if (actor) {
      const stats = getEffectiveStats(state, intent.entityId);
      const speed = Math.max(1, stats.speed);
      energyCost = Math.max(1, Math.round((energyCost * 100) / speed));
    }
  }

  if (result.events && result.events.length > 0) {
    nextState = { ...nextState, events: [...nextState.events, ...result.events] };
  }

  const isPlayerMove =
    intent.type === IntentType.Move &&
    result.success &&
    energyCost === 0 &&
    nextState.engineMode === EngineMode.TurnBased &&
    getComponent(nextState, intent.entityId, ComponentType.Player) !== undefined;
  if (isPlayerMove) {
    nextState = syncShareInitiativeCompanionsOnMove(nextState, intent.entityId);
  }
  const tAfterDispatch = performance.now();

  // If intent was an immediate non-gameplay action (e.g. toggling UI modals/settings/overlays)
  // that did not succeed or advance world energy, return early to prevent running world stabilization or cadence.
  const isImmediate = 'isImmediate' in intent && intent.isImmediate;
  if (isImmediate && energyCost === 0 && (!result.events || result.events.length === 0)) {
    return {
      state: nextState,
      success: result.success,
      energyCost: 0,
      events: []
    };
  }

  nextState = resolveStateStabilization(nextState);
  const tAfterStabilization = performance.now();

  const finalResult: ActionResult = { state: nextState, success: result.success, energyCost };

  if (energyCost > 0) {
    nextState = processFieldsTick(nextState);
  }
  nextState = processInvestigationEvents(nextState);
  const tAfterFields = performance.now();

  const isPlayerAction = getComponent(state, intent.entityId, ComponentType.Player) !== undefined;
  const didGlobalTurnAdvance = isPlayerAction && energyCost > 0;

  if (didGlobalTurnAdvance) {
    nextState = tickControllerLinksAndOverlays(nextState);
  }

  nextState = processTier2LocalCadence(nextState, didGlobalTurnAdvance);
  nextState = processTier3GlobalCadence(nextState, didGlobalTurnAdvance);
  nextState = processLedgerSystem(nextState, didGlobalTurnAdvance);
  const tAfterCadence = performance.now();

  nextState = updateExploredTiles(nextState);
  const tAfterFov = performance.now();

  nextState = evaluateAutoPause(state, nextState, intent.entityId);
  const tAfterAutoPause = performance.now();

  const eventsToReturn = [...nextState.events];
  pushTelemetryEvents(eventsToReturn);
  nextState = { ...nextState, events: [] };

  const turnTimeEnd = performance.now();
  recordTurnSample({
    intentType: intent.type,
    actorEntityId: intent.entityId,
    isPlayer: isPlayerAction,
    dispatchActionMs: tAfterDispatch - turnTime0,
    stabilizationMs: tAfterStabilization - tAfterDispatch,
    fieldsAndInvestigationMs: tAfterFields - tAfterStabilization,
    cadenceAndLedgerMs: tAfterCadence - tAfterFields,
    fovAndExploreMs: tAfterFov - tAfterCadence,
    autoPauseMs: tAfterAutoPause - tAfterFov,
    totalTurnMs: turnTimeEnd - turnTime0
  });

  return {
    ...finalResult,
    state: nextState,
    events: eventsToReturn as ReadonlyArray<GameEvent>
  };
}
