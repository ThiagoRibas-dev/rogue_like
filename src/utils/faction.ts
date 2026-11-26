import { type GameState, type EntityId } from '../types/game-state.types.ts';
import {
  DEFAULT_STANDING_FRIENDLY_THRESHOLD,
  DEFAULT_STANDING_HOSTILE_THRESHOLD
} from '../constants/reputation.constants.ts';
import {
  ComponentType,
  type FactionComponent,
  type AttitudeComponent,
  type IdentityMaskComponent,
  type MemoryComponent,
  type TemplateComponent
} from '../types/components.types.ts';
import { addComponent, createDefaultMemoryComponent, getComponent, resolveEntityDisplayName } from '../core/ecs.ts';
import { addMessage, MessageLogCategory } from '../systems/message.system.ts';

function resolveActualBaselineRelation(
  state: Readonly<GameState>,
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
 * Computes the effective bilateral standing between an observer entity (e.g., merchant or NPC)
 * and a target actor, combining Layer 2 actor-to-faction reputation (`actorMemory.factionStandings[observerFaction]`)
 * with any Layer 3 personal standing override (`observerMemory.factionStandings[actorFaction]`).
 *
 * @param state The current readonly GameState.
 * @param observerId Observer EntityId (merchant, speaker, or faction representative).
 * @param actorId Target actor EntityId whose reputation is evaluated.
 * @returns Combined integer standing score.
 */
export function getEffectiveStandingBetween(
  state: Readonly<GameState>,
  observerId: EntityId,
  actorId: EntityId
): number {
  const observerFaction = (getComponent(state, observerId, ComponentType.Faction) as FactionComponent | undefined)
    ?.factionId;
  const actorFaction = (getComponent(state, actorId, ComponentType.Faction) as FactionComponent | undefined)?.factionId;

  const actorMemory = getComponent(state, actorId, ComponentType.Memory) as MemoryComponent | undefined;
  const observerMemory = getComponent(state, observerId, ComponentType.Memory) as MemoryComponent | undefined;

  const actorReputationWithObserverFaction = observerFaction
    ? (actorMemory?.factionStandings[observerFaction] ?? 0)
    : 0;
  const observerPersonalStanding = actorFaction ? (observerMemory?.factionStandings[actorFaction] ?? 0) : 0;

  return actorReputationWithObserverFaction + observerPersonalStanding;
}

function resolveStandingAdjustedRelation(
  state: Readonly<GameState>,
  subject: EntityId,
  target: EntityId,
  subjectFaction: string,
  actualTargetFaction: string,
  subjectMemory: MemoryComponent | undefined,
  baseline: 'hostile' | 'neutral' | 'friendly'
): 'hostile' | 'neutral' | 'friendly' {
  if (subject === target) return baseline;

  const repCfg = state.campaign.rules.reputation;
  const hostileThreshold = repCfg?.hostileStandingThreshold ?? DEFAULT_STANDING_HOSTILE_THRESHOLD;
  const friendlyThreshold = repCfg?.friendlyStandingThreshold ?? DEFAULT_STANDING_FRIENDLY_THRESHOLD;

  const targetMemory = getComponent(state, target, ComponentType.Memory) as MemoryComponent | undefined;
  const targetStandingWithSubject =
    subjectFaction !== 'neutral' ? (targetMemory?.factionStandings[subjectFaction] ?? 0) : 0;
  const subjectStandingWithTarget =
    actualTargetFaction !== 'neutral' ? (subjectMemory?.factionStandings[actualTargetFaction] ?? 0) : 0;

  if (targetStandingWithSubject <= hostileThreshold || subjectStandingWithTarget <= hostileThreshold) {
    return 'hostile';
  }

  if (
    baseline !== 'hostile' &&
    (targetStandingWithSubject >= friendlyThreshold || subjectStandingWithTarget >= friendlyThreshold)
  ) {
    return 'friendly';
  }

  return baseline;
}

/**
 * Gets the faction relation between two entities.
 * Precedence:
 * 1. The subject's own faction/attitude remains its actual state (never overwritten by subject's own mask).
 * 2. Personal grudges (`MemoryComponent.grudges`) on `subject` toward `target` override any disguise and return `'hostile'`.
 * 3. Actual `'friendly'` allies (via baseline diplomacy or high `factionStandings`) remain `'friendly'` even when `target` is wearing a disguise.
 * 4. A valid, unblown `IdentityMaskComponent` on `target` (`suspicion < maxSuspicion`) resolves `target`'s perceived
 *    faction from `targetMask.disguisedAsFactionId` and suppresses baseline or standing-derived hostility.
 * 5. Otherwise falls back to standing-adjusted baseline faction/attitude relation.
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

  const baselineRelation = resolveActualBaselineRelation(state, subject, target, subjectFaction, actualTargetFaction);
  const actualRelation = resolveStandingAdjustedRelation(
    state,
    subject,
    target,
    subjectFaction,
    actualTargetFaction,
    subjectMemory,
    baselineRelation
  );
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

/**
 * Turns `targetId` mutually hostile toward `attackerId` after an unprovoked attack or shove
 * by adding a personal grudge in `MemoryComponent` and updating player-facing `AttitudeComponent`.
 *
 * @param state Current GameState.
 * @param targetId Actor being attacked or shoved.
 * @param attackerId Initiating actor (typically the player).
 * @returns Updated GameState.
 */
export function provokeActorHostility(state: GameState, targetId: EntityId, attackerId: EntityId): GameState {
  if (targetId === attackerId) return state;
  const alreadyMutuallyHostile = isHostile(state, targetId, attackerId) && isHostile(state, attackerId, targetId);
  if (alreadyMutuallyHostile) return state;

  let nextState = state;
  const targetMemory =
    (getComponent(nextState, targetId, ComponentType.Memory) as MemoryComponent | undefined) ??
    createDefaultMemoryComponent();
  const attackerKey = String(attackerId);
  if (!targetMemory.grudges.includes(attackerKey)) {
    nextState = addComponent(nextState, targetId, {
      ...targetMemory,
      grudges: [...targetMemory.grudges, attackerKey]
    });
  }

  const isAttackerPlayer = getComponent(nextState, attackerId, ComponentType.Player) !== undefined;
  if (isAttackerPlayer) {
    const existingAttitude = getComponent(nextState, targetId, ComponentType.Attitude) as AttitudeComponent | undefined;
    if (existingAttitude?.attitude !== 'hostile') {
      nextState = addComponent(nextState, targetId, {
        type: ComponentType.Attitude,
        attitude: 'hostile'
      });
    }
    const targetName = resolveEntityDisplayName(nextState, targetId, 'They');
    nextState = addMessage(nextState, `${targetName} turns hostile!`, MessageLogCategory.CombatHit);
  }

  return nextState;
}
