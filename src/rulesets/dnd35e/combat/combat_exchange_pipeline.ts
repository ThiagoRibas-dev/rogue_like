import { addComponent, getComponent } from '../../../core/ecs.ts';
import { addMessage, MessageLogCategory } from '../../../systems/message.system.ts';
import { matchesEntityTagCondition } from '../../../systems/reaction.system.ts';
import {
  ComponentType,
  type DamageComponent,
  type IdentityComponent,
  type PositionComponent,
  type TacticalDoctrineComponent
} from '../../../types/components.types.ts';
import type { EntityId, GameState } from '../../../types/game-state.types.ts';
import { evaluateActiveSpellAuraContributions } from '../magic/spell_aura_resolver.ts';
import { evaluateDiceExpression } from '../math/dice.ts';
import type { DnD35EntityData } from '../types/dnd35e.types.ts';
import type { DnD35EntityDAGResult } from '../cartridge/dnd35e_dag_adapter.ts';
import { resolveAttackRoll } from './attack_roll.ts';
import type { DnD35ResolvedStrikeProfile } from './attack_routine.ts';
import { resolveOnDropCleaveFollowup, resolveStrikePreAttackContext } from './combat_exchange_phases.ts';
import { resolveRetaliationRiders } from './retaliation_resolver.ts';

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

  let runningState = state;
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
    defenderEval
  );

  const targetAC = defenderEval.dagResult.acBreakdown.fullAC;
  const bypassTags = strike.bypassTags;
  const weaponDamageType = strike.weaponDamageType;

  const isIncorporealWithoutGhostTouch =
    defenderSelfTags.includes('subtype:incorporeal') &&
    !bypassTags.includes('ghost_touch') &&
    !bypassTags.includes('bypass:incorporeal');
  const targetImmuneToCrits =
    defenderData.abilityScores.con.base === null ||
    defenderData.immunities.includes('critical_hits') ||
    defenderSelfTags.includes('type:elemental') ||
    defenderSelfTags.includes('type:ooze') ||
    defenderSelfTags.includes('type:plant') ||
    defenderSelfTags.includes('subtype:swarm') ||
    isIncorporealWithoutGhostTouch;

  // Phase 2: StrikeRollPhase (Attack Roll, Confirmation & Fortification)
  const rollResult = resolveAttackRoll({
    attackBonus: preContext.effectiveAttackBonus,
    targetAC,
    weaponDice: strike.weaponDice,
    strModifier: 0,
    handedness: 'one_handed',
    flatDamageBonus: strike.strDamageBonus + strike.doctrineDamageBonus + strike.flatDamageBonus,
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
      `[d20: ${rollResult.naturalAttackRoll} + ${preContext.effectiveAttackBonus} = ${rollResult.totalAttackRoll} vs AC ${targetAC}] ${preContext.strikeLabel} misses${missReason}!`,
      MessageLogCategory.CombatMiss
    );
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
  const newInstances = [
    {
      amount: rollResult.totalDamage,
      sourceEntityId: attackerId,
      tags: ['melee', 'physical', weaponDamageType, ...bypassTags]
    }
  ];

  let riderText = '';
  let totalRiderDamage = 0;
  if (strike.damageRiders && strike.damageRiders.length > 0) {
    for (const rider of strike.damageRiders) {
      if (
        rider.condition &&
        !matchesEntityTagCondition(rider.condition, defenderSelfTags, ['melee', rider.damageType], attackerSelfTags)
      ) {
        continue;
      }
      if (rider.trigger === 'on_hit' || (rider.trigger === 'on_crit' && rollResult.isCriticalConfirmed)) {
        const diceExpr =
          rider.trigger === 'on_crit' && rider.diceByCritMultiplier
            ? (rider.diceByCritMultiplier[String(strike.critMultiplier)] ??
              rider.diceByCritMultiplier['2'] ??
              rider.dice)
            : rider.dice;
        if (diceExpr) {
          const riderRoll = evaluateDiceExpression(diceExpr);
          const riderAmount = Math.max(0, riderRoll.total);
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
    }
  }

  runningState = addComponent(runningState, defenderId, {
    type: ComponentType.Damage,
    instances: existingDamage ? [...existingDamage.instances, ...newInstances] : newInstances
  });

  currentDefenderHp -= rollResult.totalDamage + totalRiderDamage;
  const critText = rollResult.isCriticalConfirmed ? ' CRITICAL HIT!' : '';
  runningState = addMessage(
    runningState,
    `[d20: ${rollResult.naturalAttackRoll} + ${preContext.effectiveAttackBonus} = ${rollResult.totalAttackRoll} vs AC ${targetAC}]${critText} ${preContext.strikeLabel} deals ${rollResult.totalDamage} ${weaponDamageType}${riderText} damage!`,
    MessageLogCategory.CombatHit
  );

  // Phase 4: PostStrikeReactionPhase (Retaliation Riders & Defender Doctrine)
  const attackerPos = getComponent(runningState, attackerId, ComponentType.Position) as PositionComponent | undefined;
  const defenderPos = getComponent(runningState, defenderId, ComponentType.Position) as PositionComponent | undefined;
  const distTiles =
    attackerPos && defenderPos
      ? Math.max(Math.abs(attackerPos.x - defenderPos.x), Math.abs(attackerPos.y - defenderPos.y))
      : 1;

  const defenderAuraContrib = evaluateActiveSpellAuraContributions(runningState, defenderId, defenderSelfTags);
  const defenderDoctrine = getComponent(runningState, defenderId, ComponentType.TacticalDoctrine) as
    TacticalDoctrineComponent | undefined;

  if (defenderAuraContrib.retaliationRiders.length > 0) {
    const attackerIdentity = getComponent(runningState, attackerId, ComponentType.Identity) as
      IdentityComponent | undefined;
    const defenderIdentity = getComponent(runningState, defenderId, ComponentType.Identity) as
      IdentityComponent | undefined;
    const retResult = resolveRetaliationRiders({
      activeRiders: defenderAuraContrib.retaliationRiders,
      defenderDoctrine,
      triggerType: 'melee',
      chebyshevDistanceTiles: distTiles,
      attackerName: attackerIdentity?.name ?? 'Attacker',
      defenderName: defenderIdentity?.name ?? 'Defender',
      attackerDr: attackerData.damageReduction,
      attackerEnergyResistance: attackerData.energyResistance,
      attackerImmunities: attackerData.immunities,
      attackerVulnerabilities: attackerData.vulnerabilities
    });

    if (retResult.updatedDefenderDoctrine) {
      runningState = addComponent(runningState, defenderId, retResult.updatedDefenderDoctrine);
    }

    for (const msg of retResult.logMessages) {
      runningState = addMessage(runningState, msg, MessageLogCategory.CombatHit);
    }

    if (retResult.totalDamageToAttacker > 0) {
      const attackerExistingDmg = getComponent(runningState, attackerId, ComponentType.Damage) as
        DamageComponent | undefined;
      runningState = addComponent(runningState, attackerId, {
        type: ComponentType.Damage,
        instances: [
          ...(attackerExistingDmg?.instances ?? []),
          {
            amount: retResult.totalDamageToAttacker,
            sourceEntityId: defenderId,
            tags: ['retaliation', 'force', 'spell']
          }
        ]
      });
    }
  }

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
      cleavesCount
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
