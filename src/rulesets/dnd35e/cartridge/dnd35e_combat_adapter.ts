import { addComponent, getComponent, removeComponent, resolveEntityDisplayName } from '../../../core/ecs.ts';
import { addFloatingText } from '../../../systems/damage.system.ts';
import {
  appendInteractionFrame,
  createInteractionChain,
  resolveInteractionOriginator
} from '../../../systems/interaction_provenance.system.ts';
import { addMessage, MessageLogCategory } from '../../../systems/message.system.ts';
import {
  ComponentType,
  type DamageComponent,
  type FighterComponent,
  type InteractionChain,
  type PropertyOverlayComponent,
  type StructuralComponent,
  type TagsComponent
} from '../../../types/components.types.ts';
import { GameEventType } from '../../../types/events.types.ts';
import { EngineMode, type EntityId, type GameState } from '../../../types/game-state.types.ts';
import type { MeleeAttackIntent } from '../../../types/intents/combat.intents.ts';
import { consumeStandardActionFromBudget } from '../action_economy.ts';
import { executeCombatStrikeExchange } from '../combat/combat_exchange_pipeline.ts';
import { evaluateVitalityStatus, mitigateIncomingDamage } from '../combat/damage_vitality.ts';
import { evaluateOffTurnImmediateReactions } from '../combat/immediate_reactions.ts';
import { applySrdObjectAttackDamage } from '../combat/object_durability_resolver.ts';
import { evaluateDiceExpression } from '../math/dice.ts';
import { projectDnD35ActorSemanticTags, resolveEntitySituationalTagContext } from '../semantic_tags.ts';
import { getDnD35EntityData, resolveDamageTypeFromTags, setDnD35EntityData } from '../srd_registry.ts';
import { getDnD35SystemContent } from '../types/dnd35e_system.types.ts';
import { resolveEffectiveEntityDataWithOverlays } from '../wild_shape.ts';
import { evaluateDnD35eEntityDAG } from './dnd35e_dag_adapter.ts';
import { hydrateEntityRoundActionBudget } from './dnd35e_turn_budget.ts';

/** Maximum distance in feet (`5`) moved in a round that still allows a Full-Attack action (PHB p. 144). */
const FIVE_FOOT_STEP_MAX_DISTANCE_FT = 5;

/**
 * Resolves a melee attack intent in the `dnd35e` ruleset cartridge using the 5-phase
 * Composable `executeCombatStrikeExchange` pipeline (PreAttack, StrikeRoll, OnHitRiders,
 * PostStrikeReaction, and OnDropFollowup), or routes attacks against inanimate `StructuralComponent`
 * objects/doors through `applySrdObjectAttackDamage`.
 *
 * @param state The current GameState.
 * @param intent The MeleeAttackIntent to resolve.
 * @returns Updated GameState and success boolean.
 */
export function resolveDnD35eMeleeAttack(
  state: GameState,
  intent: MeleeAttackIntent,
  options?: {
    readonly isChargeAttack?: boolean | undefined;
    readonly interaction?: InteractionChain | undefined;
    readonly skipActionBudgetCheck?: boolean | undefined;
  }
): { state: GameState; success: boolean } {
  const { entityId: attackerId, defenderId } = intent;
  const attackerFighter = getComponent(state, attackerId, ComponentType.Fighter);
  const targetFighter = getComponent(state, defenderId, ComponentType.Fighter);
  const targetStructural = getComponent(state, defenderId, ComponentType.Structural) as StructuralComponent | undefined;

  if (!attackerFighter) {
    return { state, success: false };
  }

  if (!targetFighter && targetStructural) {
    const attackerEval = evaluateDnD35eEntityDAG(state, attackerId);
    const primaryStrike = attackerEval?.attackRoutine.strikes[0];
    const diceTotal = primaryStrike ? Math.max(1, evaluateDiceExpression(primaryStrike.weaponDice).total) : 1;
    const rawDamage = Math.max(
      1,
      diceTotal +
        (primaryStrike
          ? primaryStrike.strDamageBonus + primaryStrike.doctrineDamageBonus + primaryStrike.flatDamageBonus
          : 0)
    );
    const dmgType = resolveDamageTypeFromTags(
      primaryStrike?.weaponDamageType ? [primaryStrike.weaponDamageType] : ['slashing']
    );
    const weaponMaterialTag = primaryStrike?.bypassTags?.includes('adamantine') ? 'adamantine' : undefined;
    const objRes = applySrdObjectAttackDamage(state, defenderId, {
      rawDamage,
      damageType: dmgType,
      ...(weaponMaterialTag !== undefined ? { weaponMaterialTag } : {})
    });
    const atkName = resolveEntityDisplayName(objRes.state, attackerId, 'Attacker');
    const objName = resolveEntityDisplayName(objRes.state, defenderId, 'the object');
    const msg = `${atkName} strikes ${objName} for ${objRes.evaluation.netDamage} structural damage (${objRes.remainingHp}/${objRes.evaluation.effectiveMaxHp} HP remaining, hardness ${objRes.evaluation.effectiveHardness}).`;
    return {
      state: addMessage(objRes.state, msg, MessageLogCategory.CombatHit),
      success: true
    };
  }

  if (!targetFighter) {
    return { state, success: false };
  }

  const baseInteraction =
    options?.interaction ??
    intent.interaction ??
    createInteractionChain(attackerId, {
      kind: 'intent',
      intentType: intent.type,
      actorId: attackerId
    });
  const actionInteraction = appendInteractionFrame(baseInteraction, {
    kind: 'action',
    actionId: options?.isChargeAttack === true ? 'charge_attack' : 'melee_attack',
    actorId: attackerId
  });

  const reactionRes = evaluateOffTurnImmediateReactions(state, 'before_melee_attack', attackerId, defenderId);
  let activeState = reactionRes.state;
  const attackerData = resolveEffectiveEntityDataWithOverlays(
    getDnD35EntityData(activeState, attackerId),
    getComponent(activeState, attackerId, ComponentType.PropertyOverlay) as PropertyOverlayComponent | undefined
  );

  if (reactionRes.defenderTeleportedOutOfReach) {
    const budget = attackerData.actionBudget;
    if (options?.skipActionBudgetCheck !== true && budget && budget.standardRemaining >= 1) {
      const stdRes = consumeStandardActionFromBudget(budget);
      activeState = setDnD35EntityData(activeState, attackerId, {
        ...attackerData,
        actionBudget: stdRes.budget
      });
    }
    return {
      state: addMessage(
        activeState,
        'Melee attack swings through empty space as defender blinks away!',
        MessageLogCategory.CombatMiss
      ),
      success: true
    };
  }

  const defenderData = resolveEffectiveEntityDataWithOverlays(
    getDnD35EntityData(activeState, defenderId),
    getComponent(activeState, defenderId, ComponentType.PropertyOverlay) as PropertyOverlayComponent | undefined
  );

  const sysContent = getDnD35SystemContent(activeState.campaign);
  const attackerSituational = resolveEntitySituationalTagContext(activeState, attackerId, attackerData);
  const defenderSituational = resolveEntitySituationalTagContext(activeState, defenderId, defenderData);
  const atkRawTags =
    (getComponent(activeState, attackerId, ComponentType.Tags) as TagsComponent | undefined)?.tags ?? [];
  const defRawTags =
    (getComponent(activeState, defenderId, ComponentType.Tags) as TagsComponent | undefined)?.tags ?? [];

  const attackerSelfTags = projectDnD35ActorSemanticTags(
    attackerData,
    atkRawTags,
    attackerSituational,
    sysContent?.classes,
    sysContent?.skills,
    sysContent?.domains,
    sysContent?.feats
  );
  const defenderSelfTags = projectDnD35ActorSemanticTags(
    defenderData,
    defRawTags,
    defenderSituational,
    sysContent?.classes,
    sysContent?.skills,
    sysContent?.domains,
    sysContent?.feats
  );

  const attackerEval = evaluateDnD35eEntityDAG(
    activeState,
    attackerId,
    { targetTags: defenderSelfTags },
    { dndData: attackerData, selfTags: attackerSelfTags }
  );
  const defenderEval = evaluateDnD35eEntityDAG(
    activeState,
    defenderId,
    { targetTags: attackerSelfTags },
    { dndData: defenderData, selfTags: defenderSelfTags }
  );

  if (!attackerEval || !defenderEval) {
    return { state: activeState, success: false };
  }

  if (!attackerEval.canAttack) {
    return {
      state: addMessage(activeState, 'Cannot attack while in Total Defense stance!', MessageLogCategory.CombatMiss),
      success: false
    };
  }

  const actionBudget =
    attackerData.actionBudget ??
    (activeState.engineMode === EngineMode.RTwP ? hydrateEntityRoundActionBudget(activeState, attackerId) : undefined);
  if (options?.skipActionBudgetCheck !== true && actionBudget && actionBudget.standardRemaining < 1) {
    return { state: activeState, success: false };
  }

  const distanceMovedFt = actionBudget?.distanceMovedThisRoundFt ?? 0;
  const hasPounce =
    attackerSelfTags.includes('special_attack:pounce') ||
    attackerSelfTags.includes('trait:pounce') ||
    attackerData.hasPounce === true;
  const isChargeAttack = options?.isChargeAttack === true;
  const isFullAttack = isChargeAttack
    ? hasPounce
    : distanceMovedFt <= FIVE_FOOT_STEP_MAX_DISTANCE_FT && (actionBudget ? actionBudget.moveRemaining >= 1 : true);
  const strikes = isFullAttack ? attackerEval.attackRoutine.strikes : attackerEval.attackRoutine.strikes.slice(0, 1);

  if (strikes.length === 0) {
    return { state: activeState, success: false };
  }

  // Consume Standard (or Full-Round) action in actionBudget if present
  let updatedAttackerData = attackerData;
  if (actionBudget) {
    const consumesFullRound = isFullAttack || isChargeAttack;
    const nextStd = consumesFullRound ? 0 : Math.max(0, actionBudget.standardRemaining - 1);
    const nextMove = consumesFullRound ? 0 : actionBudget.moveRemaining;
    const movedBeforeAttack = distanceMovedFt > 0;
    const nextRemainingFt = consumesFullRound || movedBeforeAttack ? 0 : actionBudget.movementRemainingFt;
    updatedAttackerData = {
      ...attackerData,
      actionBudget: {
        ...actionBudget,
        standardRemaining: nextStd,
        moveRemaining: nextMove,
        movementRemainingFt: nextRemainingFt,
        fiveFootStepAvailable: false,
        canMoveFurtherThisRound:
          !consumesFullRound && (nextMove > 0 || !movedBeforeAttack) && (nextMove > 0 || nextStd > 0),
        hasActedThisRound: true
      }
    };
  }

  let runningState = actionBudget ? setDnD35EntityData(activeState, attackerId, updatedAttackerData) : activeState;
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
      cleavesUsedThisTurn,
      isChargeAttack,
      interaction: actionInteraction
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
    if (!fighter) {
      const structural = getComponent(nextState, entityId, ComponentType.Structural) as StructuralComponent | undefined;
      if (structural) {
        for (const inst of damageComp.instances) {
          const dmgType = resolveDamageTypeFromTags(inst.tags);
          const isRanged = inst.tags.includes('ranged') || inst.tags.includes('throw');
          const weaponMaterialTag = inst.tags.includes('adamantine') ? 'adamantine' : undefined;
          const objRes = applySrdObjectAttackDamage(nextState, entityId, {
            rawDamage: Math.max(0, inst.amount),
            damageType: dmgType,
            isRangedWeapon: isRanged,
            ...(weaponMaterialTag !== undefined ? { weaponMaterialTag } : {})
          });
          nextState = objRes.state;
        }
      }
      continue;
    }

    const defenderData = getDnD35EntityData(nextState, entityId);
    let totalDamage = 0;
    let lastAttackerId: EntityId | undefined;
    let lastInteraction: InteractionChain | undefined;

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
      if (inst.interaction !== undefined) lastInteraction = inst.interaction;
      const instOriginator =
        inst.interaction !== undefined ? resolveInteractionOriginator(inst.interaction) : inst.sourceEntityId;
      if (instOriginator !== undefined) lastAttackerId = instOriginator;
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
          ...(lastAttackerId !== undefined ? { sourceEntityId: lastAttackerId } : {}),
          ...(lastInteraction !== undefined ? { interaction: lastInteraction } : {})
        }
      ]
    };

    if (totalDamage > 0) {
      nextState = addFloatingText(nextState, entityId, `-${totalDamage}`, '#ff4757');
    }

    const isPlayer = getComponent(nextState, entityId, ComponentType.Player) !== undefined;
    const conIsNull = defenderData.abilityScores.con.base === null;
    const defenderDag = evaluateDnD35eEntityDAG(nextState, entityId);
    const vitality = evaluateVitalityStatus(
      newHp,
      defenderData.nonlethalDamage,
      defenderData.isStable,
      conIsNull,
      defenderDag?.dagResult.deathHpThreshold
    );

    if (vitality.status === 'dead' || (!isPlayer && newHp <= 0)) {
      nextState = addComponent(nextState, entityId, {
        type: ComponentType.Death,
        ...(lastAttackerId !== undefined ? { killerId: lastAttackerId } : {}),
        ...(lastInteraction !== undefined ? { interaction: lastInteraction } : {})
      });
    }
  }
  return nextState;
}
