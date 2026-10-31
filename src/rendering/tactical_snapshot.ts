/**
 * @file Pure tactical viewport projector computing unit health bars, hostility badges,
 * status pips, torchlight FOV center, and path preview DTOs for the 60Hz presenter.
 */

import { getComponent } from '../core/ecs.ts';
import { getHoverState } from '../core/hover_state.ts';
import { MAX_UNIT_STATUS_PIPS } from '../constants/ui.constants.ts';
import {
  ComponentType,
  type FighterComponent,
  type PositionComponent,
  type StatusEffectsComponent
} from '../types/components.types.ts';
import type { EntityId, GameState } from '../types/game-state.types.ts';
import { getFactionRelation } from '../utils/faction.ts';
import { coordToIndex, getBresenhamLine, isInBounds } from '../utils/grid.ts';
import { getEffectiveStats } from '../utils/stats.ts';
import type {
  TacticalAttitude,
  TacticalCursorDTO,
  TacticalPathStepDTO,
  TacticalUnitBadgeDTO,
  TacticalViewportDTO
} from './viewport_snapshot.types.ts';

/**
 * Resolves the tactical attitude of a target entity relative to the player.
 *
 * @param state The current GameState.
 * @param playerEntityId The player's EntityId, if present.
 * @param targetEntityId The entity being evaluated.
 * @returns The resolved TacticalAttitude.
 */
function resolveUnitAttitude(
  state: GameState,
  playerEntityId: EntityId | undefined,
  targetEntityId: EntityId
): TacticalAttitude {
  if (playerEntityId !== undefined && targetEntityId === playerEntityId) {
    return 'player';
  }
  if (playerEntityId === undefined) {
    return 'neutral';
  }
  return getFactionRelation(state, playerEntityId, targetEntityId);
}

/**
 * Builds the pure TacticalViewportDTO for the current viewport frame.
 *
 * @param state The current immutable GameState.
 * @param cameraX Viewport camera X offset in world coordinates.
 * @param cameraY Viewport camera Y offset in world coordinates.
 * @param viewportW Viewport width in grid cells.
 * @param viewportH Viewport height in grid cells.
 * @param visibleIndices Set of currently visible 1D tile indices.
 * @returns Immutable TacticalViewportDTO.
 */
export function buildTacticalViewportData(
  state: GameState,
  cameraX: number,
  cameraY: number,
  viewportW: number,
  viewportH: number,
  visibleIndices: ReadonlySet<number>
): TacticalViewportDTO {
  const playerEntityId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined);
  const playerPos =
    playerEntityId !== undefined
      ? (getComponent(state, playerEntityId, ComponentType.Position) as PositionComponent | undefined)
      : undefined;

  let playerVx: number | null = null;
  let playerVy: number | null = null;
  if (playerPos !== undefined) {
    const vx = playerPos.x - cameraX;
    const vy = playerPos.y - cameraY;
    if (vx >= 0 && vx < viewportW && vy >= 0 && vy < viewportH) {
      playerVx = vx;
      playerVy = vy;
    }
  }

  const visibleCells: Array<{ readonly vx: number; readonly vy: number }> = [];
  for (let vy = 0; vy < viewportH; vy++) {
    for (let vx = 0; vx < viewportW; vx++) {
      const mapX = vx + cameraX;
      const mapY = vy + cameraY;
      if (!isInBounds(mapX, mapY, state.map.width, state.map.height)) continue;
      const tileIdx = coordToIndex(mapX, mapY, state.map.width);
      if (state.map.isFullyExplored || visibleIndices.has(tileIdx)) {
        visibleCells.push({ vx, vy });
      }
    }
  }

  const unitBadges: TacticalUnitBadgeDTO[] = [];

  for (const entityId of state.entities) {
    const pos = getComponent(state, entityId, ComponentType.Position) as PositionComponent | undefined;
    const fighter = getComponent(state, entityId, ComponentType.Fighter) as FighterComponent | undefined;
    if (!pos || !fighter) continue;

    const vx = pos.x - cameraX;
    const vy = pos.y - cameraY;
    if (vx < 0 || vx >= viewportW || vy < 0 || vy >= viewportH) continue;

    const tileIdx = coordToIndex(pos.x, pos.y, state.map.width);
    const isVisible = state.map.isFullyExplored || visibleIndices.has(tileIdx);
    if (!isVisible) continue;

    const stats = getEffectiveStats(state, entityId);
    const maxHp = Math.max(1, stats.maxHp);
    const hpRatio = Math.max(0, Math.min(1, fighter.hp / maxHp));
    const attitude = resolveUnitAttitude(state, playerEntityId, entityId);

    const statusComp = getComponent(state, entityId, ComponentType.StatusEffects) as
      | StatusEffectsComponent
      | undefined;
    const statusColors: string[] = [];
    if (statusComp) {
      for (const effect of statusComp.activeEffects) {
        if (statusColors.length >= MAX_UNIT_STATUS_PIPS) break;
        const def = state.campaign.status[effect.effectId];
        statusColors.push(def?.color ?? '#f1c40f');
      }
    }

    unitBadges.push({
      vx,
      vy,
      hpRatio,
      attitude,
      statusColors
    });
  }

  const cursor = buildTacticalCursorData(state, playerEntityId, playerPos, cameraX, cameraY, viewportW, viewportH);

  return {
    playerVx,
    playerVy,
    fovRadius: state.campaign.rules.map.fovRadius,
    visibleCells,
    unitBadges,
    cursor
  };
}

/**
 * Projects the active targeting, inspect, or mouse-hover cursor and its path preview.
 */
function buildTacticalCursorData(
  state: GameState,
  playerEntityId: EntityId | undefined,
  playerPos: PositionComponent | undefined,
  cameraX: number,
  cameraY: number,
  viewportW: number,
  viewportH: number
): TacticalCursorDTO | null {
  let targetX: number | undefined;
  let targetY: number | undefined;

  if (state.targetingMode?.active) {
    targetX = state.targetingMode.x;
    targetY = state.targetingMode.y;
  } else if (state.inspectMode?.active) {
    targetX = state.inspectMode.x;
    targetY = state.inspectMode.y;
  } else {
    const hovered = getHoverState().hoveredTile;
    if (hovered !== null) {
      targetX = hovered.x;
      targetY = hovered.y;
    }
  }

  if (targetX === undefined || targetY === undefined) return null;
  if (!isInBounds(targetX, targetY, state.map.width, state.map.height)) return null;

  const vx = targetX - cameraX;
  const vy = targetY - cameraY;
  if (vx < 0 || vx >= viewportW || vy < 0 || vy >= viewportH) return null;

  const tileIdx = coordToIndex(targetX, targetY, state.map.width);
  const tile = state.map.tiles[tileIdx];
  const isExplored = tile !== undefined && (state.map.isFullyExplored || tile.explored);
  if (!isExplored) return null;

  let attitude: TacticalAttitude | 'terrain' = 'terrain';
  const isVisible = state.map.isFullyExplored || state.cachedFov.has(tileIdx);
  if (isVisible) {
    const entitiesAt = state.spatialIndex.get(`${targetX},${targetY}`) ?? [];
    const actorId = entitiesAt.find((id) => getComponent(state, id, ComponentType.Fighter) !== undefined);
    if (actorId !== undefined) {
      attitude = resolveUnitAttitude(state, playerEntityId, actorId);
    }
  }

  const pathSteps: TacticalPathStepDTO[] = [];
  if (playerPos !== undefined && (playerPos.x !== targetX || playerPos.y !== targetY)) {
    const line = getBresenhamLine(playerPos.x, playerPos.y, targetX, targetY);
    let encounteredBlock = false;
    for (let i = 1; i < line.length; i++) {
      const pt = line[i];
      if (!pt) continue;
      const stepVx = pt.x - cameraX;
      const stepVy = pt.y - cameraY;
      if (stepVx < 0 || stepVx >= viewportW || stepVy < 0 || stepVy >= viewportH) continue;

      const stepIdx = coordToIndex(pt.x, pt.y, state.map.width);
      const stepTile = state.map.tiles[stepIdx];
      const stepDef = stepTile ? state.campaign.tiles[stepTile.tileId] : undefined;
      const walkable = Boolean(stepTile && (state.map.isFullyExplored || stepTile.explored) && stepDef?.walkable);
      if (!walkable) {
        encounteredBlock = true;
      }
      pathSteps.push({
        vx: stepVx,
        vy: stepVy,
        blocked: encounteredBlock
      });
    }
  }

  return {
    vx,
    vy,
    attitude,
    pathSteps
  };
}
