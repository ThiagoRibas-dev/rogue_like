import { getComponent } from '../../core/ecs.ts';
import { getTileDefAt, isInMapBounds } from '../../map/map_accessor.ts';
import { resolveConstructionBlueprint } from '../construction.system.ts';
import type { DesignationKind, TileDesignation } from '../../types/colony.types.ts';
import { ComponentType } from '../../types/components.types.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';
import { ensureColonyState } from './job_blackboard.ts';

/** Canonical lookup key for a spatial tile designation within `areaId`. */
export function formatDesignationKey(areaId: string, x: number, y: number, z = 0): string {
  return `${areaId}:${x},${y},${z}`;
}

function isDesignationValidAt(
  state: Readonly<GameState>,
  kind: DesignationKind,
  x: number,
  y: number,
  z: number,
  blueprintId?: string,
  targetEntityId?: EntityId
): boolean {
  if (!isInMapBounds(state.map, x, y, z)) return false;
  const tileDef = getTileDefAt(state, x, y, z);
  if (!tileDef) return false;

  switch (kind) {
    case 'mine':
    case 'channel':
      return tileDef.mineable === true || (tileDef.tags?.includes('mineable') ?? false);
    case 'build': {
      const hasBlueprint = blueprintId !== undefined && resolveConstructionBlueprint(state, blueprintId) !== undefined;
      return hasBlueprint && !tileDef.isSolidObstacle;
    }
    case 'chop':
      return tileDef.tags?.includes('tree') === true || tileDef.tags?.includes('chop') === true;
    case 'harvest':
      return targetEntityId !== undefined && getComponent(state, targetEntityId, ComponentType.Corpse) !== undefined;
    case 'haul':
      return targetEntityId !== undefined && getComponent(state, targetEntityId, ComponentType.Item) !== undefined;
  }
}

/** Registers a single validated tile designation on the active area's colony overlay. */
export function addTileDesignation(
  state: GameState,
  input: {
    readonly kind: DesignationKind;
    readonly x: number;
    readonly y: number;
    readonly z?: number | undefined;
    readonly priority?: number | undefined;
    readonly blueprintId?: string | undefined;
    readonly targetEntityId?: EntityId | undefined;
  }
): { readonly state: GameState; readonly added: boolean } {
  const z = input.z ?? 0;
  if (!isDesignationValidAt(state, input.kind, input.x, input.y, z, input.blueprintId, input.targetEntityId)) {
    return { state, added: false };
  }

  const colony = ensureColonyState(state);
  const key = formatDesignationKey(state.currentAreaId, input.x, input.y, z);
  const designation: TileDesignation = {
    id: key,
    kind: input.kind,
    areaId: state.currentAreaId,
    x: input.x,
    y: input.y,
    z,
    priority: input.priority ?? 2,
    ...(input.blueprintId !== undefined ? { blueprintId: input.blueprintId } : {}),
    ...(input.targetEntityId !== undefined ? { targetEntityId: input.targetEntityId } : {}),
    createdTurn: state.globalTurn ?? 0
  };

  return {
    state: {
      ...state,
      colonyState: {
        ...colony,
        designations: {
          ...colony.designations,
          [key]: designation
        }
      }
    },
    added: true
  };
}

/** Applies a rectangular box designation across `(x1..x2, y1..y2)` on `z`, skipping invalid cells. */
export function addRectDesignation(
  state: GameState,
  input: {
    readonly kind: DesignationKind;
    readonly x1: number;
    readonly y1: number;
    readonly x2: number;
    readonly y2: number;
    readonly z?: number | undefined;
    readonly priority?: number | undefined;
    readonly blueprintId?: string | undefined;
  }
): { readonly state: GameState; readonly count: number } {
  const minX = Math.min(input.x1, input.x2);
  const maxX = Math.max(input.x1, input.x2);
  const minY = Math.min(input.y1, input.y2);
  const maxY = Math.max(input.y1, input.y2);
  let nextState = state;
  let count = 0;

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const res = addTileDesignation(nextState, {
        kind: input.kind,
        x,
        y,
        z: input.z,
        priority: input.priority,
        blueprintId: input.blueprintId
      });
      if (res.added) {
        nextState = res.state;
        count += 1;
      }
    }
  }

  return { state: nextState, count };
}

/** Removes any designation matching `(areaId, x, y, z)`. */
export function removeTileDesignation(state: GameState, areaId: string, x: number, y: number, z = 0): GameState {
  const colony = state.colonyState;
  if (!colony) return state;
  const key = formatDesignationKey(areaId, x, y, z);
  if (!colony.designations[key]) return state;

  const nextDesignations = { ...colony.designations };
  delete nextDesignations[key];
  return {
    ...state,
    colonyState: {
      ...colony,
      designations: nextDesignations
    }
  };
}

/** Completes and clears any designation at `(areaId, x, y, z)` once its physical work finishes. */
export function completeDesignationAt(state: GameState, areaId: string, x: number, y: number, z = 0): GameState {
  return removeTileDesignation(state, areaId, x, y, z);
}

/** Returns all active designations belonging to `areaId`, sorted by priority then creation turn. */
export function getActiveDesignationsForArea(
  state: Readonly<GameState>,
  areaId: string = state.currentAreaId
): ReadonlyArray<TileDesignation> {
  const designations = state.colonyState?.designations;
  if (!designations) return [];
  return Object.values(designations)
    .filter((d) => d.areaId === areaId)
    .sort((a, b) => a.priority - b.priority || a.createdTurn - b.createdTurn);
}
