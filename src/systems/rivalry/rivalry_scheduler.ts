import type { GameState, PendingRivalry } from '../../types/game-state.types.ts';
import { ComponentType, type IdentityComponent, type NemesisComponent } from '../../types/components.types.ts';
import {
  GameEventType,
  type GameEvent,
  type NemesisCheatedDeathEvent,
  type NemesisPromotedEvent
} from '../../types/events.types.ts';
import { rng } from '../../core/rng.ts';
import { addMessage, MessageLogCategory } from '../message.system.ts';
import { findNemesisComponents, findAllNemeses } from './query.ts';

/**
 * Periodically generates background rivalries based on proximity and hierarchies.
 * @param state The current global game state.
 * @returns The updated global game state.
 */
export function processRivalryGeneration(state: GameState): GameState {
  if (state.pendingRivalries.length >= 3) return state;
  if (rng.getUniform() > 0.4) return state;

  const eligible = findAllNemeses(state).filter(
    (n) => !state.pendingRivalries.some((r) => r.sourceEntityId === n.entityId || r.targetEntityId === n.entityId)
  );

  if (eligible.length < 2) return state;

  const source = rng.getItem(eligible)!;

  const targets = eligible.filter((n) => n.entityId !== source.entityId && n.hierarchyId === source.hierarchyId);
  if (targets.length === 0) return state;

  let filteredTargets = targets.filter((n) => Math.abs(n.tier - source.tier) <= 1);
  if (filteredTargets.length === 0) {
    filteredTargets = targets;
  }

  const target = rng.getItem(filteredTargets)!;

  const types: Array<'duel' | 'betrayal' | 'territory_shift' | 'training'> = [
    'duel',
    'betrayal',
    'territory_shift',
    'training'
  ];
  const type = rng.getItem(types)!;

  const delay = Math.floor(rng.getUniform() * 11) + 15;
  const resolutionTurn = state.globalTurn + delay;

  const sourceComps = findNemesisComponents(state, source.entityId);
  const targetAreaId = sourceComps?.components[ComponentType.Position]
    ? state.currentAreaId
    : (state.persistentEntities.get(source.entityId)?.areaId ?? state.currentAreaId);

  const rivalryId = `riv_${state.globalTurn}_${source.entityId}_${target.entityId}`;

  const newRivalry: PendingRivalry = {
    id: rivalryId,
    type,
    sourceEntityId: source.entityId,
    targetEntityId: target.entityId,
    targetAreaId,
    turnCreated: state.globalTurn,
    resolutionTurn
  };

  const nextState: GameState = {
    ...state,
    pendingRivalries: [...state.pendingRivalries, newRivalry],
    events: [
      ...state.events,
      {
        type: GameEventType.RivalryScheduled,
        rivalryId,
        rivalryType: type,
        sourceEntityId: source.entityId,
        targetEntityId: target.entityId,
        resolutionTurn
      }
    ]
  };

  const sourceName =
    (findNemesisComponents(state, source.entityId)?.components[ComponentType.Identity] as IdentityComponent | undefined)
      ?.name ?? 'A nemesis';
  const targetName =
    (findNemesisComponents(state, target.entityId)?.components[ComponentType.Identity] as IdentityComponent | undefined)
      ?.name ?? 'another';

  return addMessage(
    nextState,
    `[SIM-RECEIPT] A background rivalry (${type}) has been scheduled between ${sourceName} and ${targetName} resolving on turn ${resolutionTurn}.`,
    MessageLogCategory.System
  );
}

/**
 * Generates dynamic, reactive rivalries triggered by events like promotional disputes or death cheating.
 * @param state The current global game state.
 * @param event The event context triggering dynamic schedules.
 * @returns The updated global game state.
 */
export function generateEventDrivenRivalry(state: GameState, event: GameEvent): GameState {
  let nextState = state;

  if (event.type === GameEventType.NemesisCheatedDeath) {
    const cheatEvent = event as NemesisCheatedDeathEvent;
    const killerId = cheatEvent.killerId;
    if (killerId && killerId !== cheatEvent.entityId) {
      const killerComps = findNemesisComponents(state, killerId);
      const killerNemesis = killerComps?.components[ComponentType.Nemesis] as NemesisComponent | undefined;
      if (killerNemesis) {
        const rivalryId = `riv_revenge_${state.globalTurn}_${cheatEvent.entityId}_${killerId}`;
        const delay = 10;
        const resolutionTurn = state.globalTurn + delay;
        const rivalry: PendingRivalry = {
          id: rivalryId,
          type: 'duel',
          sourceEntityId: cheatEvent.entityId,
          targetEntityId: killerId,
          targetAreaId: state.currentAreaId,
          turnCreated: state.globalTurn,
          resolutionTurn
        };

        nextState = {
          ...nextState,
          pendingRivalries: [...nextState.pendingRivalries, rivalry],
          events: [
            ...nextState.events,
            {
              type: GameEventType.RivalryScheduled,
              rivalryId,
              rivalryType: 'duel',
              sourceEntityId: cheatEvent.entityId,
              targetEntityId: killerId,
              resolutionTurn
            }
          ]
        };

        const victimName =
          (
            findNemesisComponents(state, cheatEvent.entityId)?.components[ComponentType.Identity] as
              IdentityComponent | undefined
          )?.name ?? 'A nemesis';
        const killerName =
          (killerComps?.components[ComponentType.Identity] as IdentityComponent | undefined)?.name ?? 'their killer';
        nextState = addMessage(
          nextState,
          `[SIM-RECEIPT] Revenge rivalry scheduled: ${victimName} plots vengeance against ${killerName} (resolving on turn ${resolutionTurn}).`,
          MessageLogCategory.System
        );
      }
    }
  } else if (event.type === GameEventType.NemesisPromoted) {
    const promotedEvent = event as NemesisPromotedEvent;
    const promotedId = promotedEvent.entityId;
    const hierarchyId = promotedEvent.hierarchyId;

    const promotedComps = findNemesisComponents(state, promotedId);
    const promotedNemesis = promotedComps?.components[ComponentType.Nemesis] as NemesisComponent | undefined;
    const promotedTier = promotedNemesis?.tier ?? 0;

    const eligible = findAllNemeses(state).filter(
      (n) => n.entityId !== promotedId && n.hierarchyId === hierarchyId && Math.abs(n.tier - promotedTier) <= 1
    );

    if (eligible.length > 0) {
      const jealous = rng.getItem(eligible)!;
      const rivalryId = `riv_succession_${state.globalTurn}_${jealous.entityId}_${promotedId}`;
      const delay = 15;
      const resolutionTurn = state.globalTurn + delay;
      const rivalry: PendingRivalry = {
        id: rivalryId,
        type: 'duel',
        sourceEntityId: jealous.entityId,
        targetEntityId: promotedId,
        targetAreaId: state.currentAreaId,
        turnCreated: state.globalTurn,
        resolutionTurn
      };

      nextState = {
        ...nextState,
        pendingRivalries: [...nextState.pendingRivalries, rivalry],
        events: [
          ...nextState.events,
          {
            type: GameEventType.RivalryScheduled,
            rivalryId,
            rivalryType: 'duel',
            sourceEntityId: jealous.entityId,
            targetEntityId: promotedId,
            resolutionTurn
          }
        ]
      };

      const jealousName =
        (
          findNemesisComponents(state, jealous.entityId)?.components[ComponentType.Identity] as
            IdentityComponent | undefined
        )?.name ?? 'A nemesis';
      const promotedName =
        (findNemesisComponents(state, promotedId)?.components[ComponentType.Identity] as IdentityComponent | undefined)
          ?.name ?? 'the promoted';
      nextState = addMessage(
        nextState,
        `[SIM-RECEIPT] Succession rivalry scheduled: ${jealousName} challenges the newly promoted ${promotedName} (resolving on turn ${resolutionTurn}).`,
        MessageLogCategory.System
      );
    }
  }

  return nextState;
}
