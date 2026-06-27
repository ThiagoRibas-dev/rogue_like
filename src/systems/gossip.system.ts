import { DEFAULT_KNOWLEDGE_PROPAGATION_DELAY, MAX_PENDING_KNOWLEDGE_QUEUE } from '../constants/knowledge.constants.ts';
import { addComponent, getComponent } from '../core/ecs.ts';
import type { RumorPropagationRule } from '../types/campaign.types.ts';
import {
  ComponentType,
  type Component,
  type FactionComponent,
  type MemoryComponent,
  type TagsComponent,
  type TemplateComponent,
  type KnowledgeItem
} from '../types/components.types.ts';
import {
  GameEventType,
  type GameEvent,
  type EntityDiedEvent,
  type SchemeAdvancedEvent,
  type RivalryScheduledEvent,
  type RivalryResolvedEvent,
  type AreaRespawnedEvent
} from '../types/events.types.ts';
import { type GameState } from '../types/game-state.types.ts';
import type { PendingRumorPropagation } from '../types/knowledge.types.ts';

function areAreasConnected(state: GameState, areaA: string, areaB: string): boolean {
  if (areaA === areaB) return true;
  const defA = state.campaign.areas[areaA];
  if (defA?.connections) {
    for (const conn of defA.connections) {
      if (conn.targetAreaId === areaB) return true;
    }
  }
  const defB = state.campaign.areas[areaB];
  if (defB?.connections) {
    for (const conn of defB.connections) {
      if (conn.targetAreaId === areaA) return true;
    }
  }
  return false;
}

function formatString(str: string, eventId: string): string {
  return str.replace(/{eventId}/g, eventId);
}

function getEventIdPlaceholder(event: GameEvent, state: GameState): string {
  switch (event.type) {
    case GameEventType.EntityDied: {
      const dieEvent = event as EntityDiedEvent;
      const template = getComponent(state, dieEvent.victimId, ComponentType.Template) as TemplateComponent | undefined;
      return template?.templateId ?? dieEvent.victimId.toString();
    }
    case GameEventType.SchemeAdvanced: {
      const advEvent = event as SchemeAdvancedEvent;
      return `${advEvent.schemeId}_${advEvent.newPhase}`;
    }
    case GameEventType.RivalryScheduled: {
      const scheduledEvent = event as RivalryScheduledEvent;
      return scheduledEvent.rivalryId;
    }
    case GameEventType.RivalryResolved: {
      const resolvedEvent = event as RivalryResolvedEvent;
      return resolvedEvent.rivalryId;
    }
    case GameEventType.AreaRespawned: {
      const respawnEvent = event as AreaRespawnedEvent;
      return respawnEvent.areaId;
    }
    default:
      return 'generic_event';
  }
}

function getEventSourceArea(event: GameEvent, state: GameState): string {
  switch (event.type) {
    case GameEventType.EntityDied:
      return state.currentAreaId;
    case GameEventType.SchemeAdvanced: {
      const advEvent = event as SchemeAdvancedEvent;
      return advEvent.targetAreaId ?? state.currentAreaId;
    }
    case GameEventType.AreaRespawned: {
      const respawnEvent = event as AreaRespawnedEvent;
      return respawnEvent.areaId;
    }
    default:
      return state.currentAreaId;
  }
}

function isNPCEligible(
  state: GameState,
  components: Readonly<Record<string, Component>>,
  rule: RumorPropagationRule,
  sourceAreaId: string,
  npcAreaId: string
): boolean {
  if (!components[ComponentType.Memory]) return false;

  if (rule.requireAreaProximity && !areAreasConnected(state, sourceAreaId, npcAreaId)) {
    return false;
  }

  if (rule.eligibleFactions && rule.eligibleFactions.length > 0) {
    const faction = components[ComponentType.Faction] as FactionComponent | undefined;
    if (!faction || !rule.eligibleFactions.includes(faction.factionId)) return false;
  }

  if (rule.eligibleTags && rule.eligibleTags.length > 0) {
    const tagsComp = components[ComponentType.Tags] as TagsComponent | undefined;
    if (!tagsComp) return false;
    const hasAllTags = rule.eligibleTags.every((tag) => tagsComp.tags.includes(tag));
    if (!hasAllTags) return false;
  }

  return true;
}

function isItemFullyDelivered(state: GameState, item: PendingRumorPropagation): boolean {
  const campaignAreaIds = Object.keys(state.campaign.areas);
  return campaignAreaIds.every((areaId) => {
    if (item.deliveredAreas.includes(areaId)) return true;

    if (areaId === state.currentAreaId) {
      let activeHasMemory = false;
      for (const entityId of state.entities) {
        if (state.components.get(entityId)?.[ComponentType.Memory]) {
          activeHasMemory = true;
          break;
        }
      }
      return !activeHasMemory;
    }

    const areaData = state.areas.get(areaId);
    if (!areaData) return true;

    let sleepingHasMemory = false;
    for (const entityId of areaData.entities) {
      if (areaData.components.get(entityId)?.[ComponentType.Memory]) {
        sleepingHasMemory = true;
        break;
      }
    }
    return !sleepingHasMemory;
  });
}

/**
 * Processes queued events to generate matching rumors for delayed propagation.
 */
export function processRumorPropagationEvents(state: GameState): GameState {
  const rules = state.campaign.rumorPropagation;
  if (!rules || rules.length === 0) return state;

  const nextPending = [...state.pendingRumors];

  for (const event of state.events) {
    const matchingRules = rules.filter((r) => r.eventType === event.type);
    for (const rule of matchingRules) {
      if (nextPending.length >= MAX_PENDING_KNOWLEDGE_QUEUE) {
        break;
      }

      const eventId = getEventIdPlaceholder(event, state);
      const resolvedId = formatString(rule.rumorTemplate.id, eventId);
      const resolvedText = formatString(rule.rumorTemplate.text, eventId);

      // Avoid adding duplicate pending items with same resolved ID
      if (nextPending.some((p) => p.rumorItem.id === resolvedId)) {
        continue;
      }

      const sourceAreaId = getEventSourceArea(event, state);
      const delay = rule.delay !== undefined ? rule.delay : DEFAULT_KNOWLEDGE_PROPAGATION_DELAY;

      const pendingItem: PendingRumorPropagation = {
        ruleId: rule.id,
        rumorItem: {
          id: resolvedId,
          text: resolvedText,
          persistent: rule.rumorTemplate.persistent,
          sourceEventId: eventId
        },
        sourceAreaId,
        remainingDelay: delay,
        deliveredAreas: []
      };

      nextPending.push(pendingItem);
    }
  }

  return {
    ...state,
    pendingRumors: nextPending
  };
}

/**
 * Moves pending rumors to the rumor pools of eligible NPCs in the target area.
 */
export function deliverPendingRumorsToArea(state: GameState, areaId: string): GameState {
  let nextState = state;
  const expiredItems = nextState.pendingRumors.filter((item) => item.remainingDelay <= 0);
  if (expiredItems.length === 0) return nextState;

  const rules = nextState.campaign.rumorPropagation;
  const nextPending = [...nextState.pendingRumors];

  let modified = false;

  for (let i = 0; i < nextPending.length; i++) {
    const item = nextPending[i]!;
    if (item.remainingDelay > 0) continue;
    if (item.deliveredAreas.includes(areaId)) continue;

    const rule = rules.find((r) => r.id === item.ruleId);
    if (!rule) continue;

    if (areaId === nextState.currentAreaId) {
      for (const entityId of nextState.entities) {
        const comps = nextState.components.get(entityId);
        if (!comps) continue;

        if (isNPCEligible(nextState, comps, rule, item.sourceAreaId, areaId)) {
          const memory = comps[ComponentType.Memory] as MemoryComponent | undefined;
          if (memory) {
            const currentPool = memory.rumorPool || [];
            if (!currentPool.some((r) => r.id === item.rumorItem.id)) {
              const newRumor = {
                ...item.rumorItem,
                turnCreated: 0 // We don't have a global turn counter yet
              };
              nextState = addComponent(nextState, entityId, {
                ...memory,
                rumorPool: [...currentPool, newRumor]
              });
              modified = true;
            }
          }
        }
      }
    }

    nextPending[i] = {
      ...item,
      deliveredAreas: [...item.deliveredAreas, areaId]
    };
    modified = true;
  }

  if (!modified) return nextState;

  const filteredPending = nextPending.filter((item) => !isItemFullyDelivered(nextState, item));

  return {
    ...nextState,
    pendingRumors: filteredPending
  };
}

/**
 * Ticks the turn timers of pending rumors and executes propagation deliveries.
 */
export function tickPendingRumors(state: GameState): GameState {
  if (state.pendingRumors.length === 0) return state;

  const tickedPending = state.pendingRumors.map((item) => {
    if (item.remainingDelay > 0) {
      return { ...item, remainingDelay: item.remainingDelay - 1 };
    }
    return item;
  });

  const nextState = {
    ...state,
    pendingRumors: tickedPending
  };

  return deliverPendingRumorsToArea(nextState, nextState.currentAreaId);
}

/**
 * Sweeps active rumor lists on NPCs to discard stale or resolved rumor events.
 */
export function cullStaleAndConfirmedRumors(state: GameState): GameState {
  // Find the player's knowledge
  let playerKnowledge: Record<string, KnowledgeItem> = {};
  for (const entityId of state.entities) {
    if (getComponent(state, entityId, ComponentType.Player)) {
      const memory = getComponent(state, entityId, ComponentType.Memory) as MemoryComponent | undefined;
      if (memory) {
        playerKnowledge = memory.knowledge;
      }
      break;
    }
  }

  let nextState = state;

  for (const entityId of nextState.entities) {
    const memory = getComponent(nextState, entityId, ComponentType.Memory) as MemoryComponent | undefined;
    if (memory && memory.rumorPool && memory.rumorPool.length > 0) {
      let changed = false;
      const newPool = memory.rumorPool.filter((rumor) => {
        // 1. Check if confirmed true by player
        // Wait, if the rumor id matches a knowledge id, or if the rumor's sourceEventId matches a knowledge id
        const knownItem =
          playerKnowledge[rumor.id] || (rumor.sourceEventId ? playerKnowledge[rumor.sourceEventId] : undefined);
        const isConfirmed = knownItem && knownItem.type !== 'rumor';

        if (isConfirmed) {
          changed = true;
          return false;
        }

        // 2. Check if stale (skipping for now since no turn counter)
        // if (!rumor.persistent && (globalTurn - rumor.turnCreated) > RUMOR_STALE_THRESHOLD) {
        //   changed = true;
        //   return false;
        // }

        return true;
      });

      if (changed) {
        nextState = addComponent(nextState, entityId, {
          ...memory,
          rumorPool: newPool
        });
      }
    }
  }

  return nextState;
}
