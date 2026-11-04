import {
  ComponentType,
  type InventoryComponent,
  type EquipmentComponent,
  type ShopComponent,
  type ControllerLinkComponent,
  type PropertyOverlayComponent,
  type ResourcePoolComponent,
  type ResourcePoolEntry,
  type ResourceRefreshCycle
} from '../../types/components.types.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';
import { addComponent, getComponent, removeComponent, removeEntity, updateSpatialIndex } from './ecs_core.ts';

/**
 * Recursively collects a root entity ID and all owned child entity IDs
 * referenced in Inventory, Equipment, and Shop components.
 *
 * @param state The current game state.
 * @param rootEntityId The ID of the root entity to inspect.
 * @returns An array containing the root entity ID and all recursively owned entity IDs.
 */
export function collectOwnedEntityIds(state: GameState, rootEntityId: EntityId): ReadonlyArray<EntityId> {
  const visited = new Set<EntityId>();
  const queue: EntityId[] = [rootEntityId];

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (currentId === undefined || visited.has(currentId)) continue;
    visited.add(currentId);

    const inv = getComponent(state, currentId, ComponentType.Inventory) as InventoryComponent | undefined;
    if (inv) {
      for (const itemId of inv.items) {
        if (!visited.has(itemId)) queue.push(itemId);
      }
    }

    const equip = getComponent(state, currentId, ComponentType.Equipment) as EquipmentComponent | undefined;
    if (equip) {
      for (const slot of equip.slots) {
        if (slot.equippedItem !== null && !visited.has(slot.equippedItem)) {
          queue.push(slot.equippedItem);
        }
      }
    }

    const shop = getComponent(state, currentId, ComponentType.Shop) as ShopComponent | undefined;
    if (shop) {
      for (const itemId of shop.inventory) {
        if (!visited.has(itemId)) queue.push(itemId);
      }
    }

    // Traverse companion, minion, and summon links where currentId is the controller
    for (const candidateId of state.entities) {
      if (visited.has(candidateId)) continue;
      const link = getComponent(state, candidateId, ComponentType.ControllerLink) as
        ControllerLinkComponent | undefined;
      if (link && link.controllerEntityId === currentId) {
        queue.push(candidateId);
      }
    }
  }

  return Array.from(visited);
}

/**
 * Ticks duration counters on PropertyOverlayComponents and manages expiration of ControllerLinkComponents.
 * If an overlay expires (durationTurns <= 0), it is removed and any suppressed equipment slots are restored.
 * If a temporary summon controller link expires or its controller entity no longer exists, the summon entity is despawned.
 *
 * @param state The current game state.
 * @returns The updated game state.
 */
export function tickControllerLinksAndOverlays(state: GameState): GameState {
  let nextState = state;

  for (const entityId of nextState.entities) {
    // Tick property overlay
    const overlay = getComponent(nextState, entityId, ComponentType.PropertyOverlay) as
      PropertyOverlayComponent | undefined;
    if (overlay && overlay.durationTurns !== undefined) {
      const nextDuration = overlay.durationTurns - 1;
      if (nextDuration <= 0) {
        nextState = removeComponent(nextState, entityId, ComponentType.PropertyOverlay);
        // Restore any equipment slots that were melded/suppressed by the overlay
        const equipCmp = getComponent(nextState, entityId, ComponentType.Equipment) as EquipmentComponent | undefined;
        if (equipCmp && equipCmp.slots.some((s) => s.suppressed === true)) {
          const restoredSlots = equipCmp.slots.map((slot) => {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { suppressed, ...rest } = slot;
            return rest;
          });
          nextState = addComponent(nextState, entityId, {
            ...equipCmp,
            slots: restoredSlots
          });
        }
      } else {
        nextState = addComponent(nextState, entityId, {
          ...overlay,
          durationTurns: nextDuration
        });
      }
    }

    // Check controller link expiration
    const link = getComponent(nextState, entityId, ComponentType.ControllerLink) as ControllerLinkComponent | undefined;
    if (link) {
      const controllerExists = nextState.entities.includes(link.controllerEntityId);
      const isExpired = link.expirationTurn !== undefined && nextState.globalTurn >= link.expirationTurn;
      if ((!controllerExists || isExpired) && link.relationship === 'summon') {
        nextState = removeEntity(nextState, entityId);
      }
    }
  }

  return nextState;
}

/**
 * Consumes charges from a named resource pool on an entity's ResourcePoolComponent.
 *
 * @param state Current GameState.
 * @param entityId Target entity ID.
 * @param poolId Resource pool identifier (e.g. 'rage', 'turn_undead', 'wild_shape', 'ki').
 * @param amount Number of charges to expend (default 1).
 * @returns Object with allowed flag and updated GameState.
 */
export function consumeResourcePool(
  state: GameState,
  entityId: EntityId,
  poolId: string,
  amount = 1
): { readonly allowed: boolean; readonly state: GameState } {
  const poolComp = getComponent(state, entityId, ComponentType.ResourcePool) as ResourcePoolComponent | undefined;
  const entry = poolComp?.pools[poolId];
  if (!poolComp || !entry || entry.current < amount) {
    return { allowed: false, state };
  }

  const nextState = addComponent(state, entityId, {
    ...poolComp,
    pools: {
      ...poolComp.pools,
      [poolId]: {
        ...entry,
        current: entry.current - amount
      }
    }
  });

  return { allowed: true, state: nextState };
}

/**
 * Refreshes all resource pools on an entity matching the specified refresh cycle
 * (or where `resetOnRest === true` when cycle is `'rest_8h'`).
 *
 * @param state Current GameState.
 * @param entityId Target entity ID.
 * @param cycle Refresh cycle trigger ('round' | 'encounter' | 'short_rest' | 'rest_8h').
 * @returns Updated GameState.
 */
export function refreshResourcePools(state: GameState, entityId: EntityId, cycle: ResourceRefreshCycle): GameState {
  const poolComp = getComponent(state, entityId, ComponentType.ResourcePool) as ResourcePoolComponent | undefined;
  if (!poolComp) return state;

  const nextPools: Record<string, ResourcePoolEntry> = {};
  let changed = false;

  for (const [poolId, entry] of Object.entries(poolComp.pools)) {
    const matchesCycle = entry.refreshCycle === cycle || (cycle === 'rest_8h' && entry.resetOnRest === true);
    if (matchesCycle && entry.current !== entry.max) {
      nextPools[poolId] = { ...entry, current: entry.max };
      changed = true;
    } else {
      nextPools[poolId] = entry;
    }
  }

  if (!changed) return state;
  return addComponent(state, entityId, {
    ...poolComp,
    pools: nextPools
  });
}

/**
 * Recursively moves an entity and all entities it owns (inventory, equipment, shop) into persistent storage (Limbo).
 * @param state The current game state.
 * @param rootEntityId The ID of the root entity to move.
 * @param targetAreaId The area ID to associate with the persistent records.
 * @returns The updated game state.
 */
export function moveToLimbo(state: GameState, rootEntityId: EntityId, targetAreaId: string): GameState {
  const nextState = state;
  const toMove = new Set<EntityId>(collectOwnedEntityIds(state, rootEntityId));

  const nextActiveEntities = nextState.entities.filter((id) => !toMove.has(id));
  const nextActiveComponents = new Map(nextState.components);
  const nextPersistent = new Map(nextState.persistentEntities);

  for (const id of toMove) {
    const comps = nextActiveComponents.get(id);
    if (comps) {
      nextPersistent.set(id, { areaId: targetAreaId, components: comps });
      nextActiveComponents.delete(id);
    }
  }

  return updateSpatialIndex({
    ...nextState,
    entities: nextActiveEntities,
    components: nextActiveComponents,
    persistentEntities: nextPersistent
  });
}
