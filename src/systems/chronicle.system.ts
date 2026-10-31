import { ComponentType, type ChronicleComponent } from '../types/components.types.ts';
import type { GameState, EntityId } from '../types/game-state.types.ts';
import { addComponent, getComponent, promoteEntity } from '../core/ecs.ts';

export { promoteEntity };

/**
 * Records a reference to an important ledger event in an entity's chronicle.
 */
export function recordChronicleEvent(state: GameState, entityId: EntityId, eventId: string): GameState {
  const chronicle = getComponent(state, entityId, ComponentType.Chronicle) as ChronicleComponent | undefined;
  if (!chronicle) return state;

  const nextChronicle: ChronicleComponent = {
    ...chronicle,
    eventExcerpts: [...chronicle.eventExcerpts, eventId]
  };

  return addComponent(state, entityId, nextChronicle);
}
