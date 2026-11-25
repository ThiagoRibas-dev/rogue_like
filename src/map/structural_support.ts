import { CAVE_IN_CRUSH_DAMAGE, MAX_SUPPORT_SPAN_TILES } from '../constants/world_chunk.constants.ts';
import { addComponent, getComponent, getEntitiesAtPosition, spawnItem } from '../core/ecs.ts';
import { getMapZBounds, getTileDefAt, getTileIdAt, isInMapBounds, isMultiZMap, setTileIdAt } from './map_accessor.ts';
import { resolveGravityForEntity } from '../systems/gravity.system.ts';
import { addMessage, MessageLogCategory } from '../systems/message.system.ts';
import { ComponentType, type DamageComponent } from '../types/components.types.ts';
import type { GameState } from '../types/game-state.types.ts';

const ORTHOGONAL_DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1]
];

function isCellLoadBearingOrGrounded(state: Readonly<GameState>, x: number, y: number, z: number): boolean {
  if (!isInMapBounds(state.map, x, y, z)) return false;
  const { minZ } = getMapZBounds(state.map);
  if (z <= minZ) return true;

  const def = getTileDefAt(state, x, y, z);
  if (!def || def.isOpenAir === true) return false;
  if (def.isLoadBearing === true) return true;
  if (!def.walkable && def.hazardKind === undefined && def.verticalLink === undefined) {
    return true;
  }

  // A constructed floor or ceiling directly above a solid load-bearing block below is vertically supported.
  const belowDef = getTileDefAt(state, x, y, z - 1);
  if (belowDef && belowDef.isOpenAir !== true && !belowDef.walkable && belowDef.hazardKind === undefined) {
    return true;
  }
  return false;
}

/**
 * Evaluates whether the voxel at `(x, y, z)` has connected structural support to bedrock,
 * a load-bearing wall/pillar, or solid support directly below within `MAX_SUPPORT_SPAN_TILES`.
 */
export function evaluateStructuralSupport(state: Readonly<GameState>, x: number, y: number, z: number): boolean {
  if (!isMultiZMap(state.map)) return true;
  if (!isInMapBounds(state.map, x, y, z)) return true;

  const def = getTileDefAt(state, x, y, z);
  if (!def || def.isOpenAir === true) return true;
  if (isCellLoadBearingOrGrounded(state, x, y, z)) return true;

  const visited = new Set<string>([`${x},${y}`]);
  const queue: Array<{ readonly x: number; readonly y: number; readonly dist: number }> = [{ x, y, dist: 0 }];
  let head = 0;

  while (head < queue.length) {
    const cur = queue[head++]!;
    if (cur.dist >= MAX_SUPPORT_SPAN_TILES) continue;

    for (const [dx, dy] of ORTHOGONAL_DIRS) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      const key = `${nx},${ny}`;
      if (visited.has(key) || !isInMapBounds(state.map, nx, ny, z)) continue;
      const nDef = getTileDefAt(state, nx, ny, z);
      if (!nDef || nDef.isOpenAir === true) continue;
      if (isCellLoadBearingOrGrounded(state, nx, ny, z)) {
        return true;
      }
      visited.add(key);
      queue.push({ x: nx, y: ny, dist: cur.dist + 1 });
    }
  }

  return false;
}

function resolveLandingZBelow(state: Readonly<GameState>, x: number, y: number, startZ: number): number {
  const { minZ } = getMapZBounds(state.map);
  for (let probeZ = startZ - 1; probeZ >= minZ; probeZ--) {
    if (!isInMapBounds(state.map, x, y, probeZ)) break;
    const def = getTileDefAt(state, x, y, probeZ);
    if (def && def.isOpenAir !== true) {
      return probeZ;
    }
  }
  return minZ;
}

/**
 * Checks whether sculpting or removing support at `(x, y, z)` leaves unsupported upper floors/walls,
 * collapsing them to `open_air`, dropping rubble, dealing crushing damage below, and applying gravity.
 */
export function resolveCaveInAroundVoxel(state: GameState, x: number, y: number, z: number): GameState {
  if (!isMultiZMap(state.map)) return state;
  const { maxZ } = getMapZBounds(state.map);
  if (z + 1 > maxZ) return state;

  let nextState = state;
  const candidates: Array<readonly [number, number, number]> = [[x, y, z + 1]];
  for (const [dx, dy] of ORTHOGONAL_DIRS) {
    candidates.push([x + dx, y + dy, z + 1]);
  }

  let collapseCount = 0;
  for (const [cx, cy, cz] of candidates) {
    if (!isInMapBounds(nextState.map, cx, cy, cz)) continue;
    const tileId = getTileIdAt(nextState.map, cx, cy, cz);
    const tileDef = tileId ? nextState.campaign.tiles[tileId] : undefined;
    if (!tileDef || tileDef.isOpenAir === true) continue;
    if (evaluateStructuralSupport(nextState, cx, cy, cz)) continue;

    collapseCount += 1;
    const dropItemId = tileDef.collapseDropItemId ?? tileDef.mineYieldItemId;
    nextState = {
      ...nextState,
      map: setTileIdAt(nextState.map, cx, cy, 'open_air', cz),
      fovNeedsUpdate: true
    };

    const landZ = resolveLandingZBelow(nextState, cx, cy, cz);
    if (dropItemId && nextState.campaign.items[dropItemId]) {
      [nextState] = spawnItem(nextState, dropItemId, cx, cy, landZ);
    }

    for (const victimId of getEntitiesAtPosition(nextState, cx, cy, landZ)) {
      if (!getComponent(nextState, victimId, ComponentType.Fighter)) continue;
      const existingDmg = getComponent(nextState, victimId, ComponentType.Damage) as DamageComponent | undefined;
      const instance = { amount: CAVE_IN_CRUSH_DAMAGE, tags: ['bludgeoning', 'cave_in'] as const };
      nextState = addComponent(nextState, victimId, {
        type: ComponentType.Damage,
        instances: existingDmg ? [...existingDmg.instances, instance] : [instance]
      });
    }

    for (const fallenId of [...getEntitiesAtPosition(nextState, cx, cy, cz)]) {
      nextState = resolveGravityForEntity(nextState, fallenId).state;
    }
  }

  if (collapseCount > 0) {
    nextState = addMessage(
      nextState,
      `Unsupported ceiling ${collapseCount > 1 ? 'sections collapse' : 'collapses'} in a cave-in!`,
      MessageLogCategory.CombatHit
    );
  }

  return nextState;
}
