import {
  DEFAULT_ALLIED_FACTION_RIPPLE_RATIO,
  DEFAULT_ATTACK_STANDING_PENALTY,
  DEFAULT_DISGUISE_ATTACK_SUSPICION_GAIN,
  DEFAULT_DISGUISE_KILL_SUSPICION_GAIN,
  DEFAULT_KILL_STANDING_PENALTY,
  DEFAULT_STANDING_HOSTILE_THRESHOLD,
  DEFAULT_WITNESS_RADIUS_TILES,
  MAX_FACTION_STANDING,
  MIN_FACTION_STANDING
} from '../constants/reputation.constants.ts';
import { addComponent, createDefaultMemoryComponent, getComponent, resolveEntityDisplayName } from '../core/ecs.ts';
import { has3DLineOfSight } from '../map/fov_3d.ts';
import {
  ComponentType,
  type AttitudeComponent,
  type FactionComponent,
  type IdentityMaskComponent,
  type MemoryComponent,
  type PositionComponent
} from '../types/components.types.ts';
import { GameEventType, type EntityDamagedEvent } from '../types/events.types.ts';
import type { EntityId, GameState } from '../types/game-state.types.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';
import { shouldSkipTurn } from './status-effect.system.ts';

/** Fully resolved reputation rule parameters combining campaign overrides with Console defaults. */
export interface ResolvedReputationConfig {
  readonly enabled: boolean;
  readonly attackStandingPenalty: number;
  readonly killStandingPenalty: number;
  readonly hostileStandingThreshold: number;
  readonly requireWitness: boolean;
  readonly witnessRadiusTiles: number;
  readonly penalizeHostileFactions: boolean;
  readonly applyWitnessGrudge: boolean;
  readonly alliedFactionRippleRatio: number;
  readonly disguiseAttackSuspicionGain: number;
  readonly disguiseKillSuspicionGain: number;
}

/**
 * Resolves active reputation rules from `state.campaign.rules.reputation` with safe Console defaults.
 *
 * @param state Current readonly GameState.
 * @returns Normalized reputation rule configuration.
 */
export function resolveReputationConfig(state: Readonly<GameState>): ResolvedReputationConfig {
  const cfg = state.campaign.rules.reputation;
  return {
    enabled: cfg?.enabled ?? true,
    attackStandingPenalty: cfg?.attackStandingPenalty ?? DEFAULT_ATTACK_STANDING_PENALTY,
    killStandingPenalty: cfg?.killStandingPenalty ?? DEFAULT_KILL_STANDING_PENALTY,
    hostileStandingThreshold: cfg?.hostileStandingThreshold ?? DEFAULT_STANDING_HOSTILE_THRESHOLD,
    requireWitness: cfg?.requireWitness ?? true,
    witnessRadiusTiles: cfg?.witnessRadiusTiles ?? DEFAULT_WITNESS_RADIUS_TILES,
    penalizeHostileFactions: cfg?.penalizeHostileFactions ?? false,
    applyWitnessGrudge: cfg?.applyWitnessGrudge ?? true,
    alliedFactionRippleRatio: cfg?.alliedFactionRippleRatio ?? DEFAULT_ALLIED_FACTION_RIPPLE_RATIO,
    disguiseAttackSuspicionGain: cfg?.disguiseAttackSuspicionGain ?? DEFAULT_DISGUISE_ATTACK_SUSPICION_GAIN,
    disguiseKillSuspicionGain: cfg?.disguiseKillSuspicionGain ?? DEFAULT_DISGUISE_KILL_SUSPICION_GAIN
  };
}

function clampStanding(val: number): number {
  return Math.max(MIN_FACTION_STANDING, Math.min(MAX_FACTION_STANDING, Math.round(val)));
}

function chebyshevDistance3D(a: PositionComponent, b: PositionComponent): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs((a.z ?? 0) - (b.z ?? 0)));
}

function canObserverSeeTarget(
  state: Readonly<GameState>,
  observerPos: PositionComponent,
  targetPos: PositionComponent,
  radiusTiles: number
): boolean {
  if (chebyshevDistance3D(observerPos, targetPos) > radiusTiles) {
    return false;
  }
  return has3DLineOfSight(
    state,
    observerPos.x,
    observerPos.y,
    observerPos.z ?? 0,
    targetPos.x,
    targetPos.y,
    targetPos.z ?? 0
  );
}

/**
 * Finds all living, conscious actors aligned with `victimFactionId` within `radiusTiles` who have 3D
 * Line of Sight to either the victim or attacker during a combat/kill incident.
 *
 * @param state Current readonly GameState.
 * @param attackerId Attacking entity.
 * @param victimId Victim entity.
 * @param victimFactionId Faction ID of the victim.
 * @param isKill Whether the incident was fatal (excluding the victim from witnessing).
 * @param radiusTiles Maximum 3D Chebyshev sight distance for witnesses.
 * @returns Array of witnessing entity IDs.
 */
export function findCrimeWitnesses(
  state: Readonly<GameState>,
  attackerId: EntityId,
  victimId: EntityId,
  victimFactionId: string,
  isKill: boolean,
  radiusTiles: number
): ReadonlyArray<EntityId> {
  const victimPos = getComponent(state, victimId, ComponentType.Position) as PositionComponent | undefined;
  const attackerPos = getComponent(state, attackerId, ComponentType.Position) as PositionComponent | undefined;
  if (!victimPos && !attackerPos) return [];

  const witnesses: EntityId[] = [];

  for (const candidateId of state.entities) {
    if (candidateId === attackerId) continue;
    if (getComponent(state, candidateId, ComponentType.Actor) === undefined) continue;
    if (getComponent(state, candidateId, ComponentType.Player) !== undefined) continue;

    const isVictim = candidateId === victimId;
    if (isVictim && isKill) continue;
    if (!isVictim && getComponent(state, candidateId, ComponentType.Death) !== undefined) continue;
    if (shouldSkipTurn(state as GameState, candidateId)) continue;

    const candidatePos = getComponent(state, candidateId, ComponentType.Position) as PositionComponent | undefined;
    if (!candidatePos) continue;

    if (isVictim) {
      if (attackerPos && canObserverSeeTarget(state, candidatePos, attackerPos, radiusTiles)) {
        witnesses.push(candidateId);
      } else if (!attackerPos && chebyshevDistance3D(candidatePos, candidatePos) <= radiusTiles) {
        witnesses.push(candidateId);
      }
      continue;
    }

    const candidateFaction =
      (getComponent(state, candidateId, ComponentType.Faction) as FactionComponent | undefined)?.factionId ?? 'neutral';
    const alliedToVictim =
      candidateFaction === victimFactionId ||
      state.campaign.factions[candidateFaction]?.[victimFactionId] === 'friendly';
    if (!alliedToVictim) continue;

    const seesVictim = victimPos ? canObserverSeeTarget(state, candidatePos, victimPos, radiusTiles) : false;
    const seesAttacker = attackerPos ? canObserverSeeTarget(state, candidatePos, attackerPos, radiusTiles) : false;
    if (seesVictim || seesAttacker) {
      witnesses.push(candidateId);
    }
  }

  return witnesses;
}

function adjustActorFactionStanding(
  state: GameState,
  actorId: EntityId,
  factionId: string,
  delta: number
): { readonly state: GameState; readonly previous: number; readonly next: number } {
  const existing =
    (getComponent(state, actorId, ComponentType.Memory) as MemoryComponent | undefined) ??
    createDefaultMemoryComponent();
  const previous = existing.factionStandings[factionId] ?? 0;
  const next = clampStanding(previous + delta);
  if (next === previous && getComponent(state, actorId, ComponentType.Memory) !== undefined) {
    return { state, previous, next };
  }
  const updatedState = addComponent(state, actorId, {
    ...existing,
    factionStandings: {
      ...existing.factionStandings,
      [factionId]: next
    }
  });
  return { state: updatedState, previous, next };
}

function appendGrudgeToEntity(state: GameState, witnessId: EntityId, attackerKey: string): GameState {
  const existing =
    (getComponent(state, witnessId, ComponentType.Memory) as MemoryComponent | undefined) ??
    createDefaultMemoryComponent();
  if (existing.grudges.includes(attackerKey)) return state;
  return addComponent(state, witnessId, {
    ...existing,
    grudges: [...existing.grudges, attackerKey]
  });
}

/**
 * Evaluates and applies unified Tier 1 reputation consequences (witness check, disguise suspicion,
 * attacker standing penalty, allied faction ripple, and witness grudges) for a combat hit or kill.
 *
 * @param state Current GameState.
 * @param attackerId Attacking / originating EntityId.
 * @param victimId Victim EntityId.
 * @param isKill Whether the incident was fatal.
 * @returns Updated GameState.
 */
export function applyReputationCrime(
  state: GameState,
  attackerId: EntityId,
  victimId: EntityId,
  isKill: boolean
): GameState {
  const cfg = resolveReputationConfig(state);
  if (!cfg.enabled || attackerId === victimId) return state;

  const isAttackerPlayer = getComponent(state, attackerId, ComponentType.Player) !== undefined;
  const attackerActor = getComponent(state, attackerId, ComponentType.Actor);
  if (!isAttackerPlayer && !attackerActor) return state;

  const victimFaction = (getComponent(state, victimId, ComponentType.Faction) as FactionComponent | undefined)
    ?.factionId;
  if (!victimFaction) return state;

  const attackerFaction =
    (getComponent(state, attackerId, ComponentType.Faction) as FactionComponent | undefined)?.factionId ?? 'neutral';

  if (!cfg.penalizeHostileFactions) {
    const matrixRel = state.campaign.factions[victimFaction]?.[attackerFaction] ?? 'neutral';
    const victimAttitude = (getComponent(state, victimId, ComponentType.Attitude) as AttitudeComponent | undefined)
      ?.attitude;
    if (matrixRel === 'hostile' || victimAttitude === 'hostile') {
      return state;
    }
  }

  const witnesses = findCrimeWitnesses(state, attackerId, victimId, victimFaction, isKill, cfg.witnessRadiusTiles);
  if (cfg.requireWitness && witnesses.length === 0) {
    return state;
  }

  let nextState = state;
  const attackerMask = getComponent(nextState, attackerId, ComponentType.IdentityMask) as
    IdentityMaskComponent | undefined;

  if (attackerMask && attackerMask.suspicion < attackerMask.maxSuspicion) {
    const suspicionGain = isKill ? cfg.disguiseKillSuspicionGain : cfg.disguiseAttackSuspicionGain;
    const nextSuspicion = Math.min(attackerMask.maxSuspicion, attackerMask.suspicion + suspicionGain);
    nextState = addComponent(nextState, attackerId, {
      ...attackerMask,
      suspicion: nextSuspicion
    });

    if (nextSuspicion < attackerMask.maxSuspicion) {
      if (isAttackerPlayer) {
        nextState = addMessage(
          nextState,
          `Witnesses suspect your disguise (${nextSuspicion}/${attackerMask.maxSuspicion}).`,
          MessageLogCategory.System
        );
      }
      return nextState;
    }

    if (isAttackerPlayer) {
      nextState = addMessage(nextState, 'Your disguise is blown!', MessageLogCategory.System);
    }
  }

  const basePenalty = isKill ? cfg.killStandingPenalty : cfg.attackStandingPenalty;
  if (basePenalty > 0) {
    const standingRes = adjustActorFactionStanding(nextState, attackerId, victimFaction, -basePenalty);
    nextState = standingRes.state;

    if (isAttackerPlayer && standingRes.next !== standingRes.previous) {
      nextState = addMessage(
        nextState,
        `Faction standing with ${victimFaction} changed by -${basePenalty} (${standingRes.next}).`,
        MessageLogCategory.System
      );
      if (standingRes.previous > cfg.hostileStandingThreshold && standingRes.next <= cfg.hostileStandingThreshold) {
        const victimDisplayFaction = victimFaction;
        nextState = addMessage(
          nextState,
          `The ${victimDisplayFaction} faction now regards you as hostile!`,
          MessageLogCategory.System
        );
      }
    }

    if (cfg.alliedFactionRippleRatio > 0) {
      const ripplePenalty = Math.round(basePenalty * cfg.alliedFactionRippleRatio);
      if (ripplePenalty > 0) {
        for (const otherFaction of Object.keys(nextState.campaign.factions)) {
          if (otherFaction === victimFaction || otherFaction === attackerFaction) continue;
          if (nextState.campaign.factions[otherFaction]?.[victimFaction] === 'friendly') {
            nextState = adjustActorFactionStanding(nextState, attackerId, otherFaction, -ripplePenalty).state;
          }
        }
      }
    }
  }

  if (cfg.applyWitnessGrudge && witnesses.length > 0) {
    const attackerKey = String(attackerId);
    const attackerName = resolveEntityDisplayName(nextState, attackerId, 'the attacker');
    for (const witnessId of witnesses) {
      if (isKill && witnessId === victimId) continue;
      if (getComponent(nextState, witnessId, ComponentType.Death) !== undefined) continue;
      const beforeGrudges =
        (getComponent(nextState, witnessId, ComponentType.Memory) as MemoryComponent | undefined)?.grudges ?? [];
      const hadGrudge = beforeGrudges.includes(attackerKey);
      nextState = appendGrudgeToEntity(nextState, witnessId, attackerKey);
      if (!hadGrudge && isAttackerPlayer && witnessId !== victimId) {
        const witnessName = resolveEntityDisplayName(nextState, witnessId, 'A witness');
        nextState = addMessage(
          nextState,
          `${witnessName} witnesses ${attackerName}'s aggression and turns hostile!`,
          MessageLogCategory.System
        );
      }
    }
  }

  return nextState;
}

/**
 * Evaluates newly emitted `EntityDamaged` events from `startIndex` onward for non-lethal
 * attacks against non-hostile faction members (skipping entities flagged `Death` so lethal
 * hits resolve solely through `processReputationOnKill`).
 *
 * @param state Current GameState after damage resolution.
 * @param startIndex Event array offset before damage resolution.
 * @returns Updated GameState.
 */
export function processReputationOnDamageEvents(state: GameState, startIndex: number): GameState {
  if (startIndex >= state.events.length) return state;

  let nextState = state;
  const seenPairs = new Set<string>();

  for (let i = startIndex; i < nextState.events.length; i++) {
    const evt = nextState.events[i]!;
    if (evt.type !== GameEventType.EntityDamaged) continue;
    const damageEvt = evt as EntityDamagedEvent;
    if (damageEvt.amount <= 0) continue;

    // Defer fatal blows to `processReputationOnKill` in `death.system.ts` to avoid double penalties.
    if (getComponent(nextState, damageEvt.entityId, ComponentType.Death) !== undefined) continue;

    const attackerId = damageEvt.sourceEntityId ?? damageEvt.interaction?.originatorEntityId;
    if (attackerId === undefined || attackerId === damageEvt.entityId) continue;

    const pairKey = `${attackerId}->${damageEvt.entityId}`;
    if (seenPairs.has(pairKey)) continue;
    seenPairs.add(pairKey);

    nextState = applyReputationCrime(nextState, attackerId, damageEvt.entityId, false);
  }

  return nextState;
}

/**
 * Evaluates reputation consequences when `victimId` dies due to `killerId`
 * (called before removing `victimId` so its faction, attitude, and coordinates remain intact).
 *
 * @param state Current GameState.
 * @param victimId Dying entity ID.
 * @param killerId Resolved killer or `InteractionChain` originator EntityId.
 * @returns Updated GameState.
 */
export function processReputationOnKill(
  state: GameState,
  victimId: EntityId,
  killerId: EntityId | undefined
): GameState {
  if (killerId === undefined) return state;
  return applyReputationCrime(state, killerId, victimId, true);
}
