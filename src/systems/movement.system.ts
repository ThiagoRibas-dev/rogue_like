import { ComponentType, type PositionComponent, type Component } from '../types/components.types.ts';
import type { GameState, EntityId } from '../types/game-state.types.ts';
import { getComponent, updateSpatialIndex } from '../core/ecs.ts';
import { TILE_REGISTRY } from '../constants/tile.constants.ts';
import { coordToIndex, isInBounds } from '../utils/grid.ts';
import type { MoveIntent } from '../types/intents.types.ts';
import { IntentType } from '../types/intents.types.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';
import { processMeleeAttackIntent } from './combat.system.ts';
import { isHostile } from '../utils/faction.ts';
import { UIMode } from '../types/game-state.types.ts';
import { deleteSave } from '../core/save.ts';
import { removeEntity } from '../core/ecs.ts';
import { removeActor } from '../core/scheduler.ts';

/**
 * Processes a MoveIntent.
 * Checks for collision against walls and entities using the spatial index.
 * Returns updated GameState if movement was successful, or the original GameState (plus a message) if blocked.
 * @param state The current GameState.
 * @param intent The MoveIntent to process.
 * @returns The new or original GameState.
 */
export function processMoveIntent(state: GameState, intent: MoveIntent): GameState {
  const { entityId, dx, dy } = intent;

  const position = getComponent(state, entityId, ComponentType.Position);
  if (position === undefined) {
    return state;
  }

  const targetX: number = position.x + dx;
  const targetY: number = position.y + dy;

  if (!isInBounds(targetX, targetY, state.map.width, state.map.height)) {
    return state;
  }

  const targetTileIndex: number = coordToIndex(targetX, targetY, state.map.width);
  const targetTile = state.map.tiles[targetTileIndex];
  if (targetTile === undefined) {
    return state;
  }

  // 1. Wall Collision
  const tileDef = TILE_REGISTRY[targetTile.tileId];
  if (tileDef === undefined || !tileDef.walkable) {
    const isPlayer = getComponent(state, entityId, ComponentType.Player) !== undefined;
    if (targetTile.tileId === 'closed_door') {
      // Bump to open door
      const nextTiles = [...state.map.tiles];
      nextTiles[targetTileIndex] = { ...targetTile, tileId: 'open_door' };
      const nextMap = { ...state.map, tiles: nextTiles };
      let nextState: GameState = { ...state, map: nextMap };
      if (isPlayer) {
        nextState = addMessage(nextState, 'You open the door.', MessageLogCategory.System);
      }
      return nextState;
    }

    if (isPlayer) {
      return addMessage(state, 'Ouch! You bumped into a wall.', MessageLogCategory.CombatHit);
    }
    return state;
  }

  // 2. Entity Collision
  const targetKey = `${targetX},${targetY}`;
  const entitiesAtTarget = state.spatialIndex.get(targetKey);
  if (entitiesAtTarget !== undefined && entitiesAtTarget.length > 0) {
    let defenderId: EntityId | undefined;
    let isBlocked = false;

    for (const id of entitiesAtTarget) {
      if (getComponent(state, id, ComponentType.Fighter) !== undefined) {
        if (isHostile(state, entityId, id)) {
          defenderId = id;
          isBlocked = true;
          break;
        } else {
          isBlocked = true;
        }
      } else if (getComponent(state, id, ComponentType.Actor) !== undefined) {
        isBlocked = true;
      }
    }

    if (defenderId !== undefined) {
      return processMeleeAttackIntent(state, {
        type: IntentType.MeleeAttack,
        entityId,
        defenderId
      });
    }

    if (isBlocked) {
      const isPlayer = getComponent(state, entityId, ComponentType.Player) !== undefined;
      if (isPlayer) {
        return addMessage(state, 'Something is in the way.', MessageLogCategory.CombatHit);
      }
      return state;
    }
  }

  // 3. Apply Movement
  const nextPosition: PositionComponent = {
    type: ComponentType.Position,
    x: targetX,
    y: targetY
  };

  const entityComponents: ReadonlyArray<Component> | undefined = state.components.get(entityId);
  if (entityComponents === undefined) {
    return state;
  }

  const nextEntityComponents: ReadonlyArray<Component> = entityComponents.map((c: Component) =>
    c.type === ComponentType.Position ? nextPosition : c
  );

  const nextComponents: Map<EntityId, ReadonlyArray<Component>> = new Map(state.components);
  nextComponents.set(entityId, nextEntityComponents);

  let nextState: GameState = {
    ...state,
    components: nextComponents
  };

  // 4. Trap Check
  const entitiesAtNewTarget = nextState.spatialIndex.get(targetKey) || [];
  for (const id of entitiesAtNewTarget) {
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

      // We need to import and apply the trap's effect, or we can just apply damage here for MVP
      // Let's use applyItemEffect since traps act like items in our plan
      // Wait, applyItemEffect is in effects.system.ts.
      // Instead of an import cycle, we can just do flat damage for the trap for now.
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

  // Rebuild spatial index since a position changed
  return updateSpatialIndex(nextState);
}
