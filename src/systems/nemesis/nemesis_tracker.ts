import { VACANCY_FILL_DELAY } from '../../constants/nemesis.constants.ts';
import { addComponent, getComponent } from '../../core/ecs.ts';
import { rng } from '../../core/rng.ts';
import { addActor } from '../../core/scheduler.ts';
import {
  ComponentType,
  type ActorComponent,
  type ChronicleComponent,
  type Component,
  type FactionComponent,
  type IdentityComponent,
  type InteractionScoreComponent,
  type NemesisComponent,
  type PositionComponent
} from '../../types/components.types.ts';
import { GameEventType, type EntityDamagedEvent, type EntityDiedEvent } from '../../types/events.types.ts';
import { type EntityId, type GameState } from '../../types/game-state.types.ts';
import { coordToIndex } from '../../utils/grid.ts';
import { recordChronicleEvent } from '../chronicle.system.ts';
import { addMessage, MessageLogCategory } from '../message.system.ts';
import { fillVacancy } from './nemesis_hierarchy.ts';

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

    for (const [entityId, increment] of affectedEntities.entries()) {
      const chronicle = getComponent(nextState, entityId, ComponentType.Chronicle) as ChronicleComponent | undefined;
      if (chronicle) {
        nextState = addComponent(nextState, entityId, {
          ...chronicle,
          pis: chronicle.pis + increment
        });
      }

      const faction = getComponent(nextState, entityId, ComponentType.Faction) as FactionComponent | undefined;
      if (faction) {
        const factionEntId = nextState.factionEntityIds[faction.factionId];
        if (factionEntId) {
          const piComp = getComponent(nextState, factionEntId, ComponentType.InteractionScore) as
            InteractionScoreComponent | undefined;
          if (piComp) {
            nextState = addComponent(nextState, factionEntId, { ...piComp, score: piComp.score + increment });
          }
        }
      }

      const currentAreaEntId = nextState.areaEntityIds[nextState.currentAreaId];
      if (currentAreaEntId) {
        const areaPiComp = getComponent(nextState, currentAreaEntId, ComponentType.InteractionScore) as
          InteractionScoreComponent | undefined;
        if (areaPiComp) {
          nextState = addComponent(nextState, currentAreaEntId, { ...areaPiComp, score: areaPiComp.score + increment });
        }
      }
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
            if (tile && nextState.campaign.tiles[tile.tileId]?.walkable && !occupiedCoords.has(`${rx},${ry}`)) {
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
