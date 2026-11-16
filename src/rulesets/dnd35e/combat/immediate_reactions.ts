import { addComponent, consumeResourcePool, getComponent } from '../../../core/ecs.ts';
import { addFloatingText } from '../../../systems/damage.system.ts';
import { addMessage, MessageLogCategory } from '../../../systems/message.system.ts';
import { applyStatusEffect } from '../../../systems/status-effect.system.ts';
import {
  ComponentType,
  type FighterComponent,
  type IdentityComponent,
  type PositionComponent,
  type ResourcePoolComponent,
  type StatusEffectsComponent,
  type TacticalDoctrineComponent,
  type TagsComponent
} from '../../../types/components.types.ts';
import { EngineMode, type EntityId, type GameState } from '../../../types/game-state.types.ts';
import { coordToIndex, isInBounds } from '../../../utils/grid.ts';
import { isHostile } from '../../../utils/faction.ts';
import { useImmediateAction } from '../action_economy_reactions.ts';
import { evaluateDnD35eEntityDAG } from '../cartridge/dnd35e_dag_adapter.ts';
import { hydrateEntityRoundActionBudget } from '../cartridge/dnd35e_turn_budget.ts';
import { evaluateCover } from '../spatial/cover_senses.ts';
import { syncSpatialFlankingGraph } from '../spatial/flanking_graph.ts';
import { FEET_PER_GRID_SQUARE, SIZE_METRICS } from '../spatial/grid_geometry.ts';
import { getDnD35EntityData, setDnD35EntityData } from '../srd_registry.ts';

/** Maximum range of Abrupt Jaunt in grid squares (`2` tiles = `10 ft`). */
export const ABRUPT_JAUNT_MAX_TILES = 2;

/** Duration of Invisible Fist invisibility status in rounds (`1`). */
export const INVISIBLE_FIST_DURATION_ROUNDS = 1;

/** Cooldown of Invisible Fist in rounds (`3`). */
export const INVISIBLE_FIST_COOLDOWN_ROUNDS = 3;

/** Status effect ID for active invisibility granted by Invisible Fist. */
export const INVISIBLE_ACTIVE_STATUS_ID = 'invisible_active';

/** Status effect ID tracking the 3-round cooldown on Invisible Fist. */
export const INVISIBLE_FIST_COOLDOWN_STATUS_ID = 'invisible_fist_cooldown';

function buildIsWallAt(state: GameState): (x: number, y: number) => boolean {
  return (x: number, y: number): boolean => {
    if (!isInBounds(x, y, state.map.width, state.map.height)) return true;
    const tile = state.map.tiles[coordToIndex(x, y, state.map.width)];
    if (!tile) return true;
    const def = state.campaign.tiles[tile.tileId];
    return def === undefined || !def.transparent;
  };
}

function isTileValidJauntDestination(
  state: GameState,
  actorId: EntityId,
  actorPos: PositionComponent,
  targetX: number,
  targetY: number
): boolean {
  if (!isInBounds(targetX, targetY, state.map.width, state.map.height)) return false;
  const distTiles = Math.max(Math.abs(targetX - actorPos.x), Math.abs(targetY - actorPos.y));
  if (distTiles < 1 || distTiles > ABRUPT_JAUNT_MAX_TILES) return false;

  const tile = state.map.tiles[coordToIndex(targetX, targetY, state.map.width)];
  const tileDef = tile ? state.campaign.tiles[tile.tileId] : undefined;
  if (!tileDef?.walkable) return false;

  const occupants = state.spatialIndex.get(`${targetX},${targetY}`) ?? [];
  for (const occId of occupants) {
    if (occId === actorId) continue;
    const isBlockingActor =
      getComponent(state, occId, ComponentType.Fighter) !== undefined ||
      getComponent(state, occId, ComponentType.Actor) !== undefined;
    const tags = (getComponent(state, occId, ComponentType.Tags) as TagsComponent | undefined)?.tags ?? [];
    if (isBlockingActor || tags.includes('solid')) return false;
  }

  const cover = evaluateCover(actorPos, { x: targetX, y: targetY }, buildIsWallAt(state));
  return !cover.blocksLineOfEffect;
}

/**
 * Executes Monk's **Invisible Fist** immediate action ability (`Exemplars of Evil p. 21`):
 * - Checks 3-round cooldown (`invisible_fist_cooldown`).
 * - Consumes an Immediate Action (`useImmediateAction`).
 * - Applies `invisible_active` (`1` round) and `invisible_fist_cooldown` (`3` rounds).
 */
export function executeInvisibleFistImmediate(
  state: GameState,
  actorId: EntityId,
  isOnTurn: boolean
): { readonly state: GameState; readonly success: boolean } {
  const poolComp = getComponent(state, actorId, ComponentType.ResourcePool) as ResourcePoolComponent | undefined;
  const entry = poolComp?.pools['invisible_fist'];
  if (!entry || entry.current <= 0) {
    return {
      state: addMessage(state, 'Invisible Fist: No uses remaining.', MessageLogCategory.System),
      success: false
    };
  }

  const statuses = getComponent(state, actorId, ComponentType.StatusEffects) as StatusEffectsComponent | undefined;
  const cooldownEntry = statuses?.activeEffects.find((e) => e.effectId === INVISIBLE_FIST_COOLDOWN_STATUS_ID);
  if (cooldownEntry && cooldownEntry.duration > 0) {
    return {
      state: addMessage(
        state,
        `Invisible Fist is on cooldown (${cooldownEntry.duration} rounds remaining).`,
        MessageLogCategory.System
      ),
      success: false
    };
  }

  const dndData = getDnD35EntityData(state, actorId);
  const activeBudget = dndData.actionBudget ?? hydrateEntityRoundActionBudget(state, actorId);
  const immRes = useImmediateAction(activeBudget, isOnTurn);
  if (!immRes.allowed && state.engineMode === EngineMode.TurnBased) {
    return {
      state: addMessage(state, 'Invisible Fist: No Swift or Immediate Action available.', MessageLogCategory.System),
      success: false
    };
  }

  const consumed = consumeResourcePool(state, actorId, 'invisible_fist', 1);
  if (!consumed.allowed) {
    return {
      state: addMessage(state, 'Invisible Fist: Unable to consume pool charge.', MessageLogCategory.System),
      success: false
    };
  }

  let nextState = consumed.state;
  nextState = setDnD35EntityData(nextState, actorId, {
    ...getDnD35EntityData(nextState, actorId),
    actionBudget: immRes.allowed ? immRes.budget : activeBudget
  });

  nextState = applyStatusEffect(
    nextState,
    actorId,
    INVISIBLE_ACTIVE_STATUS_ID,
    INVISIBLE_FIST_DURATION_ROUNDS,
    actorId
  );
  nextState = applyStatusEffect(
    nextState,
    actorId,
    INVISIBLE_FIST_COOLDOWN_STATUS_ID,
    INVISIBLE_FIST_COOLDOWN_ROUNDS,
    actorId
  );
  nextState = addFloatingText(nextState, actorId, 'INVISIBLE!', '#a29bfe');
  nextState = addMessage(
    nextState,
    `[Immediate Action] Invisible Fist turns you invisible for ${INVISIBLE_FIST_DURATION_ROUNDS} round (3-round cooldown)!`,
    MessageLogCategory.System
  );
  return { state: nextState, success: true };
}

/**
 * Initiates interactive two-step targeting mode (`maxRangeTiles: 2` = `10 ft`) for **Abrupt Jaunt**
 * without spending the Immediate Action or daily charge until the target tile is confirmed.
 */
export function initiateAbruptJauntTargeting(
  state: GameState,
  actorId: EntityId
): { readonly state: GameState; readonly success: boolean } {
  const poolComp = getComponent(state, actorId, ComponentType.ResourcePool) as ResourcePoolComponent | undefined;
  const entry = poolComp?.pools['abrupt_jaunt'];
  if (!entry || entry.current <= 0) {
    return {
      state: addMessage(state, 'Abrupt Jaunt: No uses remaining today.', MessageLogCategory.System),
      success: false
    };
  }

  const dndData = getDnD35EntityData(state, actorId);
  const activeBudget = dndData.actionBudget ?? hydrateEntityRoundActionBudget(state, actorId);
  const immCheck = useImmediateAction(activeBudget, true);
  if (!immCheck.allowed && state.engineMode === EngineMode.TurnBased) {
    return {
      state: addMessage(state, 'Abrupt Jaunt: No Swift or Immediate Action available.', MessageLogCategory.System),
      success: false
    };
  }

  const pos = getComponent(state, actorId, ComponentType.Position) as PositionComponent | undefined;
  if (!pos) return { state, success: false };

  return {
    state: addMessage(
      {
        ...state,
        targetingMode: {
          active: true,
          x: pos.x,
          y: pos.y,
          maxRangeTiles: ABRUPT_JAUNT_MAX_TILES,
          context: { verb: 'abrupt_jaunt' }
        }
      },
      'Abrupt Jaunt active (10 ft immediate teleport). Select destination tile and confirm.',
      MessageLogCategory.System
    ),
    success: true
  };
}

/**
 * Executes Conjurer's **Abrupt Jaunt** immediate-action 10-ft spatial teleportation:
 * Validates range (`1..2` tiles), walkability, unoccupied tile, Line of Effect, pool charges, and
 * Immediate Action budget, then updates `PositionComponent`, `fovNeedsUpdate`, and the Relational Flanking Graph.
 */
export function executeAbruptJauntTeleport(
  state: GameState,
  actorId: EntityId,
  targetX: number,
  targetY: number,
  isOnTurn: boolean
): { readonly state: GameState; readonly success: boolean } {
  const actorPos = getComponent(state, actorId, ComponentType.Position) as PositionComponent | undefined;
  if (!actorPos) return { state, success: false };

  const poolComp = getComponent(state, actorId, ComponentType.ResourcePool) as ResourcePoolComponent | undefined;
  const entry = poolComp?.pools['abrupt_jaunt'];
  if (!entry || entry.current <= 0) {
    return {
      state: addMessage(state, 'Abrupt Jaunt: No uses remaining today.', MessageLogCategory.System),
      success: false
    };
  }

  if (!isTileValidJauntDestination(state, actorId, actorPos, targetX, targetY)) {
    return {
      state: addMessage(
        state,
        'Abrupt Jaunt: Destination must be an unoccupied, visible walkable square within 10 ft.',
        MessageLogCategory.System
      ),
      success: false
    };
  }

  const dndData = getDnD35EntityData(state, actorId);
  const activeBudget = dndData.actionBudget ?? hydrateEntityRoundActionBudget(state, actorId);
  const immRes = useImmediateAction(activeBudget, isOnTurn);
  if (!immRes.allowed && state.engineMode === EngineMode.TurnBased) {
    return {
      state: addMessage(state, 'Abrupt Jaunt: No Swift or Immediate Action available.', MessageLogCategory.System),
      success: false
    };
  }

  const consumed = consumeResourcePool(state, actorId, 'abrupt_jaunt', 1);
  if (!consumed.allowed) {
    return {
      state: addMessage(state, 'Abrupt Jaunt: Unable to consume pool charge.', MessageLogCategory.System),
      success: false
    };
  }

  let nextState = consumed.state;
  nextState = setDnD35EntityData(nextState, actorId, {
    ...getDnD35EntityData(nextState, actorId),
    actionBudget: immRes.allowed ? immRes.budget : activeBudget
  });

  nextState = addComponent(nextState, actorId, {
    type: ComponentType.Position,
    x: targetX,
    y: targetY
  });

  if (getComponent(nextState, actorId, ComponentType.Player) !== undefined) {
    nextState = { ...nextState, fovNeedsUpdate: true };
  }

  nextState = syncSpatialFlankingGraph(nextState);
  const actorName =
    (getComponent(nextState, actorId, ComponentType.Identity) as IdentityComponent | undefined)?.name ?? 'Actor';
  const distFt = Math.max(Math.abs(targetX - actorPos.x), Math.abs(targetY - actorPos.y)) * FEET_PER_GRID_SQUARE;
  nextState = addFloatingText(nextState, actorId, 'JAUNT!', '#74b9ff');
  nextState = addMessage(
    nextState,
    `[Immediate Action] ${actorName} abruptly jaunts ${distFt} ft to (${targetX}, ${targetY})!`,
    MessageLogCategory.System
  );
  return { state: nextState, success: true };
}

function findBestEvadeTile(
  state: GameState,
  defenderId: EntityId,
  defenderPos: PositionComponent,
  threatPos: PositionComponent
): { readonly x: number; readonly y: number } | undefined {
  let bestTile: { readonly x: number; readonly y: number } | undefined;
  let bestDist = Math.max(Math.abs(defenderPos.x - threatPos.x), Math.abs(defenderPos.y - threatPos.y));

  for (let dy = -ABRUPT_JAUNT_MAX_TILES; dy <= ABRUPT_JAUNT_MAX_TILES; dy++) {
    for (let dx = -ABRUPT_JAUNT_MAX_TILES; dx <= ABRUPT_JAUNT_MAX_TILES; dx++) {
      if (dx === 0 && dy === 0) continue;
      const cx = defenderPos.x + dx;
      const cy = defenderPos.y + dy;
      if (!isTileValidJauntDestination(state, defenderId, defenderPos, cx, cy)) continue;
      const distFromThreat = Math.max(Math.abs(cx - threatPos.x), Math.abs(cy - threatPos.y));
      if (distFromThreat > bestDist) {
        bestDist = distFromThreat;
        bestTile = { x: cx, y: cy };
      }
    }
  }
  return bestTile;
}

/**
 * Evaluates armed off-turn Immediate Action reaction policies on `defenderId` when a triggering
 * hostile event occurs (`on_enemy_adjacent_move`, `before_melee_attack`, or `before_any_attack`).
 */
export function evaluateOffTurnImmediateReactions(
  state: GameState,
  triggerWindow: 'on_enemy_adjacent_move' | 'before_melee_attack' | 'before_any_attack',
  triggeringActorId: EntityId,
  defenderId: EntityId
): { readonly state: GameState; readonly triggered: boolean; readonly defenderTeleportedOutOfReach: boolean } {
  if (triggeringActorId === defenderId || !isHostile(state, triggeringActorId, defenderId)) {
    return { state, triggered: false, defenderTeleportedOutOfReach: false };
  }

  const doctrine = getComponent(state, defenderId, ComponentType.TacticalDoctrine) as
    TacticalDoctrineComponent | undefined;
  const policies = doctrine?.reactionPolicies;
  if (!policies) {
    return { state, triggered: false, defenderTeleportedOutOfReach: false };
  }

  const matchesWindow = (policyTrigger: string): boolean => {
    if (policyTrigger === 'off') return false;
    if (policyTrigger === triggerWindow) return true;
    return policyTrigger === 'before_any_attack' && triggerWindow === 'before_melee_attack';
  };

  let runningState = state;
  let triggered = false;
  let defenderTeleportedOutOfReach = false;

  const jauntPolicy = policies['abrupt_jaunt'];
  if (jauntPolicy?.enabled && matchesWindow(jauntPolicy.trigger)) {
    const defPos = getComponent(runningState, defenderId, ComponentType.Position) as PositionComponent | undefined;
    const atkPos = getComponent(runningState, triggeringActorId, ComponentType.Position) as
      PositionComponent | undefined;
    if (defPos && atkPos) {
      const evadeTile = findBestEvadeTile(runningState, defenderId, defPos, atkPos);
      if (evadeTile) {
        const res = executeAbruptJauntTeleport(runningState, defenderId, evadeTile.x, evadeTile.y, false);
        if (res.success) {
          runningState = res.state;
          triggered = true;
          const atkEval = evaluateDnD35eEntityDAG(runningState, triggeringActorId);
          const atkSize = atkEval?.dagResult.effectiveSize ?? 'medium';
          const atkReachFt = SIZE_METRICS[atkSize]?.naturalReachTallFt ?? FEET_PER_GRID_SQUARE;
          const reachTiles = Math.max(1, Math.floor(atkReachFt / FEET_PER_GRID_SQUARE));
          const newDist = Math.max(Math.abs(evadeTile.x - atkPos.x), Math.abs(evadeTile.y - atkPos.y));
          defenderTeleportedOutOfReach = newDist > reachTiles;
          return { state: runningState, triggered, defenderTeleportedOutOfReach };
        }
      }
    }
  }

  const invPolicy = policies['invisible_fist'];
  if (invPolicy?.enabled && matchesWindow(invPolicy.trigger)) {
    const res = executeInvisibleFistImmediate(runningState, defenderId, false);
    if (res.success) {
      runningState = res.state;
      triggered = true;
    }
  }

  return { state: runningState, triggered, defenderTeleportedOutOfReach };
}

/** Cycles a reaction policy between `'off'`, `'before_melee_attack'`, `'before_any_attack'`, and `'on_enemy_adjacent_move'`. */
export function getNextReactionTrigger(
  currentTrigger: string | undefined
): 'off' | 'before_melee_attack' | 'before_any_attack' | 'on_enemy_adjacent_move' {
  switch (currentTrigger) {
    case 'before_melee_attack':
      return 'before_any_attack';
    case 'before_any_attack':
      return 'on_enemy_adjacent_move';
    case 'on_enemy_adjacent_move':
      return 'off';
    default:
      return 'before_melee_attack';
  }
}

/** Exposes living hostile adjacent defenders for movement-step reaction checks. */
export function evaluateAdjacentEnemyReactionsOnMove(
  state: GameState,
  moverId: EntityId,
  toPos: { readonly x: number; readonly y: number }
): GameState {
  let runningState = state;
  for (const candId of state.entities) {
    if (candId === moverId) continue;
    const candFighter = getComponent(runningState, candId, ComponentType.Fighter) as FighterComponent | undefined;
    const candPos = getComponent(runningState, candId, ComponentType.Position) as PositionComponent | undefined;
    if (!candFighter || candFighter.hp <= 0 || !candPos) continue;
    if (!isHostile(runningState, moverId, candId)) continue;
    const distTiles = Math.max(Math.abs(candPos.x - toPos.x), Math.abs(candPos.y - toPos.y));
    if (distTiles <= 1) {
      const res = evaluateOffTurnImmediateReactions(runningState, 'on_enemy_adjacent_move', moverId, candId);
      runningState = res.state;
    }
  }
  return runningState;
}
