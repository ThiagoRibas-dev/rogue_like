import {
  CHEAT_DEATH_BASE_CHANCE,
  CHEAT_DEATH_ENTITY_COOLDOWN,
  CHEAT_DEATH_GLOBAL_COOLDOWN,
  CHEAT_DEATH_RETURN_DELAY_MAX,
  CHEAT_DEATH_RETURN_DELAY_MIN,
  MAX_SCARS_PER_ENTITY,
  PIS_CHEAT_DEATH_THRESHOLD,
  DRAMATIC_PAUSE_DURATION_MS
} from '../../constants/nemesis.constants.ts';
import { addComponent, getComponent, moveToLimbo, updateSpatialIndex } from '../../core/ecs.ts';
import { rng } from '../../core/rng.ts';
import { removeActor, setTurnDuration } from '../../core/scheduler.ts';
import { getSettings } from '../../core/settings.ts';
import { type ScarDefinition } from '../../types/campaign.types.ts';
import {
  ComponentType,
  type ChronicleComponent,
  type Component,
  type FighterComponent,
  type IdentityComponent,
  type NemesisComponent,
  type TraitsComponent
} from '../../types/components.types.ts';
import { GameEventType } from '../../types/events.types.ts';
import { type EntityId, type GameState } from '../../types/game-state.types.ts';
import { recordChronicleEvent } from '../chronicle.system.ts';
import { addMessage, MessageLogCategory } from '../message.system.ts';
import { generateEventDrivenRivalry } from '../rivalry.system.ts';
import { getEntityBarks } from './nemesis_presentation.ts';

export { promoteNemesis, fillVacancy } from './nemesis_hierarchy.ts';

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

  const tempComponents = new Map(nextState.components);
  tempComponents.set(entityId, cleanComps);
  nextState = { ...nextState, components: tempComponents };

  nextState = moveToLimbo(nextState, entityId, targetAreaId);
  removeActor(entityId);

  nextState = {
    ...nextState,
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
