import {
  CHEAT_DEATH_BASE_CHANCE,
  CHEAT_DEATH_ENTITY_COOLDOWN,
  CHEAT_DEATH_GLOBAL_COOLDOWN,
  CHEAT_DEATH_RETURN_DELAY_MAX,
  CHEAT_DEATH_RETURN_DELAY_MIN,
  MAX_SCARS_PER_ENTITY,
  PIS_CHEAT_DEATH_THRESHOLD,
  VACANCY_FILL_DELAY,
  DRAMATIC_PAUSE_DURATION_MS
} from '../constants/nemesis.constants.ts';
import { addComponent, getComponent, spawnEntity, updateSpatialIndex } from '../core/ecs.ts';
import { rng } from '../core/rng.ts';
import { addActor, removeActor, setTurnDuration } from '../core/scheduler.ts';
import { getSettings } from '../core/settings.ts';
import { type ScarDefinition } from '../types/campaign.types.ts';
import {
  ComponentType,
  type ActorComponent,
  type ChronicleComponent,
  type Component,
  type FighterComponent,
  type IdentityComponent,
  type NemesisComponent,
  type PositionComponent,
  type TagsComponent,
  type TemplateComponent,
  type TraitsComponent
} from '../types/components.types.ts';
import { GameEventType, type EntityDamagedEvent, type EntityDiedEvent } from '../types/events.types.ts';
import { type EntityId, type GameState } from '../types/game-state.types.ts';
import { coordToIndex } from '../utils/grid.ts';
import { promoteEntity, recordChronicleEvent } from './chronicle.system.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';
import { generateEventDrivenRivalry } from './rivalry.system.ts';

/**
 *Centralized helper to pool and resolve barks from an entity's active tags and traits.
 *
 * @param state The current global game state.
 * @param entityId The EntityId of the entity to retrieve barks for.
 * @param barkType The category of bark (e.g., 'encounter_nemesis', 'cheat_death', 'victory_taunt').
 * @returns An array of matching bark strings.
 */
export function getEntityBarks(state: GameState, entityId: EntityId, barkType: string): string[] {
  const barks: string[] = [];

  const tagsComp = getComponent(state, entityId, ComponentType.Tags) as TagsComponent | undefined;
  if (tagsComp) {
    for (const tag of tagsComp.tags) {
      const tagDef = state.campaign.tagRegistry[tag];
      if (tagDef && tagDef.barks && tagDef.barks[barkType]) {
        barks.push(...tagDef.barks[barkType]);
      }
    }
  }

  const traitsComp = getComponent(state, entityId, ComponentType.Traits) as TraitsComponent | undefined;
  if (traitsComp) {
    for (const trait of traitsComp.traits) {
      const traitDef = state.campaign.traitRegistry[trait];
      if (traitDef && traitDef.barks && traitDef.barks[barkType]) {
        barks.push(...traitDef.barks[barkType]);
      }
    }
  }

  return barks;
}

/**
 * Main per-tick entry point for processing all nemesis-related mechanics:
 * 1. PIS Tracking: Increments Player Interaction Score for active NPCs based on recent player combat events.
 * 2. Return Timer Ticking: Counts down return delays for dead nemeses in limbo, spawning them back when ready.
 * 3. Vacancy Filling: Automatically processes vacancy timers and triggers succession promotions or recruitment.
 *
 * @param state The current global game state.
 * @returns The updated global game state.
 */
export function processNemesisSystem(state: GameState): GameState {
  let nextState = state;
  const globalTurn = nextState.globalTurn || 0;

  // 1. PIS Tracking
  const playerEntityId = nextState.entities.find((e) => getComponent(nextState, e, ComponentType.Player) !== undefined);

  if (playerEntityId !== undefined) {
    const affectedEntities = new Map<EntityId, number>();

    for (const event of nextState.events) {
      if (event.type === GameEventType.EntityDamaged) {
        const damageEvent = event as EntityDamagedEvent;
        if (damageEvent.sourceEntityId === playerEntityId && damageEvent.entityId !== playerEntityId) {
          affectedEntities.set(damageEvent.entityId, (affectedEntities.get(damageEvent.entityId) || 0) + 1);
        } else if (
          damageEvent.entityId === playerEntityId &&
          damageEvent.sourceEntityId !== undefined &&
          damageEvent.sourceEntityId !== playerEntityId
        ) {
          affectedEntities.set(damageEvent.sourceEntityId, (affectedEntities.get(damageEvent.sourceEntityId) || 0) + 1);
        }
      } else if (event.type === GameEventType.EntityDied) {
        const diedEvent = event as EntityDiedEvent;
        if (diedEvent.killerId === playerEntityId && diedEvent.victimId !== playerEntityId) {
          affectedEntities.set(diedEvent.victimId, (affectedEntities.get(diedEvent.victimId) || 0) + 2);
        } else if (
          diedEvent.victimId === playerEntityId &&
          diedEvent.killerId !== undefined &&
          diedEvent.killerId !== playerEntityId
        ) {
          affectedEntities.set(diedEvent.killerId, (affectedEntities.get(diedEvent.killerId) || 0) + 5);
        }
      }
    }

    const nextFactionPis = { ...nextState.factionPis };
    const nextAreaPis = { ...nextState.areaPis };
    let pisModified = false;

    for (const [entityId, increment] of affectedEntities.entries()) {
      const chronicle = getComponent(nextState, entityId, ComponentType.Chronicle) as ChronicleComponent | undefined;
      if (chronicle) {
        nextState = addComponent(nextState, entityId, {
          ...chronicle,
          pis: chronicle.pis + increment
        });
      }

      const faction = getComponent(nextState, entityId, ComponentType.Faction) as
        | import('../types/components.types.ts').FactionComponent
        | undefined;
      if (faction) {
        nextFactionPis[faction.factionId] = (nextFactionPis[faction.factionId] || 0) + increment;
        pisModified = true;
      }

      nextAreaPis[nextState.currentAreaId] = (nextAreaPis[nextState.currentAreaId] || 0) + increment;
      pisModified = true;
    }

    if (pisModified) {
      nextState = {
        ...nextState,
        factionPis: nextFactionPis,
        areaPis: nextAreaPis
      };
    }
  }

  // 2. Return Timer Ticking (limbo management)
  const nextPersistentEntities = new Map(nextState.persistentEntities);
  let modifiedPersistent = false;

  for (const [entityId, record] of nextState.persistentEntities.entries()) {
    const nemesis = record.components[ComponentType.Nemesis] as NemesisComponent | undefined;
    if (nemesis && nemesis.returnDelay !== undefined && nemesis.returnDelay > 0) {
      const nextDelay = nemesis.returnDelay - 1;
      const nextNemesis: NemesisComponent = {
        ...nemesis,
        returnDelay: nextDelay <= 0 ? undefined : nextDelay
      };

      const updatedComps: Record<string, Component> = {
        ...record.components,
        [ComponentType.Nemesis]: nextNemesis
      };

      if (nextDelay <= 0) {
        const targetAreaId = nemesis.targetAreaId || nextState.currentAreaId;

        if (targetAreaId === nextState.currentAreaId) {
          nextPersistentEntities.delete(entityId);

          let spawned = false;
          const occupiedCoords = new Set<string>();
          for (const activeId of nextState.entities) {
            const pos = getComponent(nextState, activeId, ComponentType.Position) as PositionComponent | undefined;
            if (pos) {
              occupiedCoords.add(`${pos.x},${pos.y}`);
            }
          }

          for (let attempt = 0; attempt < 100; attempt++) {
            const rx = Math.floor(rng.getUniform() * nextState.map.width);
            const ry = Math.floor(rng.getUniform() * nextState.map.height);
            const idx = coordToIndex(rx, ry, nextState.map.width);
            const tile = nextState.map.tiles[idx];
            if (
              tile &&
              !tile.tileId.includes('wall') &&
              !tile.tileId.includes('water') &&
              !occupiedCoords.has(`${rx},${ry}`)
            ) {
              const positionCmp: PositionComponent = {
                type: ComponentType.Position,
                x: rx,
                y: ry
              };
              const finalComps: Record<string, Component> = {
                ...updatedComps,
                [ComponentType.Position]: positionCmp
              };

              const actor = finalComps[ComponentType.Actor] as ActorComponent | undefined;
              if (actor) {
                addActor(entityId);
              }

              nextState = {
                ...nextState,
                entities: [...nextState.entities, entityId],
                components: new Map([...nextState.components.entries(), [entityId, finalComps]])
              };

              const eventId = `evt_${nextState.globalTurn}_return_${Math.floor(rng.getUniform() * 10000)}`;
              nextState = {
                ...nextState,
                events: [
                  ...nextState.events,
                  {
                    id: eventId,
                    importance: 'high',
                    summary: `Returned to ${targetAreaId} to seek vengeance.`,
                    type: GameEventType.NemesisReturned,
                    entityId,
                    areaId: targetAreaId
                  }
                ]
              };

              const identity = finalComps[ComponentType.Identity] as IdentityComponent | undefined;
              const name = identity ? identity.name : 'A nemesis';
              nextState = addMessage(nextState, `${name} has returned to seek vengeance!`, MessageLogCategory.System);
              nextState = recordChronicleEvent(nextState, entityId, eventId);

              spawned = true;
              break;
            }
          }

          if (!spawned) {
            nextPersistentEntities.set(entityId, {
              areaId: targetAreaId,
              components: updatedComps
            });
          }
        } else {
          nextPersistentEntities.set(entityId, {
            areaId: targetAreaId,
            components: updatedComps
          });
        }
      } else {
        nextPersistentEntities.set(entityId, {
          areaId: record.areaId,
          components: updatedComps
        });
      }
      modifiedPersistent = true;
    }
  }

  if (modifiedPersistent) {
    nextState = {
      ...nextState,
      persistentEntities: nextPersistentEntities
    };
  }

  // 3. Vacancy Filling
  const nextVacancyTurns: Record<string, number> = { ...(nextState.vacancyTurns || {}) };
  let stateAfterVacancy = nextState;

  for (const [hierarchyId, hierarchy] of Object.entries(stateAfterVacancy.campaign.nemesisHierarchies)) {
    for (const rank of hierarchy.ranks) {
      const key = `${hierarchyId}:${rank.rankId}`;
      const occupants = stateAfterVacancy.nemesisSlots[key] || [];
      const vacanciesCount = Math.max(0, rank.maxSlots - occupants.length);

      if (vacanciesCount > 0) {
        for (let slotIndex = 0; slotIndex < vacanciesCount; slotIndex++) {
          const slotKey = `${hierarchyId}:${rank.rankId}:${slotIndex}`;
          if (nextVacancyTurns[slotKey] === undefined) {
            nextVacancyTurns[slotKey] = globalTurn;
          } else {
            const turnsVacant = globalTurn - nextVacancyTurns[slotKey]!;
            if (turnsVacant >= VACANCY_FILL_DELAY) {
              stateAfterVacancy = fillVacancy(stateAfterVacancy, hierarchyId, rank.rankId);
              delete nextVacancyTurns[slotKey];
            }
          }
        }
      } else {
        for (let slotIndex = 0; slotIndex < rank.maxSlots; slotIndex++) {
          const slotKey = `${hierarchyId}:${rank.rankId}:${slotIndex}`;
          delete nextVacancyTurns[slotKey];
        }
      }
    }
  }

  return {
    ...stateAfterVacancy,
    vacancyTurns: nextVacancyTurns
  };
}

/**
 * Checks if a dying entity should cheat death.
 * If so, updates their state, applies a scar, and moves them to persistent storage limbo.
 *
 * @param state The current global game state.
 * @param entityId The EntityId of the dying entity.
 * @param killerId The EntityId of the killer (if any).
 * @returns An object indicating if they cheated death, and the updated game state.
 */
export function evaluateCheatDeath(
  state: GameState,
  entityId: EntityId,
  killerId?: EntityId
): { readonly shouldCheatDeath: boolean; readonly state: GameState } {
  const nemesis = getComponent(state, entityId, ComponentType.Nemesis) as NemesisComponent | undefined;
  if (!nemesis) {
    return { shouldCheatDeath: false, state };
  }

  const chronicle = getComponent(state, entityId, ComponentType.Chronicle) as ChronicleComponent | undefined;
  if (!chronicle) {
    return { shouldCheatDeath: false, state };
  }

  if (chronicle.pis < PIS_CHEAT_DEATH_THRESHOLD) {
    return { shouldCheatDeath: false, state };
  }

  const globalTurn = state.globalTurn || 0;

  if (state.lastCheatDeathTurn !== undefined && globalTurn - state.lastCheatDeathTurn < CHEAT_DEATH_GLOBAL_COOLDOWN) {
    return { shouldCheatDeath: false, state };
  }

  if (nemesis.lastDeathTurn !== undefined && globalTurn - nemesis.lastDeathTurn < CHEAT_DEATH_ENTITY_COOLDOWN) {
    return { shouldCheatDeath: false, state };
  }

  if (rng.getUniform() > CHEAT_DEATH_BASE_CHANCE) {
    return { shouldCheatDeath: false, state };
  }

  let nextState = state;
  const identity = getComponent(nextState, entityId, ComponentType.Identity) as IdentityComponent | undefined;
  const name = identity ? identity.name : 'A nemesis';

  const barks = getEntityBarks(nextState, entityId, 'cheat_death');
  const cheatDeathBark = barks.length > 0 ? rng.getItem(barks) : undefined;

  const hierarchy = nextState.campaign.nemesisHierarchies[nemesis.hierarchyId];
  let chosenScar: ScarDefinition | undefined;
  if (hierarchy && hierarchy.scarPool && hierarchy.scarPool.length > 0) {
    chosenScar = rng.getItem(hierarchy.scarPool) ?? undefined;
  }

  if (chosenScar) {
    nextState = applyScar(nextState, entityId, chosenScar);
  }

  const returnDelay =
    Math.floor(rng.getUniform() * (CHEAT_DEATH_RETURN_DELAY_MAX - CHEAT_DEATH_RETURN_DELAY_MIN + 1)) +
    CHEAT_DEATH_RETURN_DELAY_MIN;

  const targetAreaId = nextState.currentAreaId;

  const nextNemesis: NemesisComponent = {
    ...nemesis,
    cheatedDeathCount: nemesis.cheatedDeathCount + 1,
    lastDeathTurn: globalTurn,
    returnDelay,
    targetAreaId
  };

  const entityComps = nextState.components.get(entityId) || {};
  const cleanComps: Record<string, Component> = { ...entityComps };
  delete cleanComps[ComponentType.Position];
  delete cleanComps[ComponentType.Death];
  delete cleanComps[ComponentType.Actor];

  cleanComps[ComponentType.Nemesis] = nextNemesis;

  const nextChronicle = cleanComps[ComponentType.Chronicle] as ChronicleComponent | undefined;
  if (nextChronicle) {
    const eventId = `evt_${globalTurn}_cheat_${Math.floor(rng.getUniform() * 10000)}`;
    nextState = {
      ...nextState,
      events: [
        ...nextState.events,
        {
          id: eventId,
          importance: 'high',
          summary: `Cheated death! Survived being struck down by the player.`,
          type: GameEventType.NemesisCheatedDeath,
          entityId
        }
      ]
    };
    cleanComps[ComponentType.Chronicle] = {
      ...nextChronicle,
      eventExcerpts: [...nextChronicle.eventExcerpts, eventId]
    };
  }

  const persistentRecord = {
    areaId: targetAreaId,
    components: cleanComps
  };

  const nextPersistentEntities = new Map(nextState.persistentEntities);
  nextPersistentEntities.set(entityId, persistentRecord);

  const nextActiveEntities = nextState.entities.filter((id) => id !== entityId);
  const nextActiveComponents = new Map(nextState.components);
  nextActiveComponents.delete(entityId);
  removeActor(entityId);

  nextState = {
    ...nextState,
    entities: nextActiveEntities,
    components: nextActiveComponents,
    persistentEntities: nextPersistentEntities,
    lastCheatDeathTurn: globalTurn
  };

  if (cheatDeathBark) {
    nextState = addMessage(nextState, `${name} shouts: "${cheatDeathBark}"`, MessageLogCategory.Flavor);
  }
  if (!getSettings().visualFeedback.reduceDramaticDelays) {
    setTurnDuration(DRAMATIC_PAUSE_DURATION_MS); // dramatic pause
  }
  nextState = addMessage(nextState, `${name} refuses to die!`, MessageLogCategory.System);
  const cheatEvent = {
    type: GameEventType.NemesisCheatedDeath as const,
    entityId,
    killerId,
    scarId: chosenScar?.id
  };

  nextState = {
    ...nextState,
    events: [...nextState.events, cheatEvent]
  };

  nextState = generateEventDrivenRivalry(nextState, cheatEvent);

  nextState = updateSpatialIndex(nextState);

  return { shouldCheatDeath: true, state: nextState };
}

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
      delete finalComps[ComponentType.Actor];

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
        if (
          tile &&
          !tile.tileId.includes('wall') &&
          !tile.tileId.includes('water') &&
          !occupiedCoords.has(`${rx},${ry}`)
        ) {
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
      return promoteNemesis(stateAfterSpawn, newEntityId, hierarchyId, rankId);
    }
  }

  return state;
}

/**
 * Permanently applies a scar definition to an entity, altering their stats and traits.
 *
 * @param state The current global game state.
 * @param entityId The EntityId of the entity receiving the scar.
 * @param scarDef The ScarDefinition to apply.
 * @returns The updated global game state.
 */
export function applyScar(state: GameState, entityId: EntityId, scarDef: ScarDefinition): GameState {
  let nextState = state;

  const chronicle = getComponent(nextState, entityId, ComponentType.Chronicle) as ChronicleComponent | undefined;
  if (chronicle) {
    const nextScars = [...chronicle.scars];
    if (nextScars.length < MAX_SCARS_PER_ENTITY) {
      nextScars.push(scarDef.description);
    }
    nextState = addComponent(nextState, entityId, {
      ...chronicle,
      scars: nextScars
    });
  }

  const fighter = getComponent(nextState, entityId, ComponentType.Fighter) as FighterComponent | undefined;
  if (fighter && scarDef.statModifiers) {
    const nextFighter: FighterComponent = {
      ...fighter,
      maxHp: Math.max(1, fighter.maxHp + (scarDef.statModifiers.maxHp ?? 0)),
      hp: Math.max(1, fighter.hp + (scarDef.statModifiers.maxHp ?? 0)),
      attack: Math.max(1, fighter.attack + (scarDef.statModifiers.attack ?? 0)),
      defense: Math.max(0, fighter.defense + (scarDef.statModifiers.defense ?? 0))
    };
    nextState = addComponent(nextState, entityId, nextFighter);
  }

  const traitsCmp = getComponent(nextState, entityId, ComponentType.Traits) as TraitsComponent | undefined;
  if (traitsCmp) {
    let nextTraits = [...traitsCmp.traits];
    if (scarDef.traitsRemoved) {
      nextTraits = nextTraits.filter((t) => !scarDef.traitsRemoved!.includes(t));
    }
    if (scarDef.traitsAdded) {
      for (const t of scarDef.traitsAdded) {
        if (!nextTraits.includes(t)) {
          nextTraits.push(t);
        }
      }
    }
    nextState = addComponent(nextState, entityId, {
      ...traitsCmp,
      traits: nextTraits
    });
  }

  const eventId = `evt_${nextState.globalTurn}_scar_${Math.floor(rng.getUniform() * 10000)}`;
  nextState = {
    ...nextState,
    events: [
      ...nextState.events,
      {
        id: eventId,
        importance: 'high',
        summary: `Gained scar: ${scarDef.description}`,
        type: GameEventType.NemesisScarred,
        entityId,
        scarId: scarDef.id
      }
    ]
  };

  nextState = recordChronicleEvent(nextState, entityId, eventId);

  return nextState;
}
