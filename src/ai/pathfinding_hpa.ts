import * as ROT from 'rot-js';
import { getTileDefAt, isInMapBounds, isMultiZMap } from '../map/map_accessor.ts';
import { buildOrUpdateRegionGraph, getRegionKeyAt } from '../map/region_graph.ts';
import type { GameState } from '../types/game-state.types.ts';
import { packWorldCoord3D } from '../utils/grid.ts';
import { lookupFlowFieldStep, resolveHpaIntermediateWaypoint } from './flow_field.ts';

/** Node search budget for bounded local 3D A* refinement toward a waypoint. */
const HPA_LOCAL_ASTAR_BUDGET = 900;

const LOCAL_2D_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
  [1, -1],
  [1, 1],
  [-1, 1],
  [-1, -1]
];

/**
 * Computes a bounded 3D local A* step toward `(targetX, targetY, targetZ)`,
 * traversing stairs, ladders, and ramps natively across Z slices.
 */
export function computeBoundedAStar3DStep(
  state: Readonly<GameState>,
  fromX: number,
  fromY: number,
  fromZ: number,
  targetX: number,
  targetY: number,
  targetZ: number,
  isPassable: (nx: number, ny: number, nz: number, prevX: number, prevY: number, prevZ: number) => boolean
): { readonly dx: number; readonly dy: number; readonly dz: number } | null {
  if (!isMultiZMap(state.map) && fromZ === targetZ) {
    const astar = new ROT.Path.AStar(
      targetX,
      targetY,
      (x: number, y: number): boolean => {
        if (x === fromX && y === fromY) return true;
        if (x === targetX && y === targetY) return true;
        return isPassable(x, y, fromZ, fromX, fromY, fromZ);
      },
      { topology: 8 }
    );
    const steps: Array<{ readonly x: number; readonly y: number }> = [];
    astar.compute(fromX, fromY, (x: number, y: number): void => {
      steps.push({ x, y });
    });
    if (steps.length >= 2) {
      const next = steps[1]!;
      if (isPassable(next.x, next.y, fromZ, fromX, fromY, fromZ)) {
        return { dx: next.x - fromX, dy: next.y - fromY, dz: 0 };
      }
    }
    return null;
  }

  const startKey = packWorldCoord3D(fromX, fromY, fromZ);
  const gScore = new Map<number, number>([[startKey, 0]]);
  const cameFrom = new Map<
    number,
    { readonly key: number; readonly x: number; readonly y: number; readonly z: number }
  >();
  const open: Array<{
    readonly key: number;
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly f: number;
  }> = [
    {
      key: startKey,
      x: fromX,
      y: fromY,
      z: fromZ,
      f: Math.hypot(targetX - fromX, targetY - fromY, (targetZ - fromZ) * 2)
    }
  ];
  const closed = new Set<number>();
  let iterations = 0;

  while (open.length > 0 && iterations < HPA_LOCAL_ASTAR_BUDGET) {
    iterations++;
    open.sort((a, b) => a.f - b.f);
    const cur = open.shift()!;
    if (cur.x === targetX && cur.y === targetY && cur.z === targetZ) {
      let traceKey = cur.key;
      let nextCoord: { readonly x: number; readonly y: number; readonly z: number } = {
        x: cur.x,
        y: cur.y,
        z: cur.z
      };
      while (cameFrom.has(traceKey)) {
        const parent = cameFrom.get(traceKey)!;
        if (parent.key === startKey) {
          return { dx: nextCoord.x - fromX, dy: nextCoord.y - fromY, dz: nextCoord.z - fromZ };
        }
        traceKey = parent.key;
        nextCoord = { x: parent.x, y: parent.y, z: parent.z };
      }
      return null;
    }

    if (closed.has(cur.key)) continue;
    closed.add(cur.key);

    const curG = gScore.get(cur.key) ?? Infinity;
    const candidates: Array<{ readonly x: number; readonly y: number; readonly z: number; readonly cost: number }> = [];

    for (const [dx, dy] of LOCAL_2D_OFFSETS) {
      candidates.push({ x: cur.x + dx, y: cur.y + dy, z: cur.z, cost: dx !== 0 && dy !== 0 ? 1.4 : 1 });
    }
    const curDef = getTileDefAt(state, cur.x, cur.y, cur.z);
    for (const dz of [-1, 1] as const) {
      const nz = cur.z + dz;
      if (isInMapBounds(state.map, cur.x, cur.y, nz)) {
        const nDef = getTileDefAt(state, cur.x, cur.y, nz);
        if (curDef?.verticalLink !== undefined || nDef?.verticalLink !== undefined || nDef?.isClimbable === true) {
          candidates.push({ x: cur.x, y: cur.y, z: nz, cost: 1 });
        }
      }
      for (const [dx, dy] of LOCAL_2D_OFFSETS) {
        const nx = cur.x + dx;
        const ny = cur.y + dy;
        if (!isInMapBounds(state.map, nx, ny, nz)) continue;
        const nDef = getTileDefAt(state, nx, ny, nz);
        if (curDef?.verticalLink === 'ramp' || nDef?.verticalLink === 'ramp') {
          candidates.push({ x: nx, y: ny, z: nz, cost: 1.4 });
        }
      }
    }

    for (const cand of candidates) {
      const nKey = packWorldCoord3D(cand.x, cand.y, cand.z);
      if (closed.has(nKey)) continue;
      const isGoal = cand.x === targetX && cand.y === targetY && cand.z === targetZ;
      if (!isGoal && !isPassable(cand.x, cand.y, cand.z, cur.x, cur.y, cur.z)) continue;
      const nextG = curG + cand.cost;
      if (nextG < (gScore.get(nKey) ?? Infinity)) {
        gScore.set(nKey, nextG);
        cameFrom.set(nKey, { key: cur.key, x: cur.x, y: cur.y, z: cur.z });
        open.push({
          key: nKey,
          x: cand.x,
          y: cand.y,
          z: cand.z,
          f: nextG + Math.hypot(targetX - cand.x, targetY - cand.y, (targetZ - cand.z) * 2)
        });
      }
    }
  }

  return null;
}

/**
 * Resolves the optimal next 3D step `{ dx, dy, dz }` toward `(goalX, goalY, goalZ)` using:
 * 1. Shared 3D Dijkstra Flow Field lookup within radius,
 * 2. HPA* abstract region portal routing across clusters and Z strata,
 * 3. Bounded local A* refinement.
 */
export function computeHierarchicalNextStep(
  state: Readonly<GameState>,
  fromX: number,
  fromY: number,
  fromZ: number,
  goalX: number,
  goalY: number,
  goalZ: number,
  isPassable: (nx: number, ny: number, nz: number, prevX: number, prevY: number, prevZ: number) => boolean
): { readonly dx: number; readonly dy: number; readonly dz: number } | null {
  const flowStep = lookupFlowFieldStep(state, fromX, fromY, fromZ, goalX, goalY, goalZ, (nx, ny, nz) =>
    isPassable(nx, ny, nz, fromX, fromY, fromZ)
  );
  if (flowStep) {
    return flowStep;
  }

  const graph = buildOrUpdateRegionGraph(state);
  const startReg = getRegionKeyAt(graph, fromX, fromY, fromZ);
  const goalReg = getRegionKeyAt(graph, goalX, goalY, goalZ);

  if (startReg && goalReg && startReg !== goalReg) {
    const waypoint = resolveHpaIntermediateWaypoint(state, fromX, fromY, fromZ, goalX, goalY, goalZ);
    if (waypoint) {
      const hpaLocal = computeBoundedAStar3DStep(
        state,
        fromX,
        fromY,
        fromZ,
        waypoint.x,
        waypoint.y,
        waypoint.z,
        isPassable
      );
      if (hpaLocal) return hpaLocal;
    }
  }

  return computeBoundedAStar3DStep(state, fromX, fromY, fromZ, goalX, goalY, goalZ, isPassable);
}
