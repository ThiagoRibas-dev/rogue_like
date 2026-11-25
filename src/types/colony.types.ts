import type { EntityId } from './game-state.types.ts';

/** Canonical terrain/object designation kinds tracked on the spatial colony overlay. */
export type DesignationKind = 'mine' | 'chop' | 'haul' | 'build' | 'harvest' | 'channel';

/** Canonical labor skill categories scored by autonomous laborer AI. */
export type LaborKind = 'mining' | 'chopping' | 'hauling' | 'building' | 'harvesting' | 'crafting';

/** Supported workshop crafting bill repeat policies. */
export type BillRepeatMode = 'do_x_times' | 'maintain_stock' | 'forever';

/** Integer 3D grid coordinate (`(x, y, z)`). */
export interface VoxelCoord {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Spatial designation marker instructing colonists/NPCs to work on a voxel or target entity. */
export interface TileDesignation {
  readonly id: string;
  readonly kind: DesignationKind;
  readonly areaId: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly priority: number;
  readonly blueprintId?: string | undefined;
  readonly targetEntityId?: EntityId | undefined;
  readonly createdTurn: number;
}

/** Typed item-filter stockpile zone holding destination coordinates and priority rules. */
export interface StockpileZone {
  readonly id: string;
  readonly name: string;
  readonly areaId: string;
  readonly cells: ReadonlyArray<VoxelCoord>;
  readonly allowedTags: ReadonlyArray<string>;
  readonly deniedTags: ReadonlyArray<string>;
  readonly allowedItemIds?: ReadonlyArray<string> | undefined;
  readonly priority: number;
  readonly maxItemsPerCell: number;
}

/** Atomic lease token preventing concurrent workers from claiming the same voxel, item, or station. */
export interface JobReservationToken {
  readonly tokenId: string;
  readonly resourceKey: string;
  readonly jobId: string;
  readonly workerEntityId: EntityId;
  readonly acquiredTurn: number;
  readonly expiresAtTurn: number;
}

/** Queued crafting production order attached to a workshop entity. */
export interface CraftingBill {
  readonly billId: string;
  readonly recipeId: string;
  readonly repeatMode: BillRepeatMode;
  readonly targetCount: number;
  readonly completedCount: number;
  readonly workProgress: number;
  readonly paused: boolean;
}

/** Runtime workshop state associating a world station entity with its ordered bill queue. */
export interface WorkshopState {
  readonly workshopEntityId: EntityId;
  readonly areaId: string;
  readonly workshopTag: string;
  readonly bills: ReadonlyArray<CraftingBill>;
}

/** Scheduled temporary terrain reversal entry (e.g., expiring *Passwall* tunnel). */
export interface TimedTerrainRevert {
  readonly areaId: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly revertTileId: string;
  readonly revertTurn: number;
  readonly sourceId: string;
}

/** Full JSON-serializable colony labor, stockpile, blackboard, and temporary sculpting container. */
export interface ColonySimulationState {
  readonly designations: Readonly<Record<string, TileDesignation>>;
  readonly stockpiles: Readonly<Record<string, StockpileZone>>;
  readonly reservations: Readonly<Record<string, JobReservationToken>>;
  readonly workshops: Readonly<Record<string, WorkshopState>>;
  readonly timedTerrainReverts: ReadonlyArray<TimedTerrainRevert>;
}
