import { canTraverseVerticalTiles, getTileDefAt, isInMapBounds, isMultiZMap } from '../map/map_accessor.ts';
import { buildOrUpdateRegionGraph, getRegionKeyAt, type RegionGraph } from '../map/region_graph.ts';
import type { GameState } from '../types/game-state.types.ts';
import { packWorldCoord3D } from '../utils/grid.ts';

/** Default radius (in tiles) covered by a shared per-target 3D Dijkstra flow field. */
export const DEFAULT_FLOW_FIELD_RADIUS = 24;

/** Maximum LRU cached flow fields retained across simultaneous targets/turns. */
const MAX_FLOW_FIELD_CACHE_ENTRIES = 16;

/** Integer fixed-point multiplier used by Dial's bucket Dijkstra queue (`1.0` tile = `10`). */
const FLOW_COST_SCALE = 10;
const FLOW_ORTHO_COST = 10;
const FLOW_DIAG_COST = 14;
const FLOW_VERTICAL_COST = 10;
const FLOW_RAMP_COST = 14;

const FLOW_OFFSETS_2D: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
  [1, -1],
  [1, 1],
  [-1, 1],
  [-1, -1]
];

/** Precomputed 3D Dijkstra distance map from a single target coordinate `(goalX, goalY, goalZ)`. */
export interface FlowField3D {
  readonly areaId: string;
  readonly goalX: number;
  readonly goalY: number;
  readonly goalZ: number;
  readonly radius: number;
  readonly distances: ReadonlyMap<number, number>;
  readonly mapRef: GameState['map'];
}

const flowFieldCache = new Map<string, FlowField3D>();

function isTileNavigableForFlow(def: ReturnType<typeof getTileDefAt>): boolean {
  if (!def || def.isSolidObstacle === true) return false;
  return def.walkable === true || def.verticalLink !== undefined || def.isClimbable === true;
}

function canStepFlowNeighbor(
  state: Readonly<GameState>,
  x: number,
  y: number,
  z: number,
  nx: number,
  ny: number,
  nz: number
): boolean {
  if (!isInMapBounds(state.map, nx, ny, nz)) return false;
  const curDef = getTileDefAt(state, x, y, z);
  const def = getTileDefAt(state, nx, ny, nz);
  if (!isTileNavigableForFlow(curDef) || !isTileNavigableForFlow(def)) return false;
  if (nz === z) {
    return true;
  }
  // Dijkstra expands outward from goal (x,y,z) to (nx,ny,nz); actors move in reverse (nx,ny,nz) -> (x,y,z)
  return canTraverseVerticalTiles(def, curDef, z - nz);
}

/**
 * Clears all cached shared 3D Dijkstra flow fields (used in tests or area resets).
 */
export function clearFlowFieldCache(): void {
  flowFieldCache.clear();
}

/**
 * Computes or retrieves a cached shared 3D Dijkstra flow field radiating outward from `(goalX, goalY, goalZ)`.
 * Multiple AI actors targeting the same entity/tile within a turn share this single map cleanly in $O(1)$ per step.
 */
export function computeOrGetFlowField(
  state: Readonly<GameState>,
  goalX: number,
  goalY: number,
  goalZ = 0,
  radius = DEFAULT_FLOW_FIELD_RADIUS
): FlowField3D {
  const key = `${state.currentAreaId}:${goalX},${goalY},${goalZ}:${radius}`;
  const cached = flowFieldCache.get(key);
  if (cached && cached.mapRef === state.map) {
    return cached;
  }

  const distances = new Map<number, number>();
  const scaledDist = new Map<number, number>();
  const startPacked = packWorldCoord3D(goalX, goalY, goalZ);
  distances.set(startPacked, 0);
  scaledDist.set(startPacked, 0);

  const maxScaledDist = Math.max(0, Math.floor(radius * FLOW_COST_SCALE));
  const buckets: Array<Array<{ readonly x: number; readonly y: number; readonly z: number }>> = Array.from(
    { length: maxScaledDist + 1 },
    () => []
  );
  buckets[0]!.push({ x: goalX, y: goalY, z: goalZ });
  const multiZ = isMultiZMap(state.map);

  const tryRelax = (nx: number, ny: number, nz: number, nextScaled: number): void => {
    if (nextScaled > maxScaledDist) return;
    const nPacked = packWorldCoord3D(nx, ny, nz);
    const prev = scaledDist.get(nPacked);
    if (prev === undefined || nextScaled < prev) {
      scaledDist.set(nPacked, nextScaled);
      distances.set(nPacked, nextScaled / FLOW_COST_SCALE);
      buckets[nextScaled]!.push({ x: nx, y: ny, z: nz });
    }
  };

  for (let d = 0; d <= maxScaledDist; d++) {
    const bucket = buckets[d]!;
    for (let bi = 0; bi < bucket.length; bi++) {
      const cur = bucket[bi]!;
      const curPacked = packWorldCoord3D(cur.x, cur.y, cur.z);
      if (d > (scaledDist.get(curPacked) ?? Infinity)) continue;
      if (d >= maxScaledDist) continue;

      // 8-way same-level neighbors
      for (const [dx, dy] of FLOW_OFFSETS_2D) {
        const nx = cur.x + dx;
        const ny = cur.y + dy;
        const stepCost = dx !== 0 && dy !== 0 ? FLOW_DIAG_COST : FLOW_ORTHO_COST;
        if (d + stepCost > maxScaledDist) continue;
        if (!canStepFlowNeighbor(state, cur.x, cur.y, cur.z, nx, ny, cur.z)) continue;
        tryRelax(nx, ny, cur.z, d + stepCost);
      }

      // Vertical transitions via stairs, ladders, or ramps when multi-Z
      if (multiZ) {
        for (const dz of [-1, 1] as const) {
          const nz = cur.z + dz;
          if (
            d + FLOW_VERTICAL_COST <= maxScaledDist &&
            canStepFlowNeighbor(state, cur.x, cur.y, cur.z, cur.x, cur.y, nz)
          ) {
            tryRelax(cur.x, cur.y, nz, d + FLOW_VERTICAL_COST);
          }
          // Ramp steps diagonally between (x,y,z) and adjacent (x+dx,y+dy,z+dz)
          if (d + FLOW_RAMP_COST > maxScaledDist) continue;
          const curDef = getTileDefAt(state, cur.x, cur.y, cur.z);
          for (const [dx, dy] of FLOW_OFFSETS_2D) {
            const nx = cur.x + dx;
            const ny = cur.y + dy;
            if (!isInMapBounds(state.map, nx, ny, nz)) continue;
            const targetDef = getTileDefAt(state, nx, ny, nz);
            if (curDef?.verticalLink === 'ramp' || targetDef?.verticalLink === 'ramp') {
              if (targetDef?.walkable || targetDef?.verticalLink !== undefined) {
                tryRelax(nx, ny, nz, d + FLOW_RAMP_COST);
              }
            }
          }
        }
      }
    }
  }

  const field: FlowField3D = {
    areaId: state.currentAreaId,
    goalX,
    goalY,
    goalZ,
    radius,
    distances,
    mapRef: state.map
  };

  if (flowFieldCache.size >= MAX_FLOW_FIELD_CACHE_ENTRIES) {
    const oldestKey = flowFieldCache.keys().next().value;
    if (oldestKey !== undefined) flowFieldCache.delete(oldestKey);
  }
  flowFieldCache.set(key, field);
  return field;
}

/**
 * Looks up the steepest downhill 3D step `(dx, dy, dz)` along the shared Dijkstra flow field toward `(goalX, goalY, goalZ)`.
 * Returns `null` when `(fromX, fromY, fromZ)` is outside the computed field or already at distance `<= 1`.
 */
export function lookupFlowFieldStep(
  state: Readonly<GameState>,
  fromX: number,
  fromY: number,
  fromZ: number,
  goalX: number,
  goalY: number,
  goalZ: number,
  isPassable?: (nx: number, ny: number, nz: number) => boolean
): { readonly dx: number; readonly dy: number; readonly dz: number } | null {
  const field = computeOrGetFlowField(state, goalX, goalY, goalZ);
  const curDist = field.distances.get(packWorldCoord3D(fromX, fromY, fromZ)) ?? Infinity;
  let bestScore = curDist;
  let bestStep: { readonly dx: number; readonly dy: number; readonly dz: number } | null = null;

  const tryCandidate = (nx: number, ny: number, nz: number): void => {
    if (nx === goalX && ny === goalY && nz === goalZ) return;
    if (isPassable && !isPassable(nx, ny, nz)) return;
    const d = field.distances.get(packWorldCoord3D(nx, ny, nz));
    if (d !== undefined && d < bestScore) {
      bestScore = d;
      bestStep = { dx: nx - fromX, dy: ny - fromY, dz: nz - fromZ };
    }
  };

  for (const [dx, dy] of FLOW_OFFSETS_2D) {
    tryCandidate(fromX + dx, fromY + dy, fromZ);
  }
  if (isMultiZMap(state.map)) {
    const curDef = getTileDefAt(state, fromX, fromY, fromZ);
    const upDef = isInMapBounds(state.map, fromX, fromY, fromZ + 1)
      ? getTileDefAt(state, fromX, fromY, fromZ + 1)
      : undefined;
    const downDef = isInMapBounds(state.map, fromX, fromY, fromZ - 1)
      ? getTileDefAt(state, fromX, fromY, fromZ - 1)
      : undefined;

    if (canTraverseVerticalTiles(curDef, upDef, 1)) {
      tryCandidate(fromX, fromY, fromZ + 1);
    }
    if (canTraverseVerticalTiles(curDef, downDef, -1)) {
      tryCandidate(fromX, fromY, fromZ - 1);
    }
    for (const [dx, dy] of FLOW_OFFSETS_2D) {
      const tx = fromX + dx;
      const ty = fromY + dy;
      if (curDef?.verticalLink === 'ramp' && isInMapBounds(state.map, tx, ty, fromZ + 1)) {
        tryCandidate(tx, ty, fromZ + 1);
      }
      if (
        isInMapBounds(state.map, tx, ty, fromZ - 1) &&
        getTileDefAt(state, tx, ty, fromZ)?.isOpenAir === true &&
        getTileDefAt(state, tx, ty, fromZ - 1)?.verticalLink === 'ramp'
      ) {
        tryCandidate(tx, ty, fromZ - 1);
      }
    }
  }

  return bestStep;
}

/**
 * Computes an abstract HPA* portal hop from `(fromX, fromY, fromZ)` toward `(goalX, goalY, goalZ)`
 * when direct flow-field distance is too far or separated across region clusters / Z strata.
 */
export function resolveHpaIntermediateWaypoint(
  state: Readonly<GameState>,
  fromX: number,
  fromY: number,
  fromZ: number,
  goalX: number,
  goalY: number,
  goalZ: number
): { readonly x: number; readonly y: number; readonly z: number } | null {
  const graph: RegionGraph = buildOrUpdateRegionGraph(state);
  const startReg = getRegionKeyAt(graph, fromX, fromY, fromZ);
  const goalReg = getRegionKeyAt(graph, goalX, goalY, goalZ);
  if (!startReg || !goalReg || startReg === goalReg) {
    return null;
  }

  const startPortals = graph.regionToNodes.get(startReg) ?? [];
  const goalPortals = new Set(graph.regionToNodes.get(goalReg) ?? []);
  if (startPortals.length === 0 || goalPortals.size === 0) return null;

  const gScore = new Map<string, number>();
  const cameFrom = new Map<string, string>();
  const open: Array<{ readonly id: string; readonly f: number }> = [];
  const heuristic = (nx: number, ny: number, nz: number): number =>
    Math.hypot(goalX - nx, goalY - ny, (goalZ - nz) * 2);

  for (const pId of startPortals) {
    const p = graph.nodes.get(pId)!;
    const initCost = Math.hypot(p.x - fromX, p.y - fromY, (p.z - fromZ) * 2);
    gScore.set(pId, initCost);
    open.push({ id: pId, f: initCost + heuristic(p.x, p.y, p.z) });
  }

  while (open.length > 0) {
    open.sort((a, b) => a.f - b.f);
    const cur = open.shift()!;
    if (goalPortals.has(cur.id)) {
      let stepId = cur.id;
      while (cameFrom.has(stepId)) {
        const parent = cameFrom.get(stepId)!;
        if (
          startPortals.includes(parent) &&
          fromX === graph.nodes.get(parent)!.x &&
          fromY === graph.nodes.get(parent)!.y &&
          fromZ === graph.nodes.get(parent)!.z
        ) {
          break;
        }
        stepId = parent;
        if (startPortals.includes(stepId)) break;
      }
      const node = graph.nodes.get(stepId);
      return node ? { x: node.x, y: node.y, z: node.z } : null;
    }

    const curG = gScore.get(cur.id) ?? Infinity;
    for (const edge of graph.edges.get(cur.id) ?? []) {
      const nextG = curG + edge.cost;
      if (nextG < (gScore.get(edge.toNodeId) ?? Infinity)) {
        gScore.set(edge.toNodeId, nextG);
        cameFrom.set(edge.toNodeId, cur.id);
        const n = graph.nodes.get(edge.toNodeId)!;
        open.push({ id: edge.toNodeId, f: nextG + heuristic(n.x, n.y, n.z) });
      }
    }
  }

  return null;
}
