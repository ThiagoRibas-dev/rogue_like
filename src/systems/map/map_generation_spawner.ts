import { addComponent, createEntity, spawnEntity, spawnItem } from '../../core/ecs.ts';
import { generateArea } from '../../map/generator.ts';
import { coordToIndex } from '../../utils/grid.ts';
import type { RoomBounds } from '../../types/encounter.types.ts';
import {
  ComponentType,
  type Component,
  type PortalComponent,
  type PositionComponent,
  type RenderableComponent,
  type TagsComponent,
  type AgreementComponent
} from '../../types/components.types.ts';
import {
  type EntityId,
  type GameMap,
  type GameState,
  type PersistentEntityRecord
} from '../../types/game-state.types.ts';
import { buildAreaDirectorContext } from './map_wake_respawn.ts';

const PLACEMENT_NEIGHBOR_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
  [1, -1],
  [1, 1],
  [-1, 1],
  [-1, -1]
];

function isMapTileWalkable(state: Readonly<GameState>, map: Readonly<GameMap>, x: number, y: number): boolean {
  if (x < 0 || x >= map.width || y < 0 || y >= map.height) return false;
  const tile = map.tiles[coordToIndex(x, y, map.width)];
  return tile !== undefined && Boolean(state.campaign.tiles[tile.tileId]?.walkable);
}

function resolveSafePlacedCoords(
  state: Readonly<GameState>,
  map: Readonly<GameMap>,
  occupiedCoords: Set<string>,
  desiredX: number,
  desiredY: number
): { readonly x: number; readonly y: number } | null {
  const clampedX = Math.max(0, Math.min(map.width - 1, desiredX));
  const clampedY = Math.max(0, Math.min(map.height - 1, desiredY));
  const initialKey = `${clampedX},${clampedY}`;

  if (isMapTileWalkable(state, map, clampedX, clampedY) && !occupiedCoords.has(initialKey)) {
    occupiedCoords.add(initialKey);
    return { x: clampedX, y: clampedY };
  }

  const visited = new Set<string>([initialKey]);
  const queue: Array<{ readonly x: number; readonly y: number }> = [{ x: clampedX, y: clampedY }];
  let head = 0;

  while (head < queue.length) {
    const cur = queue[head++]!;
    for (const [dx, dy] of PLACEMENT_NEIGHBOR_OFFSETS) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (nx < 0 || nx >= map.width || ny < 0 || ny >= map.height) continue;
      const key = `${nx},${ny}`;
      if (visited.has(key)) continue;
      visited.add(key);
      if (isMapTileWalkable(state, map, nx, ny) && !occupiedCoords.has(key)) {
        occupiedCoords.add(key);
        return { x: nx, y: ny };
      }
      queue.push({ x: nx, y: ny });
    }
  }
  return null;
}

/**
 * Generates a fresh area floor, instantiating portals and placed entities via ECS.
 */
export function generateAndPopulateAreaFloor(
  state: GameState,
  targetAreaId: string,
  initialSpawnX: number,
  initialSpawnY: number,
  nextPersistentEntities: Map<EntityId, PersistentEntityRecord>
): {
  targetMap: GameMap;
  targetRooms: ReadonlyArray<RoomBounds>;
  targetLastSpawnTurn: number;
  spawnX: number;
  spawnY: number;
  nextEntities: ReadonlyArray<EntityId>;
  nextComponents: Map<EntityId, Readonly<Record<string, Component>>>;
} {
  const directorContext = buildAreaDirectorContext(state, targetAreaId, true);
  const generated = generateArea(state.campaign, targetAreaId, directorContext);
  const targetMap = generated.map;
  const targetRooms = generated.rooms ?? [];
  const targetLastSpawnTurn = state.globalTurn;

  let spawnX = initialSpawnX;
  let spawnY = initialSpawnY;
  let foundStairs = false;

  for (const portal of generated.portals) {
    if (portal.connection.targetAreaId === state.currentAreaId) {
      spawnX = portal.x;
      spawnY = portal.y;
      foundStairs = true;
      break;
    }
  }

  if (!foundStairs && spawnX === -1) {
    spawnX = generated.startPos.x;
    spawnY = generated.startPos.y;
  }

  let tempState: GameState = { ...state, entities: [], components: new Map(), map: targetMap };

  for (const portal of generated.portals) {
    let stairId: EntityId;

    const portalComp: PortalComponent = {
      type: ComponentType.Portal,
      targetAreaId: portal.connection.targetAreaId,
      targetX: portal.connection.targetX,
      targetY: portal.connection.targetY
    };

    if (
      (portal.connection.direction === 'portal' || portal.connection.direction === 'edge') &&
      portal.connection.portalTemplateId
    ) {
      if (state.campaign.entities[portal.connection.portalTemplateId]) {
        [tempState, stairId] = spawnEntity(tempState, portal.connection.portalTemplateId, portal.x, portal.y);
        tempState = addComponent(tempState, stairId, portalComp);
      } else if (state.campaign.items[portal.connection.portalTemplateId]) {
        [tempState, stairId] = spawnItem(tempState, portal.connection.portalTemplateId, portal.x, portal.y);
        tempState = addComponent(tempState, stairId, portalComp);
      } else {
        console.warn(`Portal template ${portal.connection.portalTemplateId} not found.`);
        [tempState, stairId] = createEntity(tempState);
        const pos: PositionComponent = { type: ComponentType.Position, x: portal.x, y: portal.y };
        tempState = addComponent(addComponent(tempState, stairId, pos), stairId, portalComp);
      }
    } else {
      [tempState, stairId] = createEntity(tempState);

      const stairTileKey = portal.connection.direction === 'up' ? 'stairs_up' : 'stairs_down';
      const pos: PositionComponent = { type: ComponentType.Position, x: portal.x, y: portal.y };
      const render: RenderableComponent = {
        type: ComponentType.Renderable,
        glyph:
          portal.connection.direction === 'portal' || portal.connection.direction === 'edge'
            ? 'O'
            : portal.connection.direction === 'up'
              ? (state.campaign.theme.glyphs.stairsUp ?? '<')
              : (state.campaign.theme.glyphs.stairsDown ?? '>'),
        fg: state.campaign.theme.colors.stairsFg ?? '#ffffff',
        bg: state.campaign.theme.colors.transparent ?? 'transparent',
        spriteId: state.campaign.tiles[stairTileKey]?.spriteId ?? stairTileKey
      };

      const tags: TagsComponent = {
        type: ComponentType.Tags,
        tags: ['portal']
      };

      tempState = addComponent(
        addComponent(addComponent(addComponent(tempState, stairId, pos), stairId, render), stairId, portalComp),
        stairId,
        tags
      );
    }
  }

  if (generated.placedEntities) {
    const occupiedCoords = new Set<string>([`${spawnX},${spawnY}`]);
    for (const portal of generated.portals) {
      occupiedCoords.add(`${portal.x},${portal.y}`);
    }

    for (const ent of generated.placedEntities) {
      const placement = resolveSafePlacedCoords(tempState, targetMap, occupiedCoords, ent.x, ent.y);
      const px = placement?.x ?? ent.x;
      const py = placement?.y ?? ent.y;

      if (state.campaign.items[ent.templateId]) {
        [tempState] = spawnItem(tempState, ent.templateId, px, py);
      } else if (state.campaign.entities[ent.templateId]) {
        if (ent.preExistingEntityId !== undefined) {
          const minionId = ent.preExistingEntityId;
          const minionComps = state.components.get(minionId) || state.persistentEntities.get(minionId)?.components;
          if (minionComps) {
            const updatedAgreement: AgreementComponent = {
              ...(minionComps[ComponentType.Agreement] as AgreementComponent),
              isFulfilled: true
            };
            const finalComps = {
              ...minionComps,
              [ComponentType.Position]: { type: ComponentType.Position, x: px, y: py } as PositionComponent,
              [ComponentType.Agreement]: updatedAgreement
            };
            tempState = {
              ...tempState,
              entities: [...tempState.entities, minionId],
              components: new Map([...tempState.components.entries(), [minionId, finalComps]])
            };
            nextPersistentEntities.delete(minionId);
          }
        } else {
          [tempState] = spawnEntity(tempState, ent.templateId, px, py, ent.dynamicTraits, ent.inventory);
        }
      } else {
        console.warn(`Placed entity template ${ent.templateId} not found in items or entities registries.`);
      }
    }
  }

  return {
    targetMap,
    targetRooms,
    targetLastSpawnTurn,
    spawnX,
    spawnY,
    nextEntities: tempState.entities,
    nextComponents: tempState.components as Map<EntityId, Readonly<Record<string, Component>>>
  };
}
