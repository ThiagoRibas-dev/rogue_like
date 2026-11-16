import { getComponent } from '../../../core/ecs.ts';
import {
  ComponentType,
  type FighterComponent,
  type PositionComponent,
  type PropertyOverlayComponent
} from '../../../types/components.types.ts';
import { EngineMode, type EntityId, type GameState } from '../../../types/game-state.types.ts';
import { IntentType } from '../../../types/intents/intent.enum.ts';
import type { Intent } from '../../../types/intents/intent.union.ts';
import { assertNever } from '../../../utils/assert.ts';
import { coordToIndex } from '../../../utils/grid.ts';
import { getEffectiveStats } from '../../../utils/stats.ts';
import {
  consumeMoveActionFromBudget,
  consumeMovementStepFt,
  consumeStandardActionFromBudget,
  createRoundActionBudget
} from '../action_economy.ts';
import { evaluateVitalityStatus } from '../combat/damage_vitality.ts';
import { resolveTypedModifiersWithBreakdown } from '../modifiers/stacking_engine.ts';
import { FEET_PER_GRID_SQUARE } from '../spatial/grid_geometry.ts';
import { getDnD35EntityData, setDnD35EntityData } from '../srd_registry.ts';
import type { DnD35ActionBudget, StatModifier } from '../types/dnd35e.types.ts';
import { evaluateDnD35eEntityDAG } from './dnd35e_dag_adapter.ts';

/** Standard full round energy cost (`100`). */
export const FULL_ROUND_ENERGY_COST = 100;

/** Baseline D&D 3.5e land speed in feet (`30 ft` = `6` five-foot squares per Move action). */
const BASELINE_LAND_SPEED_FT = 30;

function sumExtraActionModifier(
  mods: ReadonlyArray<StatModifier>,
  targetStat: string,
  selfTags: ReadonlyArray<string>
): number {
  const matching = mods.filter((m) => m.targetStat === targetStat);
  if (matching.length === 0) return 0;
  return resolveTypedModifiersWithBreakdown(matching, { selfTags }).total;
}

/**
 * Hydrates a fresh 6-second round `DnD35ActionBudget` dynamically from an entity's traits,
 * conditions, vitality state, off-turn immediate usage, and `StatModifier` extra-action bonuses.
 *
 * @param state Current immutable GameState.
 * @param entityId The actor entity ID.
 * @returns Initialized `DnD35ActionBudget`.
 */
export function hydrateEntityRoundActionBudget(state: GameState, entityId: EntityId): DnD35ActionBudget {
  const dag = evaluateDnD35eEntityDAG(state, entityId);
  const dndData = dag?.dndData ?? getDnD35EntityData(state, entityId);
  const fighter = getComponent(state, entityId, ComponentType.Fighter) as FighterComponent | undefined;
  const conIsNull = dndData.abilityScores?.con?.base === null;
  const vitality = fighter
    ? evaluateVitalityStatus(fighter.hp, dndData.nonlethalDamage, dndData.isStable, conIsNull)
    : { status: 'healthy' as const };

  const dexMod =
    dag?.dagResult.effectiveAbilityModifiers.dex ?? Math.floor(((dndData.abilityScores?.dex?.base ?? 10) - 10) / 2);
  const selfTags = dag?.selfTags ?? [];
  const mods = dag?.statModifiers ?? dndData.statModifiers ?? [];
  const conditions = dndData.conditions ?? [];

  const hasReflexes =
    (dndData.feats?.includes('combat_reflexes') ?? false) || selfTags.includes('feat:combat_reflexes');
  const isFlatFooted = conditions.includes('flat_footed') || selfTags.includes('condition:flat_footed');
  const isNauseated = conditions.includes('nauseated') || selfTags.includes('condition:nauseated');
  const singleActionOnly =
    dndData.singleActionsOnly === true ||
    conditions.includes('staggered') ||
    selfTags.includes('single_actions_only') ||
    selfTags.includes('trait:single_actions_only') ||
    selfTags.includes('condition:staggered') ||
    vitality.status === 'staggered' ||
    vitality.status === 'disabled';

  return createRoundActionBudget({
    dexModifier: dexMod,
    hasCombatReflexes: hasReflexes,
    isFlatFooted,
    immediateUsedOffTurn: dndData.actionBudget?.immediateUsedOffTurn === true,
    singleActionOnly,
    isNauseated,
    extraStandardActions: sumExtraActionModifier(mods, 'extra_standard_actions', selfTags),
    extraMoveActions: sumExtraActionModifier(mods, 'extra_move_actions', selfTags),
    extraSwiftActions: sumExtraActionModifier(mods, 'extra_swift_actions', selfTags),
    extraAoO: sumExtraActionModifier(mods, 'extra_aoo', selfTags)
  });
}

function computeActorTacticalLandSpeedFt(
  state: GameState,
  entityId: EntityId,
  baseLandSpeedFt: number | undefined
): number {
  const actor = getComponent(state, entityId, ComponentType.Actor);
  const overlay = getComponent(state, entityId, ComponentType.PropertyOverlay) as PropertyOverlayComponent | undefined;
  const stats = getEffectiveStats(state, entityId);
  const baseActorSpeed = actor?.speed ?? FULL_ROUND_ENERGY_COST;
  const speedBonusFt = stats.speed - baseActorSpeed;
  const effectiveLandFt = overlay?.movementModesOverride?.land ?? baseLandSpeedFt ?? BASELINE_LAND_SPEED_FT;
  return Math.max(FEET_PER_GRID_SQUARE, effectiveLandFt + speedBonusFt);
}

function hasAnyRoundActionsRemaining(budget: DnD35ActionBudget): boolean {
  return budget.movementRemainingFt > 0 || budget.standardRemaining > 0 || budget.moveRemaining > 0;
}

function clearBudgetAndEndRound(
  state: GameState,
  entityId: EntityId,
  dndData: ReturnType<typeof getDnD35EntityData>
): { readonly state: GameState; readonly energyCost: number } {
  const nextState = dndData.actionBudget
    ? setDnD35EntityData(state, entityId, { ...dndData, actionBudget: undefined })
    : state;
  return { state: nextState, energyCost: FULL_ROUND_ENERGY_COST };
}

/**
 * Commits an updated `DnD35ActionBudget` onto `entityId` after spending an action, returning
 * `energyCost: FULL_ROUND_ENERGY_COST` if all actions/movement are exhausted or `0` otherwise.
 */
export function finalizeBudgetAfterAction(
  state: GameState,
  entityId: EntityId,
  dndData: ReturnType<typeof getDnD35EntityData>,
  postBudget: DnD35ActionBudget
): { readonly state: GameState; readonly energyCost: number } {
  if (!hasAnyRoundActionsRemaining(postBudget)) {
    const nextState = setDnD35EntityData(state, entityId, { ...dndData, actionBudget: undefined });
    return { state: nextState, energyCost: FULL_ROUND_ENERGY_COST };
  }
  const nextState = setDnD35EntityData(state, entityId, {
    ...dndData,
    actionBudget: postBudget.hasActedThisRound === true ? postBudget : { ...postBudget, hasActedThisRound: true }
  });
  return { state: nextState, energyCost: 0 };
}

/**
 * Resolves D&D 3.5e 5-tier action budget consumption and energy cost symmetrically for ALL actors in TurnBased mode.
 * Returns `energyCost: 0` while movement or actions remain in the round, or `100` when the round completes.
 */
export function resolveDnD35eActionEnergyCost(
  state: GameState,
  intent: Intent,
  baseEnergyCost: number,
  preActionState?: GameState
): { readonly state: GameState; readonly energyCost: number } {
  if (state.engineMode !== EngineMode.TurnBased || baseEnergyCost <= 0) {
    return { state, energyCost: baseEnergyCost };
  }

  const dndData = getDnD35EntityData(state, intent.entityId);
  const preDndData = preActionState ? getDnD35EntityData(preActionState, intent.entityId) : undefined;
  const budgetAlreadyMutated =
    preActionState !== undefined &&
    dndData.actionBudget !== undefined &&
    preDndData?.actionBudget !== dndData.actionBudget;
  const currentBudget = dndData.actionBudget ?? hydrateEntityRoundActionBudget(state, intent.entityId);

  switch (intent.type) {
    case IntentType.Wait:
    case IntentType.ChangeArea:
      return clearBudgetAndEndRound(state, intent.entityId, dndData);

    case IntentType.Move: {
      const actorSpeedFt = computeActorTacticalLandSpeedFt(state, intent.entityId, dndData.movementModes?.land);
      const posAfter = getComponent(state, intent.entityId, ComponentType.Position) as PositionComponent | undefined;
      const tile = posAfter ? state.map.tiles[coordToIndex(posAfter.x, posAfter.y, state.map.width)] : undefined;
      const isDifficult = (tile ? (state.campaign.tiles[tile.tileId]?.movementCost ?? 100) : 100) > 100;
      const stepResult = consumeMovementStepFt(currentBudget, actorSpeedFt, FEET_PER_GRID_SQUARE, isDifficult);
      if (!stepResult.allowed) return clearBudgetAndEndRound(state, intent.entityId, dndData);
      return finalizeBudgetAfterAction(state, intent.entityId, dndData, stepResult.budget);
    }

    case IntentType.UseAbility:
      if (state.targetingMode?.active && state.targetingMode.context?.verb === 'abrupt_jaunt') {
        return hasAnyRoundActionsRemaining(currentBudget)
          ? { state, energyCost: 0 }
          : clearBudgetAndEndRound(state, intent.entityId, dndData);
      }
      if (budgetAlreadyMutated) return finalizeBudgetAfterAction(state, intent.entityId, dndData, currentBudget);
      {
        const stdRes = consumeStandardActionFromBudget(currentBudget);
        return stdRes.allowed
          ? finalizeBudgetAfterAction(state, intent.entityId, dndData, stdRes.budget)
          : clearBudgetAndEndRound(state, intent.entityId, dndData);
      }

    case IntentType.MeleeAttack:
    case IntentType.FireAimed:
    case IntentType.Apply: {
      if (budgetAlreadyMutated) return finalizeBudgetAfterAction(state, intent.entityId, dndData, currentBudget);
      const stdRes = consumeStandardActionFromBudget(currentBudget);
      return stdRes.allowed
        ? finalizeBudgetAfterAction(state, intent.entityId, dndData, stdRes.budget)
        : clearBudgetAndEndRound(state, intent.entityId, dndData);
    }

    case IntentType.PickUp:
    case IntentType.EquipItem:
    case IntentType.UnequipItem:
    case IntentType.Interact: {
      if (budgetAlreadyMutated) return finalizeBudgetAfterAction(state, intent.entityId, dndData, currentBudget);
      const moveRes = consumeMoveActionFromBudget(currentBudget);
      return moveRes.allowed
        ? finalizeBudgetAfterAction(state, intent.entityId, dndData, moveRes.budget)
        : clearBudgetAndEndRound(state, intent.entityId, dndData);
    }

    case IntentType.Drop:
    case IntentType.Say:
    case IntentType.DebugRevealMap:
    case IntentType.DebugGodMode:
    case IntentType.DebugSpawnEntity:
    case IntentType.DebugFastForwardSchemes:
    case IntentType.DebugPromote:
    case IntentType.ToggleTargeting:
    case IntentType.MoveTarget:
    case IntentType.ToggleInventory:
    case IntentType.ToggleFactions:
    case IntentType.ToggleSettings:
    case IntentType.ToggleEngineMode:
    case IntentType.TogglePause:
    case IntentType.SetRTwPSpeed:
    case IntentType.ToggleInspect:
    case IntentType.MoveInspect:
    case IntentType.ToggleRotated:
    case IntentType.Toggle3D:
    case IntentType.SetZoomLevel:
    case IntentType.StartDialogue:
    case IntentType.SelectDialogueOption:
    case IntentType.CloseDialogue:
    case IntentType.ToggleQuests:
    case IntentType.ToggleInvestigation:
    case IntentType.ToggleDebug:
    case IntentType.ToggleDossier:
    case IntentType.AskAbout:
    case IntentType.Gossip:
    case IntentType.ToggleLedger:
    case IntentType.ToggleCartridgeModal:
      return hasAnyRoundActionsRemaining(currentBudget)
        ? { state, energyCost: 0 }
        : clearBudgetAndEndRound(state, intent.entityId, dndData);

    default:
      return assertNever(intent);
  }
}

/** Checks whether an entity's current `DnD35ActionBudget` permits executing `intent` in TurnBased mode. */
export function canDnD35eActorPerformIntent(state: GameState, intent: Intent): boolean {
  if (state.engineMode !== EngineMode.TurnBased) return true;
  const budget = getDnD35EntityData(state, intent.entityId).actionBudget;
  if (!budget) return true;

  switch (intent.type) {
    case IntentType.Move:
      return (
        budget.canMoveFurtherThisRound &&
        (budget.movementRemainingFt >= FEET_PER_GRID_SQUARE || budget.moveRemaining > 0 || budget.standardRemaining > 0)
      );
    case IntentType.UseAbility: {
      const isSwift =
        intent.effectId === 'pool:abrupt_jaunt' ||
        intent.effectId === 'pool:invisible_fist' ||
        intent.effectId.startsWith('shapeshift');
      return isSwift ? budget.swiftRemaining >= 1 : budget.standardRemaining >= 1;
    }
    case IntentType.MeleeAttack:
    case IntentType.Apply:
      return budget.standardRemaining >= 1;
    case IntentType.FireAimed:
      return state.targetingMode?.active && state.targetingMode.context?.verb === 'abrupt_jaunt'
        ? budget.swiftRemaining >= 1
        : budget.standardRemaining >= 1;
    case IntentType.PickUp:
    case IntentType.EquipItem:
    case IntentType.UnequipItem:
    case IntentType.Interact:
      return budget.moveRemaining > 0 || budget.standardRemaining > 0;
    case IntentType.Wait:
    case IntentType.ChangeArea:
    case IntentType.Drop:
    case IntentType.Say:
    case IntentType.DebugRevealMap:
    case IntentType.DebugGodMode:
    case IntentType.DebugSpawnEntity:
    case IntentType.DebugFastForwardSchemes:
    case IntentType.DebugPromote:
    case IntentType.ToggleTargeting:
    case IntentType.MoveTarget:
    case IntentType.ToggleInventory:
    case IntentType.ToggleFactions:
    case IntentType.ToggleSettings:
    case IntentType.ToggleEngineMode:
    case IntentType.TogglePause:
    case IntentType.SetRTwPSpeed:
    case IntentType.ToggleInspect:
    case IntentType.MoveInspect:
    case IntentType.ToggleRotated:
    case IntentType.Toggle3D:
    case IntentType.SetZoomLevel:
    case IntentType.StartDialogue:
    case IntentType.SelectDialogueOption:
    case IntentType.CloseDialogue:
    case IntentType.ToggleQuests:
    case IntentType.ToggleInvestigation:
    case IntentType.ToggleDebug:
    case IntentType.ToggleDossier:
    case IntentType.AskAbout:
    case IntentType.Gossip:
    case IntentType.ToggleLedger:
    case IntentType.ToggleCartridgeModal:
      return true;
    default:
      return assertNever(intent);
  }
}

/** Returns true if the entity has already expended any movement or action resources in its active round budget. */
export function hasDnD35eActorActedThisTurn(state: GameState, entityId: EntityId): boolean {
  const budget = getDnD35EntityData(state, entityId).actionBudget;
  return Boolean(
    budget &&
    (budget.hasActedThisRound === true || budget.distanceMovedThisRoundFt > 0 || budget.movementRemainingFt > 0)
  );
}

/** Returns true if the entity currently has leftover walking distance from an active Move action pool. */
export function hasDnD35eActorMovementInProgress(state: GameState, entityId: EntityId): boolean {
  const budget = getDnD35EntityData(state, entityId).actionBudget;
  return Boolean(budget && budget.canMoveFurtherThisRound && budget.movementRemainingFt >= FEET_PER_GRID_SQUARE);
}
