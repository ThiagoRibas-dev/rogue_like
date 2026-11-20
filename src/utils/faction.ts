import { type GameState, type EntityId } from '../types/game-state.types.ts';
import {
  ComponentType,
  type FactionComponent,
  type AttitudeComponent,
  type IdentityMaskComponent
} from '../types/components.types.ts';
import { getComponent } from '../core/ecs.ts';

/**
 * Gets the faction relation between two entities.
 * Defaults to Neutral if either entity lacks a FactionComponent.
 * @param state The current GameState.
 * @param subject The EntityId checking relation.
 * @param target The EntityId being checked against.
 * @returns The FactionRelation enum value.
 */
export function getFactionRelation(
  state: GameState,
  subject: EntityId,
  target: EntityId
): 'hostile' | 'neutral' | 'friendly' {
  const isSubjectPlayer = getComponent(state, subject, ComponentType.Player) !== undefined;
  const isTargetPlayer = getComponent(state, target, ComponentType.Player) !== undefined;

  if (isSubjectPlayer && !isTargetPlayer) {
    const attitudeCmp = getComponent(state, target, ComponentType.Attitude) as AttitudeComponent | undefined;
    if (attitudeCmp) {
      if (attitudeCmp.attitude === 'hostile') return 'hostile';
      if (attitudeCmp.attitude === 'friendly' || attitudeCmp.attitude === 'helpful') return 'friendly';
      return 'neutral';
    }
  } else if (isTargetPlayer && !isSubjectPlayer) {
    const attitudeCmp = getComponent(state, subject, ComponentType.Attitude) as AttitudeComponent | undefined;
    if (attitudeCmp) {
      if (attitudeCmp.attitude === 'hostile') return 'hostile';
      if (attitudeCmp.attitude === 'friendly' || attitudeCmp.attitude === 'helpful') return 'friendly';
      return 'neutral';
    }
  }

  const subjectFactionCmp = getComponent(state, subject, ComponentType.Faction) as FactionComponent | undefined;
  const targetFactionCmp = getComponent(state, target, ComponentType.Faction) as FactionComponent | undefined;

  const subjectMask = getComponent(state, subject, ComponentType.IdentityMask) as IdentityMaskComponent | undefined;
  const targetMask = getComponent(state, target, ComponentType.IdentityMask) as IdentityMaskComponent | undefined;

  const subjectFaction =
    subjectMask && subjectMask.suspicion < subjectMask.maxSuspicion
      ? subjectMask.disguisedAsFactionId
      : (subjectFactionCmp?.factionId ?? 'neutral');
  const targetFaction =
    targetMask && targetMask.suspicion < targetMask.maxSuspicion
      ? targetMask.disguisedAsFactionId
      : (targetFactionCmp?.factionId ?? 'neutral');

  if (subjectFaction === targetFaction && subjectFaction !== 'neutral') {
    return 'friendly';
  }

  const relations = state.campaign.factions[subjectFaction];
  if (!relations) {
    return 'neutral';
  }

  const relation = relations[targetFaction];
  if (!relation) {
    return 'neutral';
  }

  return relation;
}

/**
 * Checks if the subject is hostile towards the target.
 * @param state The current GameState.
 * @param subject The EntityId checking relation.
 * @param target The EntityId being checked against.
 * @returns True if the subject is hostile to the target.
 */
export function isHostile(state: GameState, subject: EntityId, target: EntityId): boolean {
  return getFactionRelation(state, subject, target) === 'hostile';
}
