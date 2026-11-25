import { getComponent, getEntitiesAtPosition } from '../../core/ecs.ts';
import { getTileDefAt, isInMapBounds } from '../../map/map_accessor.ts';
import type { StockpileZone, VoxelCoord } from '../../types/colony.types.ts';
import {
  ComponentType,
  type ItemComponent,
  type PositionComponent,
  type TagsComponent
} from '../../types/components.types.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';
import { ensureColonyState, isResourceReservedByOther, tileResourceKey } from './job_blackboard.ts';
import { collectShopStockItemIds, isItemNeededAtAdjacentWorkshop } from './workshop.system.ts';

const DEFAULT_MAX_ITEMS_PER_CELL = 1;

function collectItemEntityTags(state: Readonly<GameState>, itemEntityId: EntityId): ReadonlySet<string> {
  const result = new Set<string>();
  const itemComp = getComponent(state, itemEntityId, ComponentType.Item) as ItemComponent | undefined;
  const itemDef = itemComp ? state.campaign.items[itemComp.itemId] : undefined;
  if (itemDef) {
    result.add(itemDef.category);
    for (const tag of itemDef.tags ?? []) result.add(tag);
  }
  const tagsComp = getComponent(state, itemEntityId, ComponentType.Tags) as TagsComponent | undefined;
  for (const tag of tagsComp?.tags ?? []) result.add(tag);
  return result;
}

/** Evaluates whether `itemEntityId` satisfies a stockpile zone's typed tag/item filters. */
export function doesItemMatchStockpile(
  state: Readonly<GameState>,
  itemEntityId: EntityId,
  zone: StockpileZone
): boolean {
  const itemComp = getComponent(state, itemEntityId, ComponentType.Item) as ItemComponent | undefined;
  if (!itemComp) return false;
  const tags = collectItemEntityTags(state, itemEntityId);

  for (const denied of zone.deniedTags) {
    if (tags.has(denied)) return false;
  }

  if (zone.allowedItemIds && zone.allowedItemIds.length > 0) {
    if (zone.allowedItemIds.includes(itemComp.itemId)) return true;
    if (zone.allowedTags.length === 0) return false;
  }

  if (zone.allowedTags.length === 0) return true;
  return zone.allowedTags.some((allowed) => tags.has(allowed));
}

/** Registers or updates a typed item-filter stockpile zone in `state.colonyState.stockpiles`. */
export function createStockpileZone(
  state: GameState,
  input: {
    readonly id: string;
    readonly name: string;
    readonly cells: ReadonlyArray<VoxelCoord>;
    readonly allowedTags?: ReadonlyArray<string>;
    readonly deniedTags?: ReadonlyArray<string>;
    readonly allowedItemIds?: ReadonlyArray<string>;
    readonly priority?: number;
    readonly maxItemsPerCell?: number;
  }
): GameState {
  const colony = ensureColonyState(state);
  const validCells = input.cells.filter((c) => isInMapBounds(state.map, c.x, c.y, c.z));
  const zone: StockpileZone = {
    id: input.id,
    name: input.name,
    areaId: state.currentAreaId,
    cells: validCells,
    allowedTags: input.allowedTags ?? [],
    deniedTags: input.deniedTags ?? [],
    ...(input.allowedItemIds !== undefined ? { allowedItemIds: input.allowedItemIds } : {}),
    priority: input.priority ?? 2,
    maxItemsPerCell: input.maxItemsPerCell ?? DEFAULT_MAX_ITEMS_PER_CELL
  };

  return {
    ...state,
    colonyState: {
      ...colony,
      stockpiles: {
        ...colony.stockpiles,
        [zone.id]: zone
      }
    }
  };
}

function countItemsAtCoord(state: Readonly<GameState>, x: number, y: number, z: number): number {
  let count = 0;
  for (const eid of getEntitiesAtPosition(state, x, y, z)) {
    if (getComponent(state, eid, ComponentType.Item) !== undefined) {
      count += 1;
    }
  }
  return count;
}

/** Finds any stockpile zone owning `(areaId, x, y, z)`. */
export function findStockpileAtCoord(
  state: Readonly<GameState>,
  x: number,
  y: number,
  z = 0,
  areaId: string = state.currentAreaId
): StockpileZone | undefined {
  const stockpiles = state.colonyState?.stockpiles;
  if (!stockpiles) return undefined;
  for (const zone of Object.values(stockpiles)) {
    if (zone.areaId !== areaId) continue;
    if (zone.cells.some((c) => c.x === x && c.y === y && c.z === z)) {
      return zone;
    }
  }
  return undefined;
}

/**
 * Finds the highest-priority open & unreserved stockpile cell accepting `itemEntityId`,
 * breaking ties by closest 3D Manhattan distance to `originCoord`.
 */
export function findBestStockpileCellForItem(
  state: Readonly<GameState>,
  itemEntityId: EntityId,
  workerEntityId: EntityId,
  originCoord: VoxelCoord
): { readonly zone: StockpileZone; readonly coord: VoxelCoord } | undefined {
  const stockpiles = state.colonyState?.stockpiles;
  if (!stockpiles) return undefined;

  const matchingZones = Object.values(stockpiles)
    .filter((z) => z.areaId === state.currentAreaId && doesItemMatchStockpile(state, itemEntityId, z))
    .sort((a, b) => a.priority - b.priority);

  let best: { readonly zone: StockpileZone; readonly coord: VoxelCoord; readonly dist: number } | undefined;

  for (const zone of matchingZones) {
    for (const cell of zone.cells) {
      const tileDef = getTileDefAt(state, cell.x, cell.y, cell.z);
      if (!tileDef || !tileDef.walkable) continue;
      if (
        isResourceReservedByOther(state, tileResourceKey(state.currentAreaId, cell.x, cell.y, cell.z), workerEntityId)
      ) {
        continue;
      }
      if (countItemsAtCoord(state, cell.x, cell.y, cell.z) >= zone.maxItemsPerCell) {
        continue;
      }
      const dist =
        Math.abs(cell.x - originCoord.x) + Math.abs(cell.y - originCoord.y) + Math.abs(cell.z - originCoord.z) * 2;
      if (!best || zone.priority < best.zone.priority || (zone.priority === best.zone.priority && dist < best.dist)) {
        best = { zone, coord: cell, dist };
      }
    }
  }

  return best ? { zone: best.zone, coord: best.coord } : undefined;
}

/** Enumerates positioned ground items in `areaId` that need hauling into a matching higher-priority stockpile. */
export function findUnstockedHaulItems(
  state: Readonly<GameState>,
  workerEntityId: EntityId
): ReadonlyArray<{
  readonly itemEntityId: EntityId;
  readonly sourceCoord: VoxelCoord;
  readonly targetZone: StockpileZone;
  readonly targetCoord: VoxelCoord;
}> {
  const results: Array<{
    readonly itemEntityId: EntityId;
    readonly sourceCoord: VoxelCoord;
    readonly targetZone: StockpileZone;
    readonly targetCoord: VoxelCoord;
  }> = [];

  const shopStockIds = collectShopStockItemIds(state);

  for (const entityId of state.entities) {
    if (shopStockIds.has(entityId)) continue;
    const item = getComponent(state, entityId, ComponentType.Item) as ItemComponent | undefined;
    if (!item) continue;
    const pos = getComponent(state, entityId, ComponentType.Position) as PositionComponent | undefined;
    if (!pos) continue;
    if (isResourceReservedByOther(state, `entity:${entityId}`, workerEntityId)) continue;

    const z = pos.z ?? 0;
    const itemCoord: VoxelCoord = { x: pos.x, y: pos.y, z };
    if (isItemNeededAtAdjacentWorkshop(state, entityId, itemCoord)) continue;

    const currentZone = findStockpileAtCoord(state, pos.x, pos.y, z);
    const dest = findBestStockpileCellForItem(state, entityId, workerEntityId, itemCoord);
    if (!dest) continue;

    if (
      currentZone &&
      doesItemMatchStockpile(state, entityId, currentZone) &&
      currentZone.priority <= dest.zone.priority
    ) {
      continue;
    }

    results.push({
      itemEntityId: entityId,
      sourceCoord: { x: pos.x, y: pos.y, z },
      targetZone: dest.zone,
      targetCoord: dest.coord
    });
  }

  return results;
}
