import type { GameState, PendingRivalry } from '../types/game-state.types.ts';
import { getComponent, addComponent } from '../core/ecs.ts';
import {
  ComponentType,
  type IdentityComponent,
  type NemesisComponent,
  type FighterComponent
} from '../types/components.types.ts';
import {
  GameEventType,
  type GameEvent,
  type NemesisCheatedDeathEvent,
  type NemesisPromotedEvent
} from '../types/events.types.ts';
import { rng } from '../core/rng.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';
import {
  findNemesisComponents,
  updateNemesisComponents,
  removeNemesisEntity,
  findAllNemeses
} from './rivalry/query.ts';
import { resolvePromoteNemesis, resolveApplyScar } from './rivalry/resolve.ts';

export {
  findNemesisComponents,
  updateNemesisComponents,
  removeNemesisEntity,
  findAllNemeses,
  resolvePromoteNemesis,
  resolveApplyScar
};

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
              | IdentityComponent
              | undefined
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
            | IdentityComponent
            | undefined
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

/**
 * Resolves a single pending rivalry, applying various results depending on the rivalry type.
 * @param state The current global game state.
 * @param rivalry The pending rivalry context descriptor.
 * @returns The updated global game state.
 */
function resolveRivalry(state: GameState, rivalry: PendingRivalry): GameState {
  let nextState = state;
  const sourceId = rivalry.sourceEntityId;
  const targetId = rivalry.targetEntityId;

  const sourceComps = findNemesisComponents(nextState, sourceId);
  const targetComps = targetId ? findNemesisComponents(nextState, targetId) : undefined;

  const sourceNemesis = sourceComps?.components[ComponentType.Nemesis] as NemesisComponent | undefined;
  const targetNemesis = targetComps?.components[ComponentType.Nemesis] as NemesisComponent | undefined;

  const sourceName =
    (sourceComps?.components[ComponentType.Identity] as IdentityComponent | undefined)?.name ?? 'A nemesis';
  const targetName = targetComps
    ? ((targetComps.components[ComponentType.Identity] as IdentityComponent | undefined)?.name ?? 'another')
    : '';

  if (!sourceComps || !sourceNemesis || (targetId && (!targetComps || !targetNemesis))) {
    nextState = {
      ...nextState,
      events: [
        ...nextState.events,
        {
          type: GameEventType.RivalryFailed,
          rivalryId: rivalry.id,
          reason: 'One or more participants are dead or no longer nemeses'
        }
      ]
    };
    return addMessage(
      nextState,
      `[SIM-RECEIPT] Rivalry ${rivalry.id} between ${sourceName} and ${targetName} failed because participant(s) died or moved.`,
      MessageLogCategory.System
    );
  }

  if (rivalry.type === 'duel' || rivalry.type === 'betrayal') {
    const sourceFighter = sourceComps.components[ComponentType.Fighter] as FighterComponent | undefined;
    const targetFighter = targetComps!.components[ComponentType.Fighter] as FighterComponent | undefined;

    const sourcePower = (sourceFighter?.attack ?? 5) + (sourceFighter?.defense ?? 2) + (sourceFighter?.level ?? 1);
    const targetPower = (targetFighter?.attack ?? 5) + (targetFighter?.defense ?? 2) + (targetFighter?.level ?? 1);

    const sourceRoll = sourcePower + Math.floor(rng.getUniform() * 10);
    const targetRoll = targetPower + Math.floor(rng.getUniform() * 10);

    const sourceWins = sourceRoll >= targetRoll;
    const winnerId = sourceWins ? sourceId : targetId!;
    const loserId = sourceWins ? targetId! : sourceId;

    const winnerComps = sourceWins ? sourceComps : targetComps!;
    const loserComps = sourceWins ? targetComps! : sourceComps;

    const winnerName = sourceWins ? sourceName : targetName;
    const loserName = sourceWins ? targetName : sourceName;

    const winnerNem = winnerComps.components[ComponentType.Nemesis] as NemesisComponent;
    const loserNem = loserComps.components[ComponentType.Nemesis] as NemesisComponent;

    const outcomeRoll = rng.getUniform();
    let consequence = '';

    if (outcomeRoll < 0.3) {
      // Slay outcome
      nextState = removeNemesisEntity(nextState, loserId);

      const loserSlotKey = `${loserNem.hierarchyId}:${loserNem.rankId}`;
      const nextSlots = { ...nextState.nemesisSlots };
      if (nextSlots[loserSlotKey]) {
        nextSlots[loserSlotKey] = nextSlots[loserSlotKey]!.filter((id) => id !== loserId);
      }
      nextState = {
        ...nextState,
        nemesisSlots: nextSlots,
        events: [
          ...nextState.events,
          {
            type: GameEventType.NemesisVacancy,
            hierarchyId: loserNem.hierarchyId,
            rankId: loserNem.rankId,
            vacatedByEntityId: loserId
          }
        ]
      };

      if (loserNem.tier > winnerNem.tier) {
        nextState = resolvePromoteNemesis(nextState, winnerId, winnerNem.hierarchyId, loserNem.rankId);
        consequence = `${winnerName} slew ${loserName} and claimed their rank of ${loserNem.rankId}!`;
      } else {
        nextState = updateNemesisComponents(nextState, winnerId, (comps) => {
          const fighter = comps[ComponentType.Fighter] as FighterComponent | undefined;
          if (fighter) {
            return {
              ...comps,
              [ComponentType.Fighter]: {
                ...fighter,
                level: fighter.level + 1,
                maxHp: fighter.maxHp + 5,
                hp: fighter.hp + 5,
                attack: fighter.attack + 1
              }
            };
          }
          return comps;
        });
        consequence = `${winnerName} slew ${loserName} in a duel!`;
      }
    } else if (outcomeRoll < 0.7) {
      // Scar and defeat/demote outcome
      const hierarchy = nextState.campaign.nemesisHierarchies[loserNem.hierarchyId];
      const scarDef = hierarchy?.scarPool ? rng.getItem(hierarchy.scarPool) : undefined;
      if (scarDef) {
        nextState = resolveApplyScar(nextState, loserId, scarDef);
      }

      if (loserNem.tier > winnerNem.tier) {
        nextState = resolvePromoteNemesis(nextState, winnerId, winnerNem.hierarchyId, loserNem.rankId);
        nextState = resolvePromoteNemesis(nextState, loserId, loserNem.hierarchyId, winnerNem.rankId);
        consequence = `${winnerName} defeated ${loserName}, scarring them and taking their position!`;
      } else {
        consequence = `${winnerName} defeated ${loserName} in a duel, leaving them scarred.`;
      }
    } else {
      // Grueling draw
      nextState = updateNemesisComponents(nextState, winnerId, (comps) => {
        const fighter = comps[ComponentType.Fighter] as FighterComponent | undefined;
        if (fighter) {
          return {
            ...comps,
            [ComponentType.Fighter]: {
              ...fighter,
              xp: fighter.xp + 100
            }
          };
        }
        return comps;
      });
      consequence = `${winnerName} and ${loserName} fought to a grueling draw.`;
    }

    nextState = {
      ...nextState,
      events: [
        ...nextState.events,
        {
          type: GameEventType.RivalryResolved,
          rivalryId: rivalry.id,
          rivalryType: rivalry.type,
          sourceEntityId: sourceId,
          winnerId,
          loserId,
          consequences: [consequence],
          ...(targetId !== undefined ? { targetEntityId: targetId } : {})
        }
      ]
    };

    return addMessage(nextState, `[SIM-RECEIPT] Rivalry Resolved: ${consequence}`, MessageLogCategory.System);
  } else if (rivalry.type === 'territory_shift') {
    const targetAreaId = rivalry.targetAreaId ?? state.currentAreaId;
    const roll = rng.getUniform() > 0.5 ? 15 : -15;

    const areaEntId = nextState.areaEntityIds[targetAreaId];
    if (areaEntId) {
      const budgetComp = getComponent(nextState, areaEntId, ComponentType.DirectorBudget) as
        | import('../types/components.types.ts').DirectorBudgetComponent
        | undefined;
      if (budgetComp) {
        nextState = addComponent(nextState, areaEntId, {
          ...budgetComp,
          budgetModifier: budgetComp.budgetModifier + roll
        });
      }
    }

    nextState = {
      ...nextState,
      events: [
        ...nextState.events,
        {
          type: GameEventType.RivalryResolved,
          rivalryId: rivalry.id,
          rivalryType: rivalry.type,
          sourceEntityId: sourceId,
          consequences: [`Territory shift in ${targetAreaId} by ${roll} threat points.`],
          ...(targetId !== undefined ? { targetEntityId: targetId } : {})
        }
      ]
    };

    return addMessage(
      nextState,
      `[SIM-RECEIPT] Rivalry Resolved: ${sourceName}'s turf war shifted the balance of power in ${targetAreaId} (threat budget mutated by ${roll}).`,
      MessageLogCategory.System
    );
  } else if (rivalry.type === 'training') {
    nextState = updateNemesisComponents(nextState, sourceId, (comps) => {
      const fighter = comps[ComponentType.Fighter] as FighterComponent | undefined;
      if (fighter) {
        return {
          ...comps,
          [ComponentType.Fighter]: {
            ...fighter,
            attack: fighter.attack + 2,
            defense: fighter.defense + 1
          }
        };
      }
      return comps;
    });

    nextState = {
      ...nextState,
      events: [
        ...nextState.events,
        {
          type: GameEventType.RivalryResolved,
          rivalryId: rivalry.id,
          rivalryType: rivalry.type,
          sourceEntityId: sourceId,
          consequences: [`${sourceName} finished intensive training, increasing attack and defense.`],
          ...(targetId !== undefined ? { targetEntityId: targetId } : {})
        }
      ]
    };

    return addMessage(
      nextState,
      `[SIM-RECEIPT] Rivalry Resolved: ${sourceName} completed intensive training and grew stronger.`,
      MessageLogCategory.System
    );
  }

  return nextState;
}

/**
 * Processes all background rivalries, advancing tick counts and resolving matured struggles.
 * @param state The current global game state.
 * @returns The updated global game state.
 */
export function processRivalries(state: GameState): GameState {
  let nextState = state;
  const globalTurn = nextState.globalTurn || 0;

  // 1. Periodic background generation (every 10 turns)
  if (globalTurn > 0 && globalTurn % 10 === 0) {
    nextState = processRivalryGeneration(nextState);
  }

  // 2. Resolve matured rivalries
  const currentRivalries = [...nextState.pendingRivalries];
  const unresolved: PendingRivalry[] = [];

  for (const rivalry of currentRivalries) {
    if (globalTurn >= rivalry.resolutionTurn) {
      nextState = resolveRivalry(nextState, rivalry);
    } else {
      unresolved.push(rivalry);
    }
  }

  return {
    ...nextState,
    pendingRivalries: unresolved
  };
}
