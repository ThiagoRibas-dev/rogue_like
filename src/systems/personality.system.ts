import {
  ComponentType,
  type MemoryComponent,
  type ChronicleComponent,
  type Thought
} from '../types/components.types.ts';
import type { GameState, EntityId } from '../types/game-state.types.ts';
import {
  GameEventType,
  type CoreValueViolatedEvent,
  type EntityDamagedEvent,
  type EntityDiedEvent,
  type ApplyResolvedEvent
} from '../types/events.types.ts';
import { addComponent, getComponent } from '../core/ecs.ts';
import { promoteEntity } from './chronicle.system.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';
import {
  STRESS_CORE_MEMORY_THRESHOLD,
  MAX_TRANSIENT_THOUGHTS,
  FACET_EXTREME_HIGH_THRESHOLD,
  FACET_EXTREME_LOW_THRESHOLD,
  CORE_MEMORY_MUTATION_AMOUNT
} from '../constants/personality.constants.ts';

/**
 * Processes personality shifts, stress accumulation, and core memory promotion.
 * Run at the end of the global pipeline in game-loop.ts.
 */
export function processPersonalitySystem(state: GameState): GameState {
  let nextState = state;

  // 1. Process events into thoughts
  for (const event of nextState.events) {
    if (event.type === GameEventType.EntityDamaged) {
      const e = event as EntityDamagedEvent;
      if (e.sourceEntityId !== undefined && e.amount >= 5) {
        nextState = recordThought(
          nextState,
          e.entityId,
          `Harmed by Entity #${e.sourceEntityId}`,
          e.amount,
          e.sourceEntityId
        );
      }
    } else if (event.type === GameEventType.EntityDied) {
      const e = event as EntityDiedEvent;
      if (e.killerId !== undefined) {
        nextState = recordThought(nextState, e.killerId, `Defeated Entity #${e.victimId}`, -5, e.victimId);
      }
    } else if (event.type === GameEventType.ApplyResolved) {
      const e = event as ApplyResolvedEvent;
      if (e.verb === 'kick' && e.target && typeof e.target === 'object') {
        const targetObj = e.target as { type: string; entityId?: number };
        if (targetObj.type === 'entity' && typeof targetObj.entityId === 'number') {
          nextState = recordThought(
            nextState,
            targetObj.entityId as EntityId,
            `Kicked by Entity #${e.entityId}`,
            15,
            e.entityId
          );
        }
      }
    }
  }

  for (const entityId of nextState.entities) {
    const memory = getComponent(nextState, entityId, ComponentType.Memory);
    if (!memory) continue;

    // 2. Check for Auto-Promotions (Entities with extreme facets, but no identity)
    const identity = getComponent(nextState, entityId, ComponentType.Identity);
    if (!identity && memory.facets) {
      let hasExtreme = false;
      for (const val of Object.values(memory.facets)) {
        if (val >= FACET_EXTREME_HIGH_THRESHOLD || val <= FACET_EXTREME_LOW_THRESHOLD) {
          hasExtreme = true;
          break;
        }
      }

      if (hasExtreme) {
        nextState = promoteEntity(nextState, entityId, 'Emerged from the masses with an extreme personality.');
        const newIdentity = getComponent(nextState, entityId, ComponentType.Identity);
        if (newIdentity) {
          nextState = addMessage(
            nextState,
            `${newIdentity.name} makes themselves known through extreme personality traits.`,
            MessageLogCategory.System
          );
        }
      }
    }

    // 3. Temporary Social State Decay
    const currentMemory = getComponent(nextState, entityId, ComponentType.Memory) as MemoryComponent | undefined;
    if (currentMemory) {
      let annoyedDuration = currentMemory.annoyedDuration ?? 0;
      let gratefulDuration = currentMemory.gratefulDuration ?? 0;
      let changed = false;

      if (annoyedDuration > 0) {
        annoyedDuration--;
        changed = true;
      }
      if (gratefulDuration > 0) {
        gratefulDuration--;
        changed = true;
      }

      let updatedMemory = currentMemory;
      if (changed) {
        updatedMemory = {
          ...currentMemory,
          annoyedDuration,
          gratefulDuration
        };
        nextState = addComponent(nextState, entityId, updatedMemory);
      }

      // 4. Core Memory Promotion
      if (updatedMemory.stress !== undefined && updatedMemory.stress >= STRESS_CORE_MEMORY_THRESHOLD) {
        nextState = promoteToCoreMemory(nextState, entityId);
      }
    }
  }

  return nextState;
}

/**
 * Public API to record a thought and accumulate stress on an entity.
 */
export function recordThought(
  state: GameState,
  entityId: EntityId,
  eventSummary: string,
  stressDelta: number,
  relatedEntityId?: EntityId
): GameState {
  const memory = getComponent(state, entityId, ComponentType.Memory);
  if (!memory) return state;

  const currentThoughts = memory.thoughts ? [...memory.thoughts] : [];

  const newThought: Thought = {
    turn: state.globalTurn || 0,
    eventSummary,
    stressDelta,
    relatedEntityId
  };

  currentThoughts.push(newThought);

  // TODO: Implement a ranking system for Thoughts to decide which ones are kept vs discarded when approaching the cap, prioritizing thoughts with the highest stressDelta.
  if (currentThoughts.length > MAX_TRANSIENT_THOUGHTS) {
    currentThoughts.sort((a, b) => Math.abs(b.stressDelta) - Math.abs(a.stressDelta));
    currentThoughts.length = MAX_TRANSIENT_THOUGHTS;
  }

  const nextStress = Math.max(0, (memory.stress || 0) + stressDelta);

  const nextMemory: MemoryComponent = {
    ...memory,
    thoughts: currentThoughts,
    stress: nextStress
  };

  let nextState = state;

  if (memory.values) {
    for (const valueName of Object.keys(memory.values)) {
      if (eventSummary.toLowerCase().includes(valueName.toLowerCase()) && Math.abs(stressDelta) > 5) {
        nextState = {
          ...nextState,
          events: [
            ...nextState.events,
            {
              type: GameEventType.CoreValueViolated,
              entityId,
              eventSummary
            } as CoreValueViolatedEvent
          ]
        };
        break;
      }
    }
  }

  return addComponent(nextState, entityId, nextMemory);
}

function promoteToCoreMemory(state: GameState, entityId: EntityId): GameState {
  let nextState = state;
  const memory = getComponent(nextState, entityId, ComponentType.Memory);
  if (!memory || !memory.thoughts || memory.thoughts.length === 0) return nextState;

  // Find the thought with highest stress impact
  const coreThought = [...memory.thoughts].sort((a, b) => Math.abs(b.stressDelta) - Math.abs(a.stressDelta))[0];
  if (!coreThought) return nextState;

  // If entity not promoted, promote them now since they formed a core memory
  const identity = getComponent(nextState, entityId, ComponentType.Identity);
  if (!identity) {
    nextState = promoteEntity(nextState, entityId, 'A traumatic or defining event forced them to forge an identity.');
  }

  const chronicle = getComponent(nextState, entityId, ComponentType.Chronicle);
  if (chronicle) {
    const nextChronicle: ChronicleComponent = {
      ...chronicle,
      coreMemories: [...chronicle.coreMemories, coreThought.eventSummary]
    };
    nextState = addComponent(nextState, entityId, nextChronicle);

    const identityStr = identity ? identity.name : 'An entity';
    nextState = addMessage(nextState, `${identityStr} internalizes a core memory.`, MessageLogCategory.System);
  }

  // Mutate a facet permanently based on the core memory
  const nextFacets = memory.facets ? { ...memory.facets } : undefined;
  if (nextFacets) {
    const facetKeys = Object.keys(nextFacets);
    if (facetKeys.length > 0) {
      // Pick the first facet for now to mutate. We can expand this logic later.
      const facetToMutate = facetKeys[0]!;
      const mutationAmount = coreThought.stressDelta > 0 ? CORE_MEMORY_MUTATION_AMOUNT : -CORE_MEMORY_MUTATION_AMOUNT;
      nextFacets[facetToMutate] = Math.max(0, Math.min(100, nextFacets[facetToMutate]! + mutationAmount));
    }
  }

  // Reset stress and clear the promoted thought
  const remainingThoughts = memory.thoughts.filter((t) => t !== coreThought);
  const nextMemory: MemoryComponent = {
    ...memory,
    stress: 0, // Relieve stress after core memory
    thoughts: remainingThoughts,
    facets: nextFacets
  };

  return addComponent(nextState, entityId, nextMemory);
}
