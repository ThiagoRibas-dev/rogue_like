import type { GameState, EntityId } from '../../types/game-state.types.ts';
import {
  ComponentType,
  type Component,
  type NemesisComponent,
  type FighterComponent,
  type IdentityComponent,
  type ChronicleComponent,
  type TraitsComponent
} from '../../types/components.types.ts';
import { GameEventType } from '../../types/events.types.ts';
import { rng } from '../../core/rng.ts';
import { addMessage, MessageLogCategory } from '../message.system.ts';
import type { ScarDefinition } from '../../types/campaign.types.ts';
import { findNemesisComponents, updateNemesisComponents } from './query.ts';

/**
 * Promotes a nemesis in the hierarchy rank offscreen, adjusting its stats and updating the slot registry.
 * @param state The current global game state.
 * @param entityId The ID of the target entity.
 * @param hierarchyId The ID of the target hierarchy.
 * @param newRankId The rank ID to promote into.
 * @returns The updated global game state.
 */
export function resolvePromoteNemesis(
  state: GameState,
  entityId: EntityId,
  hierarchyId: string,
  newRankId: string
): GameState {
  const nemesisComps = findNemesisComponents(state, entityId);
  if (!nemesisComps) return state;

  let nextState = state;
  const hierarchy = state.campaign.nemesisHierarchies[hierarchyId];
  if (!hierarchy) return state;

  const rank = hierarchy.ranks.find((r) => r.rankId === newRankId);
  if (!rank) return state;

  const oldNemesis = nemesisComps.components[ComponentType.Nemesis] as NemesisComponent | undefined;

  const nemesisCmp: NemesisComponent = {
    type: ComponentType.Nemesis,
    hierarchyId,
    rankId: newRankId,
    tier: rank.tier,
    cheatedDeathCount: oldNemesis ? oldNemesis.cheatedDeathCount : 0,
    lastDeathTurn: oldNemesis ? oldNemesis.lastDeathTurn : 0,
    returnDelay: oldNemesis?.returnDelay,
    targetAreaId: oldNemesis?.targetAreaId
  };

  const fighter = nemesisComps.components[ComponentType.Fighter] as FighterComponent | undefined;
  let nextFighter: FighterComponent | undefined;
  if (fighter && rank.statMultipliers) {
    nextFighter = {
      ...fighter,
      maxHp: Math.round(fighter.maxHp * (rank.statMultipliers.maxHp ?? 1.0)),
      hp: Math.round(fighter.hp * (rank.statMultipliers.maxHp ?? 1.0)),
      attack: Math.round(fighter.attack * (rank.statMultipliers.attack ?? 1.0)),
      defense: Math.round(fighter.defense * (rank.statMultipliers.defense ?? 1.0)),
      xpGiven: Math.round(fighter.xpGiven * (rank.statMultipliers.xpGiven ?? 1.0))
    };
  }

  const identity = nemesisComps.components[ComponentType.Identity] as IdentityComponent | undefined;
  let nextIdentity = identity;
  let chosenTitle = identity?.title;
  if (identity && rank.titlePool && rank.titlePool.length > 0) {
    chosenTitle = rng.getItem(rank.titlePool) ?? identity.title;
    nextIdentity = {
      ...identity,
      title: chosenTitle
    };
  }

  const chronicle = nemesisComps.components[ComponentType.Chronicle] as ChronicleComponent | undefined;
  let nextChronicle = chronicle;
  const name = identity ? identity.name : 'Someone';
  const rankDisplayName = rank.displayName;
  const summary = `Promoted to ${rankDisplayName}${chosenTitle ? ` (${chosenTitle})` : ''}.`;
  const eventId = `evt_${state.globalTurn}_promo_${Math.floor(rng.getUniform() * 10000)}`;

  if (chronicle) {
    nextChronicle = {
      ...chronicle,
      eventExcerpts: [...chronicle.eventExcerpts, eventId]
    };
  } else {
    nextChronicle = {
      type: ComponentType.Chronicle,
      pis: 1,
      scars: [],
      coreMemories: [],
      eventExcerpts: [eventId]
    };
  }

  nextState = updateNemesisComponents(nextState, entityId, (comps) => {
    const nextComps: Record<string, Component> = {
      ...comps,
      [ComponentType.Nemesis]: nemesisCmp,
      [ComponentType.Chronicle]: nextChronicle,
      [ComponentType.Persistent]: { type: ComponentType.Persistent }
    };
    if (nextFighter) nextComps[ComponentType.Fighter] = nextFighter;
    if (nextIdentity) nextComps[ComponentType.Identity] = nextIdentity;
    return nextComps;
  });

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

  nextState = addMessage(nextState, `${name} has been promoted to ${rankDisplayName}!`, MessageLogCategory.System);
  nextState = {
    ...nextState,
    events: [
      ...nextState.events,
      {
        id: eventId,
        importance: 'high',
        summary,
        type: GameEventType.NemesisPromoted,
        entityId,
        hierarchyId,
        newRankId,
        previousRankId: oldNemesis?.rankId
      }
    ]
  };

  return nextState;
}

/**
 * Applies a scar to an entity wherever it resides in the game state.
 * @param state The current global game state.
 * @param entityId The ID of the target entity.
 * @param scarDef The scar definition mapping properties to apply.
 * @returns The updated global game state.
 */
export function resolveApplyScar(state: GameState, entityId: EntityId, scarDef: ScarDefinition): GameState {
  let nextState = state;

  const eventId = `evt_${state.globalTurn}_scar_${Math.floor(rng.getUniform() * 10000)}`;

  nextState = updateNemesisComponents(nextState, entityId, (comps) => {
    const nextComps = { ...comps };

    const chronicle = comps[ComponentType.Chronicle] as ChronicleComponent | undefined;
    if (chronicle) {
      const nextScars = [...chronicle.scars];
      if (nextScars.length < 5) {
        nextScars.push(scarDef.description);
      }
      nextComps[ComponentType.Chronicle] = {
        ...chronicle,
        scars: nextScars,
        eventExcerpts: [...chronicle.eventExcerpts, eventId]
      };
    }

    const fighter = comps[ComponentType.Fighter] as FighterComponent | undefined;
    if (fighter && scarDef.statModifiers) {
      nextComps[ComponentType.Fighter] = {
        ...fighter,
        maxHp: Math.max(1, fighter.maxHp + (scarDef.statModifiers.maxHp ?? 0)),
        hp: Math.max(1, fighter.hp + (scarDef.statModifiers.maxHp ?? 0)),
        attack: Math.max(1, fighter.attack + (scarDef.statModifiers.attack ?? 0)),
        defense: Math.max(0, fighter.defense + (scarDef.statModifiers.defense ?? 0))
      };
    }

    const traitsCmp = comps[ComponentType.Traits] as TraitsComponent | undefined;
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
      nextComps[ComponentType.Traits] = {
        ...traitsCmp,
        traits: nextTraits
      };
    }

    return nextComps;
  });

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

  return nextState;
}
