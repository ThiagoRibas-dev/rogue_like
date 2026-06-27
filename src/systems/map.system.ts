import * as ROT from 'rot-js';
import {
  addComponent,
  createEntity,
  getComponent,
  queryEntities,
  spawnEntity,
  spawnItem,
  updateSpatialIndex
} from '../core/ecs.ts';
import { computeFOV } from '../map/fov.ts';
import { generateArea } from '../map/generator.ts';
import { runEncounterDirector, type RoomBounds } from '../map/encounter_director.ts';
import { GameEventType } from '../types/events.types.ts';
import {
  ComponentType,
  type Component,
  type PortalComponent,
  type PositionComponent,
  type RenderableComponent,
  type TagsComponent,
  type AgreementComponent,
  type FighterComponent,
  type TemplateComponent,
  type NemesisComponent
} from '../types/components.types.ts';
import { type AreaData, type EntityId, type GameMap, type GameState } from '../types/game-state.types.ts';
import { coordToIndex } from '../utils/grid.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';

import type { ChangeAreaIntent } from '@/types/intents/movement.intents.ts';
import { addActor, clearScheduler } from '../core/scheduler.ts';
import { deliverPendingKnowledgeToArea } from './knowledge.system.ts';

/**
 * Evaluates the player's line of sight and marks newly visible tiles as explored.
 */
export function updateExploredTiles(state: GameState): GameState {
  if (!state.fovNeedsUpdate) return state;

  const players: ReadonlyArray<EntityId> = queryEntities(state, [ComponentType.Player, ComponentType.Position]);
  const playerEntityId = players[0];
  if (playerEntityId === undefined) return state;

  const playerPos = getComponent(state, playerEntityId, ComponentType.Position);
  if (playerPos === undefined) return state;

  const visibleIndices: Set<number> = computeFOV(state, playerPos.x, playerPos.y);

  let modified = false;
  const nextTiles = state.map.tiles.map((tile, idx) => {
    if (visibleIndices.has(idx) && !tile.explored) {
      modified = true;
      return { ...tile, explored: true };
    }
    return tile;
  });

  return {
    ...state,
    fovNeedsUpdate: false,
    cachedFov: visibleIndices,
    map: modified ? { ...state.map, tiles: nextTiles } : state.map
  };
}

/**
 * Transition handling to move entities between area instances, saving the current area state and unpacking the destination map.
 */
export function processChangeAreaIntent(
  state: GameState,
  intent: ChangeAreaIntent
): { state: GameState; success: boolean } {
  const { targetAreaId, targetX, targetY, entityId } = intent;

  // 1. Determine which entities migrate with the player (inventory, equipment)
  const inventory = getComponent(state, entityId, ComponentType.Inventory);
  const equipment = getComponent(state, entityId, ComponentType.Equipment);

  const migratingEntities = new Set<EntityId>([entityId]);
  if (inventory) {
    inventory.items.forEach((id) => migratingEntities.add(id));
  }
  if (equipment) {
    equipment.slots.forEach((s) => {
      if (s.equippedItem !== null) migratingEntities.add(s.equippedItem);
    });
  }

  // Pack and save the current floor (excluding migrating entities and persistent entities)
  const savedEntityIds = state.entities.filter((id) => !migratingEntities.has(id));
  const regularSavedEntityIds: EntityId[] = [];
  const nextPersistentEntities = new Map(state.persistentEntities);

  const currentLevelComponents = new Map<EntityId, Readonly<Record<string, Component>>>();

  for (const id of savedEntityIds) {
    const comps = state.components.get(id);
    if (comps === undefined) continue;

    const isPersistent = comps[ComponentType.Persistent] !== undefined;
    if (isPersistent) {
      nextPersistentEntities.set(id, {
        areaId: state.currentAreaId,
        components: comps
      });
    } else {
      regularSavedEntityIds.push(id);
      currentLevelComponents.set(id, comps);
    }
  }

  // Remove the migrating & persistent entities' positions from the saved index
  const currentAreaData: AreaData = {
    map: state.map,
    entities: regularSavedEntityIds,
    components: currentLevelComponents,
    spatialIndex: updateSpatialIndex({ ...state, entities: regularSavedEntityIds, components: currentLevelComponents })
      .spatialIndex,
    rooms: state.activeRooms ?? [],
    lastSpawnTurn: state.lastSpawnTurn ?? 0
  };

  const nextAreas = new Map(state.areas);
  nextAreas.set(state.currentAreaId, currentAreaData);

  // 2. Load or generate target floor
  let targetMap: GameMap;
  let nextEntities: ReadonlyArray<EntityId> = [];
  let nextComponents = new Map<EntityId, Readonly<Record<string, Component>>>();
  let spawnX: number = targetX ?? -1;
  let spawnY: number = targetY ?? -1;
  let targetRooms: ReadonlyArray<RoomBounds> = [];
  let targetLastSpawnTurn: number = 0;

  const savedTargetArea = nextAreas.get(targetAreaId);

  if (savedTargetArea !== undefined) {
    targetMap = savedTargetArea.map;
    nextEntities = [...savedTargetArea.entities];
    nextComponents = new Map(savedTargetArea.components);
    targetRooms = savedTargetArea.rooms ?? [];
    targetLastSpawnTurn = savedTargetArea.lastSpawnTurn ?? 0;

    // Reinforcement Pass for wake phase:
    // Find unfulfilled reservations (Agreements) targeting targetAreaId
    const reservedTokens: Array<{ templateId: string; minionId: EntityId }> = [];
    for (const [entityId, comps] of state.components.entries()) {
      const agreement = comps[ComponentType.Agreement] as AgreementComponent | undefined;
      if (agreement && agreement.targetAreaId === targetAreaId && !agreement.isFulfilled) {
        const template = comps[ComponentType.Template] as TemplateComponent | undefined;
        if (template) {
          reservedTokens.push({ templateId: template.templateId, minionId: entityId });
        }
      }
    }
    for (const [entityId, record] of state.persistentEntities.entries()) {
      const agreement = record.components[ComponentType.Agreement] as AgreementComponent | undefined;
      if (agreement && agreement.targetAreaId === targetAreaId && !agreement.isFulfilled) {
        const template = record.components[ComponentType.Template] as TemplateComponent | undefined;
        if (template) {
          reservedTokens.push({ templateId: template.templateId, minionId: entityId });
        }
      }
    }

    if (reservedTokens.length > 0) {
      const occupiedCoords = new Set<string>();
      for (const id of nextEntities) {
        const pos = nextComponents.get(id)?.[ComponentType.Position] as PositionComponent;
        if (pos) {
          occupiedCoords.add(`${pos.x},${pos.y}`);
        }
      }

      for (const token of reservedTokens) {
        for (let attempt = 0; attempt < 100; attempt++) {
          const rx = Math.floor(ROT.RNG.getUniform() * targetMap.width);
          const ry = Math.floor(ROT.RNG.getUniform() * targetMap.height);
          const idx = coordToIndex(rx, ry, targetMap.width);
          const tile = targetMap.tiles[idx];
          if (
            tile &&
            !tile.tileId.includes('wall') &&
            !tile.tileId.includes('water') &&
            !occupiedCoords.has(`${rx},${ry}`)
          ) {
            const minionComps =
              state.components.get(token.minionId) || state.persistentEntities.get(token.minionId)?.components;
            if (minionComps) {
              const updatedAgreement: AgreementComponent = {
                ...(minionComps[ComponentType.Agreement] as AgreementComponent),
                isFulfilled: true
              };

              const finalComps = {
                ...minionComps,
                [ComponentType.Position]: { type: ComponentType.Position, x: rx, y: ry } as PositionComponent,
                [ComponentType.Agreement]: updatedAgreement
              };

              if (!nextEntities.includes(token.minionId)) {
                nextEntities = [...nextEntities, token.minionId];
              }
              nextComponents.set(token.minionId, finalComps);
              occupiedCoords.add(`${rx},${ry}`);

              nextPersistentEntities.delete(token.minionId);
              break;
            }
          }
        }
      }
    }

    // Find the corresponding stairs
    let foundStairs = false;
    for (const id of nextEntities) {
      const portal = nextComponents.get(id)?.[ComponentType.Portal] as PortalComponent;
      if (portal && portal.targetAreaId === state.currentAreaId) {
        const pos = nextComponents.get(id)?.[ComponentType.Position] as PositionComponent;
        if (pos && spawnX === -1) {
          spawnX = pos.x;
          spawnY = pos.y;
          foundStairs = true;
          break;
        }
      }
    }

    if (!foundStairs && spawnX === -1) {
      spawnX = Math.floor(targetMap.width / 2);
      spawnY = Math.floor(targetMap.height / 2);
    }

    // Check Respawn Timer
    const areaDef = state.campaign.areas[targetAreaId];
    if (areaDef?.respawnTimerTurns && state.globalTurn - targetLastSpawnTurn >= areaDef.respawnTimerTurns) {
      // Calculate pre-allocated entities
      const existingEntities = Array.from(nextComponents.entries())
        .map(([_id, comps]) => {
          const template = comps[ComponentType.Template] as TemplateComponent | undefined;
          const pos = comps[ComponentType.Position] as PositionComponent | undefined;
          return template && pos ? { templateId: template.templateId, x: pos.x, y: pos.y } : null;
        })
        .filter((e) => e !== null) as Array<{ templateId: string; x: number; y: number }>;

      // Fetch player level
      const players = queryEntities(state, [ComponentType.Player, ComponentType.Fighter]);
      const playerLevel =
        players[0] !== undefined
          ? (getComponent(state, players[0], ComponentType.Fighter) as FighterComponent | undefined)?.level || 1
          : 1;

      // Get mutations for this area
      let areaMutation: { addedTags: ReadonlyArray<string>; budgetModifier: number } | undefined = undefined;
      const areaEntId1 = state.areaEntityIds[targetAreaId];
      if (areaEntId1) {
        const tagsComp = getComponent(state, areaEntId1, ComponentType.Tags) as
          | import('../types/components.types.ts').TagsComponent
          | undefined;
        const budgetComp = getComponent(state, areaEntId1, ComponentType.DirectorBudget) as
          | import('../types/components.types.ts').DirectorBudgetComponent
          | undefined;
        if (tagsComp || budgetComp) {
          areaMutation = {
            addedTags: tagsComp ? tagsComp.tags : [],
            budgetModifier: budgetComp ? budgetComp.budgetModifier : 0
          };
        }
      }

      const directorContext = {
        playerLevel,
        tokenPool: new Set<string>(),
        areaMutation,
        reservedTokens: []
      };

      // Run the Director
      const directorResult = runEncounterDirector(
        state.campaign,
        areaDef,
        targetMap,
        targetRooms,
        existingEntities,
        directorContext
      );

      if (directorResult.newEntities.length > 0) {
        // Create a temporary state using targetMap, current nextEntities and nextComponents
        let tempState: GameState = {
          ...state,
          entities: nextEntities,
          components: nextComponents,
          map: targetMap
        };

        for (const ent of directorResult.newEntities) {
          if (state.campaign.items[ent.templateId]) {
            [tempState] = spawnItem(tempState, ent.templateId, ent.x, ent.y);
          } else if (state.campaign.entities[ent.templateId]) {
            [tempState] = spawnEntity(tempState, ent.templateId, ent.x, ent.y, ent.dynamicTraits);
          } else {
            console.warn(`Director placed template ${ent.templateId} not found in registries.`);
          }
        }

        nextEntities = tempState.entities;
        nextComponents = tempState.components as Map<EntityId, Readonly<Record<string, Component>>>;

        // Push event
        state = {
          ...state,
          events: [
            ...state.events,
            {
              type: GameEventType.AreaRespawned,
              areaId: targetAreaId,
              newEntitiesSpawned: directorResult.newEntities.length
            }
          ]
        };
      }

      targetLastSpawnTurn = state.globalTurn;
    }
  } else {
    // Fetch player level (we can query the player entity's FighterComponent)
    const players = queryEntities(state, [ComponentType.Player, ComponentType.Fighter]);
    const playerLevel =
      players[0] !== undefined
        ? (getComponent(state, players[0], ComponentType.Fighter) as FighterComponent | undefined)?.level || 1
        : 1;

    // Get mutations for this area
    let areaMutation: { addedTags: ReadonlyArray<string>; budgetModifier: number } | undefined = undefined;
    const areaEntId2 = state.areaEntityIds[targetAreaId];
    if (areaEntId2) {
      const tagsComp = getComponent(state, areaEntId2, ComponentType.Tags) as
        | import('../types/components.types.ts').TagsComponent
        | undefined;
      const budgetComp = getComponent(state, areaEntId2, ComponentType.DirectorBudget) as
        | import('../types/components.types.ts').DirectorBudgetComponent
        | undefined;
      if (tagsComp || budgetComp) {
        areaMutation = {
          addedTags: tagsComp ? tagsComp.tags : [],
          budgetModifier: budgetComp ? budgetComp.budgetModifier : 0
        };
      }
    }

    // Find unfulfilled reservations (Agreements) targeting targetAreaId
    const reservedTokens: Array<{ templateId: string; minionId: EntityId }> = [];
    for (const [entityId, comps] of state.components.entries()) {
      const agreement = comps[ComponentType.Agreement] as AgreementComponent | undefined;
      if (agreement && agreement.targetAreaId === targetAreaId && !agreement.isFulfilled) {
        const template = comps[ComponentType.Template] as TemplateComponent | undefined;
        if (template) {
          reservedTokens.push({ templateId: template.templateId, minionId: entityId });
        }
      }
    }
    for (const [entityId, record] of state.persistentEntities.entries()) {
      const agreement = record.components[ComponentType.Agreement] as AgreementComponent | undefined;
      if (agreement && agreement.targetAreaId === targetAreaId && !agreement.isFulfilled) {
        const template = record.components[ComponentType.Template] as TemplateComponent | undefined;
        if (template) {
          reservedTokens.push({ templateId: template.templateId, minionId: entityId });
        }
      }
    }

    const directorContext = {
      playerLevel,
      tokenPool: new Set<string>(),
      areaMutation,
      reservedTokens
    };

    // Generate new floor
    const generated = generateArea(state.campaign, targetAreaId, directorContext);
    targetMap = generated.map;
    targetRooms = generated.rooms ?? [];
    targetLastSpawnTurn = state.globalTurn;

    let foundStairs = false;
    for (const portal of generated.portals) {
      if (portal.connection.targetAreaId === state.currentAreaId) {
        spawnX = portal.x;
        spawnY = portal.y;
        foundStairs = true;
        break;
      }
    }

    if (!foundStairs) {
      spawnX = generated.startPos.x;
      spawnY = generated.startPos.y;
    }

    // We can't use createEntity easily without a state object.
    // Let's create a temporary state to use ECS functions.
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
          bg: state.campaign.theme.colors.transparent ?? 'transparent'
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

    nextEntities = tempState.entities;
    nextComponents = tempState.components as Map<EntityId, Readonly<Record<string, Component>>>;
  }

  // Wake up persistent entities that belong to the target area
  const nextEntitiesArray = [...nextEntities];
  for (const [id, record] of nextPersistentEntities.entries()) {
    if (record.areaId === targetAreaId) {
      const nemesis = record.components[ComponentType.Nemesis] as NemesisComponent | undefined;
      if (nemesis && nemesis.returnDelay !== undefined && nemesis.returnDelay > 0) {
        continue;
      }
      nextEntitiesArray.push(id);
      nextComponents.set(id, record.components);
      nextPersistentEntities.delete(id); // Remove from global cold storage, it's now in active ECS
    }
  }
  nextEntities = nextEntitiesArray;

  // 3. Move Player and their owned items
  const migratingArray = Array.from(migratingEntities);
  nextEntities = [...migratingArray, ...nextEntities];

  // Bring migrating components into the new floor
  for (const id of migratingArray) {
    let comps = state.components.get(id) ?? {};
    if (id === entityId) {
      // Update player position
      comps = {
        ...comps,
        [ComponentType.Position]: { ...(comps[ComponentType.Position] as PositionComponent), x: spawnX, y: spawnY }
      };
    }
    nextComponents.set(id, comps);
  }

  let nextState: GameState = {
    ...state,
    entities: nextEntities,
    components: nextComponents,
    map: targetMap,
    currentAreaId: targetAreaId,
    activeRooms: targetRooms,
    lastSpawnTurn: targetLastSpawnTurn,
    areas: nextAreas,
    persistentEntities: nextPersistentEntities,
    fovNeedsUpdate: true,
    cachedFov: new Set()
  };

  nextState = updateSpatialIndex(nextState);
  nextState = deliverPendingKnowledgeToArea(nextState, targetAreaId);

  // 4. Update Scheduler
  clearScheduler();
  for (const id of nextState.entities) {
    if (id === entityId) {
      const actor = getComponent(nextState, id, ComponentType.Actor);
      if (actor) addActor(id);
      continue;
    }
    const actor = getComponent(nextState, id, ComponentType.Actor);
    if (actor) {
      addActor(id);
    }
  }

  const msg = `You travel to ${targetAreaId}.`;
  nextState = addMessage(nextState, msg, MessageLogCategory.System);

  return { state: updateExploredTiles(nextState), success: true };
}
