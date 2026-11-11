import { addComponent, getComponent, removeComponent } from '../../../core/ecs.ts';
import { addFloatingText } from '../../../systems/damage.system.ts';
import { addMessage, MessageLogCategory } from '../../../systems/message.system.ts';
import {
  ComponentType,
  type DamageComponent,
  type FighterComponent,
  type PropertyOverlayComponent
} from '../../../types/components.types.ts';
import { GameEventType } from '../../../types/events.types.ts';
import type { EntityId, GameState } from '../../../types/game-state.types.ts';
import type { MeleeAttackIntent } from '../../../types/intents/combat.intents.ts';
import { executeCombatStrikeExchange } from '../combat/combat_exchange_pipeline.ts';
import { evaluateVitalityStatus, mitigateIncomingDamage } from '../combat/damage_vitality.ts';
import { projectDnD35ActorSemanticTags, resolveEntitySituationalTagContext } from '../semantic_tags.ts';
import { getDnD35EntityData, resolveDamageTypeFromTags, setDnD35EntityData } from '../srd_registry.ts';
import { getDnD35SystemContent } from '../types/dnd35e_system.types.ts';
import { resolveEffectiveEntityDataWithOverlays } from '../wild_shape.ts';
import { evaluateDnD35eEntityDAG } from './dnd35e_dag_adapter.ts';

/** Maximum distance in feet (`5`) moved in a round that still allows a Full-Attack action (PHB p. 144). */
const FIVE_FOOT_STEP_MAX_DISTANCE_FT = 5;

/**
 * Resolves a melee attack intent in the `dnd35e` ruleset cartridge using the 5-phase
 * Composable `executeCombatStrikeExchange` pipeline (PreAttack, StrikeRoll, OnHitRiders,
 * PostStrikeReaction, and OnDropFollowup).
 *
 * @param state The current GameState.
 * @param intent The MeleeAttackIntent to resolve.
 * @returns Updated GameState and success boolean.
 */
export function resolveDnD35eMeleeAttack(
  state: GameState,
  intent: MeleeAttackIntent
): { state: GameState; success: boolean } {
  const { entityId: attackerId, defenderId } = intent;
  const attackerFighter = getComponent(state, attackerId, ComponentType.Fighter);
  const targetFighter = getComponent(state, defenderId, ComponentType.Fighter);
  if (!attackerFighter || !targetFighter) {
    return { state, success: false };
  }

  const attackerData = resolveEffectiveEntityDataWithOverlays(
    getDnD35EntityData(state, attackerId),
    getComponent(state, attackerId, ComponentType.PropertyOverlay) as PropertyOverlayComponent | undefined
  );
  const defenderData = resolveEffectiveEntityDataWithOverlays(
    getDnD35EntityData(state, defenderId),
    getComponent(state, defenderId, ComponentType.PropertyOverlay) as PropertyOverlayComponent | undefined
  );

  const sysContent = getDnD35SystemContent(state.campaign);
  const attackerSituational = resolveEntitySituationalTagContext(state, attackerId, attackerData);
  const defenderSituational = resolveEntitySituationalTagContext(state, defenderId, defenderData);

  const attackerSelfTags = projectDnD35ActorSemanticTags(
    attackerData,
    [],
    attackerSituational,
    sysContent?.classes,
    sysContent?.skills
  );
  const defenderSelfTags = projectDnD35ActorSemanticTags(
    defenderData,
    [],
    defenderSituational,
    sysContent?.classes,
    sysContent?.skills
  );

  const attackerEval = evaluateDnD35eEntityDAG(
    state,
    attackerId,
    { targetTags: defenderSelfTags },
    { dndData: attackerData, selfTags: attackerSelfTags }
  );
  const defenderEval = evaluateDnD35eEntityDAG(
    state,
    defenderId,
    { targetTags: attackerSelfTags },
    { dndData: defenderData, selfTags: defenderSelfTags }
  );

  if (!attackerEval || !defenderEval) {
    return { state, success: false };
  }

  if (!attackerEval.canAttack) {
    return {
      state: addMessage(state, 'Cannot attack while in Total Defense stance!', MessageLogCategory.CombatMiss),
      success: false
    };
  }

  const actionBudget = attackerData.actionBudget;
  const distanceMovedFt = actionBudget?.distanceMovedThisRoundFt ?? 0;
  const isFullAttack = distanceMovedFt <= FIVE_FOOT_STEP_MAX_DISTANCE_FT;
  const strikes = isFullAttack ? attackerEval.attackRoutine.strikes : attackerEval.attackRoutine.strikes.slice(0, 1);

  if (strikes.length === 0) {
    return { state, success: false };
  }

  // Consume standard action in actionBudget if present
  let updatedAttackerData = attackerData;
  if (actionBudget) {
    const nextStd = isFullAttack ? 0 : Math.max(0, actionBudget.standardRemaining - 1);
    const nextMove = isFullAttack ? 0 : actionBudget.moveRemaining;
    const nextRemainingFt = isFullAttack ? 0 : actionBudget.movementRemainingFt;
    updatedAttackerData = {
      ...attackerData,
      actionBudget: {
        ...actionBudget,
        standardRemaining: nextStd,
        moveRemaining: nextMove,
        movementRemainingFt: nextRemainingFt,
        fiveFootStepAvailable: false,
        canMoveFurtherThisRound: !isFullAttack && nextRemainingFt > 0
      }
    };
  }

  let runningState = actionBudget ? setDnD35EntityData(state, attackerId, updatedAttackerData) : state;
  let anyStrikeAttempted = false;
  let defenderHpRemaining = targetFighter.hp;
  let cleavesUsedThisTurn = 0;

  for (let sIdx = 0; sIdx < strikes.length; sIdx++) {
    const strike = strikes[sIdx]!;
    anyStrikeAttempted = true;

    const exchangeRes = executeCombatStrikeExchange({
      state: runningState,
      attackerId,
      defenderId,
      strike,
      strikeIndex: sIdx,
      totalStrikes: strikes.length,
      attackerData,
      defenderData,
      attackerSelfTags,
      defenderSelfTags,
      attackerEval,
      defenderEval,
      defenderHpRemaining,
      cleavesUsedThisTurn
    });

    runningState = exchangeRes.state;
    defenderHpRemaining = exchangeRes.defenderHpRemaining;
    cleavesUsedThisTurn = exchangeRes.cleavesUsedThisTurn;

    if (defenderHpRemaining <= 0) {
      break;
    }
  }

  return {
    state: runningState,
    success: anyStrikeAttempted
  };
}

/**
 * Processes queued `DamageComponent` instances on entities for the `dnd35e` cartridge,
 * applying `mitigateIncomingDamage` (`DR`, Energy Resistance, Immunity/Vulnerability) and
 * `evaluateVitalityStatus` (`0 HP` Disabled, `-1..-9 HP` Dying, `-10 HP` Dead, or `0 HP`
 * immediate destruction for `CON: null` Undead/Constructs).
 *
 * @param state The current GameState.
 * @returns Updated GameState.
 */
export function processDnD35eDamage(state: GameState): GameState {
  let nextState = state;
  for (const entityId of state.entities) {
    const damageComp = getComponent(nextState, entityId, ComponentType.Damage) as DamageComponent | undefined;
    if (!damageComp || damageComp.instances.length === 0) continue;

    nextState = removeComponent(nextState, entityId, ComponentType.Damage);
    const fighter = getComponent(nextState, entityId, ComponentType.Fighter) as FighterComponent | undefined;
    if (!fighter) continue;

    const defenderData = getDnD35EntityData(nextState, entityId);
    let totalDamage = 0;
    let lastAttackerId: EntityId | undefined;

    for (const inst of damageComp.instances) {
      const dmgType = resolveDamageTypeFromTags(inst.tags);
      const mitigated = mitigateIncomingDamage({
        rawDamage: Math.max(0, inst.amount),
        damageType: dmgType,
        attackBypassTags: inst.tags,
        ...(defenderData.damageReduction !== undefined ? { damageReduction: defenderData.damageReduction } : {}),
        energyResistance: defenderData.energyResistance,
        immunities: defenderData.immunities,
        vulnerabilities: defenderData.vulnerabilities
      });
      totalDamage += mitigated.finalDamage;
      if (inst.sourceEntityId !== undefined) lastAttackerId = inst.sourceEntityId;
    }

    const newHp = fighter.hp - totalDamage;
    nextState = addComponent(nextState, entityId, { ...fighter, hp: newHp });
    nextState = {
      ...nextState,
      events: [
        ...nextState.events,
        {
          type: GameEventType.EntityDamaged,
          entityId,
          amount: totalDamage,
          ...(lastAttackerId !== undefined ? { sourceEntityId: lastAttackerId } : {})
        }
      ]
    };

    if (totalDamage > 0) {
      nextState = addFloatingText(nextState, entityId, `-${totalDamage}`, '#ff4757');
    }

    const isPlayer = getComponent(nextState, entityId, ComponentType.Player) !== undefined;
    const conIsNull = defenderData.abilityScores.con.base === null;
    const vitality = evaluateVitalityStatus(newHp, defenderData.nonlethalDamage, defenderData.isStable, conIsNull);

    if (vitality.status === 'dead' || (!isPlayer && newHp <= 0)) {
      nextState = addComponent(nextState, entityId, {
        type: ComponentType.Death,
        ...(lastAttackerId !== undefined ? { killerId: lastAttackerId } : {})
      });
    }
  }
  return nextState;
}
