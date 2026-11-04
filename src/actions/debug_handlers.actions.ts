import type { GameState, EntityId } from '../types/game-state.types.ts';
import type { DebugFastForwardSchemesIntent } from '../types/intents/debug.intents.ts';
import { getComponent, spawnEntity, removeComponent, addComponent } from '../core/ecs.ts';
import { addActor } from '../core/scheduler.ts';
import { addMessage, MessageLogCategory } from '../systems/message.system.ts';
import { processSchemeTurn } from '../systems/scheme.system.ts';
import { processRivalries } from '../systems/rivalry.system.ts';
import { promoteEntity } from '../systems/chronicle.system.ts';
import { ComponentType, type GodModeComponent, type SchemeComponent } from '../types/components.types.ts';
import { GameEventType, type ClueDiscoveredEvent, type SchemeMutatedAreaEvent } from '../types/events.types.ts';
import { coordToIndex } from '../utils/grid.ts';

/**
 * Toggles full map exploration visibility for debugging.
 */
export function processDebugRevealMap(state: GameState): { state: GameState; success: boolean } {
  const nextMap = { ...state.map, isFullyExplored: !state.map.isFullyExplored };
  const msg = nextMap.isFullyExplored ? '[DEBUG] Map Revealed.' : '[DEBUG] Map Hidden.';
  return { state: addMessage({ ...state, map: nextMap }, msg, MessageLogCategory.System), success: false };
}

/**
 * Toggles God Mode on an entity.
 */
export function processDebugGodMode(state: GameState, entityId: EntityId): { state: GameState; success: boolean } {
  const hasGodMode = getComponent(state, entityId, ComponentType.GodMode) !== undefined;
  if (hasGodMode) {
    return {
      state: addMessage(
        removeComponent(state, entityId, ComponentType.GodMode),
        '[DEBUG] God Mode Disabled.',
        MessageLogCategory.System
      ),
      success: false
    };
  }
  const godCmp: GodModeComponent = { type: ComponentType.GodMode };
  return {
    state: addMessage(addComponent(state, entityId, godCmp), '[DEBUG] God Mode Enabled.', MessageLogCategory.System),
    success: false
  };
}

/**
 * Spawns a dummy Orc adjacent to the target entity for debugging.
 */
export function processDebugSpawnEntity(state: GameState, entityId: EntityId): { state: GameState; success: boolean } {
  const pos = getComponent(state, entityId, ComponentType.Position);
  if (!pos) return { state, success: false };

  const neighbors = [
    { x: pos.x + 1, y: pos.y },
    { x: pos.x - 1, y: pos.y },
    { x: pos.x, y: pos.y + 1 },
    { x: pos.x, y: pos.y - 1 }
  ];

  let spawnX = -1;
  let spawnY = -1;

  for (const n of neighbors) {
    const idx = coordToIndex(n.x, n.y, state.map.width);
    const tile = state.map.tiles[idx];
    if (tile && state.campaign.tiles[tile.tileId]?.walkable) {
      const entitiesAt = state.spatialIndex.get(`${n.x},${n.y}`);
      if (!entitiesAt || entitiesAt.length === 0) {
        spawnX = n.x;
        spawnY = n.y;
        break;
      }
    }
  }

  if (spawnX === -1) {
    return {
      state: addMessage(state, '[DEBUG] No room to spawn entity.', MessageLogCategory.System),
      success: false
    };
  }

  const [stateAfterSpawn, newEntityId] = spawnEntity(state, 'orc', spawnX, spawnY);
  const nextState = stateAfterSpawn;
  const actor = getComponent(nextState, newEntityId, ComponentType.Actor);
  if (actor) {
    addActor(newEntityId);
  }

  return {
    state: addMessage(nextState, `[DEBUG] Spawned dummy Orc at ${spawnX}, ${spawnY}.`, MessageLogCategory.System),
    success: false
  };
}

/**
 * Fast-forwards all active mastermind schemes and rivalries by N iterations.
 */
export function processDebugFastForwardSchemes(
  state: GameState,
  intentFF: DebugFastForwardSchemesIntent
): { state: GameState; success: boolean } {
  let nextState = state;

  const masterminds: EntityId[] = [];
  for (const id of state.entities) {
    if (getComponent(state, id, ComponentType.Scheme)) masterminds.push(id);
  }
  for (const [id, record] of state.persistentEntities.entries()) {
    if (record.components[ComponentType.Scheme]) masterminds.push(id);
  }

  if (masterminds.length === 0) {
    return {
      state: addMessage(state, '[DEBUG] No masterminds found to fast-forward.', MessageLogCategory.System),
      success: false
    };
  }

  const startEventCount = nextState.events.length;
  for (let i = 0; i < intentFF.iterations; i++) {
    nextState = { ...nextState, globalTurn: nextState.globalTurn + 1 };
    for (const mastermindId of masterminds) {
      nextState = processSchemeTurn(nextState, mastermindId);
    }
    nextState = processRivalries(nextState);
  }

  const newEvents = nextState.events.slice(startEventCount);
  const schemeMutations = newEvents.filter(
    (e) => e.type === GameEventType.SchemeMutatedArea
  ) as SchemeMutatedAreaEvent[];
  for (const mut of schemeMutations) {
    nextState = addMessage(
      nextState,
      `[SIM-RECEIPT] Area mutated: ${mut.areaId} -> tags added: [${mut.tagsAdded.join(', ')}], budget mod: +${mut.budgetModifier}`,
      MessageLogCategory.System
    );
  }

  let cluesInjected = 0;
  for (const mastermindId of masterminds) {
    const schemeComp = getComponent(nextState, mastermindId, ComponentType.Scheme) as SchemeComponent | undefined;
    if (!schemeComp) continue;

    for (const minionId of schemeComp.activeMinions) {
      const clueEvent: ClueDiscoveredEvent = {
        type: GameEventType.ClueDiscovered,
        clueId: `simulated_clue_${minionId}`,
        sourceEntityId: minionId,
        implicatesEntityId: mastermindId
      };
      nextState = { ...nextState, events: [...nextState.events, clueEvent] };
      cluesInjected++;
    }
  }

  nextState = addMessage(
    nextState,
    `[DEBUG] Fast-forwarded schemes ${intentFF.iterations} turns. Injected ${cluesInjected} simulated clues.`,
    MessageLogCategory.System
  );

  return { state: nextState, success: false };
}

/**
 * Promotes the first available non-player actor to a notable character for debugging.
 */
export function processDebugPromote(state: GameState, entityId: EntityId): { state: GameState; success: boolean } {
  const pos = getComponent(state, entityId, ComponentType.Position);
  if (!pos) return { state, success: false };

  let targetEntityId: EntityId | undefined;
  for (const eId of state.entities) {
    if (eId === entityId) continue;
    const eActor = getComponent(state, eId, ComponentType.Actor);
    const ePos = getComponent(state, eId, ComponentType.Position);
    if (eActor && ePos) {
      targetEntityId = eId;
      break;
    }
  }

  if (targetEntityId) {
    const nextState = promoteEntity(state, targetEntityId);
    return {
      state: addMessage(
        nextState,
        `[DEBUG] Promoted entity ${targetEntityId} to a notable character.`,
        MessageLogCategory.System
      ),
      success: false
    };
  }

  return {
    state: addMessage(state, `[DEBUG] No actors available to promote.`, MessageLogCategory.System),
    success: false
  };
}
