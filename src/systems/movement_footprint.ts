import { getComponent } from '../core/ecs.ts';
import { getActiveRuleset } from '../rulesets/registry.ts';
import type { TileDefinition } from '../types/campaign/world.ts';
import { ComponentType, type PositionComponent, type TagsComponent } from '../types/components.types.ts';
import type { CardinalFacing } from '../types/components/world_components.types.ts';
import type { EntityId, GameState } from '../types/game-state.types.ts';
import type { ActorSpatialProfile } from '../types/ruleset.types.ts';
import { isHostile } from '../utils/faction.ts';
import { coordToIndex, isInBounds } from '../utils/grid.ts';

/** Size-rank delta threshold (`3`) allowing larger/smaller creatures to move through an opponent's square. */
export const SIZE_DIFF_PASS_THROUGH_THRESHOLD = 3;

/** Resolved target footprint placement returned by `resolveMovementFootprintPlacement`. */
export interface FootprintPlacementResult {
  readonly valid: boolean;
  readonly anchorX: number;
  readonly anchorY: number;
  readonly width: number;
  readonly height: number;
  readonly facing: CardinalFacing | undefined;
  readonly isSqueezing: boolean;
  readonly profile: ActorSpatialProfile;
  readonly blockedByWall: boolean;
  readonly blockedByObstacleDef: TileDefinition | undefined;
}

/** Classification of entities encountered within a candidate destination footprint. */
export interface FootprintOccupancyResult {
  readonly blocked: boolean;
  readonly meleeTargetId: EntityId | undefined;
  readonly friendlyShareIds: ReadonlyArray<EntityId>;
  readonly swapCandidateId: EntityId | undefined;
  readonly solidBlockerId: EntityId | undefined;
}

/** Default spatial profile fallback when no ruleset spatial hook is registered. */
const DEFAULT_SPATIAL_PROFILE: ActorSpatialProfile = {
  baseWidth: 1,
  baseHeight: 1,
  sizeRankIndex: 0,
  naturalReachTiles: 1,
  canShareTile: false,
  subTileScale: 1.0,
  isHelpless: false,
  isIncorporeal: false,
  isFlying: false,
  isCompletelyFillingSpace: false
};

/**
 * Resolves updated cardinal facing from a relative movement vector `(dx, dy)`.
 */
export function resolveCardinalFacing(
  dx: number,
  dy: number,
  previousFacing?: CardinalFacing
): CardinalFacing | undefined {
  if (dx === 0 && dy === 0) return previousFacing;
  if (Math.abs(dx) >= Math.abs(dy) && dx !== 0) {
    return dx > 0 ? 'east' : 'west';
  }
  return dy > 0 ? 'south' : 'north';
}

/**
 * Computes minimum Chebyshev distance in tiles between two rectangular grid footprints.
 * Returns `0` if the footprints overlap, `1` if adjacent.
 */
export function computeRectDistanceTiles(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number
): number {
  const safeAw = Math.max(1, aw);
  const safeAh = Math.max(1, ah);
  const safeBw = Math.max(1, bw);
  const safeBh = Math.max(1, bh);

  const gapX = Math.max(0, bx - (ax + safeAw - 1), ax - (bx + safeBw - 1));
  const gapY = Math.max(0, by - (ay + safeAh - 1), ay - (by + safeBh - 1));
  return Math.max(gapX, gapY);
}

/**
 * Computes signed delta `(dx, dy)` from the closest square of rect A to the closest square of rect B.
 */
export function computeRectNearestDelta(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number
): { readonly dx: number; readonly dy: number } {
  const safeAw = Math.max(1, aw);
  const safeAh = Math.max(1, ah);
  const safeBw = Math.max(1, bw);
  const safeBh = Math.max(1, bh);

  let bestDist = Infinity;
  let bestManhattan = Infinity;
  let bestDx = bx - ax;
  let bestDy = by - ay;
  for (let sy = ay; sy < ay + safeAh; sy++) {
    for (let sx = ax; sx < ax + safeAw; sx++) {
      for (let ty = by; ty < by + safeBh; ty++) {
        for (let tx = bx; tx < bx + safeBw; tx++) {
          const d = Math.max(Math.abs(tx - sx), Math.abs(ty - sy));
          const manhattan = Math.abs(tx - sx) + Math.abs(ty - sy);
          if (d < bestDist || (d === bestDist && manhattan < bestManhattan)) {
            bestDist = d;
            bestManhattan = manhattan;
            bestDx = tx - sx;
            bestDy = ty - sy;
            if (d === 0) return { dx: 0, dy: 0 };
          }
        }
      }
    }
  }
  return { dx: bestDx, dy: bestDy };
}

/**
 * Retrieves an entity's live `ActorSpatialProfile` via the active ruleset or PositionComponent fallback.
 */
export function getEntitySpatialProfile(
  state: GameState,
  entityId: EntityId,
  facing?: CardinalFacing
): ActorSpatialProfile {
  const hook = getActiveRuleset(state).resolveActorSpatialProfile;
  if (hook) {
    return hook(state, entityId, facing);
  }
  const pos = getComponent(state, entityId, ComponentType.Position) as PositionComponent | undefined;
  return {
    ...DEFAULT_SPATIAL_PROFILE,
    baseWidth: Math.max(1, pos?.footprintWidth ?? 1),
    baseHeight: Math.max(1, pos?.footprintHeight ?? 1),
    sizeRankIndex: pos?.sizeRankIndex ?? 0,
    canShareTile: pos?.canShareTile === true,
    subTileScale: pos?.subTileScale ?? 1.0
  };
}

function isHardCornerWallTile(state: GameState, x: number, y: number): boolean {
  if (!isInBounds(x, y, state.map.width, state.map.height)) return true;
  const tile = state.map.tiles[coordToIndex(x, y, state.map.width)];
  if (!tile) return true;
  const tileDef = state.campaign.tiles[tile.tileId];
  if (!tileDef || tileDef.walkable) return false;
  // SRD: You can move diagonally past impassable obstacles such as pits/chasms, only not past wall corners.
  const tags = tileDef.tags ?? [];
  if (tags.includes('pit') || tags.includes('chasm') || tags.includes('water') || tags.includes('liquid')) {
    return false;
  }
  return true;
}

/**
 * Returns `true` if a diagonal step `(dx !== 0 && dy !== 0)` would cut across an impassable wall corner.
 */
export function isFootprintDiagonalBlockedByHardCorner(
  state: GameState,
  fromX: number,
  fromY: number,
  width: number,
  height: number,
  dx: number,
  dy: number
): boolean {
  if (dx === 0 || dy === 0) return false;
  const leadX = dx > 0 ? fromX + Math.max(1, width) - 1 : fromX;
  const leadY = dy > 0 ? fromY + Math.max(1, height) - 1 : fromY;
  return isHardCornerWallTile(state, leadX + dx, leadY) || isHardCornerWallTile(state, leadX, leadY + dy);
}

function checkRectTilesTraversable(
  state: GameState,
  anchorX: number,
  anchorY: number,
  width: number,
  height: number,
  canTraverse: (tileDef: TileDefinition | undefined) => boolean
): { readonly ok: boolean; readonly firstBlockedDef: TileDefinition | undefined } {
  for (let dy = 0; dy < height; dy++) {
    for (let dx = 0; dx < width; dx++) {
      const tx = anchorX + dx;
      const ty = anchorY + dy;
      if (!isInBounds(tx, ty, state.map.width, state.map.height)) {
        return { ok: false, firstBlockedDef: undefined };
      }
      const tile = state.map.tiles[coordToIndex(tx, ty, state.map.width)];
      const tileDef = tile ? state.campaign.tiles[tile.tileId] : undefined;
      if (!canTraverse(tileDef)) {
        return { ok: false, firstBlockedDef: tileDef };
      }
    }
  }
  return { ok: true, firstBlockedDef: undefined };
}

/**
 * Resolves whether a creature can place its full footprint (or SRD Squeezing footprint `>= ceil(span / 2)`)
 * when stepping by `(dx, dy)`, enforcing hard-corner diagonal rules and orientation rotation.
 */
export function resolveMovementFootprintPlacement(params: {
  readonly state: GameState;
  readonly entityId: EntityId;
  readonly fromPos: PositionComponent;
  readonly dx: number;
  readonly dy: number;
  readonly canTraverse: (tileDef: TileDefinition | undefined) => boolean;
}): FootprintPlacementResult {
  const { state, entityId, fromPos, dx, dy, canTraverse } = params;
  const nextFacing = resolveCardinalFacing(dx, dy, fromPos.facing);
  const profile = getEntitySpatialProfile(state, entityId, nextFacing);
  const curW = Math.max(1, fromPos.footprintWidth ?? profile.baseWidth);
  const curH = Math.max(1, fromPos.footprintHeight ?? profile.baseHeight);
  const baseW = profile.baseWidth;
  const baseH = profile.baseHeight;

  if (
    !profile.isIncorporeal &&
    isFootprintDiagonalBlockedByHardCorner(state, fromPos.x, fromPos.y, curW, curH, dx, dy)
  ) {
    return {
      valid: false,
      anchorX: fromPos.x + dx,
      anchorY: fromPos.y + dy,
      width: curW,
      height: curH,
      facing: nextFacing,
      isSqueezing: fromPos.isSqueezing === true,
      profile,
      blockedByWall: true,
      blockedByObstacleDef: undefined
    };
  }

  const targetX = fromPos.x + dx;
  const targetY = fromPos.y + dy;

  // 1. Attempt normal unsqueezed placement (plus aligned shift if un-squeezing or rotating near wall).
  const fullCheck = checkRectTilesTraversable(state, targetX, targetY, baseW, baseH, canTraverse);
  if (fullCheck.ok) {
    return {
      valid: true,
      anchorX: targetX,
      anchorY: targetY,
      width: baseW,
      height: baseH,
      facing: nextFacing,
      isSqueezing: false,
      profile,
      blockedByWall: false,
      blockedByObstacleDef: undefined
    };
  }

  // Try aligned orthogonal slide when expanding out of a squeeze or rotating non-square dimensions
  if (
    curW < baseW ||
    curH < baseH ||
    (fromPos.footprintWidth ?? baseW) !== baseW ||
    (fromPos.footprintHeight ?? baseH) !== baseH
  ) {
    const maxShiftX = Math.max(0, baseW - curW);
    const maxShiftY = Math.max(0, baseH - curH);
    for (let sy = 0; sy <= maxShiftY; sy++) {
      for (let sx = 0; sx <= maxShiftX; sx++) {
        if (sx === 0 && sy === 0) continue;
        const shifted = checkRectTilesTraversable(state, targetX - sx, targetY - sy, baseW, baseH, canTraverse);
        if (shifted.ok) {
          return {
            valid: true,
            anchorX: targetX - sx,
            anchorY: targetY - sy,
            width: baseW,
            height: baseH,
            facing: nextFacing,
            isSqueezing: false,
            profile,
            blockedByWall: false,
            blockedByObstacleDef: undefined
          };
        }
      }
    }
  }

  // 2. SRD Squeezing: Large+ creatures (`baseW >= 2 || baseH >= 2`) can squeeze into at least half width/height
  if (baseW >= 2 || baseH >= 2) {
    const halfW = Math.ceil(baseW / 2);
    const halfH = Math.ceil(baseH / 2);
    const squeezeCandidates: ReadonlyArray<{ readonly w: number; readonly h: number }> =
      dx !== 0 && dy === 0
        ? [
            { w: baseW, h: halfH },
            { w: halfW, h: halfH }
          ]
        : dy !== 0 && dx === 0
          ? [
              { w: halfW, h: baseH },
              { w: halfW, h: halfH }
            ]
          : [
              { w: halfW, h: baseH },
              { w: baseW, h: halfH },
              { w: halfW, h: halfH }
            ];

    for (const cand of squeezeCandidates) {
      if (cand.w >= baseW && cand.h >= baseH) continue;
      const shiftXMax = Math.max(0, curW - cand.w);
      const shiftYMax = Math.max(0, curH - cand.h);
      for (let sy = 0; sy <= shiftYMax; sy++) {
        for (let sx = 0; sx <= shiftXMax; sx++) {
          const check = checkRectTilesTraversable(state, targetX + sx, targetY + sy, cand.w, cand.h, canTraverse);
          if (check.ok) {
            return {
              valid: true,
              anchorX: targetX + sx,
              anchorY: targetY + sy,
              width: cand.w,
              height: cand.h,
              facing: nextFacing,
              isSqueezing: true,
              profile,
              blockedByWall: false,
              blockedByObstacleDef: undefined
            };
          }
        }
      }
    }
  }

  return {
    valid: false,
    anchorX: targetX,
    anchorY: targetY,
    width: baseW,
    height: baseH,
    facing: nextFacing,
    isSqueezing: fromPos.isSqueezing === true,
    profile,
    blockedByWall: true,
    blockedByObstacleDef: fullCheck.firstBlockedDef
  };
}

/**
 * Evaluates all entities occupying squares of a candidate target footprint against SRD rules:
 * - Friendly pass-through / companion swap
 * - Helpless opponent pass-through
 * - Tiny / Diminutive / Fine (`canShareTile`) square entry & sharing
 * - Creatures >= 3 size categories apart
 * - Designated exceptions (`isCompletelyFillingSpace`, e.g., Gelatinous Cube)
 */
export function evaluateFootprintOccupancy(params: {
  readonly state: GameState;
  readonly moverId: EntityId;
  readonly moverPos: PositionComponent;
  readonly targetX: number;
  readonly targetY: number;
  readonly targetW: number;
  readonly targetH: number;
}): FootprintOccupancyResult {
  const { state, moverId, moverPos, targetX, targetY, targetW, targetH } = params;
  const seenIds = new Set<EntityId>();
  const moverProfile = getEntitySpatialProfile(state, moverId, moverPos.facing);
  const friendlyShareIds: EntityId[] = [];
  let swapCandidateId: EntityId | undefined;
  let meleeTargetId: EntityId | undefined;
  let solidBlockerId: EntityId | undefined;

  for (let dy = 0; dy < targetH; dy++) {
    for (let dx = 0; dx < targetW; dx++) {
      const ids = state.spatialIndex.get(`${targetX + dx},${targetY + dy}`);
      if (!ids) continue;
      for (const otherId of ids) {
        if (otherId !== moverId) {
          seenIds.add(otherId);
        }
      }
    }
  }

  for (const otherId of seenIds) {
    const hasFighter = getComponent(state, otherId, ComponentType.Fighter) !== undefined;
    const hasActor = getComponent(state, otherId, ComponentType.Actor) !== undefined;
    if (!hasFighter && !hasActor) {
      const tagsCmp = getComponent(state, otherId, ComponentType.Tags) as TagsComponent | undefined;
      if (tagsCmp?.tags.includes('solid')) {
        solidBlockerId = solidBlockerId ?? otherId;
      }
      continue;
    }

    const otherProfile = getEntitySpatialProfile(state, otherId);
    const hostile = isHostile(state, moverId, otherId);
    const sizeDiff = Math.abs(moverProfile.sizeRankIndex - otherProfile.sizeRankIndex);
    const canPassSizeRule =
      !otherProfile.isCompletelyFillingSpace &&
      (moverProfile.canShareTile || sizeDiff >= SIZE_DIFF_PASS_THROUGH_THRESHOLD || otherProfile.isHelpless);

    if (hostile && hasFighter) {
      // Check if mover already overlaps this target or is bumping into melee
      const otherPos = getComponent(state, otherId, ComponentType.Position) as PositionComponent | undefined;
      const alreadyOverlapping =
        otherPos !== undefined &&
        computeRectDistanceTiles(
          moverPos.x,
          moverPos.y,
          moverPos.footprintWidth ?? 1,
          moverPos.footprintHeight ?? 1,
          otherPos.x,
          otherPos.y,
          otherPos.footprintWidth ?? 1,
          otherPos.footprintHeight ?? 1
        ) === 0;

      // Tiny+ (0-ft reach) MUST enter opponent's square first unless already sharing or opponent is helpless
      if (moverProfile.canShareTile && !otherProfile.isCompletelyFillingSpace && !alreadyOverlapping) {
        friendlyShareIds.push(otherId);
        continue;
      }
      if (otherProfile.isHelpless && !otherProfile.isCompletelyFillingSpace) {
        friendlyShareIds.push(otherId);
        continue;
      }
      if (canPassSizeRule && sizeDiff >= SIZE_DIFF_PASS_THROUGH_THRESHOLD && !alreadyOverlapping) {
        // Still allow direct bump-to-attack if moving directly into a single enemy target square;
        // AStar pathfinding queries `isPassable` separately.
        meleeTargetId = meleeTargetId ?? otherId;
        continue;
      }
      meleeTargetId = meleeTargetId ?? otherId;
      continue;
    }

    // Friendly or neutral non-hostile actor
    if (
      !otherProfile.isCompletelyFillingSpace &&
      (moverProfile.canShareTile || otherProfile.canShareTile || sizeDiff >= SIZE_DIFF_PASS_THROUGH_THRESHOLD)
    ) {
      friendlyShareIds.push(otherId);
      continue;
    }

    swapCandidateId = swapCandidateId ?? otherId;
  }

  if (meleeTargetId !== undefined || solidBlockerId !== undefined || swapCandidateId !== undefined) {
    return {
      blocked: true,
      meleeTargetId,
      friendlyShareIds,
      swapCandidateId,
      solidBlockerId
    };
  }

  return {
    blocked: false,
    meleeTargetId: undefined,
    friendlyShareIds,
    swapCandidateId: undefined,
    solidBlockerId: undefined
  };
}
