import { dispatchAction } from '../../actions/action.registry.ts';
import { ComponentType } from '../../types/components.types.ts';
import type { GameState } from '../../types/game-state.types.ts';
import { IntentType } from '../../types/intents/intent.enum.ts';
import type { ActionResult, Intent } from '../../types/intents/intent.union.ts';
import { getComponent, tickControllerLinksAndOverlays } from '../ecs.ts';
import { pushTelemetryEvents } from '../telemetry.ts';
import { perfTracker } from '../performance.ts';
import { getEffectiveStats } from '../../utils/stats.ts';
import type { GameEvent } from '../../types/events.types.ts';
import { updateExploredTiles } from '../../systems/map.system.ts';
import { evaluateAutoPause } from '../auto_pause.ts';
import { coordToIndex } from '../../utils/grid.ts';
import { processTraps } from '../../systems/trigger.system.ts';
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

  let energyCost = 100;

  if (!result.success) {
    energyCost = 0;
  } else if (intent.type === IntentType.Move) {
    const posAfter = getComponent(nextState, intent.entityId, ComponentType.Position);
    if (posAfter) {
      const tileIdx = coordToIndex(posAfter.x, posAfter.y, state.map.width);
      const tile = state.map.tiles[tileIdx];
      if (tile) {
        energyCost = state.campaign.tiles[tile.tileId]?.movementCost ?? 100;
      }
    }
    nextState = processTraps(nextState, intent.entityId);
  } else if ('isImmediate' in intent && intent.isImmediate) {
    energyCost = 0;
  }

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

  nextState = resolveStateStabilization(nextState);

  const finalResult: ActionResult = { state: nextState, success: result.success, energyCost };

  nextState = processFieldsTick(nextState);
  nextState = processInvestigationEvents(nextState);

  const isPlayerAction = getComponent(state, intent.entityId, ComponentType.Player) !== undefined;
  const didGlobalTurnAdvance = isPlayerAction && energyCost > 0;

  if (didGlobalTurnAdvance) {
    nextState = tickControllerLinksAndOverlays(nextState);
  }

  nextState = processTier2LocalCadence(nextState, didGlobalTurnAdvance);
  nextState = processTier3GlobalCadence(nextState, didGlobalTurnAdvance);
  nextState = processLedgerSystem(nextState, didGlobalTurnAdvance);
  nextState = updateExploredTiles(nextState);
  nextState = evaluateAutoPause(state, nextState, intent.entityId);

  const eventsToReturn = [...nextState.events];
  pushTelemetryEvents(eventsToReturn);
  nextState = { ...nextState, events: [] };

  perfTracker.lastTurnTimeMs = performance.now() - turnTime0;

  return {
    ...finalResult,
    state: nextState,
    events: eventsToReturn as ReadonlyArray<GameEvent>
  };
}
