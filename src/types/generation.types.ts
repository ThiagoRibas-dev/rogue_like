import { type AreaConnection } from './campaign.types.ts';
import { type EntityId, type GameMap } from './game-state.types.ts';
import type { DirectorReceipt, RoomBounds } from './encounter.types.ts';

/**
 * Output data resulting from map generation, containing tiles, portals, rooms, and entities.
 */
export interface GeneratedArea {
  readonly map: GameMap;
  readonly startPos: { readonly x: number; readonly y: number };
  readonly portals: ReadonlyArray<{ readonly x: number; readonly y: number; readonly connection: AreaConnection }>;
  readonly rooms: ReadonlyArray<RoomBounds>;
  readonly placedEntities?:
    | ReadonlyArray<{
        readonly templateId: string;
        readonly x: number;
        readonly y: number;
        readonly dynamicTraits?: ReadonlyArray<string> | undefined;
        readonly inventory?: ReadonlyArray<string> | undefined;
        readonly preExistingEntityId?: EntityId | undefined;
      }>
    | undefined;
  readonly directorReceipt?: DirectorReceipt | undefined;
}
