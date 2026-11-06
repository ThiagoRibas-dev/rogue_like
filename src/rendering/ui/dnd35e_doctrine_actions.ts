/**
 * @file Tactical Doctrine Bar and Combat Maneuver Actions (Milestone 118).
 * Pure state updates for Power Attack, Combat Expertise, Fighting Defensively,
 * Total Defense, Grip Mode, and Special Combat Maneuvers.
 */

import { addComponent, getComponent } from '../../core/ecs.ts';
import { setGameState } from '../../core/game-loop.ts';
import { markDomainDirty, PresentationDomain } from '../../core/presentation_queue.ts';
import { ComponentType, type TacticalDoctrineComponent, type WeaponGripMode } from '../../types/components.types.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';

/**
 * Updates an actor's TacticalDoctrineComponent settings.
 *
 * @param state The current GameState.
 * @param entityId Target entity ID.
 * @param updates Partial updates to merge into TacticalDoctrineComponent.
 * @returns Updated GameState.
 */
export function updateActorTacticalDoctrine(
  state: GameState,
  entityId: EntityId,
  updates: Partial<Omit<TacticalDoctrineComponent, 'type'>>
): GameState {
  const current = (getComponent(state, entityId, ComponentType.TacticalDoctrine) as
    TacticalDoctrineComponent | undefined) ?? {
    type: ComponentType.TacticalDoctrine,
    powerAttackAmount: 0,
    combatExpertiseAmount: 0,
    fightingDefensively: false,
    totalDefense: false,
    gripMode: 'one_handed' as WeaponGripMode
  };

  const nextComp: TacticalDoctrineComponent = {
    ...current,
    ...updates,
    type: ComponentType.TacticalDoctrine
  };

  return addComponent(state, entityId, nextComp);
}

/**
 * Dispatches an immediate state update to change tactical doctrine and marks presentation dirty.
 *
 * @param state The current GameState.
 * @param entityId Target actor ID.
 * @param updates Partial updates.
 */
export function applyDoctrineUpdate(
  state: GameState,
  entityId: EntityId,
  updates: Partial<Omit<TacticalDoctrineComponent, 'type'>>
): void {
  const next = updateActorTacticalDoctrine(state, entityId, updates);
  setGameState(next);
  markDomainDirty(PresentationDomain.HUD);
  markDomainDirty(PresentationDomain.Modals);
}
