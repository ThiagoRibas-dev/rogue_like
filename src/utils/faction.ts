import { type GameState, type EntityId } from '../types/game-state.types.ts';
import {
  ComponentType,
  type FactionComponent,
  type AttitudeComponent,
  type IdentityMaskComponent,
  type MemoryComponent,
  type TemplateComponent
} from '../types/components.types.ts';
import { getComponent } from '../core/ecs.ts';

function resolveActualBaselineRelation(
  state: GameState,
  subject: EntityId,
  target: EntityId,
  subjectFaction: string,
  actualTargetFaction: string
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

  if (subjectFaction === actualTargetFaction && subjectFaction !== 'neutral') {
    return 'friendly';
  }

  const relations = state.campaign.factions[subjectFaction];
  if (!relations) {
    return 'neutral';
  }

  return relations[actualTargetFaction] ?? 'neutral';
}

/**
 * Gets the faction relation between two entities.
 * Precedence:
 * 1. The subject's own faction/attitude remains its actual state (never overwritten by subject's own mask).
 * 2. Personal grudges (`MemoryComponent.grudges`) on `subject` toward `target` override any disguise and return `'hostile'`.
 * 3. Actual `'friendly'` allies remain `'friendly'` even when `target` is wearing a disguise.
 * 4. A valid, unblown `IdentityMaskComponent` on `target` (`suspicion < maxSuspicion`) resolves `target`'s perceived
 *    faction from `targetMask.disguisedAsFactionId` and suppresses baseline faction/attitude hostility.
 * 5. Otherwise falls back to actual faction/attitude relation.
 *
 * @param state The current GameState.
 * @param subject The EntityId checking relation.
 * @param target The EntityId being checked against.
 * @returns The FactionRelation value (`'hostile' | 'neutral' | 'friendly'`).
 */
export function getFactionRelation(
  state: GameState,
  subject: EntityId,
  target: EntityId
): 'hostile' | 'neutral' | 'friendly' {
  const subjectFactionCmp = getComponent(state, subject, ComponentType.Faction) as FactionComponent | undefined;
  const targetFactionCmp = getComponent(state, target, ComponentType.Faction) as FactionComponent | undefined;
  const subjectFaction = subjectFactionCmp?.factionId ?? 'neutral';
  const actualTargetFaction = targetFactionCmp?.factionId ?? 'neutral';

  const subjectMemory = getComponent(state, subject, ComponentType.Memory) as MemoryComponent | undefined;
  if (subjectMemory?.grudges && subjectMemory.grudges.length > 0) {
    const targetTemplateId = (getComponent(state, target, ComponentType.Template) as TemplateComponent | undefined)
      ?.templateId;
    if (
      subjectMemory.grudges.includes(String(target)) ||
      subjectMemory.grudges.includes(actualTargetFaction) ||
      (targetTemplateId !== undefined && subjectMemory.grudges.includes(targetTemplateId))
    ) {
      return 'hostile';
    }
  }

  const actualRelation = resolveActualBaselineRelation(state, subject, target, subjectFaction, actualTargetFaction);
  if (actualRelation === 'friendly') {
    return 'friendly';
  }

  const targetMask = getComponent(state, target, ComponentType.IdentityMask) as IdentityMaskComponent | undefined;
  if (targetMask && targetMask.suspicion < targetMask.maxSuspicion) {
    const disguisedFaction = targetMask.disguisedAsFactionId;
    if (subjectFaction === disguisedFaction && subjectFaction !== 'neutral') {
      return 'friendly';
    }
    const spoofedRelation = state.campaign.factions[subjectFaction]?.[disguisedFaction] ?? 'neutral';
    if (spoofedRelation !== 'hostile') {
      return spoofedRelation;
    }
  }

  return actualRelation;
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
