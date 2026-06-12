import { ComponentType } from '../types/components.types.ts';
import { type GameState, type EntityId } from '../types/game-state.types.ts';
import { getComponent } from '../core/ecs.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';

/**
 * Checks if the entity stepped on any triggers (like traps) and applies their effects.
 *
 * @param state The current GameState.
 * @param entityId The entity that moved.
 * @returns The updated GameState.
 */
export function processTriggers(state: GameState, entityId: EntityId): GameState {
  const pos = getComponent(state, entityId, ComponentType.Position);
  if (!pos) return state;

  const targetKey = `${pos.x},${pos.y}`;
  const entitiesAtNewTarget = state.spatialIndex.get(targetKey) || [];

  let nextState = state;

  for (const id of entitiesAtNewTarget) {
    if (id === entityId) continue;

    const trap = getComponent(nextState, id, ComponentType.Trap);
    if (trap && !trap.triggered) {
      // Trigger it!
      const nextTrap = { ...trap, triggered: true };

      const newCompsMap = new Map(nextState.components);
      const trapComps = newCompsMap.get(id) ?? [];

      // Update TrapComponent to triggered
      newCompsMap.set(
        id,
        trapComps.map((c) => (c.type === ComponentType.Trap ? nextTrap : c))
      );

      // Add a RenderableComponent so the trap becomes visible (or update existing)
      const renderCmp = newCompsMap.get(id)?.find((c) => c.type === ComponentType.Renderable);
      if (!renderCmp) {
        newCompsMap.set(id, [
          ...(newCompsMap.get(id) ?? []),
          { type: ComponentType.Renderable, glyph: '^', fg: '#e74c3c', bg: 'transparent' }
        ]);
      }

      nextState = { ...nextState, components: newCompsMap };

      const isPlayer = getComponent(nextState, entityId, ComponentType.Player) !== undefined;
      const fighter = getComponent(nextState, entityId, ComponentType.Fighter);
      if (fighter) {
        const damage = 10;

        const targetName = isPlayer ? 'You' : 'Something';
        nextState = addMessage(
          nextState,
          `${targetName} triggered a trap for ${damage} damage!`,
          MessageLogCategory.CombatHit
        );

        // Attach DamageComponent to leverage the unified combat pipeline
        const existingDamageComp = newCompsMap.get(entityId)?.find((c) => c.type === ComponentType.Damage) as
          | import('../types/components.types.ts').DamageComponent
          | undefined;

        const damageInstance: import('../types/components.types.ts').DamageInstance = {
          amount: damage,
          sourceEntityId: id, // The trap entity is the source
          tags: ['trap', 'physical']
        };

        const targetComps = newCompsMap.get(entityId) ?? [];
        if (existingDamageComp) {
          const newDamageComp = {
            ...existingDamageComp,
            instances: [...existingDamageComp.instances, damageInstance]
          };
          newCompsMap.set(
            entityId,
            targetComps.map((c) => (c.type === ComponentType.Damage ? newDamageComp : c))
          );
        } else {
          const newDamageComp: import('../types/components.types.ts').DamageComponent = {
            type: ComponentType.Damage,
            instances: [damageInstance]
          };
          newCompsMap.set(entityId, [...targetComps, newDamageComp]);
        }
        nextState = { ...nextState, components: newCompsMap };
      }
    }
  }

  return nextState;
}
