import * as ROT from 'rot-js';
import { getComponent } from '../core/ecs.ts';
import { canTraverseTile } from '../systems/movement.system.ts';
import { ComponentType, type MovementModes, type PropertyOverlayComponent } from '../types/components.types.ts';
import type { EntityId, GameState } from '../types/game-state.types.ts';
import { IntentType } from '../types/intents/intent.enum.ts';
import type { Intent } from '../types/intents/intent.union.ts';
import { coordToIndex, isInBounds } from '../utils/grid.ts';
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
 * Resolves movement modes for pathfinding traversal checks.
 */
function getMovementModes(state: GameState, entityId: EntityId): MovementModes | undefined {
  const overlay = getComponent(state, entityId, ComponentType.PropertyOverlay) as PropertyOverlayComponent | undefined;
  if (overlay?.movementModesOverride) {
    return overlay.movementModesOverride;
  }
  const rulesetComp = getComponent(state, entityId, ComponentType.RulesetData);
  if (rulesetComp && rulesetComp.rulesetId === 'dnd35e' && rulesetComp.payload) {
    const dndData = rulesetComp.payload as { movementModes?: MovementModes };
    if (dndData.movementModes) {
      return dndData.movementModes;
    }
  }
  return undefined;
}

/**
 * Checks whether a tile is unoccupied by another Fighter or Actor entity.
 */
function isTileBlockedByActor(state: GameState, x: number, y: number, selfId: EntityId): boolean {
  const key = `${x},${y}`;
  const entitiesAtTile = state.spatialIndex.get(key);
  if (!entitiesAtTile || entitiesAtTile.length === 0) return false;

  for (const id of entitiesAtTile) {
    if (id === selfId) continue;
    if (getComponent(state, id, ComponentType.Fighter) !== undefined) return true;
    if (getComponent(state, id, ComponentType.Actor) !== undefined) return true;
  }
  return false;
}

/**
 * Checks whether a companion can step onto `(x, y)`.
 */
function isStepPassable(
  state: GameState,
  x: number,
  y: number,
  entityId: EntityId,
  movementModes: MovementModes | undefined
): boolean {
  if (!isInBounds(x, y, state.map.width, state.map.height)) return false;
  const tile = state.map.tiles[coordToIndex(x, y, state.map.width)];
  if (!tile) return false;
  const tileDef = state.campaign.tiles[tile.tileId];
  if (!canTraverseTile(tileDef, movementModes)) return false;
  return !isTileBlockedByActor(state, x, y, entityId);
}

/**
 * Computes the next passable 1-tile step from `(fromX, fromY)` toward `(goalX, goalY)` using
 * 8-way `ROT.Path.AStar` pathfinding around walls and actors, with a squared-distance greedy
 * fallback. Never returns a step directly onto `(goalX, goalY)`.
 *
 * @param state The current GameState.
 * @param entityId The moving entity taking its turn.
 * @param fromX Current X coordinate.
 * @param fromY Current Y coordinate.
 * @param goalX Target X coordinate.
 * @param goalY Target Y coordinate.
 * @returns Relative `{ dx, dy }` step, or `null` if no passable advancing step exists.
 */
export function computeNextStepToward(
  state: GameState,
  entityId: EntityId,
  fromX: number,
  fromY: number,
  goalX: number,
  goalY: number
): { readonly dx: number; readonly dy: number } | null {
  const movementModes = getMovementModes(state, entityId);

  const astar = new ROT.Path.AStar(
    goalX,
    goalY,
    (x: number, y: number): boolean => {
      if (x === fromX && y === fromY) return true;
      if (x === goalX && y === goalY) return true;
      return isStepPassable(state, x, y, entityId, movementModes);
    },
    { topology: 8 }
  );

  const pathSteps: Array<{ readonly x: number; readonly y: number }> = [];
  astar.compute(fromX, fromY, (x: number, y: number): void => {
    pathSteps.push({ x, y });
  });

  if (pathSteps.length >= 2) {
    const nextStep = pathSteps[1];
    if (
      nextStep &&
      !(nextStep.x === goalX && nextStep.y === goalY) &&
      isStepPassable(state, nextStep.x, nextStep.y, entityId, movementModes)
    ) {
      return {
        dx: nextStep.x - fromX,
        dy: nextStep.y - fromY
      };
    }
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
    if (candidate.nx === goalX && candidate.ny === goalY) continue;
    if (isStepPassable(state, candidate.nx, candidate.ny, entityId, movementModes)) {
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
  const currentDistance = Math.max(Math.abs(controllerPos.x - pos.x), Math.abs(controllerPos.y - pos.y));

  if (currentDistance <= followDistance) {
    return null;
  }

  const step = computeNextStepToward(state, entityId, pos.x, pos.y, controllerPos.x, controllerPos.y);
  if (!step) return null;

  return {
    type: IntentType.Move,
    entityId,
    dx: step.dx,
    dy: step.dy
  };
}
