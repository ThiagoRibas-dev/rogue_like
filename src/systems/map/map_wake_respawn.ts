import { getComponent, queryEntities, spawnEntity, spawnItem } from '../../core/ecs.ts';
import { rng } from '../../core/rng.ts';
import { runEncounterDirector } from '../../map/encounter_director.ts';
import type { RoomBounds } from '../../types/encounter.types.ts';
import { GameEventType } from '../../types/events.types.ts';
import {
  ComponentType,
  type Component,
  type DirectorBudgetComponent,
  type PositionComponent,
  type TagsComponent,
  type AgreementComponent,
  type FighterComponent,
  type TemplateComponent
} from '../../types/components.types.ts';
import {
  type EntityId,
  type GameMap,
  type GameState,
  type PersistentEntityRecord
} from '../../types/game-state.types.ts';
import { coordToIndex } from '../../utils/grid.ts';

/**
 * Collects unfulfilled minion Agreements targeting the specified area across both active and persistent entities.
 */
export function collectReservedTokensForArea(
  state: GameState,
  targetAreaId: string
): Array<{ templateId: string; minionId: EntityId }> {
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
  return reservedTokens;
}

/**
 * Builds the Encounter Director context for a target area (player level, area mutations, reserved tokens).
 */
export function buildAreaDirectorContext(
  state: GameState,
  targetAreaId: string,
  includeReservedTokens: boolean
): {
  playerLevel: number;
  tokenPool: Set<string>;
  areaMutation: { addedTags: ReadonlyArray<string>; budgetModifier: number } | undefined;
  reservedTokens: Array<{ templateId: string; minionId: EntityId }>;
} {
  const players = queryEntities(state, [ComponentType.Player, ComponentType.Fighter]);
  const playerLevel =
    players[0] !== undefined
      ? (getComponent(state, players[0], ComponentType.Fighter) as FighterComponent | undefined)?.level || 1
      : 1;

  let areaMutation: { addedTags: ReadonlyArray<string>; budgetModifier: number } | undefined = undefined;
  const areaEntId = state.areaEntityIds[targetAreaId];
  if (areaEntId) {
    const tagsComp = getComponent(state, areaEntId, ComponentType.Tags) as TagsComponent | undefined;
    const budgetComp = getComponent(state, areaEntId, ComponentType.DirectorBudget) as
      DirectorBudgetComponent | undefined;
    if (tagsComp || budgetComp) {
      areaMutation = {
        addedTags: tagsComp ? tagsComp.tags : [],
        budgetModifier: budgetComp ? budgetComp.budgetModifier : 0
      };
    }
  }

  return {
    playerLevel,
    tokenPool: new Set<string>(),
    areaMutation,
    reservedTokens: includeReservedTokens ? collectReservedTokensForArea(state, targetAreaId) : []
  };
}

/**
 * Applies the wake-phase reinforcement pass (placing unfulfilled Agreement minions) and checks respawn timers.
 */
export function wakeSavedAreaFloor(
  state: GameState,
  targetAreaId: string,
  targetMap: GameMap,
  targetRooms: ReadonlyArray<RoomBounds>,
  initialEntities: ReadonlyArray<EntityId>,
  initialComponents: Map<EntityId, Readonly<Record<string, Component>>>,
  nextPersistentEntities: Map<EntityId, PersistentEntityRecord>,
  initialLastSpawnTurn: number
): {
  state: GameState;
  nextEntities: ReadonlyArray<EntityId>;
  nextComponents: Map<EntityId, Readonly<Record<string, Component>>>;
  targetLastSpawnTurn: number;
} {
  let nextState = state;
  let nextEntities = [...initialEntities];
  let nextComponents = new Map(initialComponents);
  let targetLastSpawnTurn = initialLastSpawnTurn;

  const reservedTokens = collectReservedTokensForArea(nextState, targetAreaId);
  if (reservedTokens.length > 0) {
    const occupiedCoords = new Set<string>();
    for (const id of nextEntities) {
      const pos = nextComponents.get(id)?.[ComponentType.Position] as PositionComponent | undefined;
      if (pos) {
        occupiedCoords.add(`${pos.x},${pos.y}`);
      }
    }

    for (const token of reservedTokens) {
      for (let attempt = 0; attempt < 100; attempt++) {
        const rx = Math.floor(rng.getUniform() * targetMap.width);
        const ry = Math.floor(rng.getUniform() * targetMap.height);
        const idx = coordToIndex(rx, ry, targetMap.width);
        const tile = targetMap.tiles[idx];
        if (tile && nextState.campaign.tiles[tile.tileId]?.walkable && !occupiedCoords.has(`${rx},${ry}`)) {
          const minionComps =
            nextState.components.get(token.minionId) || nextState.persistentEntities.get(token.minionId)?.components;
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

  // Check Respawn Timer
  const areaDef = nextState.campaign.areas[targetAreaId];
  if (areaDef?.respawnTimerTurns && nextState.globalTurn - targetLastSpawnTurn >= areaDef.respawnTimerTurns) {
    const existingEntities = Array.from(nextComponents.entries())
      .map(([_id, comps]) => {
        const template = comps[ComponentType.Template] as TemplateComponent | undefined;
        const pos = comps[ComponentType.Position] as PositionComponent | undefined;
        return template && pos ? { templateId: template.templateId, x: pos.x, y: pos.y } : null;
      })
      .filter((e): e is { templateId: string; x: number; y: number } => e !== null);

    const directorContext = buildAreaDirectorContext(nextState, targetAreaId, false);
    const directorResult = runEncounterDirector(
      nextState.campaign,
      areaDef,
      targetMap,
      targetRooms,
      existingEntities,
      directorContext
    );

    if (directorResult.newEntities.length > 0) {
      let tempState: GameState = {
        ...nextState,
        entities: nextEntities,
        components: nextComponents,
        map: targetMap
      };

      for (const ent of directorResult.newEntities) {
        if (nextState.campaign.items[ent.templateId]) {
          [tempState] = spawnItem(tempState, ent.templateId, ent.x, ent.y);
        } else if (nextState.campaign.entities[ent.templateId]) {
          [tempState] = spawnEntity(tempState, ent.templateId, ent.x, ent.y, ent.dynamicTraits);
        } else {
          console.warn(`Director placed template ${ent.templateId} not found in registries.`);
        }
      }

      nextEntities = [...tempState.entities];
      nextComponents = tempState.components as Map<EntityId, Readonly<Record<string, Component>>>;

      nextState = {
        ...nextState,
        events: [
          ...nextState.events,
          {
            type: GameEventType.AreaRespawned,
            areaId: targetAreaId,
            newEntitiesSpawned: directorResult.newEntities.length
          }
        ]
      };
    }

    targetLastSpawnTurn = nextState.globalTurn;
  }

  return {
    state: nextState,
    nextEntities,
    nextComponents,
    targetLastSpawnTurn
  };
}
