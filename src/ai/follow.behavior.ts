import * as ROT from 'rot-js';
import { getComponent } from '../core/ecs.ts';
import { canTraverseTile, processMoveIntent } from '../systems/movement.system.ts';
import { shouldSkipTurn } from '../systems/status-effect.system.ts';
import { ComponentType, type MovementModes, type PropertyOverlayComponent } from '../types/components.types.ts';
import type { EntityId, GameState } from '../types/game-state.types.ts';
import { IntentType } from '../types/intents/intent.enum.ts';
import type { Intent } from '../types/intents/intent.union.ts';
import { isHostile } from '../utils/faction.ts';
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
    const dist = Math.max(Math.abs(otherPos.x - pos.x), Math.abs(otherPos.y - pos.y));
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
