import {
  EDGE_ARROW_GLYPHS,
  EDGE_ARROW_SPRITE_IDS,
  type EdgeTransitionDirection
} from '../../constants/display.constants.ts';
import { addComponent, createEntity, spawnEntity, spawnItem, withEcsBatchState } from '../../core/ecs.ts';
import { generateArea } from '../../map/generator.ts';
import { getTileIdAt, isInMapBounds } from '../../map/map_accessor.ts';
import type { AreaConnection } from '../../types/campaign.types.ts';
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
  type AreaData,
  type EntityId,
  type GameMap,
  type GameState,
  type PersistentEntityRecord
} from '../../types/game-state.types.ts';
import { assertNever } from '../../utils/assert.ts';
import { buildAreaDirectorContext } from './map_wake_respawn.ts';

/** Safety cap on BFS frontier nodes when resolving a walkable spawn tile. */
const MAX_SAFE_PLACEMENT_BFS_NODES = 1024;

/** Default open-doorway sprite ID used for non-edge `'portal'` transitions without a template override. */
const DEFAULT_HORIZONTAL_PASSAGE_SPRITE_ID = 'tile_framed_door_1_open';

/** Fallback compass direction when neither `placementSide` nor finite map bounds are available. */
const DEFAULT_EDGE_TRANSITION_DIRECTION: EdgeTransitionDirection = 'east';

/**
 * Resolves the outward cardinal compass direction for a `direction: 'edge'` area transition.
 * Prefers explicit `connection.placementSide` (`top`/`bottom`/`left`/`right`); when omitted or `'any'`,
 * infers the nearest map boundary from `(x, y)` normalized against the map dimensions.
 *
 * @param connection Area connection metadata.
 * @param x Portal tile X coordinate.
 * @param y Portal tile Y coordinate.
 * @param mapWidth Width of the containing map in tiles.
 * @param mapHeight Height of the containing map in tiles.
 * @returns Resolved cardinal compass direction (`north` | `south` | `west` | `east`).
 */
export function resolveEdgeTransitionDirection(
  connection: AreaConnection,
  x: number,
  y: number,
  mapWidth: number,
  mapHeight: number
): EdgeTransitionDirection {
  const side = connection.placementSide;
  if (side !== undefined && side !== 'any') {
    switch (side) {
      case 'top':
        return 'north';
      case 'bottom':
        return 'south';
      case 'left':
        return 'west';
      case 'right':
        return 'east';
      default:
        return assertNever(side);
    }
  }

  if (mapWidth <= 0 || mapHeight <= 0) {
    return DEFAULT_EDGE_TRANSITION_DIRECTION;
  }

  const normalizedDistances: ReadonlyArray<{ readonly dir: EdgeTransitionDirection; readonly dist: number }> = [
    { dir: 'north', dist: Math.max(0, y) / mapHeight },
    { dir: 'south', dist: Math.max(0, mapHeight - 1 - y) / mapHeight },
    { dir: 'west', dist: Math.max(0, x) / mapWidth },
    { dir: 'east', dist: Math.max(0, mapWidth - 1 - x) / mapWidth }
  ];

  let best = normalizedDistances[0]!;
  for (let i = 1; i < normalizedDistances.length; i++) {
    const candidate = normalizedDistances[i]!;
    if (candidate.dist < best.dist) {
      best = candidate;
    }
  }
  return best.dir;
}

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

function isMapTileWalkable(state: Readonly<GameState>, map: Readonly<GameMap>, x: number, y: number, z = 0): boolean {
  if (!isInMapBounds(map, x, y, z)) return false;
  const tileId = getTileIdAt(map, x, y, z);
  return tileId !== undefined && Boolean(state.campaign.tiles[tileId]?.walkable);
}

function resolveSafePlacedCoords(
  state: Readonly<GameState>,
  map: Readonly<GameMap>,
  occupiedCoords: Set<string>,
  desiredX: number,
  desiredY: number,
  desiredZ = 0
): { readonly x: number; readonly y: number; readonly z: number } | null {
  const clampedX = map.chunkGrid !== undefined ? desiredX : Math.max(0, Math.min(map.width - 1, desiredX));
  const clampedY = map.chunkGrid !== undefined ? desiredY : Math.max(0, Math.min(map.height - 1, desiredY));
  const initialKey = `${clampedX},${clampedY},${desiredZ}`;

  if (isMapTileWalkable(state, map, clampedX, clampedY, desiredZ) && !occupiedCoords.has(initialKey)) {
    occupiedCoords.add(initialKey);
    return { x: clampedX, y: clampedY, z: desiredZ };
  }

  const visited = new Set<string>([initialKey]);
  const queue: Array<{ readonly x: number; readonly y: number }> = [{ x: clampedX, y: clampedY }];
  let head = 0;

  while (head < queue.length && queue.length < MAX_SAFE_PLACEMENT_BFS_NODES) {
    const cur = queue[head++]!;
    for (const [dx, dy] of PLACEMENT_NEIGHBOR_OFFSETS) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (!isInMapBounds(map, nx, ny, desiredZ)) continue;
      const key = `${nx},${ny},${desiredZ}`;
      if (visited.has(key)) continue;
      visited.add(key);
      if (isMapTileWalkable(state, map, nx, ny, desiredZ) && !occupiedCoords.has(key)) {
        occupiedCoords.add(key);
        return { x: nx, y: ny, z: desiredZ };
      }
      queue.push({ x: nx, y: ny });
    }
  }
  return null;
}

/**
 * Instantiates a single area-connection portal or stair entity into `state` with direction-appropriate
 * sprite/glyph visuals (`stairs_up`/`stairs_down` for vertical Z links, open archway passage for horizontal
 * `edge` connections, and portal visuals or template overrides for `portal` links).
 *
 * @param state Current GameState.
 * @param portal Generated portal placement coordinate and connection metadata.
 * @returns Updated GameState and created portal EntityId.
 */
export function spawnAreaPortalEntity(
  state: GameState,
  portal: {
    readonly x: number;
    readonly y: number;
    readonly z?: number | undefined;
    readonly connection: AreaConnection;
  }
): { readonly state: GameState; readonly entityId: EntityId } {
  let nextState = state;
  let portalEntityId: EntityId;
  const pz = portal.z ?? portal.connection.placementZ ?? 0;

  const portalComp: PortalComponent = {
    type: ComponentType.Portal,
    targetAreaId: portal.connection.targetAreaId,
    targetX: portal.connection.targetX,
    targetY: portal.connection.targetY,
    ...(portal.connection.targetZ !== undefined ? { targetZ: portal.connection.targetZ } : {}),
    ...(portal.connection.preserveCoords !== undefined ? { preserveCoords: portal.connection.preserveCoords } : {})
  };

  if (
    (portal.connection.direction === 'portal' || portal.connection.direction === 'edge') &&
    portal.connection.portalTemplateId
  ) {
    if (state.campaign.entities[portal.connection.portalTemplateId]) {
      [nextState, portalEntityId] = spawnEntity(
        nextState,
        portal.connection.portalTemplateId,
        portal.x,
        portal.y,
        undefined,
        undefined,
        pz
      );
      nextState = addComponent(nextState, portalEntityId, portalComp);
      return { state: nextState, entityId: portalEntityId };
    }
    if (state.campaign.items[portal.connection.portalTemplateId]) {
      [nextState, portalEntityId] = spawnItem(nextState, portal.connection.portalTemplateId, portal.x, portal.y, pz);
      nextState = addComponent(nextState, portalEntityId, portalComp);
      return { state: nextState, entityId: portalEntityId };
    }
    console.warn(`Portal template ${portal.connection.portalTemplateId} not found.`);
    [nextState, portalEntityId] = createEntity(nextState);
    const pos: PositionComponent = {
      type: ComponentType.Position,
      x: portal.x,
      y: portal.y,
      ...(pz !== 0 ? { z: pz } : {})
    };
    nextState = addComponent(addComponent(nextState, portalEntityId, pos), portalEntityId, portalComp);
    return { state: nextState, entityId: portalEntityId };
  }

  const direction = portal.connection.direction;
  let spriteId: string;
  let glyph: string;

  switch (direction) {
    case 'edge': {
      const edgeDir = resolveEdgeTransitionDirection(
        portal.connection,
        portal.x,
        portal.y,
        state.map.width,
        state.map.height
      );
      spriteId = state.campaign.tiles['edge']?.spriteId ?? EDGE_ARROW_SPRITE_IDS[edgeDir];
      glyph = EDGE_ARROW_GLYPHS[edgeDir];
      break;
    }
    case 'portal': {
      spriteId =
        state.campaign.tiles['portal']?.spriteId ??
        state.campaign.tiles['passage']?.spriteId ??
        DEFAULT_HORIZONTAL_PASSAGE_SPRITE_ID;
      glyph = 'O';
      break;
    }
    case 'up': {
      spriteId = state.campaign.tiles['stairs_up']?.spriteId ?? 'stairs_up';
      glyph = state.campaign.theme.glyphs.stairsUp ?? '<';
      break;
    }
    case 'down': {
      spriteId = state.campaign.tiles['stairs_down']?.spriteId ?? 'stairs_down';
      glyph = state.campaign.theme.glyphs.stairsDown ?? '>';
      break;
    }
    default:
      return assertNever(direction);
  }

  const pos: PositionComponent = {
    type: ComponentType.Position,
    x: portal.x,
    y: portal.y,
    ...(pz !== 0 ? { z: pz } : {})
  };
  const render: RenderableComponent = {
    type: ComponentType.Renderable,
    glyph,
    fg: state.campaign.theme.colors.stairsFg ?? '#ffffff',
    bg: state.campaign.theme.colors.transparent ?? 'transparent',
    spriteId
  };
  const tags: TagsComponent = {
    type: ComponentType.Tags,
    tags: ['portal']
  };

  nextState = withEcsBatchState(nextState, (batch) => {
    portalEntityId = batch.createEntity();
    batch.addComponent(portalEntityId, pos);
    batch.addComponent(portalEntityId, render);
    batch.addComponent(portalEntityId, portalComp);
    batch.addComponent(portalEntityId, tags);
  });
  return { state: nextState, entityId: portalEntityId! };
}

/**
 * Generates a fresh area floor, instantiating portals and placed entities via ECS.
 */
export function generateAndPopulateAreaFloor(
  state: GameState,
  targetAreaId: string,
  initialSpawnX: number,
  initialSpawnY: number,
  nextPersistentEntities: Map<EntityId, PersistentEntityRecord>,
  nextAreas?: ReadonlyMap<string, AreaData>,
  initialSpawnZ = 0,
  hasExplicitSpawnZ = false
): {
  targetMap: GameMap;
  targetRooms: ReadonlyArray<RoomBounds>;
  targetLastSpawnTurn: number;
  spawnX: number;
  spawnY: number;
  spawnZ: number;
  nextEntities: ReadonlyArray<EntityId>;
  nextComponents: Map<EntityId, Readonly<Record<string, Component>>>;
  nextEntityId: number;
  nextItemInstanceId: number;
} {
  const directorContext = buildAreaDirectorContext(state, targetAreaId, true);
  const generated = generateArea(state.campaign, targetAreaId, directorContext);
  const targetMap = generated.map;
  const targetRooms = generated.rooms ?? [];
  const targetLastSpawnTurn = state.globalTurn;

  let spawnX = initialSpawnX;
  let spawnY = initialSpawnY;
  let spawnZ = initialSpawnZ;
  let foundStairs = false;

  if (spawnX === -1 || spawnY === -1) {
    for (const portal of generated.portals) {
      if (portal.connection.targetAreaId === state.currentAreaId) {
        spawnX = portal.x;
        spawnY = portal.y;
        if (!hasExplicitSpawnZ) {
          spawnZ = portal.z ?? portal.connection.placementZ ?? 0;
        }
        foundStairs = true;
        break;
      }
    }
  }

  if (!foundStairs && (spawnX === -1 || spawnY === -1)) {
    spawnX = generated.startPos.x;
    spawnY = generated.startPos.y;
    if (!hasExplicitSpawnZ) {
      spawnZ = generated.startPos.z ?? 0;
    }
  }

  let tempState: GameState = {
    ...state,
    entities: [],
    components: new Map(),
    map: targetMap,
    areas: nextAreas ?? state.areas,
    persistentEntities: nextPersistentEntities
  };

  for (const portal of generated.portals) {
    tempState = spawnAreaPortalEntity(tempState, portal).state;
  }

  if (generated.placedEntities) {
    const occupiedCoords = new Set<string>([`${spawnX},${spawnY},${spawnZ}`]);
    for (const portal of generated.portals) {
      occupiedCoords.add(`${portal.x},${portal.y},${portal.z ?? portal.connection.placementZ ?? 0}`);
    }

    for (const ent of generated.placedEntities) {
      const ez = ent.z ?? 0;
      const placement = resolveSafePlacedCoords(tempState, targetMap, occupiedCoords, ent.x, ent.y, ez);
      const px = placement?.x ?? ent.x;
      const py = placement?.y ?? ent.y;
      const pz = placement?.z ?? ez;

      if (state.campaign.items[ent.templateId]) {
        [tempState] = spawnItem(tempState, ent.templateId, px, py, pz);
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
              [ComponentType.Position]: {
                type: ComponentType.Position,
                x: px,
                y: py,
                ...(pz !== 0 ? { z: pz } : {})
              } as PositionComponent,
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
          [tempState] = spawnEntity(tempState, ent.templateId, px, py, ent.dynamicTraits, ent.inventory, pz);
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
    spawnZ,
    nextEntities: tempState.entities,
    nextComponents: tempState.components as Map<EntityId, Readonly<Record<string, Component>>>,
    nextEntityId: tempState.nextEntityId,
    nextItemInstanceId: tempState.nextItemInstanceId
  };
}
