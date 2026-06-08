import { ComponentType } from '../types/components.types.ts';
import { type GameState, type EntityId, UIMode } from '../types/game-state.types.ts';
import { getComponent, removeEntity } from '../core/ecs.ts';
import { removeActor } from '../core/scheduler.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';
import { deleteSave } from '../core/save.ts';

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
      if (isPlayer) {
        nextState = addMessage(nextState, 'You triggered a trap!', MessageLogCategory.System);
      }

      // Hardcoded flat damage for now to ensure stability
      const fighter = getComponent(nextState, entityId, ComponentType.Fighter);
      if (fighter) {
        const damage = 10;
        const newHp = Math.max(0, fighter.hp - damage);
        const nextFighter = { ...fighter, hp: newHp };

        const finalComps = new Map(nextState.components);
        const entityComps = finalComps.get(entityId) ?? [];
        finalComps.set(
          entityId,
          entityComps.map((c) => (c.type === ComponentType.Fighter ? nextFighter : c))
        );
        nextState = { ...nextState, components: finalComps };

        const targetName = isPlayer ? 'You' : 'Something';
        nextState = addMessage(
          nextState,
          `${targetName} takes ${damage} damage from the trap!`,
          MessageLogCategory.CombatHit
        );

        if (newHp === 0) {
          nextState = addMessage(nextState, `${targetName} dies from the trap!`, MessageLogCategory.CombatDeath);
          if (isPlayer) {
            nextState = addMessage(nextState, `Game Over! You were killed by a trap.`, MessageLogCategory.CombatDeath);
            nextState = { ...nextState, isGameOver: true, uiMode: UIMode.GameOver };
            deleteSave();
          } else {
            nextState = removeEntity(nextState, entityId);
            removeActor(entityId);
          }
        }
      }
    }
  }

  return nextState;
}
