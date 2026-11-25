import { addComponent, getComponent, getEntitiesAtPosition, removeEntity, spawnItem } from '../core/ecs.ts';
import {
  getMaterialIdFromPaletteIndex,
  getPaletteIndexForMaterialId,
  buildMaterialPaletteRegistry
} from '../map/material_palette.ts';
import {
  getMaterialIndexAt,
  getTileDefAt,
  getTileIdAt,
  isInMapBounds,
  setMaterialIndexAt,
  setTileIdAt
} from '../map/map_accessor.ts';
import { resolveCaveInAroundVoxel } from '../map/structural_support.ts';
import type { ConstructionBlueprint } from '../types/campaign/meta.ts';
import type { TimedTerrainRevert } from '../types/colony.types.ts';
import {
  ComponentType,
  type InventoryComponent,
  type ItemComponent,
  type PositionComponent,
  type TagsComponent
} from '../types/components.types.ts';
import type { EntityId, GameState } from '../types/game-state.types.ts';
import { emitSoundEvent, SOUND_DB_DOOR_KICK } from './sound.system.ts';
import { resolveGravityForEntity } from './gravity.system.ts';
import { completeDesignationAt } from './labor/designation.system.ts';
import { ensureColonyState } from './labor/job_blackboard.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';

/** Resolves a declarative `ConstructionBlueprint` by ID from campaign rules or engine fallbacks. */
export function resolveConstructionBlueprint(
  state: Readonly<GameState>,
  blueprintId: string
): ConstructionBlueprint | undefined {
  return state.campaign.rules.blueprints?.[blueprintId] ?? DEFAULT_CONSTRUCTION_BLUEPRINTS[blueprintId];
}

/**
 * Displaces any positioned entities currently inside `(x, y, z)` to the nearest open walkable
 * neighbor before transforming that voxel into an impassable solid tile (e.g. *Passwall* revert or obsidian freeze).
 */
export function ejectEntitiesFromBlockedVoxel(state: GameState, x: number, y: number, z = 0): GameState {
  const occupants = [...getEntitiesAtPosition(state, x, y, z)];
  if (occupants.length === 0) return state;

  let safeCoord: { readonly x: number; readonly y: number } | undefined;
  for (let radius = 1; radius <= 2 && !safeCoord; radius++) {
    for (let dy = -radius; dy <= radius && !safeCoord; dy++) {
      for (let dx = -radius; dx <= radius && !safeCoord; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (!isInMapBounds(state.map, nx, ny, z)) continue;
        const nDef = getTileDefAt(state, nx, ny, z);
        if (nDef && nDef.walkable && !nDef.isSolidObstacle) {
          safeCoord = { x: nx, y: ny };
        }
      }
    }
  }
  if (!safeCoord) return state;

  let nextState = state;
  let movedActor = false;
  for (const eid of occupants) {
    const pos = getComponent(nextState, eid, ComponentType.Position) as PositionComponent | undefined;
    if (!pos) continue;
    const isMovable =
      getComponent(nextState, eid, ComponentType.Actor) !== undefined ||
      getComponent(nextState, eid, ComponentType.Item) !== undefined;
    if (!isMovable) continue;
    const { z: _oldZ, ...restPos } = pos;
    nextState = addComponent(nextState, eid, {
      ...restPos,
      x: safeCoord.x,
      y: safeCoord.y,
      ...(z !== 0 ? { z } : {})
    });
    if (getComponent(nextState, eid, ComponentType.Player) !== undefined) {
      nextState = { ...nextState, fovNeedsUpdate: true };
    }
    if (getComponent(nextState, eid, ComponentType.Actor) !== undefined) {
      movedActor = true;
    }
  }
  if (movedActor) {
    nextState = addMessage(nextState, 'Shifting stone pushes you clear of the solid rock!', MessageLogCategory.System);
  }
  return nextState;
}

/** Fallback declarative blueprints available when a campaign's `rules.json` omits custom overrides. */
export const DEFAULT_CONSTRUCTION_BLUEPRINTS: Readonly<Record<string, ConstructionBlueprint>> = {
  stone_wall_blueprint: {
    id: 'stone_wall_blueprint',
    name: 'Constructed Stone Wall',
    targetTileId: 'stone_wall',
    requiredInputs: [{ tag: 'material:stone', count: 1 }],
    workUnits: 1
  },
  stone_floor_blueprint: {
    id: 'stone_floor_blueprint',
    name: 'Stone Floor',
    targetTileId: 'stone_floor',
    requiredInputs: [{ tag: 'material:stone', count: 1 }],
    workUnits: 1
  }
};

function hasMatchingToolTag(
  state: Readonly<GameState>,
  actorId: EntityId,
  requiredTag: string,
  explicitToolId?: EntityId
): boolean {
  const itemHasTag = (eid: EntityId): boolean => {
    const tags = (getComponent(state, eid, ComponentType.Tags) as TagsComponent | undefined)?.tags ?? [];
    if (tags.includes(requiredTag)) return true;
    const item = getComponent(state, eid, ComponentType.Item) as ItemComponent | undefined;
    const defTags = item ? state.campaign.items[item.itemId]?.tags : undefined;
    return defTags?.includes(requiredTag) === true;
  };
  if (explicitToolId !== undefined && itemHasTag(explicitToolId)) return true;
  const inv = getComponent(state, actorId, ComponentType.Inventory) as InventoryComponent | undefined;
  return inv?.items.some((id) => itemHasTag(id)) === true;
}

/**
 * Mutates voxel `(x, y, z)` to `targetTileId` cleanly, updating `materialId`, flagging `fovNeedsUpdate`,
 * clearing completed designations, optionally spawning mining yields, and checking connected structural
 * support (`resolveCaveInAroundVoxel`) + entity gravity.
 */
export function sculptTerrainVoxel(
  state: GameState,
  x: number,
  y: number,
  z: number,
  targetTileId: string,
  options?: {
    readonly materialId?: string | undefined;
    readonly dropYield?: boolean | undefined;
    readonly dropAt?: { readonly x: number; readonly y: number; readonly z: number } | undefined;
  }
): GameState {
  if (!isInMapBounds(state.map, x, y, z)) return state;
  if (!state.campaign.tiles[targetTileId]) return state;

  const prevDef = getTileDefAt(state, x, y, z);
  const nextDef = state.campaign.tiles[targetTileId]!;
  let nextState = state;

  let nextMap = setTileIdAt(nextState.map, x, y, targetTileId, z);
  if (options?.materialId !== undefined) {
    const matPalette = buildMaterialPaletteRegistry(nextState.campaign.rules.materials);
    const matIdx = getPaletteIndexForMaterialId(matPalette, options.materialId);
    if (matIdx > 0) {
      nextMap = setMaterialIndexAt(nextMap, x, y, matIdx, z, nextState.globalTurn);
    }
  } else {
    const existingMat = getMaterialIndexAt(nextMap, x, y, z);
    if (existingMat > 0) {
      const matPalette = buildMaterialPaletteRegistry(nextState.campaign.rules.materials);
      if (!getMaterialIdFromPaletteIndex(matPalette, existingMat)) {
        nextMap = setMaterialIndexAt(nextMap, x, y, 0, z, nextState.globalTurn);
      }
    }
  }

  nextState = {
    ...nextState,
    map: nextMap,
    fovNeedsUpdate: true
  };

  nextState = completeDesignationAt(nextState, nextState.currentAreaId, x, y, z);

  if (options?.dropYield === true && prevDef?.mineYieldItemId && nextState.campaign.items[prevDef.mineYieldItemId]) {
    const count = prevDef.mineYieldCount ?? 1;
    const dropPos = options.dropAt ?? { x, y, z };
    for (let i = 0; i < count; i++) {
      [nextState] = spawnItem(nextState, prevDef.mineYieldItemId, dropPos.x, dropPos.y, dropPos.z);
    }
  }

  nextState = resolveCaveInAroundVoxel(nextState, x, y, z);

  if (nextDef.isOpenAir === true) {
    for (const eid of [...getEntitiesAtPosition(nextState, x, y, z)]) {
      nextState = resolveGravityForEntity(nextState, eid).state;
    }
  }

  return nextState;
}

/**
 * Resolves a physical `'mine'` / `'chop'` sculpting action at `(x, y, z)`, verifying declarative
 * `mineable` / `requiredToolTag` properties and dropping boulder/ore yields.
 */
export function mineTerrainTile(
  state: GameState,
  actorId: EntityId,
  x: number,
  y: number,
  z = 0,
  toolEntityId?: EntityId
): { readonly state: GameState; readonly success: boolean } {
  if (!isInMapBounds(state.map, x, y, z)) {
    return { state, success: false };
  }
  const tileDef = getTileDefAt(state, x, y, z);
  const canMine = tileDef !== undefined && (tileDef.mineable === true || tileDef.tags?.includes('mineable') === true);
  if (!tileDef || !canMine) {
    return {
      state: addMessage(state, 'That terrain cannot be mined.', MessageLogCategory.System),
      success: false
    };
  }

  if (tileDef.requiredToolTag && !hasMatchingToolTag(state, actorId, tileDef.requiredToolTag, toolEntityId)) {
    return {
      state: addMessage(state, `Requires a tool tagged ${tileDef.requiredToolTag}.`, MessageLogCategory.System),
      success: false
    };
  }

  const targetTileId = tileDef.minedTileId ?? 'stone_floor';
  if (!state.campaign.tiles[targetTileId]) {
    return { state, success: false };
  }

  const actorPos = getComponent(state, actorId, ComponentType.Position) as PositionComponent | undefined;
  let nextState = sculptTerrainVoxel(state, x, y, z, targetTileId, {
    dropYield: true,
    dropAt:
      state.campaign.tiles[targetTileId]?.isOpenAir === true && actorPos
        ? { x: actorPos.x, y: actorPos.y, z: actorPos.z ?? z }
        : { x, y, z }
  });
  nextState = emitSoundEvent(nextState, x, y, SOUND_DB_DOOR_KICK, actorId).state;
  nextState = addMessage(nextState, 'You carve through the rock.', MessageLogCategory.System);
  return { state: nextState, success: true };
}

function matchesIngredient(
  state: Readonly<GameState>,
  itemEntityId: EntityId,
  itemIdFilter: string | undefined,
  tagFilter: string | undefined
): boolean {
  const item = getComponent(state, itemEntityId, ComponentType.Item) as ItemComponent | undefined;
  if (!item) return false;
  if (itemIdFilter && item.itemId === itemIdFilter) return true;
  if (!tagFilter) return false;
  const tags = (getComponent(state, itemEntityId, ComponentType.Tags) as TagsComponent | undefined)?.tags ?? [];
  if (tags.includes(tagFilter)) return true;
  const defTags = state.campaign.items[item.itemId]?.tags;
  return defTags?.includes(tagFilter) === true;
}

/**
 * Resolves a `'build'` construction action using declarative `ConstructionBlueprint` inputs
 * from the actor's inventory or ground tiles within 1 tile of `(x, y, z)`.
 */
export function constructTerrainTile(
  state: GameState,
  actorId: EntityId,
  x: number,
  y: number,
  z = 0,
  blueprintId = 'stone_wall_blueprint',
  toolEntityId?: EntityId
): { readonly state: GameState; readonly success: boolean } {
  if (!isInMapBounds(state.map, x, y, z)) return { state, success: false };
  const blueprint = resolveConstructionBlueprint(state, blueprintId);
  if (!blueprint || !state.campaign.tiles[blueprint.targetTileId]) {
    return {
      state: addMessage(state, 'Unknown construction blueprint.', MessageLogCategory.System),
      success: false
    };
  }

  if (blueprint.requiredToolTag && !hasMatchingToolTag(state, actorId, blueprint.requiredToolTag, toolEntityId)) {
    return {
      state: addMessage(state, `Requires a tool tagged ${blueprint.requiredToolTag}.`, MessageLogCategory.System),
      success: false
    };
  }

  const tileDef = getTileDefAt(state, x, y, z);
  if (tileDef?.isOpenAir === true && blueprint.allowOverOpenAir !== true) {
    return {
      state: addMessage(state, 'Cannot build there without floor support.', MessageLogCategory.System),
      success: false
    };
  }

  const inv = getComponent(state, actorId, ComponentType.Inventory) as InventoryComponent | undefined;
  const toConsume: Array<{ readonly entityId: EntityId; readonly fromInventory: boolean }> = [];
  const usedIds = new Set<EntityId>();

  for (const req of blueprint.requiredInputs) {
    let foundCount = 0;
    for (const invItemId of inv?.items ?? []) {
      if (foundCount >= req.count) break;
      if (usedIds.has(invItemId)) continue;
      if (matchesIngredient(state, invItemId, req.itemId, req.tag)) {
        toConsume.push({ entityId: invItemId, fromInventory: true });
        usedIds.add(invItemId);
        foundCount += 1;
      }
    }
    if (foundCount < req.count) {
      for (let dy = -1; dy <= 1 && foundCount < req.count; dy++) {
        for (let dx = -1; dx <= 1 && foundCount < req.count; dx++) {
          for (const groundId of getEntitiesAtPosition(state, x + dx, y + dy, z)) {
            if (foundCount >= req.count) break;
            if (usedIds.has(groundId)) continue;
            if (matchesIngredient(state, groundId, req.itemId, req.tag)) {
              toConsume.push({ entityId: groundId, fromInventory: false });
              usedIds.add(groundId);
              foundCount += 1;
            }
          }
        }
      }
    }
    if (foundCount < req.count) {
      return {
        state: addMessage(state, `Missing materials to build ${blueprint.name}.`, MessageLogCategory.System),
        success: false
      };
    }
  }

  let nextState = state;
  const consumedFromInv = new Set(toConsume.filter((c) => c.fromInventory).map((c) => c.entityId));
  if (inv && consumedFromInv.size > 0) {
    nextState = addComponent(nextState, actorId, {
      ...inv,
      items: inv.items.filter((id) => !consumedFromInv.has(id))
    });
  }
  for (const c of toConsume) {
    nextState = removeEntity(nextState, c.entityId);
  }

  nextState = sculptTerrainVoxel(nextState, x, y, z, blueprint.targetTileId, {
    materialId: blueprint.materialId,
    dropYield: false
  });
  nextState = addMessage(nextState, `Built ${blueprint.name}.`, MessageLogCategory.System);
  return { state: nextState, success: true };
}

/** Schedules a temporary sculpted voxel (such as *Passwall*) to revert at `revertTurn`. */
export function scheduleTimedTerrainRevert(state: GameState, entry: TimedTerrainRevert): GameState {
  const colony = ensureColonyState(state);
  const filtered = colony.timedTerrainReverts.filter(
    (r) => !(r.areaId === entry.areaId && r.x === entry.x && r.y === entry.y && r.z === entry.z)
  );
  return {
    ...state,
    colonyState: {
      ...colony,
      timedTerrainReverts: [...filtered, entry]
    }
  };
}

/** Processes any scheduled temporary terrain reverts whose `revertTurn <= state.globalTurn`. */
export function tickTimedTerrainReverts(state: GameState): GameState {
  const reverts = state.colonyState?.timedTerrainReverts;
  if (!reverts || reverts.length === 0) return state;

  const currentTurn = state.globalTurn ?? 0;
  let nextState = state;
  const remaining: TimedTerrainRevert[] = [];
  let changed = false;

  for (const rev of reverts) {
    if (rev.areaId === nextState.currentAreaId && currentTurn >= rev.revertTurn) {
      changed = true;
      if (isInMapBounds(nextState.map, rev.x, rev.y, rev.z) && nextState.campaign.tiles[rev.revertTileId]) {
        const curTile = getTileIdAt(nextState.map, rev.x, rev.y, rev.z);
        if (curTile !== rev.revertTileId) {
          const revertDef = nextState.campaign.tiles[rev.revertTileId];
          if (revertDef && (!revertDef.walkable || revertDef.isSolidObstacle === true)) {
            nextState = ejectEntitiesFromBlockedVoxel(nextState, rev.x, rev.y, rev.z);
          }
          nextState = sculptTerrainVoxel(nextState, rev.x, rev.y, rev.z, rev.revertTileId, { dropYield: false });
        }
      }
    } else {
      remaining.push(rev);
    }
  }

  if (!changed) return state;
  const colony = ensureColonyState(nextState);
  return {
    ...nextState,
    colonyState: {
      ...colony,
      timedTerrainReverts: remaining
    }
  };
}
