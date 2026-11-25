import { getComponent, getEntitiesAtPosition } from '../core/ecs.ts';
import { computeHierarchicalNextStep } from './pathfinding_hpa.ts';
import { processMoveIntent } from '../systems/movement.system.ts';
import { evaluateTileTraversal, getEntityMovementModes } from '../systems/movement_displacement.ts';
import {
  computeRectDistanceTiles,
  getEntitySpatialProfile,
  isFootprintDiagonalBlockedByHardCorner,
  SIZE_DIFF_PASS_THROUGH_THRESHOLD
} from '../systems/movement_footprint.ts';
import { shouldSkipTurn } from '../systems/status-effect.system.ts';
import { ComponentType, type MovementModes } from '../types/components.types.ts';
import type { EntityId, GameState } from '../types/game-state.types.ts';
import type { ActorSpatialProfile } from '../types/ruleset.types.ts';
import { IntentType } from '../types/intents/intent.enum.ts';
import type { Intent } from '../types/intents/intent.union.ts';
import { isHostile } from '../utils/faction.ts';
import { getTileDefAt, isInMapBounds } from '../map/map_accessor.ts';
import { DEFAULT_COMPANION_FOLLOW_DISTANCE } from './companion_targeting.ts';

const CARDINAL_AND_DIAGONAL_OFFSETS: ReadonlyArray<{ readonly dx: number; readonly dy: number }> = [
  { dx: 0, dy: -1 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
  { dx: 1, dy: 0 },
  { dx: -1, dy: -1 },
  { dx: 1, dy: -1 },
  { dx: -1, dy: 1 },
  { dx: 1, dy: 1 }
];

/**
 * Checks whether a tile is unoccupied by another Fighter or Actor entity.
 */
function getCachedSpatialProfile(
  state: GameState,
  entityId: EntityId,
  profileCache: Map<EntityId, ActorSpatialProfile>
): ActorSpatialProfile {
  const existing = profileCache.get(entityId);
  if (existing) return existing;
  const resolved = getEntitySpatialProfile(state, entityId);
  profileCache.set(entityId, resolved);
  return resolved;
}

/**
 * Checks whether a tile is unoccupied by another Fighter or Actor entity.
 */
function isTileBlockedByActor(
  state: GameState,
  x: number,
  y: number,
  selfId: EntityId,
  selfProfile: ActorSpatialProfile,
  profileCache: Map<EntityId, ActorSpatialProfile>,
  z = 0
): boolean {
  const entitiesAtTile = getEntitiesAtPosition(state, x, y, z);
  if (entitiesAtTile.length === 0) return false;

  for (const id of entitiesAtTile) {
    if (id === selfId) continue;
    const hasFighter = getComponent(state, id, ComponentType.Fighter) !== undefined;
    const hasActor = getComponent(state, id, ComponentType.Actor) !== undefined;
    if (!hasFighter && !hasActor) continue;
    const otherProfile = getCachedSpatialProfile(state, id, profileCache);
    if (otherProfile.isCompletelyFillingSpace) return true;
    const sizeDiff = Math.abs(selfProfile.sizeRankIndex - otherProfile.sizeRankIndex);
    const canMovePast =
      otherProfile.isHelpless || selfProfile.canShareTile || sizeDiff >= SIZE_DIFF_PASS_THROUGH_THRESHOLD;
    if (!canMovePast) {
      return true;
    }
  }
  return false;
}

/**
 * Checks whether a companion can step onto `(x, y)` respecting footprint squeezing and hard-corner diagonals.
 */
function isStepPassable(
  state: GameState,
  x: number,
  y: number,
  entityId: EntityId,
  movementModes: MovementModes | undefined,
  profile: ActorSpatialProfile,
  profileCache: Map<EntityId, ActorSpatialProfile>,
  prevX?: number,
  prevY?: number,
  z = 0,
  prevZ = z
): boolean {
  const baseW = profile.baseWidth;
  const baseH = profile.baseHeight;

  if (
    prevX !== undefined &&
    prevY !== undefined &&
    z === prevZ &&
    !profile.isIncorporeal &&
    isFootprintDiagonalBlockedByHardCorner(state, prevX, prevY, baseW, baseH, x - prevX, y - prevY, z)
  ) {
    return false;
  }

  const minW = baseW >= 2 ? Math.ceil(baseW / 2) : baseW;
  const minH = baseH >= 2 ? Math.ceil(baseH / 2) : baseH;
  for (let dy = 0; dy < minH; dy++) {
    for (let dx = 0; dx < minW; dx++) {
      const tx = x + dx;
      const ty = y + dy;
      if (!isInMapBounds(state.map, tx, ty, z)) return false;
      const tileDef = getTileDefAt(state, tx, ty, z);
      if (!tileDef) return false;
      const traversal = evaluateTileTraversal(tileDef, movementModes, state, tx, ty, z);
      if (traversal.passability !== 'unimpeded' && traversal.passability !== 'difficult') return false;
      if (isTileBlockedByActor(state, tx, ty, entityId, profile, profileCache, z)) return false;
    }
  }
  return true;
}

/**
 * Computes the next passable 1-tile step from `(fromX, fromY, fromZ)` toward `(goalX, goalY, goalZ)` using
 * shared 3D Dijkstra Flow Fields, HPA* Region Pathfinding across sectors/Z-strata, local A* refinement,
 * and a squared-distance greedy fallback. Never returns a step directly onto `(goalX, goalY, goalZ)`.
 *
 * @param state The current GameState.
 * @param entityId The moving entity taking its turn.
 * @param fromX Current X coordinate.
 * @param fromY Current Y coordinate.
 * @param goalX Target X coordinate.
 * @param goalY Target Y coordinate.
 * @param fromZ Current Z coordinate (default `0`).
 * @param goalZ Target Z coordinate (default `0`).
 * @returns Relative `{ dx, dy, dz? }` step, or `null` if no passable advancing step exists.
 */
export function computeNextStepToward(
  state: GameState,
  entityId: EntityId,
  fromX: number,
  fromY: number,
  goalX: number,
  goalY: number,
  fromZ = 0,
  goalZ = 0
): { readonly dx: number; readonly dy: number; readonly dz?: number | undefined } | null {
  const movementModes = getEntityMovementModes(state, entityId);
  const profileCache = new Map<EntityId, ActorSpatialProfile>();
  const selfProfile = getCachedSpatialProfile(state, entityId, profileCache);

  const hierarchicalStep = computeHierarchicalNextStep(
    state,
    fromX,
    fromY,
    fromZ,
    goalX,
    goalY,
    goalZ,
    (nx, ny, nz, px, py, pz) =>
      isStepPassable(state, nx, ny, entityId, movementModes, selfProfile, profileCache, px, py, nz, pz)
  );
  if (hierarchicalStep) {
    return {
      dx: hierarchicalStep.dx,
      dy: hierarchicalStep.dy,
      ...(hierarchicalStep.dz !== 0 ? { dz: hierarchicalStep.dz } : {})
    };
  }

  const rankedCandidates = CARDINAL_AND_DIAGONAL_OFFSETS.map((offset) => {
    const nx = fromX + offset.dx;
    const ny = fromY + offset.dy;
    const distSq = (goalX - nx) ** 2 + (goalY - ny) ** 2;
    return { dx: offset.dx, dy: offset.dy, nx, ny, distSq };
  }).sort((a, b) => a.distSq - b.distSq);

  const currentDistSq = (goalX - fromX) ** 2 + (goalY - fromY) ** 2;

  for (const candidate of rankedCandidates) {
    if (candidate.distSq >= currentDistSq) continue;
    if (candidate.nx === goalX && candidate.ny === goalY && fromZ === goalZ) continue;
    if (
      isStepPassable(
        state,
        candidate.nx,
        candidate.ny,
        entityId,
        movementModes,
        selfProfile,
        profileCache,
        fromX,
        fromY,
        fromZ,
        fromZ
      )
    ) {
      return { dx: candidate.dx, dy: candidate.dy };
    }
  }

  return null;
}

/**
 * Follow behavior: guides a controlled entity back toward its `controllerEntityId` whenever its
 * Chebyshev distance exceeds `followDistance`, respecting `'hold'` stances and routing around obstacles.
 * @param state The current GameState.
 * @param entityId The companion entity taking its turn.
 * @param params Behavior parameters from the AI profile.
 * @returns A `MoveIntent` toward the controller, or `null` if already within follow distance or holding position.
 */
export function followBehavior(
  state: GameState,
  entityId: EntityId,
  params: Readonly<Record<string, unknown>>
): Intent | null {
  const link = getComponent(state, entityId, ComponentType.ControllerLink);
  if (!link || link.stance === 'hold') return null;

  const pos = getComponent(state, entityId, ComponentType.Position);
  const controllerPos = getComponent(state, link.controllerEntityId, ComponentType.Position);
  if (!pos || !controllerPos) return null;

  const paramFollowDistance = typeof params.followDistance === 'number' ? params.followDistance : undefined;
  const followDistance = link.followDistance ?? paramFollowDistance ?? DEFAULT_COMPANION_FOLLOW_DISTANCE;
  const selfZ = pos.z ?? 0;
  const controllerZ = controllerPos.z ?? 0;
  const currentDistance = Math.max(Math.abs(controllerPos.x - pos.x), Math.abs(controllerPos.y - pos.y));

  if (selfZ === controllerZ && currentDistance <= followDistance) {
    return null;
  }

  const step = computeNextStepToward(
    state,
    entityId,
    pos.x,
    pos.y,
    controllerPos.x,
    controllerPos.y,
    pos.z ?? 0,
    controllerPos.z ?? 0
  );
  if (!step) return null;

  return {
    type: IntentType.Move,
    entityId,
    dx: step.dx,
    dy: step.dy,
    ...(step.dz !== undefined ? { dz: step.dz } : {})
  };
}

/**
 * Checks whether `companionId` is currently adjacent (`distance <= 1`) to a living hostile target.
 */
function hasAdjacentHostile(state: GameState, companionId: EntityId): boolean {
  const pos = getComponent(state, companionId, ComponentType.Position);
  if (!pos) return false;

  for (const otherId of state.entities) {
    if (otherId === companionId) continue;
    const otherFighter = getComponent(state, otherId, ComponentType.Fighter);
    const otherPos = getComponent(state, otherId, ComponentType.Position);
    if (!otherFighter || otherFighter.hp <= 0 || !otherPos) continue;
    if (!isHostile(state, companionId, otherId)) continue;
    const dist = computeRectDistanceTiles(
      pos.x,
      pos.y,
      pos.footprintWidth ?? 1,
      pos.footprintHeight ?? 1,
      otherPos.x,
      otherPos.y,
      otherPos.footprintWidth ?? 1,
      otherPos.footprintHeight ?? 1
    );
    if (dist <= 1) return true;
  }
  return false;
}

/**
 * Advances `shareInitiative` companions by one follow step after `controllerId` completes a
 * zero-energy mid-round movement step in Turn-Based mode, keeping companions in formation during
 * exploration without interrupting active melee engagements.
 *
 * @param state Current GameState after the controller's move.
 * @param controllerId Controller EntityId (the moving player).
 * @returns Updated GameState with linked companions stepped via `followBehavior`.
 */
export function syncShareInitiativeCompanionsOnMove(state: GameState, controllerId: EntityId): GameState {
  let runningState = state;
  const candidates = [...runningState.entities];

  for (const companionId of candidates) {
    if (companionId === controllerId) continue;
    const link = getComponent(runningState, companionId, ComponentType.ControllerLink);
    if (!link || link.controllerEntityId !== controllerId) continue;
    if (link.shareInitiative === false || link.stance === 'hold') continue;

    const fighter = getComponent(runningState, companionId, ComponentType.Fighter);
    if (fighter && fighter.hp <= 0) continue;
    if (isHostile(runningState, companionId, controllerId)) continue;
    if (shouldSkipTurn(runningState, companionId)) continue;
    if (hasAdjacentHostile(runningState, companionId)) continue;

    const intent = followBehavior(runningState, companionId, {
      followDistance: link.followDistance ?? DEFAULT_COMPANION_FOLLOW_DISTANCE
    });
    if (intent && intent.type === IntentType.Move) {
      const moveResult = processMoveIntent(runningState, intent);
      if (moveResult.success) {
        runningState = moveResult.state;
        if (moveResult.events && moveResult.events.length > 0) {
          runningState = { ...runningState, events: [...runningState.events, ...moveResult.events] };
        }
      }
    }
  }

  return runningState;
}
