import { type GameState } from '../types/game-state.types.ts';
import {
  ComponentType,
  type Component,
  type MemoryComponent,
  type TagsComponent,
  type FactionComponent,
  type TemplateComponent
} from '../types/components.types.ts';
import { getComponent, addComponent } from '../core/ecs.ts';
import {
  GameEventType,
  type GameEvent,
  type EntityDiedEvent,
  type SchemeAdvancedEvent,
  type RivalryScheduledEvent,
  type RivalryResolvedEvent
} from '../types/events.types.ts';
import type { PendingKnowledgePropagation } from '../types/knowledge.types.ts';
import type { KnowledgePropagationRule } from '../types/campaign.types.ts';
import { DEFAULT_KNOWLEDGE_PROPAGATION_DELAY, MAX_PENDING_KNOWLEDGE_QUEUE } from '../constants/knowledge.constants.ts';

/**
 * Helper to check if two areas are connected in the campaign configuration.
 * @param state The current GameState.
 * @param areaA First area ID.
 * @param areaB Second area ID.
 * @returns True if the areas are identical or directly connected.
 */
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

/**
 * Helper to format string placeholders (replacing {eventId} with the actual event ID).
 * @param str The template string.
 * @param eventId The event ID string.
 * @returns The formatted string.
 */
function formatString(str: string, eventId: string): string {
  return str.replace(/{eventId}/g, eventId);
}

/**
 * Helper to determine event ID placeholder replacement from a GameEvent.
 * @param event The GameEvent.
 * @param state The GameState.
 * @returns A string representing the event's unique context.
 */
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
    default:
      return 'generic_event';
  }
}

/**
 * Helper to find the source area of a GameEvent.
 * @param event The GameEvent.
 * @param state The GameState.
 * @returns The area ID where the event originated.
 */
function getEventSourceArea(event: GameEvent, state: GameState): string {
  switch (event.type) {
    case GameEventType.EntityDied:
      return state.currentAreaId;
    case GameEventType.SchemeAdvanced: {
      const advEvent = event as SchemeAdvancedEvent;
      return advEvent.targetAreaId ?? state.currentAreaId;
    }
    default:
      return state.currentAreaId;
  }
}

/**
 * Helper to check NPC eligibility against a knowledge propagation rule.
 * @param state The current GameState.
 * @param components The NPC's ECS components.
 * @param rule The rule definitions.
 * @param sourceAreaId The source area ID where the event occurred.
 * @param npcAreaId The area ID where the NPC is currently located.
 * @returns True if eligible.
 */
function isNPCEligible(
  state: GameState,
  components: Readonly<Record<string, Component>>,
  rule: KnowledgePropagationRule,
  sourceAreaId: string,
  npcAreaId: string
): boolean {
  if (!components[ComponentType.Memory]) return false;

  // Proximity
  if (rule.requireAreaProximity && !areAreasConnected(state, sourceAreaId, npcAreaId)) {
    return false;
  }

  // Factions
  if (rule.eligibleFactions && rule.eligibleFactions.length > 0) {
    const faction = components[ComponentType.Faction] as FactionComponent | undefined;
    if (!faction || !rule.eligibleFactions.includes(faction.factionId)) return false;
  }

  // Tags
  if (rule.eligibleTags && rule.eligibleTags.length > 0) {
    const tagsComp = components[ComponentType.Tags] as TagsComponent | undefined;
    if (!tagsComp) return false;
    const hasAllTags = rule.eligibleTags.every((tag) => tagsComp.tags.includes(tag));
    if (!hasAllTags) return false;
  }

  return true;
}

/**
 * Checks if a pending item is fully delivered to all areas containing Memory NPCs.
 * @param state The GameState.
 * @param item The pending knowledge item.
 * @returns True if no eligible areas are left.
 */
function isItemFullyDelivered(state: GameState, item: PendingKnowledgePropagation): boolean {
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
 * Scans events in GameState and registers pending knowledge propagation entries.
 * @param state The current GameState.
 * @returns Updated GameState with newly registered pending items.
 */
export function processKnowledgePropagationEvents(state: GameState): GameState {
  const rules = state.campaign.knowledgePropagation;
  if (!rules || rules.length === 0) return state;

  const nextPending = [...state.pendingKnowledge];

  for (const event of state.events) {
    const matchingRules = rules.filter((r) => r.eventType === event.type);
    for (const rule of matchingRules) {
      if (nextPending.length >= MAX_PENDING_KNOWLEDGE_QUEUE) {
        console.warn(`[KnowledgeSystem] Pending knowledge queue full, skipping propagation for rule ${rule.id}`);
        break;
      }

      const eventId = getEventIdPlaceholder(event, state);
      const resolvedId = formatString(rule.knowledgeTemplate.id, eventId);
      const resolvedDescription = formatString(rule.knowledgeTemplate.description, eventId);

      // Avoid adding duplicate pending items with same resolved ID
      if (nextPending.some((p) => p.knowledgeItem.id === resolvedId)) {
        continue;
      }

      const sourceAreaId = getEventSourceArea(event, state);
      const delay = rule.delay !== undefined ? rule.delay : DEFAULT_KNOWLEDGE_PROPAGATION_DELAY;

      const pendingItem: PendingKnowledgePropagation = {
        ruleId: rule.id,
        knowledgeItem: {
          id: resolvedId,
          type: rule.knowledgeTemplate.type,
          description: resolvedDescription,
          tags: rule.knowledgeTemplate.tags
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
    pendingKnowledge: nextPending
  };
}

/**
 * Distributes expired pending knowledge items to eligible NPCs in a specific area.
 * Called when ticking or loading an area.
 * @param state The current GameState.
 * @param areaId The area to deliver to.
 * @returns Updated GameState.
 */
export function deliverPendingKnowledgeToArea(state: GameState, areaId: string): GameState {
  let nextState = state;
  const expiredItems = nextState.pendingKnowledge.filter((item) => item.remainingDelay <= 0);
  if (expiredItems.length === 0) return nextState;

  const rules = nextState.campaign.knowledgePropagation;
  const nextPending = [...nextState.pendingKnowledge];

  let modified = false;

  for (let i = 0; i < nextPending.length; i++) {
    const item = nextPending[i]!;
    if (item.remainingDelay > 0) continue;
    if (item.deliveredAreas.includes(areaId)) continue;

    const rule = rules.find((r) => r.id === item.ruleId);
    if (!rule) continue;

    // We only deliver to the active areaId if it matches areaId.
    if (areaId === nextState.currentAreaId) {
      for (const entityId of nextState.entities) {
        const comps = nextState.components.get(entityId);
        if (!comps) continue;

        if (isNPCEligible(nextState, comps, rule, item.sourceAreaId, areaId)) {
          const memory = comps[ComponentType.Memory] as MemoryComponent | undefined;
          if (memory && !memory.knowledge[item.knowledgeItem.id]) {
            const nextKnowledge = {
              ...memory.knowledge,
              [item.knowledgeItem.id]: item.knowledgeItem
            };
            nextState = addComponent(nextState, entityId, {
              ...memory,
              knowledge: nextKnowledge
            });
            modified = true;
          }
        }
      }
    }

    // Update item deliveredAreas
    nextPending[i] = {
      ...item,
      deliveredAreas: [...item.deliveredAreas, areaId]
    };
    modified = true;
  }

  if (!modified) return nextState;

  // Filter out items that are fully delivered
  const filteredPending = nextPending.filter((item) => !isItemFullyDelivered(nextState, item));

  return {
    ...nextState,
    pendingKnowledge: filteredPending
  };
}

/**
 * Ticks down delays on pending knowledge items and triggers distribution.
 * @param state The current GameState.
 * @returns Updated GameState.
 */
export function tickPendingKnowledge(state: GameState): GameState {
  if (state.pendingKnowledge.length === 0) return state;

  const tickedPending = state.pendingKnowledge.map((item) => {
    if (item.remainingDelay > 0) {
      return { ...item, remainingDelay: item.remainingDelay - 1 };
    }
    return item;
  });

  const nextState = {
    ...state,
    pendingKnowledge: tickedPending
  };

  return deliverPendingKnowledgeToArea(nextState, nextState.currentAreaId);
}
