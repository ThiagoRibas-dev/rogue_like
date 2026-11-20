import { addComponent, getComponent, resolveEntityDisplayName } from '../../../core/ecs.ts';
import { addMessage, MessageLogCategory } from '../../../systems/message.system.ts';
import {
  ComponentType,
  type DamageComponent,
  type FighterComponent,
  type PositionComponent
} from '../../../types/components.types.ts';
import type { EntityId, GameState } from '../../../types/game-state.types.ts';
import { isHostile } from '../../../utils/faction.ts';
import {
  evaluateConcealmentAndSenses,
  FLANKING_ATTACK_BONUS,
  resolveEffectiveTileIllumination
} from '../spatial/cover_senses.ts';
import { evaluateEntityFlankingTarget } from '../spatial/flanking_graph.ts';
import { measureFootprintToFootprintDistanceFt } from '../spatial/footprint_resolver.ts';
import { FEET_PER_GRID_SQUARE, SIZE_METRICS } from '../spatial/grid_geometry.ts';
import { isActorDusted } from '../spatial/stealth_resolver.ts';
import { getDnD35EntityData, setDnD35EntityData } from '../srd_registry.ts';
import type { DnD35DamageType, DnD35EntityData, OnHitRiderDescriptor, SensoryProfile } from '../types/dnd35e.types.ts';
import { evaluateDnD35eEntityDAG, type DnD35EntityDAGResult } from '../cartridge/dnd35e_dag_adapter.ts';
import { resolveAttackRoll } from './attack_roll.ts';
import type { DnD35ResolvedStrikeProfile } from './attack_routine.ts';
import { resolveCleaveFollowupEligibility } from './cleave_whirlwind.ts';
import { mitigateIncomingDamage, resolveSavingThrow } from './damage_vitality.ts';
import {
  applyConditionWithEscalation,
  resolveSpecialAbilitySaveDc,
  shouldTriggerOnHitRider
} from './maneuvers_conditions.ts';

/** Standard untyped Charge attack roll bonus (`+2`, PHB p. 154). */
export const CHARGE_ATTACK_BONUS = 2;

/** Context resolved during Phase 1 (`PreAttackPhase`) of a strike exchange. */
export interface PreAttackContext {
  readonly effectiveAttackBonus: number;
  readonly strikeLabel: string;
  readonly concealmentMissChance: number;
  readonly isFlanking: boolean;
}

/**
 * Resolves Phase 1 (`PreAttackPhase`): Spatial flanking, tile illumination, and observer sensory concealment.
 *
 * @param state Immutable GameState.
 * @param attackerId Attacking entity ID.
 * @param defenderId Defending entity ID.
 * @param strike The attack strike being executed.
 * @param strikeIndex Index of strike in routine.
 * @param totalStrikes Total strikes in routine.
 * @param attackerData Attacker entity D&D data.
 * @param defenderData Defender entity D&D data.
 * @param attackerSelfTags Attacker semantic tags.
 * @param defenderSelfTags Defender semantic tags.
 * @param attackerEval Attacker DAG evaluation.
 * @param defenderEval Defender DAG evaluation.
 * @returns PreAttackContext with synthesized attack bonus, label, and concealment.
 */
export function resolveStrikePreAttackContext(
  state: GameState,
  attackerId: EntityId,
  defenderId: EntityId,
  strike: DnD35ResolvedStrikeProfile,
  strikeIndex: number,
  totalStrikes: number,
  attackerData: DnD35EntityData,
  defenderData: DnD35EntityData,
  attackerSelfTags: ReadonlyArray<string>,
  defenderSelfTags: ReadonlyArray<string>,
  attackerEval: DnD35EntityDAGResult,
  defenderEval: DnD35EntityDAGResult,
  isChargeAttack?: boolean
): PreAttackContext {
  const attackerPos = getComponent(state, attackerId, ComponentType.Position) as PositionComponent | undefined;
  const defenderPos = getComponent(state, defenderId, ComponentType.Position) as PositionComponent | undefined;

  let flankingBonus = 0;
  let isFlanking = false;
  if (attackerPos && defenderPos) {
    isFlanking = evaluateEntityFlankingTarget({
      state,
      attackerId,
      defenderId,
      attackerPos,
      defenderPos,
      attackerData,
      defenderData,
      attackerSelfTags,
      defenderSelfTags
    });
    if (isFlanking) {
      flankingBonus = attackerEval.dagResult.flankingBonus ?? FLANKING_ATTACK_BONUS;
    }
  }

  let concealmentMissChance = defenderEval.dagResult.concealmentMissChancePercent ?? 0;
  if (attackerPos && defenderPos) {
    const tileIllumination = resolveEffectiveTileIllumination(state, defenderPos.x, defenderPos.y);
    const observerSenses: SensoryProfile = {
      lowLightVision: attackerData.senses?.lowLightVision ?? attackerSelfTags.includes('trait:low_light_vision'),
      darkvisionRangeFt:
        attackerData.senses?.darkvisionRangeFt ?? (attackerSelfTags.includes('trait:darkvision') ? 60 : 0),
      blindsenseRangeFt: attackerData.senses?.blindsenseRangeFt ?? 0,
      blindsightRangeFt: attackerData.senses?.blindsightRangeFt ?? 0,
      tremorsenseRangeFt: attackerData.senses?.tremorsenseRangeFt ?? 0,
      scentRangeFt: attackerData.senses?.scentRangeFt ?? 0
    };
    const targetInvisible = defenderSelfTags.includes('trait:invisible');
    const targetBlurred = defenderSelfTags.includes('trait:blurred');
    const targetDusted = isActorDusted(state, defenderId);
    const sensoryConcealment = evaluateConcealmentAndSenses(
      tileIllumination,
      attackerPos,
      defenderPos,
      observerSenses,
      {
        ...(targetInvisible ? { targetInvisible: true } : {}),
        ...(targetBlurred ? { targetBlurred: true } : {}),
        ...(targetDusted ? { targetDusted: true } : {})
      }
    );
    concealmentMissChance = Math.max(concealmentMissChance, sensoryConcealment.missChancePercent);
  }

  const chargeBonus = isChargeAttack === true ? CHARGE_ATTACK_BONUS : 0;
  let strikeLabel = strike.label;
  if (totalStrikes > 1 && strike.attackSource === 'manufactured_primary') {
    strikeLabel = `${strikeLabel} (Iterative ${strikeIndex + 1})`;
  }
  if (chargeBonus > 0) {
    strikeLabel = `${strikeLabel} [Charge +${chargeBonus}]`;
  }
  if (isFlanking) {
    strikeLabel = `${strikeLabel} [Flanking +${flankingBonus}]`;
  }

  return {
    effectiveAttackBonus: strike.attackBonus + flankingBonus + chargeBonus,
    strikeLabel,
    concealmentMissChance,
    isFlanking
  };
}

/**
 * Resolves Phase 5 (`OnDropFollowupPhase`): Evaluates Cleave / Great Cleave eligibility and executes
 * a follow-up melee strike against an adjacent hostile opponent if the primary defender was dropped.
 *
 * @param state Current GameState.
 * @param attackerId Attacker entity ID.
 * @param droppedDefenderId Entity ID of the dropped defender.
 * @param strike Base attack strike.
 * @param targetAC Fallback AC if secondary target DAG evaluation is unavailable.
 * @param attackerEval Attacker DAG evaluation.
 * @param cleavesCount Number of cleaves already executed this turn.
 * @param forcedAttackRoll Optional deterministic d20 roll override for testing.
 * @returns Updated GameState and updated cleaves count.
 */
export function resolveOnDropCleaveFollowup(
  state: GameState,
  attackerId: EntityId,
  droppedDefenderId: EntityId,
  strike: DnD35ResolvedStrikeProfile,
  targetAC: number,
  attackerEval: DnD35EntityDAGResult,
  cleavesCount: number,
  forcedAttackRoll?: number
): { state: GameState; cleavesUsed: number } {
  if (!attackerEval.hasCleave) {
    return { state, cleavesUsed: cleavesCount };
  }

  const attackerPos = getComponent(state, attackerId, ComponentType.Position) as PositionComponent | undefined;
  if (!attackerPos) {
    return { state, cleavesUsed: cleavesCount };
  }

  const cleaveEligible = resolveCleaveFollowupEligibility(true, cleavesCount, attackerEval.hasGreatCleave);
  if (!cleaveEligible) {
    return { state, cleavesUsed: cleavesCount };
  }

  let cleaveTargetId: EntityId | undefined;
  let cleaveTargetName = 'foe';
  const attackerReachFt =
    SIZE_METRICS[attackerEval.dagResult.effectiveSize]?.naturalReachTallFt ?? FEET_PER_GRID_SQUARE;
  for (const candId of state.entities) {
    if (candId === droppedDefenderId || candId === attackerId) continue;
    const candFighter = getComponent(state, candId, ComponentType.Fighter) as FighterComponent | undefined;
    const candPos = getComponent(state, candId, ComponentType.Position) as PositionComponent | undefined;
    if (!candFighter || candFighter.hp <= 0 || !candPos) continue;

    const candDistFt = measureFootprintToFootprintDistanceFt(
      attackerPos.x,
      attackerPos.y,
      attackerPos.footprintWidth ?? 1,
      attackerPos.footprintHeight ?? 1,
      candPos.x,
      candPos.y,
      candPos.footprintWidth ?? 1,
      candPos.footprintHeight ?? 1
    );
    if (candDistFt <= attackerReachFt && isHostile(state, attackerId, candId)) {
      cleaveTargetId = candId;
      cleaveTargetName = resolveEntityDisplayName(state, candId, 'foe');
      break;
    }
  }

  if (cleaveTargetId === undefined) {
    return { state, cleavesUsed: cleavesCount };
  }

  const cleaveTargetEval = evaluateDnD35eEntityDAG(state, cleaveTargetId);
  const cleaveTargetAC = cleaveTargetEval?.dagResult.acBreakdown.fullAC ?? targetAC;

  let nextState = addMessage(
    state,
    `[Cleave] Dropped foe grants a free follow-up melee strike against ${cleaveTargetName}!`,
    MessageLogCategory.CombatHit
  );

  const cleaveStrike: DnD35ResolvedStrikeProfile = {
    ...strike,
    label: `${strike.label} [Cleave]`
  };
  const cleaveRes = resolveAttackRoll({
    attackBonus: cleaveStrike.attackBonus,
    targetAC: cleaveTargetAC,
    weaponDice: cleaveStrike.weaponDice,
    strModifier: 0,
    handedness: 'one_handed',
    flatDamageBonus: cleaveStrike.strDamageBonus + cleaveStrike.doctrineDamageBonus + cleaveStrike.flatDamageBonus,
    critThreatMin: cleaveStrike.critThreatMin,
    critMultiplier: cleaveStrike.critMultiplier,
    hasBlindFight: attackerEval.hasBlindFight,
    ...(forcedAttackRoll !== undefined ? { forcedAttackRoll } : {})
  });

  if (cleaveRes.hit) {
    const candExistingDmg = getComponent(nextState, cleaveTargetId, ComponentType.Damage) as
      DamageComponent | undefined;
    nextState = addComponent(nextState, cleaveTargetId, {
      type: ComponentType.Damage,
      instances: [
        ...(candExistingDmg?.instances ?? []),
        {
          amount: cleaveRes.totalDamage,
          sourceEntityId: attackerId,
          tags: ['melee', 'physical', strike.weaponDamageType, ...strike.bypassTags]
        }
      ]
    });
    const critStr = cleaveRes.isCriticalConfirmed ? ' CRITICAL HIT!' : '';
    nextState = addMessage(
      nextState,
      `[Cleave] [d20: ${cleaveRes.naturalAttackRoll} + ${cleaveStrike.attackBonus} = ${cleaveRes.totalAttackRoll} vs AC ${cleaveTargetAC}]${critStr} Cleave hits ${cleaveTargetName} for ${cleaveRes.totalDamage} ${strike.weaponDamageType} damage!`,
      MessageLogCategory.CombatHit
    );
  } else {
    nextState = addMessage(
      nextState,
      `[Cleave] [d20: ${cleaveRes.naturalAttackRoll} + ${cleaveStrike.attackBonus} = ${cleaveRes.totalAttackRoll} vs AC ${cleaveTargetAC}] Cleave strike misses ${cleaveTargetName}!`,
      MessageLogCategory.CombatMiss
    );
  }

  return {
    state: nextState,
    cleavesUsed: cleavesCount + 1
  };
}

/**
 * Evaluates natural weapon `OnHitRiderDescriptor` effects (poison, paralysis, disease, curse, energy drain)
 * against post-DR physical damage, immunities, and `resolveSpecialAbilitySaveDc` modifiers.
 */
export function resolveNaturalWeaponOnHitRiders(params: {
  readonly state: GameState;
  readonly defenderId: EntityId;
  readonly onHitRiders: ReadonlyArray<OnHitRiderDescriptor>;
  readonly rawPhysicalDamage: number;
  readonly weaponDamageType: DnD35DamageType;
  readonly bypassTags: ReadonlyArray<string>;
  readonly attackerData: DnD35EntityData;
  readonly defenderData: DnD35EntityData;
  readonly attackerSelfTags: ReadonlyArray<string>;
  readonly attackerEval: DnD35EntityDAGResult;
  readonly defenderEval: DnD35EntityDAGResult;
  readonly forcedRiderSaveRoll?: number | undefined;
}): GameState {
  let runningState = params.state;
  const { defenderData } = params;
  const physMitigation = mitigateIncomingDamage({
    rawDamage: params.rawPhysicalDamage,
    damageType: params.weaponDamageType,
    attackBypassTags: params.bypassTags,
    ...(defenderData.damageReduction !== undefined ? { damageReduction: defenderData.damageReduction } : {}),
    energyResistance: defenderData.energyResistance,
    immunities: defenderData.immunities,
    vulnerabilities: defenderData.vulnerabilities
  });
  const defenderConNull = defenderData.abilityScores.con.base === null;
  const activeAttackerMods = params.attackerEval.statModifiers ?? params.attackerData.statModifiers ?? [];

  for (const rider of params.onHitRiders) {
    if (!shouldTriggerOnHitRider(rider, physMitigation.finalDamage, true)) continue;
    const isImmune =
      defenderData.immunities.includes(rider.type) ||
      defenderData.immunities.includes(rider.riderId) ||
      (rider.saveType === 'fort' && defenderConNull);
    if (isImmune) {
      runningState = addMessage(
        runningState,
        `[${rider.initialEffectDescription}] Target is immune to ${rider.type}!`,
        MessageLogCategory.CombatMiss
      );
      continue;
    }

    const baseDc = resolveSpecialAbilitySaveDc(rider.dc, rider.type, activeAttackerMods, params.attackerSelfTags);
    const effectiveDc =
      rider.riderId !== rider.type
        ? Math.max(
            baseDc,
            resolveSpecialAbilitySaveDc(rider.dc, rider.riderId, activeAttackerMods, params.attackerSelfTags)
          )
        : baseDc;

    const saveBonus = params.defenderEval.dagResult.saves[rider.saveType];
    const saveRes = resolveSavingThrow({
      saveType: rider.saveType,
      baseSave: saveBonus,
      abilityModifier: 0,
      dc: effectiveDc,
      ...(params.forcedRiderSaveRoll !== undefined ? { forcedNaturalRoll: params.forcedRiderSaveRoll } : {})
    });

    if (saveRes.success) {
      runningState = addMessage(
        runningState,
        `[${rider.saveType.toUpperCase()} Save vs ${rider.initialEffectDescription} (DC ${effectiveDc}): d20(${saveRes.naturalRoll}) + ${saveBonus} = ${saveRes.total} — SAVED!]`,
        MessageLogCategory.CombatMiss
      );
      continue;
    }

    runningState = addMessage(
      runningState,
      `[${rider.saveType.toUpperCase()} Save vs ${rider.initialEffectDescription} (DC ${effectiveDc}): d20(${saveRes.naturalRoll}) + ${saveBonus} = ${saveRes.total} — FAILED!]`,
      MessageLogCategory.CombatHit
    );
    const curDefData = getDnD35EntityData(runningState, params.defenderId);
    if (rider.type === 'energy_drain') {
      runningState = setDnD35EntityData(runningState, params.defenderId, {
        ...curDefData,
        negativeLevels: (curDefData.negativeLevels ?? 0) + 1
      });
    } else if (
      rider.type === 'paralysis' ||
      rider.type === 'poison' ||
      rider.type === 'disease' ||
      rider.type === 'curse'
    ) {
      const nextCondition = rider.type === 'paralysis' ? 'paralyzed' : 'sickened';
      runningState = setDnD35EntityData(runningState, params.defenderId, {
        ...curDefData,
        conditions: applyConditionWithEscalation(curDefData.conditions, nextCondition)
      });
    }
  }

  return runningState;
}
