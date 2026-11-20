import { addComponent, getComponent } from '../../../core/ecs.ts';
import { addMessage, MessageLogCategory } from '../../../systems/message.system.ts';
import { matchesEntityTagCondition } from '../../../systems/reaction.system.ts';
import { ComponentType, type DamageComponent } from '../../../types/components.types.ts';
import type { EntityId, GameState } from '../../../types/game-state.types.ts';
import { evaluateDiceExpression } from '../math/dice.ts';
import type { DnD35EntityData } from '../types/dnd35e.types.ts';
import type { DnD35EntityDAGResult } from '../cartridge/dnd35e_dag_adapter.ts';
import { resolveAttackRoll } from './attack_roll.ts';
import type { DnD35ResolvedStrikeProfile } from './attack_routine.ts';
import {
  resolveNaturalWeaponOnHitRiders,
  resolveOnDropCleaveFollowup,
  resolveStrikePreAttackContext
} from './combat_exchange_phases.ts';
import {
  finalizeStrikeAcfStateUpdates,
  resolvePrecisionDamageOnHit,
  resolveSmiteAndChargeContext,
  resolveSneakAttackDiceCount
} from './combat_acf_riders.ts';
import { applyAndConsumeWeaponCoatingOnHit } from './floor_hazard_resolver.ts';
import { summarizeConditionEffects } from './maneuvers_conditions.ts';
import { applyPostStrikeRetaliationPhase } from './retaliation_resolver.ts';
import { breakActorStealth } from '../spatial/stealth_resolver.ts';

/** Parameters for executing a single strike exchange through the 5-phase combat pipeline. */
export interface StrikeExchangeParams {
  readonly state: GameState;
  readonly attackerId: EntityId;
  readonly defenderId: EntityId;
  readonly strike: DnD35ResolvedStrikeProfile;
  readonly strikeIndex: number;
  readonly totalStrikes: number;
  readonly attackerData: DnD35EntityData;
  readonly defenderData: DnD35EntityData;
  readonly attackerSelfTags: ReadonlyArray<string>;
  readonly defenderSelfTags: ReadonlyArray<string>;
  readonly attackerEval: DnD35EntityDAGResult;
  readonly defenderEval: DnD35EntityDAGResult;
  readonly defenderHpRemaining: number;
  readonly cleavesUsedThisTurn: number;
  readonly forcedAttackRoll?: number | undefined;
  readonly forcedRiderSaveRoll?: number | undefined;
  readonly isChargeAttack?: boolean | undefined;
}

/** Result of executing a single strike exchange. */
export interface StrikeExchangeResult {
  readonly state: GameState;
  readonly hit: boolean;
  readonly defenderHpRemaining: number;
  readonly cleavesUsedThisTurn: number;
  readonly foeDropped: boolean;
}

/**
 * Executes a single melee strike through the 5-phase Composable Combat Exchange Pipeline:
 * - Phase 1 (`PreAttackPhase`): Spatial flanking, tile illumination, and observer sensory concealment.
 * - Phase 2 (`StrikeRollPhase`): Attack roll, critical confirmation, and fortification.
 * - Phase 3 (`OnHitRidersPhase`): Weapon damage riders and defender damage queueing.
 * - Phase 4 (`PostStrikeReactionPhase`): Active retaliation riders and attacker damage queueing.
 * - Phase 5 (`OnDropFollowupPhase`): Cleave follow-up bonus melee strike execution on dropped foe.
 *
 * @param params StrikeExchangeParams configuring the strike and actors.
 * @returns StrikeExchangeResult with updated state, HP remaining, and cleave count.
 */
export function executeCombatStrikeExchange(params: StrikeExchangeParams): StrikeExchangeResult {
  const {
    state,
    attackerId,
    defenderId,
    strike,
    strikeIndex,
    totalStrikes,
    attackerData,
    defenderData,
    attackerSelfTags,
    defenderSelfTags,
    attackerEval,
    defenderEval,
    cleavesUsedThisTurn
  } = params;

  let runningState = breakActorStealth(state, attackerId, 'attacked');
  let currentDefenderHp = params.defenderHpRemaining;
  let cleavesCount = cleavesUsedThisTurn;

  // Phase 1: PreAttackPhase (Spatial, Flanking, Illumination & Concealment)
  const preContext = resolveStrikePreAttackContext(
    runningState,
    attackerId,
    defenderId,
    strike,
    strikeIndex,
    totalStrikes,
    attackerData,
    defenderData,
    attackerSelfTags,
    defenderSelfTags,
    attackerEval,
    defenderEval,
    params.isChargeAttack
  );

  const targetAC = defenderEval.dagResult.acBreakdown.fullAC;
  const bypassTags = strike.bypassTags;
  const weaponDamageType = strike.weaponDamageType;

  const isIncorporealWithoutGhostTouch =
    defenderSelfTags.includes('subtype:incorporeal') &&
    !bypassTags.includes('ghost_touch') &&
    !bypassTags.includes('bypass:incorporeal');
  const targetImmuneToCrits =
    defenderData.abilityScores?.con?.base === null ||
    (defenderData.immunities?.includes('critical_hits') ?? false) ||
    defenderSelfTags.includes('type:elemental') ||
    defenderSelfTags.includes('type:ooze') ||
    defenderSelfTags.includes('type:plant') ||
    defenderSelfTags.includes('subtype:swarm') ||
    isIncorporealWithoutGhostTouch;

  const smiteCtx = resolveSmiteAndChargeContext({
    attackerData,
    attackerSelfTags,
    defenderSelfTags,
    attackerChaMod:
      attackerEval.dagResult.effectiveAbilityModifiers?.cha ??
      Math.floor(((attackerData.abilityScores?.cha?.base ?? 10) - 10) / 2),
    isChargeAttack: params.isChargeAttack === true || attackerSelfTags.includes('stance:charge')
  });
  const strikeDmgMult =
    strike.damageMultiplier ?? (attackerSelfTags.includes('status:decisive_strike_aoo_active') ? 2 : 1);
  const isDecisiveStrike = strikeDmgMult > 1;

  // Phase 2: StrikeRollPhase (Attack Roll, Confirmation & Fortification)
  const rollResult = resolveAttackRoll({
    attackBonus: preContext.effectiveAttackBonus + smiteCtx.smiteAttackBonus,
    targetAC,
    weaponDice: strike.weaponDice,
    strModifier: 0,
    handedness: 'one_handed',
    flatDamageBonus:
      strike.strDamageBonus + strike.doctrineDamageBonus + strike.flatDamageBonus + smiteCtx.smiteDamageBonus,
    critThreatMin: strike.critThreatMin,
    critMultiplier: strike.critMultiplier,
    targetImmuneToCrits,
    hasBlindFight: attackerEval.hasBlindFight,
    ...(defenderEval.dagResult.fortificationPercent !== undefined
      ? { fortificationPercent: defenderEval.dagResult.fortificationPercent }
      : {}),
    ...(preContext.concealmentMissChance > 0 ? { concealmentMissChancePercent: preContext.concealmentMissChance } : {}),
    ...(params.forcedAttackRoll !== undefined ? { forcedAttackRoll: params.forcedAttackRoll } : {})
  });

  if (!rollResult.hit) {
    const missReason = rollResult.missedDueToConcealment ? ' (Missed due to Concealment!)' : '';
    runningState = addMessage(
      runningState,
      `[d20: ${rollResult.naturalAttackRoll} + ${preContext.effectiveAttackBonus + smiteCtx.smiteAttackBonus} = ${rollResult.totalAttackRoll} vs AC ${targetAC}] ${preContext.strikeLabel} misses${missReason}!`,
      MessageLogCategory.CombatMiss
    );
    runningState = finalizeStrikeAcfStateUpdates({
      state: runningState,
      attackerId,
      defenderId,
      attackerSelfTags,
      hit: false,
      smiteCtx,
      isDecisiveStrike
    });
    return {
      state: runningState,
      hit: false,
      defenderHpRemaining: currentDefenderHp,
      cleavesUsedThisTurn: cleavesCount,
      foeDropped: false
    };
  }

  // Phase 3: OnHitRidersPhase (Weapon Damage Riders & Damage Queueing)
  const existingDamage = getComponent(runningState, defenderId, ComponentType.Damage) as DamageComponent | undefined;
  const multipliedBaseDamage = rollResult.totalDamage * strikeDmgMult;
  const newInstances = [
    {
      amount: multipliedBaseDamage,
      sourceEntityId: attackerId,
      tags: ['melee', 'physical', weaponDamageType, ...bypassTags]
    }
  ];

  let riderText = smiteCtx.smiteDamageBonus > 0 ? ` [Smite +${smiteCtx.smiteDamageBonus}]` : '';
  let totalRiderDamage = 0;

  const defenderCond = summarizeConditionEffects(defenderData.conditions ?? []);
  const defenderHasUncanny =
    defenderSelfTags.includes('feature:uncanny_dodge') || defenderSelfTags.includes('feature:improved_uncanny_dodge');
  const nonFlatFootedDeniedDex = (defenderData.conditions ?? []).some(
    (c) => c === 'blinded' || c === 'stunned' || c === 'helpless' || c === 'paralyzed' || c === 'unconscious'
  );
  const isTargetDeniedDex =
    attackerSelfTags.includes('trait:invisible') ||
    nonFlatFootedDeniedDex ||
    (defenderCond.losesDexToAC && !defenderHasUncanny);

  const sneakRes = resolvePrecisionDamageOnHit({
    sneakAttackDice: resolveSneakAttackDiceCount(attackerData, attackerSelfTags),
    isFlanking: preContext.isFlanking,
    isTargetDeniedDex,
    targetImmuneToCrits,
    fortificationNegated: rollResult.precisionNegated === true,
    concealmentMissChance: preContext.concealmentMissChance,
    attackerSelfTags
  });
  if (sneakRes.damage > 0) {
    newInstances.push({
      amount: sneakRes.damage,
      sourceEntityId: attackerId,
      tags: ['melee', 'physical', 'precision', weaponDamageType, ...bypassTags]
    });
    totalRiderDamage += sneakRes.damage;
    riderText += ` + ${sneakRes.damage} ${sneakRes.usedPenetratingStrike ? 'Penetrating' : 'Sneak'} (${sneakRes.diceUsed}d6)`;
  }

  if (strike.damageRiders && strike.damageRiders.length > 0) {
    for (const rider of strike.damageRiders) {
      if (
        rider.condition &&
        !matchesEntityTagCondition(rider.condition, defenderSelfTags, ['melee', rider.damageType], attackerSelfTags)
      ) {
        continue;
      }
      if (rider.trigger !== 'on_hit' && !(rider.trigger === 'on_crit' && rollResult.isCriticalConfirmed)) continue;
      const diceExpr =
        rider.trigger === 'on_crit' && rider.diceByCritMultiplier
          ? (rider.diceByCritMultiplier[String(strike.critMultiplier)] ?? rider.diceByCritMultiplier['2'] ?? rider.dice)
          : rider.dice;
      const riderAmount = diceExpr ? Math.max(0, evaluateDiceExpression(diceExpr).total) : 0;
      if (riderAmount > 0) {
        const isEnergy = ['fire', 'cold', 'electricity', 'acid', 'sonic'].includes(rider.damageType);
        newInstances.push({
          amount: riderAmount,
          sourceEntityId: attackerId,
          tags: ['melee', isEnergy ? 'energy' : 'physical', rider.damageType, ...bypassTags]
        });
        totalRiderDamage += riderAmount;
        riderText += ` + ${riderAmount} ${rider.damageType}`;
      }
    }
  }

  runningState = addComponent(runningState, defenderId, {
    type: ComponentType.Damage,
    instances: existingDamage ? [...existingDamage.instances, ...newInstances] : newInstances
  });

  if (!strike.isNaturalOrUnarmed) {
    const coatingOutcome = applyAndConsumeWeaponCoatingOnHit(runningState, attackerId, defenderId, defenderSelfTags);
    runningState = coatingOutcome.state;
    totalRiderDamage += coatingOutcome.bonusDamage;
    riderText += coatingOutcome.riderText;
  }

  currentDefenderHp -= multipliedBaseDamage + totalRiderDamage;
  const critText = rollResult.isCriticalConfirmed ? ' CRITICAL HIT!' : '';
  runningState = addMessage(
    runningState,
    `[d20: ${rollResult.naturalAttackRoll} + ${preContext.effectiveAttackBonus + smiteCtx.smiteAttackBonus} = ${rollResult.totalAttackRoll} vs AC ${targetAC}]${critText} ${preContext.strikeLabel} deals ${multipliedBaseDamage} ${weaponDamageType}${riderText} damage!`,
    MessageLogCategory.CombatHit
  );
  runningState = finalizeStrikeAcfStateUpdates({
    state: runningState,
    attackerId,
    defenderId,
    attackerSelfTags,
    hit: true,
    smiteCtx,
    isDecisiveStrike
  });

  if (strike.onHitRiders && strike.onHitRiders.length > 0) {
    runningState = resolveNaturalWeaponOnHitRiders({
      state: runningState,
      defenderId,
      onHitRiders: strike.onHitRiders,
      rawPhysicalDamage: rollResult.totalDamage,
      weaponDamageType,
      bypassTags,
      attackerData,
      defenderData,
      attackerSelfTags,
      attackerEval,
      defenderEval,
      ...(params.forcedRiderSaveRoll !== undefined ? { forcedRiderSaveRoll: params.forcedRiderSaveRoll } : {})
    });
  }

  // Phase 4: PostStrikeReactionPhase (Retaliation Riders & Defender Doctrine)
  runningState = applyPostStrikeRetaliationPhase(runningState, attackerId, defenderId, attackerData, defenderSelfTags);

  // Phase 5: OnDropFollowupPhase (Cleave Follow-up Strikes)
  const foeDropped = currentDefenderHp <= 0;
  if (foeDropped) {
    const cleaveResult = resolveOnDropCleaveFollowup(
      runningState,
      attackerId,
      defenderId,
      strike,
      targetAC,
      attackerEval,
      cleavesCount,
      params.forcedAttackRoll
    );
    runningState = cleaveResult.state;
    cleavesCount = cleaveResult.cleavesUsed;
  }

  return {
    state: runningState,
    hit: true,
    defenderHpRemaining: currentDefenderHp,
    cleavesUsedThisTurn: cleavesCount,
    foeDropped
  };
}
