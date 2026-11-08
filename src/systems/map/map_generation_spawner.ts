import { addComponent, createEntity, spawnEntity, spawnItem } from '../../core/ecs.ts';
import { generateArea } from '../../map/generator.ts';
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
    for (const ent of generated.placedEntities) {
      if (state.campaign.items[ent.templateId]) {
        [tempState] = spawnItem(tempState, ent.templateId, ent.x, ent.y);
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
              [ComponentType.Position]: { type: ComponentType.Position, x: ent.x, y: ent.y } as PositionComponent,
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
          [tempState] = spawnEntity(tempState, ent.templateId, ent.x, ent.y, ent.dynamicTraits, ent.inventory);
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
