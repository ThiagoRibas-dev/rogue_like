import type { Component } from './components.types.ts';
import type { CampaignData } from './campaign.types.ts';
import type { Intent } from './intents.types.ts';
import type { GameEvent } from './events.types.ts';

/**
 * Enum defining the engine mode.
 */
export enum EngineMode {
  TurnBased = 'turn-based',
  RTwP = 'rtwp'
}

/**
 * Enum defining the current UI interaction mode.
 * Controls how keyboard input is interpreted (game actions vs. menu selections).
 * Serializable for M7 save/load.
 */
export const enum UIMode {
  MainMenu = 'main_menu',
  CampaignSelect = 'campaign_select',
  Game = 'game',
  Inventory = 'inventory',
  GameOver = 'game_over',
  Settings = 'settings',
  Factions = 'factions'
}

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
  readonly count?: number;
}

/**
 * A transient visual effect to be rendered on the map.
 */
export interface VisualEffect {
  readonly id: string;
  readonly type: 'floating_text';
  readonly x: number;
  readonly y: number;
  readonly content: string;
  readonly color: string;
  readonly expiresAt: number; // performance.now() + duration
}

/**
 * Data associated with an inactive/saved area.
 */
export interface AreaData {
  readonly map: GameMap;
  readonly entities: ReadonlyArray<EntityId>;
  readonly components: ReadonlyMap<EntityId, ReadonlyArray<Component>>;
  readonly spatialIndex: ReadonlyMap<string, ReadonlyArray<EntityId>>;
}

/**
 * Data associated with an entity stored in global persistence, disconnected from the active Area.
 */
export interface PersistentEntityRecord {
  readonly areaId: string;
  readonly components: ReadonlyArray<Component>;
}

/**
 * Immutable shape of the global game state.
 */
export interface GameState {
  readonly campaignId: string;
  readonly campaign: CampaignData;
  readonly entities: ReadonlyArray<EntityId>;
  readonly components: ReadonlyMap<EntityId, ReadonlyArray<Component>>;
  readonly map: GameMap;
  readonly nextEntityId: number;
  /** Counter used to generate unique ItemInstanceIds for new item entities. */
  readonly nextItemInstanceId: number;
  readonly messages: ReadonlyArray<LogMessage>;
  readonly events: ReadonlyArray<GameEvent>;
  readonly currentAreaId: string;
  readonly areas: ReadonlyMap<string, AreaData>;
  readonly persistentEntities: ReadonlyMap<EntityId, PersistentEntityRecord>;
  readonly spatialIndex: ReadonlyMap<string, ReadonlyArray<EntityId>>;
  readonly isGameOver: boolean;
  /**
   * Current UI mode. Controls how keyboard input is interpreted.
   * 'game' = normal play; 'inventory' = inventory panel open.
   */
  readonly uiMode: UIMode;
  readonly targetingMode?:
    | {
        readonly active: boolean;
        readonly x: number;
        readonly y: number;
        readonly radius?: number;
      }
    | undefined;
  readonly inspectMode?:
    | {
        readonly active: boolean;
        readonly x: number;
        readonly y: number;
      }
    | undefined;
  readonly identifiedItems: ReadonlySet<string>;
  readonly itemUnidentifiedNames: ReadonlyMap<string, string>;
  readonly engineMode: EngineMode;
  readonly visualEffects: ReadonlyArray<VisualEffect>;
  readonly rtwpState: {
    readonly paused: boolean;
    readonly speedMultiplier: number;
  };
  readonly isRotated: boolean;
  readonly is3D: boolean;
  readonly zoomLevel: number;
  readonly playerCommandQueue: ReadonlyArray<Intent>;
}

/**
 * Shape of AreaData when serialized to JSON.
 */
export interface SerializedAreaData {
  readonly map: GameMap;
  readonly entities: ReadonlyArray<EntityId>;
  readonly components: ReadonlyArray<[EntityId, ReadonlyArray<Component>]>;
}

/**
 * Shape of PersistentEntityRecord when serialized.
 */
export interface SerializedPersistentEntityRecord {
  readonly areaId: string;
  readonly components: ReadonlyArray<Component>;
}

/**
 * Shape of GameState when serialized to JSON.
 */
export interface SerializedGameState {
  readonly campaignId: string;
  readonly entities: ReadonlyArray<EntityId>;
  readonly components: ReadonlyArray<[EntityId, ReadonlyArray<Component>]>;
  readonly map: GameMap;
  readonly nextEntityId: number;
  readonly nextItemInstanceId: number;
  readonly messages: ReadonlyArray<LogMessage>;
  readonly currentAreaId: string;
  readonly areas: ReadonlyArray<[string, SerializedAreaData]>;
  readonly persistentEntities: ReadonlyArray<[EntityId, SerializedPersistentEntityRecord]>;
  readonly isGameOver: boolean;
  readonly uiMode: UIMode;
  readonly identifiedItems: ReadonlyArray<string>;
  readonly itemUnidentifiedNames: ReadonlyArray<[string, string]>;
  readonly engineMode: EngineMode;
  readonly visualEffects: ReadonlyArray<VisualEffect>;
  readonly rtwpState: {
    readonly paused: boolean;
    readonly speedMultiplier: number;
  };
  readonly isRotated: boolean;
  readonly is3D: boolean;
  readonly zoomLevel: number;
}
