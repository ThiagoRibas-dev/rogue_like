import type { GameState, PendingRivalry } from '../types/game-state.types.ts';
import { getComponent, addComponent } from '../core/ecs.ts';
import {
  ComponentType,
  type DirectorBudgetComponent,
  type IdentityComponent,
  type NemesisComponent,
  type FighterComponent
} from '../types/components.types.ts';
import { GameEventType } from '../types/events.types.ts';
import { rng } from '../core/rng.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';
import {
  findNemesisComponents,
  updateNemesisComponents,
  removeNemesisEntity,
  findAllNemeses
} from './rivalry/query.ts';
import { resolvePromoteNemesis, resolveApplyScar } from './rivalry/resolve.ts';
import { processRivalryGeneration, generateEventDrivenRivalry } from './rivalry/rivalry_scheduler.ts';

export {
  findNemesisComponents,
  updateNemesisComponents,
  removeNemesisEntity,
  findAllNemeses,
  resolvePromoteNemesis,
  resolveApplyScar,
  processRivalryGeneration,
  generateEventDrivenRivalry
};

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
        DirectorBudgetComponent | undefined;
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

  if (globalTurn > 0 && globalTurn % 10 === 0) {
    nextState = processRivalryGeneration(nextState);
  }

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
