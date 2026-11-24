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
  type IdentityComponent,
  type PositionComponent,
  type RenderableComponent,
  type StatusEffectsComponent,
  type StatusEffectPolarity
} from '../types/components.types.ts';
import type { EntityId, GameState } from '../types/game-state.types.ts';
import { getFactionRelation } from '../utils/faction.ts';
import { getBresenhamLine } from '../utils/grid.ts';
import { getTileAt, getTileDefAt, isInMapBounds, toMapTileKey } from '../map/map_accessor.ts';
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
      if (!isInMapBounds(state.map, mapX, mapY)) continue;
      const tileIdx = toMapTileKey(state.map, mapX, mapY);
      if (state.map.isFullyExplored || visibleIndices.has(tileIdx)) {
        visibleCells.push({ vx, vy });
      }
    }
  }

  const unitBadges: TacticalUnitBadgeDTO[] = [];

  const occupiedCellCounts = new Map<string, number>();
  for (const entityId of state.entities) {
    const pos = getComponent(state, entityId, ComponentType.Position) as PositionComponent | undefined;
    const fighter = getComponent(state, entityId, ComponentType.Fighter) as FighterComponent | undefined;
    if (!pos || !fighter) continue;
    const fw = Math.max(1, pos.footprintWidth ?? 1);
    const fh = Math.max(1, pos.footprintHeight ?? 1);
    for (let dy = 0; dy < fh; dy++) {
      for (let dx = 0; dx < fw; dx++) {
        const key = `${pos.x + dx},${pos.y + dy}`;
        occupiedCellCounts.set(key, (occupiedCellCounts.get(key) ?? 0) + 1);
      }
    }
  }

  for (const entityId of state.entities) {
    const pos = getComponent(state, entityId, ComponentType.Position) as PositionComponent | undefined;
    const fighter = getComponent(state, entityId, ComponentType.Fighter) as FighterComponent | undefined;
    if (!pos || !fighter) continue;

    const fw = Math.max(1, pos.footprintWidth ?? 1);
    const fh = Math.max(1, pos.footprintHeight ?? 1);
    const vx = pos.x - cameraX;
    const vy = pos.y - cameraY;

    if (vx + fw <= 0 || vx >= viewportW || vy + fh <= 0 || vy >= viewportH) continue;

    let anyVisible = state.map.isFullyExplored;
    let isSharedTile = false;
    for (let dy = 0; dy < fh; dy++) {
      for (let dx = 0; dx < fw; dx++) {
        const sx = pos.x + dx;
        const sy = pos.y + dy;
        if (isInMapBounds(state.map, sx, sy)) {
          const tileIdx = toMapTileKey(state.map, sx, sy);
          if (visibleIndices.has(tileIdx)) {
            anyVisible = true;
          }
        }
        if ((occupiedCellCounts.get(`${sx},${sy}`) ?? 0) > 1) {
          isSharedTile = true;
        }
      }
    }
    if (!anyVisible) continue;

    const stats = getEffectiveStats(state, entityId);
    const maxHp = Math.max(1, stats.maxHp);
    const hpRatio = Math.max(0, Math.min(1, fighter.hp / maxHp));
    const attitude = resolveUnitAttitude(state, playerEntityId, entityId);

    const PIP_COLORS: Readonly<Record<StatusEffectPolarity, string>> = {
      buff: '#2ed573',
      debuff: '#ff4757',
      mixed: '#a855f7',
      neutral: '#f1c40f'
    };
    const statusComp = getComponent(state, entityId, ComponentType.StatusEffects) as StatusEffectsComponent | undefined;
    const statusColors: string[] = [];
    if (statusComp) {
      for (const effect of statusComp.activeEffects) {
        if (statusColors.length >= MAX_UNIT_STATUS_PIPS) break;
        const def = state.campaign.status[effect.effectId];
        const polarityColor = effect.polarity ? PIP_COLORS[effect.polarity] : undefined;
        statusColors.push(effect.color ?? def?.color ?? polarityColor ?? '#f1c40f');
      }
    }

    const renderable = getComponent(state, entityId, ComponentType.Renderable) as RenderableComponent | undefined;
    const identity = getComponent(state, entityId, ComponentType.Identity) as IdentityComponent | undefined;

    unitBadges.push({
      vx,
      vy,
      ...(fw > 1 ? { footprintW: fw } : {}),
      ...(fh > 1 ? { footprintH: fh } : {}),
      ...(pos.isSqueezing === true ? { isSqueezing: true } : {}),
      ...(pos.subTileScale !== undefined && pos.subTileScale !== 1 ? { subTileScale: pos.subTileScale } : {}),
      ...(isSharedTile ? { isSharedTile: true } : {}),
      ...(renderable?.glyph !== undefined ? { glyph: renderable.glyph } : {}),
      ...(identity?.colorOverride !== undefined || renderable?.fg !== undefined
        ? { fg: identity?.colorOverride ?? renderable?.fg }
        : {}),
      ...(renderable?.spriteId !== undefined ? { spriteId: renderable.spriteId } : {}),
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
  if (!isInMapBounds(state.map, targetX, targetY)) return null;

  const vx = targetX - cameraX;
  const vy = targetY - cameraY;
  if (vx < 0 || vx >= viewportW || vy < 0 || vy >= viewportH) return null;

  const tile = getTileAt(state.map, targetX, targetY);
  const tileIdx = toMapTileKey(state.map, targetX, targetY);
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

      const stepTile = getTileAt(state.map, pt.x, pt.y);
      const stepDef = getTileDefAt(state, pt.x, pt.y);
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
