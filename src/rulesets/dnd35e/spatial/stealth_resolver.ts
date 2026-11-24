import { addComponent, getComponent, resolveEntityDisplayName } from '../../../core/ecs.ts';
import { addMessage, MessageLogCategory } from '../../../systems/message.system.ts';
import { getEntityMovementModes } from '../../../systems/movement_displacement.ts';
import { updateActorTacticalDoctrine } from '../../../systems/stance.system.ts';
import { applyStatusEffect } from '../../../systems/status-effect.system.ts';
import {
  ComponentType,
  type AIComponent,
  type FighterComponent,
  type PositionComponent,
  type StatusEffectsComponent,
  type StealthStanceState,
  type TacticalDoctrineComponent,
  type TagsComponent
} from '../../../types/components.types.ts';
import type { EntityId, GameState } from '../../../types/game-state.types.ts';
import { isHostile } from '../../../utils/faction.ts';
import { getTileDefAt, isInMapBounds } from '../../../map/map_accessor.ts';
import { evaluateDnD35eEntityDAG } from '../cartridge/dnd35e_dag_adapter.ts';
import { rollD20 } from '../math/dice.ts';
import { getDnD35EntityData } from '../srd_registry.ts';
import type { CreatureSizeCategory, SensoryProfile } from '../types/dnd35e.types.ts';
import { evaluateConcealmentAndSenses, evaluateCover, resolveTileLightReading } from './cover_senses.ts';
import { measureDnD35DistanceFt } from './grid_geometry.ts';
import { getShallowWaterStealthAndTumblePenalty } from './terrain_traversal_resolver.ts';

/** SRD penalty to Hide and Move Silently when moving at full speed instead of half-speed (`-5`). */
export const FAST_STEALTH_PENALTY = -5;

/** Minimum rounds between routine Stealth cadence re-rolls (`1` round = 6 seconds per M151). */
export const STEALTH_CHECK_CADENCE_ROUNDS = 1;

/** Cooldown in rounds after Stealth breaks before an actor can manually re-enter Stealth (`1` round). */
export const RESTEALTH_COOLDOWN_ROUNDS = 1;

/** Distance penalty increment for Spot and Listen checks (`-1` per `10` ft). */
export const PERCEPTION_DISTANCE_PENALTY_FT = 10;

/** Status effect ID applied by a `flour_pouch` splash (`'dusted'`). */
export const DUSTED_STATUS_ID = 'dusted';

/** Duration in turns for `'dusted'` counter-invisibility flour coating (`10` turns = 1 minute). */
export const FLOUR_DUST_DURATION_TURNS = 10;

/** Default Scent detection range in feet (`30` ft per SRD). */
export const DEFAULT_SCENT_RANGE_FT = 30;

/** SRD creature size modifiers applied to `Hide` checks. */
const HIDE_SIZE_MODIFIERS: Readonly<Record<CreatureSizeCategory, number>> = {
  fine: 16,
  diminutive: 12,
  tiny: 8,
  small: 4,
  medium: 0,
  large: -4,
  huge: -8,
  gargantuan: -12,
  colossal: -16
};

/** Trigger categories governing when `evaluateStealthDetection` runs opposed checks. */
export type StealthCheckTrigger =
  'round_cadence' | 'light_band_change' | 'new_observer_los' | 'door_open' | 'loud_noise';

/** Result of evaluating stealth checks against nearby observers. */
export interface StealthDetectionResult {
  readonly state: GameState;
  readonly broken: boolean;
  readonly skippedDueToCadence: boolean;
  readonly detectedByEntityId?: EntityId | undefined;
  readonly reason?: string | undefined;
}

/** Returns `true` if `entityId` is currently in active Stealth stance. */
export function isActorStealthed(state: Readonly<GameState>, entityId: EntityId): boolean {
  const doctrine = getComponent(state, entityId, ComponentType.TacticalDoctrine) as
    TacticalDoctrineComponent | undefined;
  return doctrine?.stealth?.isStealthed === true;
}

/** Returns `true` if `entityId` is moving at half-speed default Stealth (`isStealthed && !fastStealth`). */
export function isActorHalfSpeedStealthing(state: Readonly<GameState>, entityId: EntityId): boolean {
  const doctrine = getComponent(state, entityId, ComponentType.TacticalDoctrine) as
    TacticalDoctrineComponent | undefined;
  return doctrine?.stealth?.isStealthed === true && doctrine.stealth.fastStealth !== true;
}

/** Returns `true` if `entityId` is currently coated in flour dust (`'dusted'`), negating Hide and cutting invisibility to 20%. */
export function isActorDusted(state: Readonly<GameState>, entityId: EntityId): boolean {
  const statuses = getComponent(state, entityId, ComponentType.StatusEffects) as StatusEffectsComponent | undefined;
  if (statuses?.activeEffects.some((e) => e.effectId === DUSTED_STATUS_ID)) return true;
  const tags = getComponent(state, entityId, ComponentType.Tags) as TagsComponent | undefined;
  return tags?.tags.includes(DUSTED_STATUS_ID) ?? false;
}

function getCurrentWorldRound(state: Readonly<GameState>): number {
  return state.globalTurn ?? 0;
}

function resolveObserverSensoryProfile(state: GameState, observerId: EntityId): SensoryProfile {
  const dag = evaluateDnD35eEntityDAG(state, observerId);
  const directSenses = getDnD35EntityData(state, observerId).senses;
  const senses = directSenses ?? dag?.dndData.senses;
  const tags = dag?.selfTags ?? [];
  return {
    lowLightVision: senses?.lowLightVision ?? tags.includes('trait:low_light_vision'),
    darkvisionRangeFt: senses?.darkvisionRangeFt ?? (tags.includes('trait:darkvision') ? 60 : 0),
    blindsenseRangeFt: senses?.blindsenseRangeFt ?? 0,
    blindsightRangeFt: senses?.blindsightRangeFt ?? 0,
    tremorsenseRangeFt: senses?.tremorsenseRangeFt ?? (tags.includes('trait:tremorsense') ? 60 : 0),
    scentRangeFt: senses?.scentRangeFt ?? (tags.includes('trait:scent') ? DEFAULT_SCENT_RANGE_FT : 0)
  };
}

function isTileOpaqueWall(state: Readonly<GameState>, x: number, y: number): boolean {
  if (!isInMapBounds(state.map, x, y)) return true;
  return getTileDefAt(state, x, y)?.transparent === false;
}

function hasDirectHostileObserverWithoutConcealment(
  state: GameState,
  actorId: EntityId,
  actorPos: PositionComponent,
  selfTags: ReadonlyArray<string>
): boolean {
  if (selfTags.includes('trait:hide_in_plain_sight') || selfTags.includes('feat:hide_in_plain_sight')) {
    return false;
  }
  const lightReading = resolveTileLightReading(state, actorPos.x, actorPos.y);
  const isWallAt = (x: number, y: number): boolean => isTileOpaqueWall(state, x, y);
  const targetInvisible = selfTags.includes('trait:invisible');

  for (const otherId of state.entities) {
    if (otherId === actorId) continue;
    const fighter = getComponent(state, otherId, ComponentType.Fighter) as FighterComponent | undefined;
    const otherPos = getComponent(state, otherId, ComponentType.Position) as PositionComponent | undefined;
    if (!fighter || fighter.hp <= 0 || !otherPos) continue;
    if (!isHostile(state, actorId, otherId)) continue;

    const cover = evaluateCover(otherPos, actorPos, isWallAt);
    if (cover.blocksLineOfEffect) continue;
    if (cover.coverState === 'standard' || cover.coverState === 'total') continue;

    const senses = resolveObserverSensoryProfile(state, otherId);
    const concealment = evaluateConcealmentAndSenses(lightReading.level, otherPos, actorPos, senses, {
      ...(targetInvisible ? { targetInvisible: true } : {})
    });
    if (concealment.missChancePercent === 0) {
      return true;
    }
  }
  return false;
}

function computeStealthCheckRoll(
  state: GameState,
  actorId: EntityId,
  skillId: 'hide' | 'move_silently',
  fastStealth: boolean,
  forcedD20?: number
): number {
  const dag = evaluateDnD35eEntityDAG(state, actorId);
  const baseSkillMod = dag?.resolvedSkills[skillId]?.totalModifier ?? 0;
  const sizeCategory: CreatureSizeCategory = dag?.dndData.sizeCategory ?? 'medium';
  const sizeMod = skillId === 'hide' ? HIDE_SIZE_MODIFIERS[sizeCategory] : 0;
  const fastPenalty = fastStealth ? FAST_STEALTH_PENALTY : 0;
  const waterPenalty = skillId === 'move_silently' ? getShallowWaterStealthAndTumblePenalty(state, actorId) : 0;
  const totalMod = baseSkillMod + sizeMod + fastPenalty + waterPenalty;
  return rollD20('skill_check', totalMod, forcedD20).total;
}

/**
 * Evaluates whether `entityId` is eligible to manually enter Stealth right now:
 * - Must not be `'dusted'`
 * - Must satisfy the 1-round `reStealthCooldownRound`
 * - Must either be unobserved or possess cover/concealment (or `trait:hide_in_plain_sight`).
 */
export function canActorEnterStealth(
  state: GameState,
  entityId: EntityId
): { readonly allowed: boolean; readonly reason?: string | undefined } {
  const pos = getComponent(state, entityId, ComponentType.Position) as PositionComponent | undefined;
  if (!pos) return { allowed: false, reason: 'No position.' };

  if (isActorDusted(state, entityId)) {
    return { allowed: false, reason: 'You are coated in flour dust and cannot Hide!' };
  }

  const doctrine = getComponent(state, entityId, ComponentType.TacticalDoctrine) as
    TacticalDoctrineComponent | undefined;
  const currentRound = getCurrentWorldRound(state);
  if (doctrine?.stealth && currentRound < doctrine.stealth.reStealthCooldownRound) {
    return { allowed: false, reason: 'You must wait 1 round before re-entering Stealth.' };
  }

  const dag = evaluateDnD35eEntityDAG(state, entityId);
  const selfTags = dag?.selfTags ?? [];
  if (hasDirectHostileObserverWithoutConcealment(state, entityId, pos, selfTags)) {
    return { allowed: false, reason: 'Cannot enter Stealth while directly observed without cover or concealment.' };
  }

  return { allowed: true };
}

/**
 * Manually toggles Stealth stance for `entityId` (symmetric for players, companions, and AI).
 * Entering Stealth defaults to half-speed (`fastStealth: false`, avoiding `-5` penalty) unless explicitly requested.
 */
export function toggleActorStealth(
  state: GameState,
  entityId: EntityId,
  options?: {
    readonly fastStealth?: boolean | undefined;
    readonly forcedHideD20?: number | undefined;
    readonly forcedMoveSilentlyD20?: number | undefined;
  }
): { readonly state: GameState; readonly isStealthed: boolean; readonly reason?: string | undefined } {
  const doctrine = getComponent(state, entityId, ComponentType.TacticalDoctrine) as
    TacticalDoctrineComponent | undefined;
  const currentRound = getCurrentWorldRound(state);
  const actorName = resolveEntityDisplayName(state, entityId, 'Someone');

  if (doctrine?.stealth?.isStealthed === true) {
    const nextStealth: StealthStanceState = {
      isStealthed: false,
      fastStealth: doctrine.stealth.fastStealth,
      nextStealthCheckRound: currentRound,
      reStealthCooldownRound: currentRound + RESTEALTH_COOLDOWN_ROUNDS
    };
    let nextState = updateActorTacticalDoctrine(state, entityId, { stealth: nextStealth });
    nextState = addMessage(nextState, `${actorName} steps out of Stealth.`, MessageLogCategory.System);
    return { state: nextState, isStealthed: false };
  }

  const check = canActorEnterStealth(state, entityId);
  if (!check.allowed) {
    const nextState = addMessage(state, check.reason ?? 'Cannot enter Stealth.', MessageLogCategory.System);
    return { state: nextState, isStealthed: false, reason: check.reason };
  }

  const fastStealth = options?.fastStealth ?? doctrine?.stealth?.fastStealth ?? false;
  const hideRoll = computeStealthCheckRoll(state, entityId, 'hide', fastStealth, options?.forcedHideD20);
  const moveSilentlyRoll = computeStealthCheckRoll(
    state,
    entityId,
    'move_silently',
    fastStealth,
    options?.forcedMoveSilentlyD20
  );

  const nextStealth: StealthStanceState = {
    isStealthed: true,
    fastStealth,
    lastHideRoll: hideRoll,
    lastMoveSilentlyRoll: moveSilentlyRoll,
    nextStealthCheckRound: currentRound + STEALTH_CHECK_CADENCE_ROUNDS,
    reStealthCooldownRound: currentRound
  };
  let nextState = updateActorTacticalDoctrine(state, entityId, { stealth: nextStealth });
  nextState = addMessage(
    nextState,
    `${actorName} slips into Stealth (${fastStealth ? 'Full Speed, -5' : 'Half Speed'}; Hide ${hideRoll}, Move Silently ${moveSilentlyRoll}).`,
    MessageLogCategory.System
  );
  return { state: nextState, isStealthed: true };
}

/**
 * Toggles the Fast Stealth preference (full-speed movement at `-5` Hide/Move Silently vs. default half-speed).
 */
export function toggleActorFastStealth(state: GameState, entityId: EntityId, fastStealth?: boolean): GameState {
  const doctrine = getComponent(state, entityId, ComponentType.TacticalDoctrine) as
    TacticalDoctrineComponent | undefined;
  const currentRound = getCurrentWorldRound(state);
  const nextFast = fastStealth ?? !(doctrine?.stealth?.fastStealth ?? false);
  const nextStealth: StealthStanceState = {
    isStealthed: doctrine?.stealth?.isStealthed ?? false,
    fastStealth: nextFast,
    ...(doctrine?.stealth?.lastHideRoll !== undefined ? { lastHideRoll: doctrine.stealth.lastHideRoll } : {}),
    ...(doctrine?.stealth?.lastMoveSilentlyRoll !== undefined
      ? { lastMoveSilentlyRoll: doctrine.stealth.lastMoveSilentlyRoll }
      : {}),
    nextStealthCheckRound: doctrine?.stealth?.nextStealthCheckRound ?? currentRound,
    reStealthCooldownRound: doctrine?.stealth?.reStealthCooldownRound ?? currentRound
  };
  const nextState = updateActorTacticalDoctrine(state, entityId, { stealth: nextStealth });
  return addMessage(
    nextState,
    `Fast Stealth ${nextFast ? 'enabled (full speed, -5 stealth penalty)' : 'disabled (half speed, no penalty)'}.`,
    MessageLogCategory.System
  );
}

/**
 * Immediately breaks Stealth on `entityId` **without triggering auto-pause** (per user decision),
 * recording a 1-round `reStealthCooldownRound` before manual re-entry.
 */
export function breakActorStealth(state: GameState, entityId: EntityId, reason: string): GameState {
  const doctrine = getComponent(state, entityId, ComponentType.TacticalDoctrine) as
    TacticalDoctrineComponent | undefined;
  if (doctrine?.stealth?.isStealthed !== true) return state;

  const currentRound = getCurrentWorldRound(state);
  const nextStealth: StealthStanceState = {
    isStealthed: false,
    fastStealth: doctrine.stealth.fastStealth,
    nextStealthCheckRound: currentRound,
    reStealthCooldownRound: currentRound + RESTEALTH_COOLDOWN_ROUNDS
  };
  let nextState = updateActorTacticalDoctrine(state, entityId, { stealth: nextStealth });
  const actorName = resolveEntityDisplayName(nextState, entityId, 'Someone');
  nextState = addMessage(nextState, `${actorName}'s Stealth breaks (${reason})!`, MessageLogCategory.System);
  return nextState;
}

/**
 * Evaluates opposed `Hide` vs `Spot` and `Move Silently` vs `Listen` plus sensory overrides
 * (Darkvision, Low-Light Vision, Blindsight, Tremorsense, Scent, and `'dusted'` status) for a stealthed actor.
 * - On `'round_cadence'`, strictly enforces the M151 6-second round cadence (`currentRound >= nextStealthCheckRound`).
 * - On state-change triggers (`'light_band_change'`, `'new_observer_los'`, `'door_open'`, `'loud_noise'`),
 *   evaluates immediately.
 * - Breaks Stealth instantly **without auto-pause** on failure or loss of concealment while observed.
 */
export function evaluateStealthDetection(
  state: GameState,
  stealthActorId: EntityId,
  trigger: StealthCheckTrigger,
  options?: {
    readonly forcedHideD20?: number | undefined;
    readonly forcedMoveSilentlyD20?: number | undefined;
    readonly forcedObserverSpotD20?: Readonly<Record<string, number>> | undefined;
    readonly forcedObserverListenD20?: Readonly<Record<string, number>> | undefined;
  }
): StealthDetectionResult {
  const doctrine = getComponent(state, stealthActorId, ComponentType.TacticalDoctrine) as
    TacticalDoctrineComponent | undefined;
  const stealth = doctrine?.stealth;
  if (!stealth || !stealth.isStealthed) {
    return { state, broken: false, skippedDueToCadence: false };
  }

  const currentRound = getCurrentWorldRound(state);
  if (trigger === 'round_cadence' && currentRound < stealth.nextStealthCheckRound) {
    return { state, broken: false, skippedDueToCadence: true };
  }

  if (isActorDusted(state, stealthActorId)) {
    return {
      state: breakActorStealth(state, stealthActorId, 'coated in flour dust'),
      broken: true,
      skippedDueToCadence: false,
      reason: 'dusted'
    };
  }

  const actorPos = getComponent(state, stealthActorId, ComponentType.Position) as PositionComponent | undefined;
  if (!actorPos) return { state, broken: false, skippedDueToCadence: false };

  const actorDag = evaluateDnD35eEntityDAG(state, stealthActorId);
  const actorSelfTags = actorDag?.selfTags ?? [];
  const hasHideInPlainSight =
    actorSelfTags.includes('trait:hide_in_plain_sight') || actorSelfTags.includes('feat:hide_in_plain_sight');
  const actorModes = getEntityMovementModes(state, stealthActorId);
  const actorGrounded = (actorModes?.fly ?? 0) <= 0;
  const lightReading = resolveTileLightReading(state, actorPos.x, actorPos.y);
  const isWallAt = (x: number, y: number): boolean => isTileOpaqueWall(state, x, y);

  const hideRoll =
    options?.forcedHideD20 !== undefined || trigger === 'round_cadence'
      ? computeStealthCheckRoll(state, stealthActorId, 'hide', stealth.fastStealth, options?.forcedHideD20)
      : (stealth.lastHideRoll ?? computeStealthCheckRoll(state, stealthActorId, 'hide', stealth.fastStealth));
  const moveSilentlyRoll =
    options?.forcedMoveSilentlyD20 !== undefined || trigger === 'round_cadence'
      ? computeStealthCheckRoll(
          state,
          stealthActorId,
          'move_silently',
          stealth.fastStealth,
          options?.forcedMoveSilentlyD20
        )
      : (stealth.lastMoveSilentlyRoll ??
        computeStealthCheckRoll(state, stealthActorId, 'move_silently', stealth.fastStealth));

  let runningState = updateActorTacticalDoctrine(state, stealthActorId, {
    stealth: {
      ...stealth,
      lastHideRoll: hideRoll,
      lastMoveSilentlyRoll: moveSilentlyRoll,
      nextStealthCheckRound: currentRound + STEALTH_CHECK_CADENCE_ROUNDS
    }
  });

  for (const observerId of runningState.entities) {
    if (observerId === stealthActorId) continue;
    const fighter = getComponent(runningState, observerId, ComponentType.Fighter) as FighterComponent | undefined;
    const obsPos = getComponent(runningState, observerId, ComponentType.Position) as PositionComponent | undefined;
    if (!fighter || fighter.hp <= 0 || !obsPos) continue;
    if (!isHostile(runningState, stealthActorId, observerId)) continue;

    const distFt = measureDnD35DistanceFt(obsPos.x, obsPos.y, actorPos.x, actorPos.y);
    const distPenalty = -Math.floor(distFt / PERCEPTION_DISTANCE_PENALTY_FT);
    const senses = resolveObserverSensoryProfile(runningState, observerId);
    const cover = evaluateCover(obsPos, actorPos, isWallAt);
    const obsName = resolveEntityDisplayName(runningState, observerId, `Creature #${observerId}`);

    // Tremorsense detects grounded movers within range regardless of Hide
    if (senses.tremorsenseRangeFt >= distFt && actorGrounded) {
      runningState = alertObserverAI(runningState, observerId, actorPos);
      return {
        state: breakActorStealth(runningState, stealthActorId, `sensed via Tremorsense by ${obsName}`),
        broken: true,
        skippedDueToCadence: false,
        detectedByEntityId: observerId,
        reason: 'tremorsense'
      };
    }

    // Blindsight detects within range regardless of Hide or Darkness
    if (senses.blindsightRangeFt >= distFt && !cover.blocksLineOfEffect) {
      runningState = alertObserverAI(runningState, observerId, actorPos);
      return {
        state: breakActorStealth(runningState, stealthActorId, `detected via Blindsight by ${obsName}`),
        broken: true,
        skippedDueToCadence: false,
        detectedByEntityId: observerId,
        reason: 'blindsight'
      };
    }

    // Scent detects presence within 30 ft (pinpointing at 5 ft)
    if (senses.scentRangeFt >= distFt) {
      runningState = alertObserverAI(runningState, observerId, actorPos);
      if (distFt <= 5) {
        return {
          state: breakActorStealth(runningState, stealthActorId, `pinpointed by Scent of ${obsName}`),
          broken: true,
          skippedDueToCadence: false,
          detectedByEntityId: observerId,
          reason: 'scent'
        };
      }
    }

    // Visual detection when observer has unobstructed Line of Effect
    if (!cover.blocksLineOfEffect) {
      const concealment = evaluateConcealmentAndSenses(lightReading.level, obsPos, actorPos, senses, {
        ...(actorSelfTags.includes('trait:invisible') ? { targetInvisible: true } : {}),
        targetGrounded: actorGrounded
      });

      const hasHideEnablingCondition =
        hasHideInPlainSight ||
        cover.coverState === 'standard' ||
        cover.coverState === 'total' ||
        concealment.missChancePercent > 0;

      if (!hasHideEnablingCondition) {
        runningState = alertObserverAI(runningState, observerId, actorPos);
        return {
          state: breakActorStealth(runningState, stealthActorId, `exposed in plain sight of ${obsName}`),
          broken: true,
          skippedDueToCadence: false,
          detectedByEntityId: observerId,
          reason: 'exposed_in_open'
        };
      }

      if (concealment.visible) {
        const obsDag = evaluateDnD35eEntityDAG(runningState, observerId);
        const spotMod = (obsDag?.resolvedSkills['spot']?.totalModifier ?? 0) + distPenalty;
        const spotRoll = rollD20('skill_check', spotMod, options?.forcedObserverSpotD20?.[String(observerId)]).total;
        if (spotRoll >= hideRoll) {
          runningState = alertObserverAI(runningState, observerId, actorPos);
          return {
            state: breakActorStealth(
              runningState,
              stealthActorId,
              `spotted by ${obsName} (Spot ${spotRoll} vs Hide ${hideRoll})`
            ),
            broken: true,
            skippedDueToCadence: false,
            detectedByEntityId: observerId,
            reason: 'spotted'
          };
        }
      }
    }

    // Auditory Listen check within 60 ft
    if (distFt <= 60) {
      const obsDag = evaluateDnD35eEntityDAG(runningState, observerId);
      const listenMod = (obsDag?.resolvedSkills['listen']?.totalModifier ?? 0) + distPenalty;
      const listenRoll = rollD20(
        'skill_check',
        listenMod,
        options?.forcedObserverListenD20?.[String(observerId)]
      ).total;
      if (listenRoll >= moveSilentlyRoll) {
        runningState = alertObserverAI(runningState, observerId, actorPos);
        return {
          state: breakActorStealth(
            runningState,
            stealthActorId,
            `heard by ${obsName} (Listen ${listenRoll} vs Move Silently ${moveSilentlyRoll})`
          ),
          broken: true,
          skippedDueToCadence: false,
          detectedByEntityId: observerId,
          reason: 'heard'
        };
      }
    }
  }

  return { state: runningState, broken: false, skippedDueToCadence: false };
}

function alertObserverAI(
  state: GameState,
  observerId: EntityId,
  targetPos: { readonly x: number; readonly y: number }
): GameState {
  const ai = getComponent(state, observerId, ComponentType.AI) as AIComponent | undefined;
  if (!ai) return state;
  return addComponent(state, observerId, {
    ...ai,
    alertnessState: 'alerted',
    lastHeardPos: { x: targetPos.x, y: targetPos.y },
    alertnessDecayTurns: 10
  });
}

/**
 * Throws/splashes a `flour_pouch` (`counter_invisibility_dust`) onto `(targetX, targetY)`,
 * applying the `'dusted'` status (`DUSTED_STATUS_ID`) to all living actors within a 1-tile splash,
 * immediately breaking non-magical Stealth and reducing invisibility miss chance from `50%` to `20%`.
 *
 * @param state Current immutable GameState.
 * @param throwerId Actor dispersing the flour dust.
 * @param targetX Target X coordinate.
 * @param targetY Target Y coordinate.
 * @returns Updated GameState and array of dusted actor IDs.
 */
export function applyFlourPouchDust(
  state: GameState,
  throwerId: EntityId,
  targetX: number,
  targetY: number
): { readonly state: GameState; readonly dustedEntityIds: ReadonlyArray<EntityId> } {
  let nextState = state;
  const dustedEntityIds: EntityId[] = [];

  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const occupants = nextState.spatialIndex.get(`${targetX + dx},${targetY + dy}`) ?? [];
      for (const eid of occupants) {
        const fighter = getComponent(nextState, eid, ComponentType.Fighter) as FighterComponent | undefined;
        if (!fighter || fighter.hp <= 0) continue;
        nextState = applyStatusEffect(nextState, eid, DUSTED_STATUS_ID, FLOUR_DUST_DURATION_TURNS, throwerId);
        nextState = breakActorStealth(nextState, eid, 'coated in flour dust');
        dustedEntityIds.push(eid);
      }
    }
  }

  const throwerName = resolveEntityDisplayName(nextState, throwerId, 'Someone');
  nextState = addMessage(
    nextState,
    dustedEntityIds.length > 0
      ? `${throwerName} bursts a cloud of flour dust, coating ${dustedEntityIds.length} creature(s)!`
      : `${throwerName} bursts a cloud of flour dust across the floor.`,
    MessageLogCategory.System
  );

  return { state: nextState, dustedEntityIds };
}
