import type { Component } from './components.types.ts';

/**
 * Branded type for Entity ID to prevent mixing it up with other numeric types.
 */
export type EntityId = number & { readonly __brand: unique symbol };

/**
 * Helper to cast a number to EntityId.
 * @param id The numeric ID to cast.
 * @returns The branded EntityId.
 */
export function toEntityId(id: number): EntityId {
  return id as EntityId;
}

/**
 * Structure representing a map tile, pointing to a definition in the registry.
 */
export interface Tile {
  readonly tileId: string;
  readonly x: number;
  readonly y: number;
  readonly explored: boolean;
}

/**
 * Interface representing the game map with a flat tiles grid.
 */
export interface GameMap {
  readonly width: number;
  readonly height: number;
  readonly tiles: ReadonlyArray<Tile>;
  readonly isFullyExplored?: boolean;
}

/**
 * A message to be displayed in the Message Log UI.
 */
export interface LogMessage {
  readonly text: string;
  readonly cssClass?: string;
}

/**
 * Data associated with an inactive/saved dungeon level.
 */
export interface LevelData {
  readonly map: GameMap;
  readonly entities: ReadonlyArray<EntityId>;
  readonly components: ReadonlyMap<EntityId, ReadonlyArray<Component>>;
  readonly spatialIndex: ReadonlyMap<string, ReadonlyArray<EntityId>>;
}

/**
 * Immutable shape of the global game state.
 */
export interface GameState {
  readonly entities: ReadonlyArray<EntityId>;
  readonly components: ReadonlyMap<EntityId, ReadonlyArray<Component>>;
  readonly map: GameMap;
  readonly nextEntityId: number;
  readonly messages: ReadonlyArray<LogMessage>;
  readonly currentDepth: number;
  readonly levels: ReadonlyMap<number, LevelData>;
  readonly spatialIndex: ReadonlyMap<string, ReadonlyArray<EntityId>>;
  readonly targetingMode?: {
    readonly active: boolean;
    readonly x: number;
    readonly y: number;
    readonly radius?: number;
  };
}
