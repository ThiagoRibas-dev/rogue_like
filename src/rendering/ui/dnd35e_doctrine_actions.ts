/**
 * @file Tactical Doctrine Bar and Combat Maneuver Actions (Milestone 118).
 * Pure state updates for Power Attack, Combat Expertise, Fighting Defensively,
 * Total Defense, Grip Mode, and declarative Class/Feat Stance Toggles.
 */

import { addComponent, getComponent } from '../../core/ecs.ts';
import { queuePlayerIntent, setGameState } from '../../core/game-loop.ts';
import { markAllDomainsDirty, markDomainDirty, PresentationDomain } from '../../core/presentation_queue.ts';
import { canToggleTwoHandedGrip } from '../../rulesets/dnd35e/equipment_physics.ts';
import { SHAPESHIFT_STANCE_GROUP_ID } from '../../rulesets/dnd35e/shapeshift.ts';
import { getDnD35EntityData } from '../../rulesets/dnd35e/srd_registry.ts';
import {
  type DnD35ActivatedAbilityDescriptor,
  getDnD35SystemContent,
  getLastLoadedDnD35SystemContent
} from '../../rulesets/dnd35e/types/dnd35e_system.types.ts';
import { toggleConsoleStanceGroup } from '../../systems/stance.system.ts';
import { ComponentType, type TacticalDoctrineComponent, type WeaponGripMode } from '../../types/components.types.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';
import { IntentType } from '../../types/intents/intent.enum.ts';
import type { UIStanceModeEntry } from '../../types/ui_adapter.types.ts';

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

function findActorActivatedAbilityDescriptor(
  state: GameState,
  entityId: EntityId,
  abilityId: string
): DnD35ActivatedAbilityDescriptor | undefined {
  const sys = getDnD35SystemContent(state.campaign) ?? getLastLoadedDnD35SystemContent();
  if (!sys) return undefined;
  const dndData = getDnD35EntityData(state, entityId);
  for (const track of dndData.tracks ?? []) {
    const cls = sys.classes[track.trackId];
    if (!cls) continue;
    for (const detail of Object.values(cls.featureDetails ?? {})) {
      const match = (detail.activatedAbilities ?? []).find((a) => a.abilityId === abilityId);
      if (match) return match;
    }
  }
  return undefined;
}

/**
 * Single Source of Truth for toggling baseline combat stances, declarative class doctrine toggles,
 * form-overlay abilities (e.g. Druid Shapeshift), and mutually exclusive stance groups.
 *
 * @param state Current GameState.
 * @param playerId Target player entity ID.
 * @param stanceId Selected stance or activated ability ID.
 * @param stanceModes Optional projected stance modes from the UI adapter.
 */
export function toggleDnD35eActorStance(
  state: GameState,
  playerId: EntityId,
  stanceId: string,
  stanceModes: ReadonlyArray<UIStanceModeEntry> = []
): void {
  const docComp = getComponent(state, playerId, ComponentType.TacticalDoctrine) as
    TacticalDoctrineComponent | undefined;
  const currentPA = docComp?.powerAttackAmount ?? 0;
  const currentCE = docComp?.combatExpertiseAmount ?? 0;
  const currentFD = docComp?.fightingDefensively ?? false;
  const currentTD = docComp?.totalDefense ?? false;
  const currentGrip = docComp?.gripMode ?? 'one_handed';

  if (stanceId === 'power_attack') {
    applyDoctrineUpdate(state, playerId, { powerAttackAmount: currentPA > 0 ? 0 : 1 });
    return;
  }
  if (stanceId === 'combat_expertise') {
    applyDoctrineUpdate(state, playerId, { combatExpertiseAmount: currentCE > 0 ? 0 : 1 });
    return;
  }
  if (stanceId === 'fighting_defensively') {
    const nextFD = !currentFD;
    applyDoctrineUpdate(state, playerId, {
      fightingDefensively: nextFD,
      totalDefense: nextFD ? false : currentTD
    });
    return;
  }
  if (stanceId === 'total_defense') {
    const nextTD = !currentTD;
    applyDoctrineUpdate(state, playerId, {
      totalDefense: nextTD,
      fightingDefensively: nextTD ? false : currentFD,
      ...(nextTD ? { decisiveStrike: false } : {})
    });
    return;
  }
  if (stanceId === 'two_handed_grip') {
    if (!canToggleTwoHandedGrip(state, playerId)) return;
    applyDoctrineUpdate(state, playerId, {
      gripMode: currentGrip === 'two_handed' ? 'one_handed' : 'two_handed'
    });
    return;
  }

  const matchingMode = stanceModes.find((m) => m.id === stanceId);
  const abilityDesc = findActorActivatedAbilityDescriptor(state, playerId, stanceId);

  if (
    abilityDesc?.formOverlay !== undefined ||
    abilityDesc?.toggleGroup === SHAPESHIFT_STANCE_GROUP_ID ||
    matchingMode?.groupId === SHAPESHIFT_STANCE_GROUP_ID
  ) {
    queuePlayerIntent({
      type: IntentType.UseAbility,
      entityId: playerId,
      effectId: stanceId,
      abilityName: matchingMode?.label ?? abilityDesc?.name ?? stanceId
    });
    markAllDomainsDirty();
    return;
  }

  if (abilityDesc?.doctrineToggleKey === 'decisiveStrike') {
    const nextDS = !(docComp?.decisiveStrike ?? false);
    applyDoctrineUpdate(state, playerId, {
      decisiveStrike: nextDS,
      totalDefense: nextDS ? false : currentTD
    });
    return;
  }

  if (abilityDesc?.doctrineToggleKey === 'whirlingFrenzy') {
    applyDoctrineUpdate(state, playerId, {
      whirlingFrenzy: !(docComp?.whirlingFrenzy ?? false)
    });
    return;
  }

  if (matchingMode?.groupId) {
    const nextDoctrine = toggleConsoleStanceGroup(docComp, matchingMode.groupId, stanceId, false);
    applyDoctrineUpdate(state, playerId, { activeStanceGroups: nextDoctrine.activeStanceGroups });
  } else if (stanceId.includes(':')) {
    const parts = stanceId.split(':');
    const nextDoctrine = toggleConsoleStanceGroup(docComp, parts[0]!, parts[1]!, false);
    applyDoctrineUpdate(state, playerId, { activeStanceGroups: nextDoctrine.activeStanceGroups });
  }
}
