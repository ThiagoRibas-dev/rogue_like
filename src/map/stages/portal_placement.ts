/**
 * @file Pure placement helpers for choosing border-aligned, well-separated start and portal coordinates
 * across cellular, DLA, and digger map generators.
 */

import * as ROT from 'rot-js';
import {
  CELLULAR_PORTAL_EDGE_BAND_TILES,
  CELLULAR_PORTAL_PERPENDICULAR_CENTER_BAND,
  MIN_CELLULAR_PORTAL_SEPARATION
} from '../../constants/spawning.constants.ts';
import type { AreaConnection } from '../../types/campaign.types.ts';
import { assertNever } from '../../utils/assert.ts';

type CardinalPlacementSide = 'top' | 'bottom' | 'left' | 'right';

/** Immutable 2D map grid coordinate. */
export interface PortalGridCoord {
  readonly x: number;
  readonly y: number;
}

/**
 * Computes the Manhattan distance between two grid coordinates.
 */
function manhattanDistance(a: PortalGridCoord, b: PortalGridCoord): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/**
 * Picks a uniformly random coordinate from a non-empty readonly list using ROT.RNG.
 */
function pickRandomCoord(coords: ReadonlyArray<PortalGridCoord>): PortalGridCoord {
  return coords[ROT.RNG.getUniformInt(0, coords.length - 1)]!;
}

/**
 * Selects the walkable floor coordinate closest to the map center for cellular/DLA hub starts.
 *
 * @param floorCoords All walkable floor coordinates on the map.
 * @param width Map width in tiles.
 * @param height Map height in tiles.
 * @returns Floor coordinate nearest to the map center.
 */
export function selectCenteredStartCoord(
  floorCoords: ReadonlyArray<PortalGridCoord>,
  width: number,
  height: number
): PortalGridCoord {
  const centerX = Math.floor(width / 2);
  const centerY = Math.floor(height / 2);
  let best = floorCoords[0]!;
  let bestDistSq = Number.POSITIVE_INFINITY;

  for (const pt of floorCoords) {
    const dx = pt.x - centerX;
    const dy = pt.y - centerY;
    const distSq = dx * dx + dy * dy;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      best = pt;
    }
  }
  return best;
}

/**
 * Computes the signed inward coordinate for a requested cardinal edge (smaller = closer to that edge).
 */
function getAxisCoordinateForSide(pt: PortalGridCoord, side: CardinalPlacementSide): number {
  switch (side) {
    case 'top':
      return pt.y;
    case 'bottom':
      return -pt.y;
    case 'left':
      return pt.x;
    case 'right':
      return -pt.x;
    default:
      return assertNever(side);
  }
}

/**
 * Checks whether a coordinate sits within the preferred centered perpendicular band for a cardinal side.
 */
function isInPerpendicularCenterBand(
  pt: PortalGridCoord,
  side: CardinalPlacementSide,
  width: number,
  height: number
): boolean {
  switch (side) {
    case 'top':
    case 'bottom': {
      const halfBand = Math.max(1, width * CELLULAR_PORTAL_PERPENDICULAR_CENTER_BAND);
      return Math.abs(pt.x - width / 2) <= halfBand;
    }
    case 'left':
    case 'right': {
      const halfBand = Math.max(1, height * CELLULAR_PORTAL_PERPENDICULAR_CENTER_BAND);
      return Math.abs(pt.y - height / 2) <= halfBand;
    }
    default:
      return assertNever(side);
  }
}

/**
 * Selects a walkable portal coordinate for `cellular` and `dla` maps that respects `placementSide`
 * (hugging the requested cardinal map edge near its perpendicular midpoint) while avoiding clustering
 * against already-placed portals and the map start tile.
 *
 * @param floorCoords All walkable floor coordinates on the map.
 * @param connection Area connection metadata.
 * @param placedPortals Previously placed portal coordinates to avoid clustering with.
 * @param startPos Map start coordinate.
 * @param width Map width in tiles.
 * @param height Map height in tiles.
 * @returns Selected walkable portal coordinate.
 */
export function selectCellularPortalCoord(
  floorCoords: ReadonlyArray<PortalGridCoord>,
  connection: AreaConnection,
  placedPortals: ReadonlyArray<PortalGridCoord>,
  startPos: PortalGridCoord,
  width: number,
  height: number
): PortalGridCoord {
  const occupiedKeys = new Set<string>(placedPortals.map((p) => `${p.x},${p.y}`));
  const isUnoccupied = (pt: PortalGridCoord): boolean => !occupiedKeys.has(`${pt.x},${pt.y}`);
  const isWellSeparated = (pt: PortalGridCoord): boolean =>
    isUnoccupied(pt) &&
    (pt.x !== startPos.x || pt.y !== startPos.y) &&
    placedPortals.every((existing) => manhattanDistance(pt, existing) >= MIN_CELLULAR_PORTAL_SEPARATION);

  const side = connection.placementSide ?? 'any';
  if (side === 'any') {
    const separatedFromAll = floorCoords.filter(
      (pt) => isWellSeparated(pt) && manhattanDistance(pt, startPos) >= MIN_CELLULAR_PORTAL_SEPARATION
    );
    if (separatedFromAll.length > 0) return pickRandomCoord(separatedFromAll);
    const separatedFromPortals = floorCoords.filter(isWellSeparated);
    if (separatedFromPortals.length > 0) return pickRandomCoord(separatedFromPortals);
    const unoccupied = floorCoords.filter(isUnoccupied);
    if (unoccupied.length > 0) return pickRandomCoord(unoccupied);
    return pickRandomCoord(floorCoords);
  }

  let extremeAxis = Number.POSITIVE_INFINITY;
  for (const pt of floorCoords) {
    const axisVal = getAxisCoordinateForSide(pt, side);
    if (axisVal < extremeAxis) {
      extremeAxis = axisVal;
    }
  }

  const edgeBand = floorCoords.filter(
    (pt) => getAxisCoordinateForSide(pt, side) <= extremeAxis + CELLULAR_PORTAL_EDGE_BAND_TILES
  );
  const centeredEdgeSeparated = edgeBand.filter(
    (pt) => isWellSeparated(pt) && isInPerpendicularCenterBand(pt, side, width, height)
  );
  if (centeredEdgeSeparated.length > 0) return pickRandomCoord(centeredEdgeSeparated);

  const edgeSeparated = edgeBand.filter(isWellSeparated);
  if (edgeSeparated.length > 0) return pickRandomCoord(edgeSeparated);

  const separatedAll = floorCoords.filter(isWellSeparated);
  if (separatedAll.length > 0) {
    let bestAxis = Number.POSITIVE_INFINITY;
    for (const pt of separatedAll) {
      const axisVal = getAxisCoordinateForSide(pt, side);
      if (axisVal < bestAxis) bestAxis = axisVal;
    }
    const outerSeparated = separatedAll.filter(
      (pt) => getAxisCoordinateForSide(pt, side) <= bestAxis + CELLULAR_PORTAL_EDGE_BAND_TILES
    );
    if (outerSeparated.length > 0) return pickRandomCoord(outerSeparated);
  }

  const edgeUnoccupied = edgeBand.filter(isUnoccupied);
  if (edgeUnoccupied.length > 0) return pickRandomCoord(edgeUnoccupied);

  const unoccupied = floorCoords.filter(isUnoccupied);
  if (unoccupied.length > 0) return pickRandomCoord(unoccupied);
  return pickRandomCoord(floorCoords);
}

/**
 * Selects a non-overlapping candidate coordinate from digger portal wall candidates, falling back
 * to the room interior or raw candidate list only when every candidate is already occupied.
 *
 * @param candidates Wall coordinates matching the desired side of the target room.
 * @param placedPortals Previously placed portal coordinates.
 * @param fallbackCoord Default coordinate (typically room center) when `candidates` is empty.
 * @returns Selected portal coordinate.
 */
export function selectDiggerPortalCandidate(
  candidates: ReadonlyArray<PortalGridCoord>,
  placedPortals: ReadonlyArray<PortalGridCoord>,
  fallbackCoord: PortalGridCoord
): PortalGridCoord {
  if (candidates.length === 0) return fallbackCoord;
  const occupiedKeys = new Set<string>(placedPortals.map((p) => `${p.x},${p.y}`));
  const unoccupied = candidates.filter((pt) => !occupiedKeys.has(`${pt.x},${pt.y}`));
  if (unoccupied.length > 0) return pickRandomCoord(unoccupied);
  return pickRandomCoord(candidates);
}
