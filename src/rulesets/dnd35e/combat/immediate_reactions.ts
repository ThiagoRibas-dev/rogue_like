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
  if (!tile || !state.campaign.tiles[tile.tileId]?.walkable) return false;

  const occupants = state.spatialIndex.get(`${targetX},${targetY}`) ?? [];
  for (const occId of occupants) {
    if (occId === actorId) continue;
    const isActor =
      getComponent(state, occId, ComponentType.Fighter) !== undefined ||
      getComponent(state, occId, ComponentType.Actor) !== undefined;
    const tags = (getComponent(state, occId, ComponentType.Tags) as TagsComponent | undefined)?.tags ?? [];
    if (isActor || tags.includes('solid')) return false;
  }

  const isWallAt = (x: number, y: number): boolean => {
    if (!isInBounds(x, y, state.map.width, state.map.height)) return true;
    const t = state.map.tiles[coordToIndex(x, y, state.map.width)];
    return !t || !state.campaign.tiles[t.tileId]?.transparent;
  };
  return !evaluateCover(actorPos, { x: targetX, y: targetY }, isWallAt).blocksLineOfEffect;
}

function tryConsumeImmediatePoolAndAction(
  state: GameState,
  actorId: EntityId,
  poolId: string,
  abilityName: string,
  isOnTurn: boolean
): { readonly state: GameState; readonly allowed: boolean } {
  const poolComp = getComponent(state, actorId, ComponentType.ResourcePool) as ResourcePoolComponent | undefined;
  if ((poolComp?.pools[poolId]?.current ?? 0) <= 0) {
    return {
      state: addMessage(state, `${abilityName}: No uses remaining.`, MessageLogCategory.System),
      allowed: false
    };
  }
  const dndData = getDnD35EntityData(state, actorId);
  const activeBudget = dndData.actionBudget ?? hydrateEntityRoundActionBudget(state, actorId);
  const immRes = useImmediateAction(activeBudget, isOnTurn);
  if (!immRes.allowed && state.engineMode === EngineMode.TurnBased) {
    return {
      state: addMessage(state, `${abilityName}: No Swift or Immediate Action available.`, MessageLogCategory.System),
      allowed: false
    };
  }
  const consumed = consumeResourcePool(state, actorId, poolId, 1);
  if (!consumed.allowed) {
    return {
      state: addMessage(state, `${abilityName}: Unable to consume pool charge.`, MessageLogCategory.System),
      allowed: false
    };
  }
  const nextState = setDnD35EntityData(consumed.state, actorId, {
    ...getDnD35EntityData(consumed.state, actorId),
    actionBudget: immRes.allowed ? immRes.budget : activeBudget
  });
  return { state: nextState, allowed: true };
}

/** Executes Monk's **Invisible Fist** immediate action ability (`Exemplars of Evil p. 21`). */
export function executeInvisibleFistImmediate(
  state: GameState,
  actorId: EntityId,
  isOnTurn: boolean
): { readonly state: GameState; readonly success: boolean } {
  const statuses = getComponent(state, actorId, ComponentType.StatusEffects) as StatusEffectsComponent | undefined;
  const cd = statuses?.activeEffects.find((e) => e.effectId === INVISIBLE_FIST_COOLDOWN_STATUS_ID);
  if (cd && cd.duration > 0) {
    const msg = `Invisible Fist is on cooldown (${cd.duration} rounds remaining).`;
    return { state: addMessage(state, msg, MessageLogCategory.System), success: false };
  }
  const consumed = tryConsumeImmediatePoolAndAction(state, actorId, 'invisible_fist', 'Invisible Fist', isOnTurn);
  if (!consumed.allowed) return { state: consumed.state, success: false };

  let next = applyStatusEffect(
    consumed.state,
    actorId,
    INVISIBLE_ACTIVE_STATUS_ID,
    INVISIBLE_FIST_DURATION_ROUNDS,
    actorId
  );
  next = applyStatusEffect(next, actorId, INVISIBLE_FIST_COOLDOWN_STATUS_ID, INVISIBLE_FIST_COOLDOWN_ROUNDS, actorId);
  next = addFloatingText(next, actorId, 'INVISIBLE!', '#a29bfe');
  const log = `[Immediate Action] Invisible Fist turns you invisible for ${INVISIBLE_FIST_DURATION_ROUNDS} round (3-round cooldown)!`;
  return { state: addMessage(next, log, MessageLogCategory.System), success: true };
}

/** Initiates interactive two-step targeting mode (`maxRangeTiles: 2` = `10 ft`) for **Abrupt Jaunt**. */
export function initiateAbruptJauntTargeting(
  state: GameState,
  actorId: EntityId
): { readonly state: GameState; readonly success: boolean } {
  const poolComp = getComponent(state, actorId, ComponentType.ResourcePool) as ResourcePoolComponent | undefined;
  if ((poolComp?.pools['abrupt_jaunt']?.current ?? 0) <= 0) {
    return {
      state: addMessage(state, 'Abrupt Jaunt: No uses remaining today.', MessageLogCategory.System),
      success: false
    };
  }
  const activeBudget =
    getDnD35EntityData(state, actorId).actionBudget ?? hydrateEntityRoundActionBudget(state, actorId);
  if (!useImmediateAction(activeBudget, true).allowed && state.engineMode === EngineMode.TurnBased) {
    const msg = 'Abrupt Jaunt: No Swift or Immediate Action available.';
    return { state: addMessage(state, msg, MessageLogCategory.System), success: false };
  }
  const pos = getComponent(state, actorId, ComponentType.Position) as PositionComponent | undefined;
  if (!pos) return { state, success: false };

  const targetingMode = {
    active: true,
    x: pos.x,
    y: pos.y,
    maxRangeTiles: ABRUPT_JAUNT_MAX_TILES,
    context: { verb: 'abrupt_jaunt' }
  };
  const prompt = 'Abrupt Jaunt active (10 ft immediate teleport). Select destination tile and confirm.';
  return { state: addMessage({ ...state, targetingMode }, prompt, MessageLogCategory.System), success: true };
}

/** Executes Conjurer's **Abrupt Jaunt** immediate-action 10-ft spatial teleportation. */
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
  if ((poolComp?.pools['abrupt_jaunt']?.current ?? 0) <= 0) {
    return {
      state: addMessage(state, 'Abrupt Jaunt: No uses remaining today.', MessageLogCategory.System),
      success: false
    };
  }
  if (!isTileValidJauntDestination(state, actorId, actorPos, targetX, targetY)) {
    const err = 'Abrupt Jaunt: Destination must be an unoccupied, visible walkable square within 10 ft.';
    return { state: addMessage(state, err, MessageLogCategory.System), success: false };
  }

  const consumed = tryConsumeImmediatePoolAndAction(state, actorId, 'abrupt_jaunt', 'Abrupt Jaunt', isOnTurn);
  if (!consumed.allowed) return { state: consumed.state, success: false };

  let next = addComponent(consumed.state, actorId, { type: ComponentType.Position, x: targetX, y: targetY });
  if (getComponent(next, actorId, ComponentType.Player) !== undefined) next = { ...next, fovNeedsUpdate: true };
  next = syncSpatialFlankingGraph(next);
  const name = (getComponent(next, actorId, ComponentType.Identity) as IdentityComponent | undefined)?.name ?? 'Actor';
  const distFt = Math.max(Math.abs(targetX - actorPos.x), Math.abs(targetY - actorPos.y)) * FEET_PER_GRID_SQUARE;
  next = addFloatingText(next, actorId, 'JAUNT!', '#74b9ff');
  const log = `[Immediate Action] ${name} abruptly jaunts ${distFt} ft to (${targetX}, ${targetY})!`;
  return { state: addMessage(next, log, MessageLogCategory.System), success: true };
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
      const cx = defenderPos.x + dx;
      const cy = defenderPos.y + dy;
      if ((dx === 0 && dy === 0) || !isTileValidJauntDestination(state, defenderId, defenderPos, cx, cy)) continue;
      const distFromThreat = Math.max(Math.abs(cx - threatPos.x), Math.abs(cy - threatPos.y));
      if (distFromThreat > bestDist) {
        bestDist = distFromThreat;
        bestTile = { x: cx, y: cy };
      }
    }
  }
  return bestTile;
}

/** Evaluates armed off-turn Immediate Action reaction policies on `defenderId` when a hostile trigger occurs. */
export function evaluateOffTurnImmediateReactions(
  state: GameState,
  triggerWindow: 'on_enemy_adjacent_move' | 'before_melee_attack' | 'before_any_attack',
  triggeringActorId: EntityId,
  defenderId: EntityId
): { readonly state: GameState; readonly triggered: boolean; readonly defenderTeleportedOutOfReach: boolean } {
  if (triggeringActorId === defenderId || !isHostile(state, triggeringActorId, defenderId)) {
    return { state, triggered: false, defenderTeleportedOutOfReach: false };
  }
  const policies = (
    getComponent(state, defenderId, ComponentType.TacticalDoctrine) as TacticalDoctrineComponent | undefined
  )?.reactionPolicies;
  if (!policies) return { state, triggered: false, defenderTeleportedOutOfReach: false };

  const matchesWindow = (t: string): boolean =>
    t !== 'off' && (t === triggerWindow || (t === 'before_any_attack' && triggerWindow === 'before_melee_attack'));

  const jauntPolicy = policies['abrupt_jaunt'];
  if (jauntPolicy?.enabled && matchesWindow(jauntPolicy.trigger)) {
    const defPos = getComponent(state, defenderId, ComponentType.Position) as PositionComponent | undefined;
    const atkPos = getComponent(state, triggeringActorId, ComponentType.Position) as PositionComponent | undefined;
    const evadeTile = defPos && atkPos ? findBestEvadeTile(state, defenderId, defPos, atkPos) : undefined;
    if (evadeTile && atkPos) {
      const res = executeAbruptJauntTeleport(state, defenderId, evadeTile.x, evadeTile.y, false);
      if (res.success) {
        const atkSize = evaluateDnD35eEntityDAG(res.state, triggeringActorId)?.dagResult.effectiveSize ?? 'medium';
        const reachTiles = Math.max(
          1,
          Math.floor((SIZE_METRICS[atkSize]?.naturalReachTallFt ?? FEET_PER_GRID_SQUARE) / FEET_PER_GRID_SQUARE)
        );
        const newDist = Math.max(Math.abs(evadeTile.x - atkPos.x), Math.abs(evadeTile.y - atkPos.y));
        return { state: res.state, triggered: true, defenderTeleportedOutOfReach: newDist > reachTiles };
      }
    }
  }

  const invPolicy = policies['invisible_fist'];
  if (invPolicy?.enabled && matchesWindow(invPolicy.trigger)) {
    const res = executeInvisibleFistImmediate(state, defenderId, false);
    if (res.success) return { state: res.state, triggered: true, defenderTeleportedOutOfReach: false };
  }
  return { state, triggered: false, defenderTeleportedOutOfReach: false };
}

/** Cycles a reaction policy between `'off'`, `'before_melee_attack'`, `'before_any_attack'`, and `'on_enemy_adjacent_move'`. */
export function getNextReactionTrigger(
  currentTrigger: string | undefined
): 'off' | 'before_melee_attack' | 'before_any_attack' | 'on_enemy_adjacent_move' {
  if (currentTrigger === 'before_melee_attack') return 'before_any_attack';
  if (currentTrigger === 'before_any_attack') return 'on_enemy_adjacent_move';
  if (currentTrigger === 'on_enemy_adjacent_move') return 'off';
  return 'before_melee_attack';
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
    if (!candFighter || candFighter.hp <= 0 || !candPos || !isHostile(runningState, moverId, candId)) continue;
    if (Math.max(Math.abs(candPos.x - toPos.x), Math.abs(candPos.y - toPos.y)) <= 1) {
      runningState = evaluateOffTurnImmediateReactions(runningState, 'on_enemy_adjacent_move', moverId, candId).state;
    }
  }
  return runningState;
}
