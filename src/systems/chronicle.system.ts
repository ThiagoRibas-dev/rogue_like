import {
  ComponentType,
  type ChronicleComponent,
  type IdentityComponent,
  type ChronicleEvent
} from '../types/components.types.ts';
import type { GameState, EntityId } from '../types/game-state.types.ts';
import { addComponent, getComponent } from '../core/ecs.ts';
import { rng } from '../core/rng.ts';

/**
 * Promotes a generic entity to a named, persistent entity.
 * Generates an identity, creates a chronicle, and marks them persistent.
 *
 * Note: The generation table is looked up in `state.campaign.identityGeneration`
 * using the strict naming convention `{templateId}_identity`.
 */
export function promoteEntity(state: GameState, entityId: EntityId, reason: string): GameState {
  if (getComponent(state, entityId, ComponentType.Chronicle)) {
    return state; // Already promoted
  }

  let nextState = state;
  const templateCmp = getComponent(state, entityId, ComponentType.Template);
  const templateId = templateCmp ? templateCmp.templateId : 'orc';

  // Try to find a matching identity table
  const identityKey = `${templateId}_identity`;
  let table = state.campaign.identityGeneration[identityKey];
  if (!table) {
    const keys = Object.keys(state.campaign.identityGeneration);
    if (keys.length > 0) {
      table = state.campaign.identityGeneration[keys[0]!]!;
    }
  }

  const name = table && table.firstNames.length > 0 ? (rng.getItem(table.firstNames) ?? 'Gruk') : 'Gruk';
  const title = table && table.titles.length > 0 ? (rng.getItem(table.titles) ?? 'the Unknown') : 'the Unknown';
  const mannerism =
    table && table.mannerisms.length > 0 ? (rng.getItem(table.mannerisms) ?? 'stares blankly') : 'stares blankly';
  const color = table && table.colors && table.colors.length > 0 ? rng.getItem(table.colors) : undefined;

  const identity: IdentityComponent = {
    type: ComponentType.Identity,
    name,
    title,
    mannerisms: [mannerism],
    colorOverride: color ?? undefined
  };

  nextState = addComponent(nextState, entityId, identity);

  const initialEvent: ChronicleEvent = {
    turn: 0, // TODO: Implement global turn counter in GameState
    type: 'Promotion',
    summary: reason
  };

  const chronicle: ChronicleComponent = {
    type: ComponentType.Chronicle,
    pis: 1, // Start with some player interaction score
    scars: [],
    coreMemories: [],
    eventExcerpts: [initialEvent]
  };

  nextState = addComponent(nextState, entityId, chronicle);

  // Attach PersistentComponent so they survive area transitions
  nextState = addComponent(nextState, entityId, { type: ComponentType.Persistent });

  return nextState;
}

/**
 * Records a new event in an entity's chronicle.
 */
export function recordChronicleEvent(
  state: GameState,
  entityId: EntityId,
  eventType: string,
  summary: string,
  relatedEntityIds?: EntityId[]
): GameState {
  const chronicle = getComponent(state, entityId, ComponentType.Chronicle) as ChronicleComponent | undefined;
  if (!chronicle) return state;

  const newEvent: ChronicleEvent = {
    turn: 0, // TODO: Implement global turn counter in GameState
    type: eventType,
    summary,
    relatedEntityIds
  };

  const nextChronicle: ChronicleComponent = {
    ...chronicle,
    eventExcerpts: [...chronicle.eventExcerpts, newEvent]
  };

  return addComponent(state, entityId, nextChronicle);
}
