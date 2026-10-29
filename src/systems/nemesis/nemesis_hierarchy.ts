import { addComponent, getComponent, spawnEntity } from '../../core/ecs.ts';
import { rng } from '../../core/rng.ts';
import { addActor } from '../../core/scheduler.ts';
import {
  ComponentType,
  type ChronicleComponent,
  type FighterComponent,
  type IdentityComponent,
  type NemesisComponent,
  type PositionComponent,
  type TemplateComponent
} from '../../types/components.types.ts';
import { GameEventType } from '../../types/events.types.ts';
import { type EntityId, type GameState } from '../../types/game-state.types.ts';
import { coordToIndex } from '../../utils/grid.ts';
import { promoteEntity, recordChronicleEvent } from '../chronicle.system.ts';
import { addMessage, MessageLogCategory } from '../message.system.ts';
import { generateEventDrivenRivalry } from '../rivalry.system.ts';

/**
 * Promotes a target entity into a hierarchy rank.
 *
 * @param state The current global game state.
 * @param entityId The EntityId of the entity to promote.
 * @param hierarchyId The ID of the target hierarchy.
 * @param newRankId The rank ID to promote them into.
 * @returns The updated global game state.
 */
export function promoteNemesis(
  state: GameState,
  entityId: EntityId,
  hierarchyId: string,
  newRankId: string
): GameState {
  let nextState = state;

  if (!getComponent(nextState, entityId, ComponentType.Chronicle)) {
    nextState = promoteEntity(nextState, entityId);
  }

  const hierarchy = nextState.campaign.nemesisHierarchies[hierarchyId];
  if (!hierarchy) return state;

  const rank = hierarchy.ranks.find((r) => r.rankId === newRankId);
  if (!rank) return state;

  const oldNemesis = getComponent(nextState, entityId, ComponentType.Nemesis) as NemesisComponent | undefined;

  const nemesisCmp: NemesisComponent = {
    type: ComponentType.Nemesis,
    hierarchyId,
    rankId: newRankId,
    tier: rank.tier,
    cheatedDeathCount: oldNemesis ? oldNemesis.cheatedDeathCount : 0,
    lastDeathTurn: oldNemesis ? oldNemesis.lastDeathTurn : 0,
    returnDelay: undefined,
    targetAreaId: undefined
  };

  nextState = addComponent(nextState, entityId, nemesisCmp);

  const fighter = getComponent(nextState, entityId, ComponentType.Fighter) as FighterComponent | undefined;
  if (fighter && rank.statMultipliers) {
    const nextFighter: FighterComponent = {
      ...fighter,
      maxHp: Math.round(fighter.maxHp * (rank.statMultipliers.maxHp ?? 1.0)),
      hp: Math.round(fighter.hp * (rank.statMultipliers.maxHp ?? 1.0)),
      attack: Math.round(fighter.attack * (rank.statMultipliers.attack ?? 1.0)),
      defense: Math.round(fighter.defense * (rank.statMultipliers.defense ?? 1.0)),
      xpGiven: Math.round(fighter.xpGiven * (rank.statMultipliers.xpGiven ?? 1.0))
    };
    nextState = addComponent(nextState, entityId, nextFighter);
  }

  const identity = getComponent(nextState, entityId, ComponentType.Identity) as IdentityComponent | undefined;
  let chosenTitle = identity?.title;

  if (identity && rank.titlePool && rank.titlePool.length > 0) {
    chosenTitle = rng.getItem(rank.titlePool) ?? identity.title;
    nextState = addComponent(nextState, entityId, {
      ...identity,
      title: chosenTitle
    });
  }

  let oldRankKey: string | undefined;
  if (oldNemesis) {
    oldRankKey = `${oldNemesis.hierarchyId}:${oldNemesis.rankId}`;
  }

  const nextSlots = { ...nextState.nemesisSlots };
  if (oldRankKey && nextSlots[oldRankKey]) {
    nextSlots[oldRankKey] = nextSlots[oldRankKey]!.filter((id) => id !== entityId);
  }

  const rankKey = `${hierarchyId}:${newRankId}`;
  nextSlots[rankKey] = [...(nextSlots[rankKey] || []), entityId];

  nextState = {
    ...nextState,
    nemesisSlots: nextSlots
  };

  const name = identity ? identity.name : 'Someone';
  const rankDisplayName = rank.displayName;
  const summary = `Promoted to ${rankDisplayName}${chosenTitle ? ` (${chosenTitle})` : ''}.`;

  const eventId = `evt_${nextState.globalTurn}_promo_${Math.floor(rng.getUniform() * 10000)}`;

  const promoteEvent = {
    id: eventId,
    importance: 'high' as const,
    summary,
    type: GameEventType.NemesisPromoted as const,
    entityId,
    hierarchyId,
    newRankId,
    previousRankId: oldNemesis?.rankId
  };

  nextState = {
    ...nextState,
    events: [...nextState.events, promoteEvent]
  };

  nextState = recordChronicleEvent(nextState, entityId, eventId);
  nextState = addMessage(nextState, `${name} has been promoted to ${rankDisplayName}!`, MessageLogCategory.System);

  nextState = generateEventDrivenRivalry(nextState, promoteEvent);

  return nextState;
}

/**
 * Promotes/spawns an entity to fill a vacancy in a hierarchy rank.
 *
 * @param state The current global game state.
 * @param hierarchyId The ID of the nemesis hierarchy.
 * @param rankId The ID of the vacant rank.
 * @returns The updated global game state.
 */
export function fillVacancy(state: GameState, hierarchyId: string, rankId: string): GameState {
  const hierarchy = state.campaign.nemesisHierarchies[hierarchyId];
  if (!hierarchy) return state;

  const rank = hierarchy.ranks.find((r) => r.rankId === rankId);
  if (!rank) return state;

  const vacantTier = rank.tier;

  // Try to find candidate from the rank below
  if (vacantTier > 0) {
    const lowerRank = hierarchy.ranks.find((r) => r.tier === vacantTier - 1);
    if (lowerRank) {
      const lowerRankKey = `${hierarchyId}:${lowerRank.rankId}`;
      const lowerRankOccupants = state.nemesisSlots[lowerRankKey] || [];

      if (lowerRankOccupants.length > 0) {
        let bestCandidate: EntityId | undefined;
        let maxPis = -1;

        for (const id of lowerRankOccupants) {
          const chronicle = getComponent(state, id, ComponentType.Chronicle) as ChronicleComponent | undefined;
          if (chronicle && chronicle.pis > maxPis) {
            maxPis = chronicle.pis;
            bestCandidate = id;
          }
        }

        if (bestCandidate !== undefined) {
          return promoteNemesis(state, bestCandidate, hierarchyId, rankId);
        }
      }
    }
  }

  // Fallback: search active / persistent templates matching promotionSources
  const promotionSources = hierarchy.promotionSources;
  if (promotionSources.length > 0) {
    let bestCandidateId: EntityId | undefined;
    let bestCandidateSource: 'active' | 'persistent' | undefined;
    let maxPis = -1;

    for (const id of state.entities) {
      if (getComponent(state, id, ComponentType.Player)) continue;
      const template = getComponent(state, id, ComponentType.Template) as TemplateComponent | undefined;
      if (template && promotionSources.includes(template.templateId)) {
        const nemesis = getComponent(state, id, ComponentType.Nemesis);
        if (!nemesis) {
          const chronicle = getComponent(state, id, ComponentType.Chronicle) as ChronicleComponent | undefined;
          const pis = chronicle ? chronicle.pis : 0;
          if (pis > maxPis || bestCandidateId === undefined) {
            maxPis = pis;
            bestCandidateId = id;
            bestCandidateSource = 'active';
          }
        }
      }
    }

    for (const [id, record] of state.persistentEntities.entries()) {
      const template = record.components[ComponentType.Template] as TemplateComponent | undefined;
      if (template && promotionSources.includes(template.templateId)) {
        const nemesis = record.components[ComponentType.Nemesis];
        if (!nemesis) {
          const chronicle = record.components[ComponentType.Chronicle] as ChronicleComponent | undefined;
          const pis = chronicle ? chronicle.pis : 0;
          if (pis > maxPis || bestCandidateId === undefined) {
            maxPis = pis;
            bestCandidateId = id;
            bestCandidateSource = 'persistent';
          }
        }
      }
    }

    if (bestCandidateId !== undefined) {
      if (bestCandidateSource === 'active') {
        return promoteNemesis(state, bestCandidateId, hierarchyId, rankId);
      } else {
        const record = state.persistentEntities.get(bestCandidateId)!;
        const nextPersistentEntities = new Map(state.persistentEntities);
        nextPersistentEntities.delete(bestCandidateId);

        let nextState: GameState = {
          ...state,
          entities: [...state.entities, bestCandidateId],
          components: new Map([...state.components.entries(), [bestCandidateId, record.components]]),
          persistentEntities: nextPersistentEntities
        };

        // Temporarily promote in the active state
        nextState = promoteNemesis(nextState, bestCandidateId, hierarchyId, rankId);

        // Put them back into persistent entities with their original areaId
        const finalComps = nextState.components.get(bestCandidateId)!;
        const finalActiveEntities = nextState.entities.filter((id) => id !== bestCandidateId);
        const finalActiveComponents = new Map(nextState.components);
        finalActiveComponents.delete(bestCandidateId);

        const finalPersistentEntities = new Map(nextState.persistentEntities);
        finalPersistentEntities.set(bestCandidateId, {
          areaId: record.areaId,
          components: finalComps
        });

        return {
          ...nextState,
          entities: finalActiveEntities,
          components: finalActiveComponents,
          persistentEntities: finalPersistentEntities
        };
      }
    }

    // Recruits fallback: spawn a new recruit and promote immediately
    const templateId = rng.getItem(promotionSources) ?? 'orc';
    const currentAreaDef = state.campaign.areas[state.currentAreaId];
    const isSafeArea = currentAreaDef?.tags?.includes('safe') || false;

    if (isSafeArea) {
      // If the current area is safe, do not spawn them on the map.
      // Spawn them temporarily at 0,0, promote them, and push to persistent entities
      const [stateAfterSpawn, newEntityId] = spawnEntity(state, templateId, 0, 0);
      const nextState = promoteNemesis(stateAfterSpawn, newEntityId, hierarchyId, rankId);

      // Find an unsafe area to place them in
      const unsafeAreas = Object.keys(state.campaign.areas).filter(
        (id) => !state.campaign.areas[id]?.tags?.includes('safe')
      );
      const targetAreaId = unsafeAreas.length > 0 ? (rng.getItem(unsafeAreas) ?? 'dungeon_1') : 'dungeon_1';

      const finalComps = { ...nextState.components.get(newEntityId)! };
      delete finalComps[ComponentType.Position];

      const finalActiveEntities = nextState.entities.filter((id) => id !== newEntityId);
      const finalActiveComponents = new Map(nextState.components);
      finalActiveComponents.delete(newEntityId);

      const finalPersistentEntities = new Map(nextState.persistentEntities);
      finalPersistentEntities.set(newEntityId, {
        areaId: targetAreaId,
        components: finalComps
      });

      return {
        ...nextState,
        entities: finalActiveEntities,
        components: finalActiveComponents,
        persistentEntities: finalPersistentEntities
      };
    } else {
      let spawnX = 0;
      let spawnY = 0;
      let spawned = false;
      const occupiedCoords = new Set<string>();
      for (const activeId of state.entities) {
        const pos = getComponent(state, activeId, ComponentType.Position) as PositionComponent | undefined;
        if (pos) {
          occupiedCoords.add(`${pos.x},${pos.y}`);
        }
      }

      for (let attempt = 0; attempt < 100; attempt++) {
        const rx = Math.floor(rng.getUniform() * state.map.width);
        const ry = Math.floor(rng.getUniform() * state.map.height);
        const idx = coordToIndex(rx, ry, state.map.width);
        const tile = state.map.tiles[idx];
        if (tile && state.campaign.tiles[tile.tileId]?.walkable && !occupiedCoords.has(`${rx},${ry}`)) {
          spawnX = rx;
          spawnY = ry;
          spawned = true;
          break;
        }
      }

      if (!spawned) {
        spawnX = Math.floor(state.map.width / 2);
        spawnY = Math.floor(state.map.height / 2);
      }

      const [stateAfterSpawn, newEntityId] = spawnEntity(state, templateId, spawnX, spawnY);
      const promotedState = promoteNemesis(stateAfterSpawn, newEntityId, hierarchyId, rankId);
      if (getComponent(promotedState, newEntityId, ComponentType.Actor)) {
        addActor(newEntityId);
      }
      return promotedState;
    }
  }

  return state;
}
