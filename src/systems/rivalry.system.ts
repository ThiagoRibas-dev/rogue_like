import type { GameState, EntityId, PendingRivalry } from '../types/game-state.types.ts';
import {
  ComponentType,
  type Component,
  type NemesisComponent,
  type FighterComponent,
  type IdentityComponent,
  type ChronicleComponent,
  type PositionComponent,
  type TraitsComponent
} from '../types/components.types.ts';
import {
  GameEventType,
  type GameEvent,
  type NemesisCheatedDeathEvent,
  type NemesisPromotedEvent
} from '../types/events.types.ts';
import { getComponent, updateSpatialIndex } from '../core/ecs.ts';
import { rng } from '../core/rng.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';
import type { ScarDefinition } from '../types/campaign.types.ts';

interface NemesisInfo {
  readonly entityId: EntityId;
  readonly hierarchyId: string;
  readonly rankId: string;
  readonly tier: number;
}

/**
 * Searches active entities, persistent limbo, and inactive area data to locate the components of a given entity.
 */
export function findNemesisComponents(
  state: GameState,
  entityId: EntityId
):
  | {
      readonly location: 'active' | 'persistent' | 'area';
      readonly areaId?: string;
      readonly components: Record<string, Component>;
    }
  | undefined {
  // 1. Check active entities
  const activeComps = state.components.get(entityId);
  if (activeComps) {
    return { location: 'active', components: activeComps };
  }

  // 2. Check persistent entities
  const persistentRecord = state.persistentEntities.get(entityId);
  if (persistentRecord) {
    return { location: 'persistent', components: persistentRecord.components };
  }

  // 3. Check areas
  for (const [areaId, areaData] of state.areas.entries()) {
    const areaComps = areaData.components.get(entityId);
    if (areaComps) {
      return { location: 'area', areaId, components: areaComps };
    }
  }

  return undefined;
}

/**
 * Updates the components of an entity wherever it resides in the game state.
 */
export function updateNemesisComponents(
  state: GameState,
  entityId: EntityId,
  updater: (components: Record<string, Component>) => Record<string, Component>
): GameState {
  // 1. Check active entities
  if (state.components.has(entityId)) {
    const activeComps = state.components.get(entityId) ?? {};
    const nextComps = new Map(state.components);
    nextComps.set(entityId, updater(activeComps));
    return {
      ...state,
      components: nextComps
    };
  }

  // 2. Check persistent entities
  if (state.persistentEntities.has(entityId)) {
    const record = state.persistentEntities.get(entityId)!;
    const nextPersistent = new Map(state.persistentEntities);
    nextPersistent.set(entityId, {
      ...record,
      components: updater(record.components)
    });
    return {
      ...state,
      persistentEntities: nextPersistent
    };
  }

  // 3. Check areas
  for (const [areaId, areaData] of state.areas.entries()) {
    if (areaData.components.has(entityId)) {
      const areaComps = areaData.components.get(entityId) ?? {};
      const nextAreaComponents = new Map(areaData.components);
      nextAreaComponents.set(entityId, updater(areaComps));

      const nextAreas = new Map(state.areas);
      nextAreas.set(areaId, {
        ...areaData,
        components: nextAreaComponents
      });
      return {
        ...state,
        areas: nextAreas
      };
    }
  }

  return state;
}

/**
 * Removes an entity completely from the game state (active entities, persistent registry, or inactive floors).
 */
export function removeNemesisEntity(state: GameState, entityId: EntityId): GameState {
  let nextState = state;

  // 1. Remove from active entities
  if (nextState.entities.includes(entityId)) {
    nextState = {
      ...nextState,
      entities: nextState.entities.filter((id) => id !== entityId)
    };
    const nextComponents = new Map(nextState.components);
    nextComponents.delete(entityId);
    nextState = {
      ...nextState,
      components: nextComponents
    };
    nextState = updateSpatialIndex(nextState);
  }

  // 2. Remove from persistent entities
  if (nextState.persistentEntities.has(entityId)) {
    const nextPersistent = new Map(nextState.persistentEntities);
    nextPersistent.delete(entityId);
    nextState = {
      ...nextState,
      persistentEntities: nextPersistent
    };
  }

  // 3. Remove from other areas
  let modifiedArea = false;
  const nextAreas = new Map(nextState.areas);
  for (const [areaId, areaData] of nextState.areas.entries()) {
    if (areaData.entities.includes(entityId)) {
      const nextAreaEntities = areaData.entities.filter((id) => id !== entityId);
      const nextAreaComponents = new Map(areaData.components);
      nextAreaComponents.delete(entityId);

      const nextSpatialIndex = new Map<string, EntityId[]>();
      for (const id of nextAreaEntities) {
        const pos = nextAreaComponents.get(id)?.[ComponentType.Position] as PositionComponent | undefined;
        if (pos) {
          const key = `${pos.x},${pos.y}`;
          let arr = nextSpatialIndex.get(key);
          if (!arr) {
            arr = [];
            nextSpatialIndex.set(key, arr);
          }
          arr.push(id);
        }
      }

      nextAreas.set(areaId, {
        ...areaData,
        entities: nextAreaEntities,
        components: nextAreaComponents,
        spatialIndex: nextSpatialIndex
      });
      modifiedArea = true;
    }
  }

  if (modifiedArea) {
    nextState = {
      ...nextState,
      areas: nextAreas
    };
  }

  return nextState;
}

/**
 * Finds all nemeses registered in the global game state across active, persistent, and inactive areas.
 */
export function findAllNemeses(state: GameState): ReadonlyArray<NemesisInfo> {
  const result: NemesisInfo[] = [];

  // 1. Check active entities
  for (const entityId of state.entities) {
    const nemesis = getComponent(state, entityId, ComponentType.Nemesis);
    if (nemesis) {
      result.push({
        entityId,
        hierarchyId: nemesis.hierarchyId,
        rankId: nemesis.rankId,
        tier: nemesis.tier
      });
    }
  }

  // 2. Check persistent entities
  for (const [entityId, record] of state.persistentEntities.entries()) {
    const nemesis = record.components[ComponentType.Nemesis] as NemesisComponent | undefined;
    if (nemesis) {
      result.push({
        entityId,
        hierarchyId: nemesis.hierarchyId,
        rankId: nemesis.rankId,
        tier: nemesis.tier
      });
    }
  }

  // 3. Check saved areas
  for (const areaData of state.areas.values()) {
    for (const entityId of areaData.entities) {
      const comps = areaData.components.get(entityId);
      const nemesis = comps?.[ComponentType.Nemesis] as NemesisComponent | undefined;
      if (nemesis) {
        result.push({
          entityId,
          hierarchyId: nemesis.hierarchyId,
          rankId: nemesis.rankId,
          tier: nemesis.tier
        });
      }
    }
  }

  return result;
}

/**
 * Promotes a nemesis in the hierarchy rank offscreen, adjusting its stats and updating the slot registry.
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
  const promotionEvent = {
    turn: state.globalTurn || 0,
    type: 'Promotion',
    summary
  };

  if (chronicle) {
    nextChronicle = {
      ...chronicle,
      eventExcerpts: [...chronicle.eventExcerpts, promotionEvent]
    };
  } else {
    nextChronicle = {
      type: ComponentType.Chronicle,
      pis: 1,
      scars: [],
      coreMemories: [],
      eventExcerpts: [promotionEvent]
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
 */
export function resolveApplyScar(state: GameState, entityId: EntityId, scarDef: ScarDefinition): GameState {
  let nextState = state;

  nextState = updateNemesisComponents(nextState, entityId, (comps) => {
    const nextComps = { ...comps };

    const chronicle = comps[ComponentType.Chronicle] as ChronicleComponent | undefined;
    if (chronicle) {
      const nextScars = [...chronicle.scars];
      if (nextScars.length < 5) {
        nextScars.push(scarDef.description);
      }
      const scarEvent = {
        turn: state.globalTurn || 0,
        type: 'Scarred',
        summary: `Gained scar: ${scarDef.description}`
      };
      nextComps[ComponentType.Chronicle] = {
        ...chronicle,
        scars: nextScars,
        eventExcerpts: [...chronicle.eventExcerpts, scarEvent]
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
        type: GameEventType.NemesisScarred,
        entityId,
        scarId: scarDef.id
      }
    ]
  };

  return nextState;
}

/**
 * Periodically generates background rivalries based on proximity and hierarchies.
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
    const currentMutation = nextState.areaMutations[targetAreaId] || { addedTags: [], budgetModifier: 0 };
    const roll = rng.getUniform() > 0.5 ? 15 : -15;

    const nextMutations = {
      ...nextState.areaMutations,
      [targetAreaId]: {
        ...currentMutation,
        budgetModifier: currentMutation.budgetModifier + roll
      }
    };

    nextState = {
      ...nextState,
      areaMutations: nextMutations,
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
