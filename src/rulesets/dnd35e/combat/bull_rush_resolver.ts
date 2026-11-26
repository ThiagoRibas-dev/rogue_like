import { addComponent, getComponent, resolveEntityDisplayName } from '../../../core/ecs.ts';
import { addMessage, MessageLogCategory } from '../../../systems/message.system.ts';
import { displaceEntityAlongVector, isEntityImmovable } from '../../../systems/movement_displacement.ts';
import { ComponentType, type DamageComponent, type PositionComponent } from '../../../types/components.types.ts';
import type { EntityId, GameState } from '../../../types/game-state.types.ts';
import { evaluateDnD35eEntityDAG } from '../cartridge/dnd35e_dag_adapter.ts';
import { evaluateDiceExpression } from '../math/dice.ts';
import { resolveTypedModifiersWithBreakdown } from '../modifiers.ts';
import { FEET_PER_GRID_SQUARE } from '../spatial/grid_geometry.ts';
import type { StatModifier } from '../types/dnd35e.types.ts';
import { resolveCombatManeuver } from './maneuvers_conditions.ts';

/** Margin of victory step (every `5` points) adding an extra `5 ft` (1 square) to Bull Rush push distance. */
const BULL_RUSH_EXTRA_SQUARE_STEP = 5;

/** Baseline Improved Bull Rush bonus (`+4`) used only when explicitly forced via caller override without DAG modifiers. */
const IMPROVED_BULL_RUSH_FALLBACK_BONUS = 4;

/** Baseline racial/structural stability bonus (`+4`) against Bull Rush checks (`trait:stability`). */
const BULL_RUSH_STABILITY_BONUS = 4;

/** Dungeon Crasher Tier 1 wall-slam damage dice count (`4d6`) and STR multiplier (`2x`). */
const DUNGEON_CRASHER_T1_DICE = 4;
const DUNGEON_CRASHER_T1_STR_MULT = 2;

/** Dungeon Crasher Tier 2 wall-slam damage dice count (`8d6`) and STR multiplier (`3x`). */
const DUNGEON_CRASHER_T2_DICE = 8;
const DUNGEON_CRASHER_T2_STR_MULT = 3;

/** Result of resolving a spatial Bull Rush maneuver and optional obstacle impact damage. */
export interface BullRushImpactResult {
  readonly state: GameState;
  readonly success: boolean;
  readonly attackerTotal: number;
  readonly defenderTotal: number;
  readonly pushedSquares: number;
  readonly collidedWithWall: boolean;
  readonly wallCrashDamage: number;
  readonly finalPosition: { readonly x: number; readonly y: number } | undefined;
}

/**
 * Resolves declarative Dungeon Crasher dice count and STR multiplier from `StatModifier`s
 * (`dungeon_crasher_dice`, `dungeon_crasher_str_mult`) with tag fallback for `trait:dungeon_crasher_1/2`.
 */
export function resolveDungeonCrasherProfile(
  statModifiers: ReadonlyArray<StatModifier>,
  selfTags: ReadonlyArray<string>
): { readonly diceCount: number; readonly strMultiplier: number } {
  const diceMods = statModifiers.filter((m) => m.targetStat === 'dungeon_crasher_dice');
  const multMods = statModifiers.filter((m) => m.targetStat === 'dungeon_crasher_str_mult');
  const modDice = diceMods.length > 0 ? resolveTypedModifiersWithBreakdown(diceMods, { selfTags }).total : 0;
  const modMult = multMods.length > 0 ? resolveTypedModifiersWithBreakdown(multMods, { selfTags }).total : 0;

  if (modDice > 0) {
    return {
      diceCount: modDice,
      strMultiplier: Math.max(1, modMult > 0 ? modMult : DUNGEON_CRASHER_T1_STR_MULT)
    };
  }
  if (selfTags.includes('trait:dungeon_crasher_2')) {
    return { diceCount: DUNGEON_CRASHER_T2_DICE, strMultiplier: DUNGEON_CRASHER_T2_STR_MULT };
  }
  if (selfTags.includes('trait:dungeon_crasher_1') || selfTags.includes('feature:dungeon_crasher')) {
    return { diceCount: DUNGEON_CRASHER_T1_DICE, strMultiplier: DUNGEON_CRASHER_T1_STR_MULT };
  }
  return { diceCount: 0, strMultiplier: 0 };
}

/**
 * Executes a full spatial Bull Rush maneuver (`PHB p. 154`) and **Dungeon Crasher**
 * (`Dungeonscape p. 10`) obstacle impact damage:
 * 1. Resolves the opposed Strength check (`size modifier + feats + stability`).
 * 2. Pushes the defender `5 ft` (`1` square) plus `5 ft` per `5` points by which the attacker beats the defender.
 * 3. If the push path encounters an impassable solid obstacle/wall, stops the defender before the wall
 *    and triggers Dungeon Crasher bludgeoning damage (`4d6 + 2 * STR` at Tier 1, `8d6 + 3 * STR` at Tier 2).
 * 4. Updates defender `PositionComponent` and synchronizes the Relational Flanking Graph.
 */
export function resolveBullRushImpact(
  state: GameState,
  params: {
    readonly attackerId: EntityId;
    readonly defenderId: EntityId;
    readonly forcedOpposedRolls?: { readonly rollA: number; readonly rollB: number } | undefined;
    readonly hasImprovedBullRush?: boolean | undefined;
  }
): BullRushImpactResult {
  const { attackerId, defenderId } = params;
  const attackerPos = getComponent(state, attackerId, ComponentType.Position) as PositionComponent | undefined;
  const defenderPos = getComponent(state, defenderId, ComponentType.Position) as PositionComponent | undefined;
  const attackerEval = evaluateDnD35eEntityDAG(state, attackerId);
  const defenderEval = evaluateDnD35eEntityDAG(state, defenderId);

  if (!attackerPos || !defenderPos || !attackerEval || !defenderEval) {
    return {
      state,
      success: false,
      attackerTotal: 0,
      defenderTotal: 0,
      pushedSquares: 0,
      collidedWithWall: false,
      wallCrashDamage: 0,
      finalPosition: defenderPos ? { x: defenderPos.x, y: defenderPos.y } : undefined
    };
  }

  const defName = resolveEntityDisplayName(state, defenderId, 'Defender');
  if (
    isEntityImmovable(state, defenderId) ||
    defenderEval.selfTags.includes('trait:immovable') ||
    defenderEval.selfTags.includes('immovable')
  ) {
    const immState = addMessage(
      state,
      `[Bull Rush] ${defName} is immovable and cannot be pushed back!`,
      MessageLogCategory.CombatMiss
    );
    return {
      state: immState,
      success: false,
      attackerTotal: 0,
      defenderTotal: 0,
      pushedSquares: 0,
      collidedWithWall: false,
      wallCrashDamage: 0,
      finalPosition: { x: defenderPos.x, y: defenderPos.y }
    };
  }

  const atkStrMod = attackerEval.dagResult.effectiveAbilityModifiers.str;
  const defStrMod = defenderEval.dagResult.effectiveAbilityModifiers.str;
  const bullRushMods = (attackerEval.statModifiers ?? []).filter((m) => m.targetStat === 'bull_rush');
  const declarativeBullRushBonus =
    bullRushMods.length > 0
      ? resolveTypedModifiersWithBreakdown(bullRushMods, { selfTags: attackerEval.selfTags }).total
      : 0;
  const resolvedBullRushBonus =
    params.hasImprovedBullRush === true && declarativeBullRushBonus === 0
      ? IMPROVED_BULL_RUSH_FALLBACK_BONUS
      : params.hasImprovedBullRush === false
        ? 0
        : declarativeBullRushBonus;
  const suppressesAoO =
    params.hasImprovedBullRush ??
    attackerEval.ruleOverrides?.some((r) => r.ruleKey === 'bull_rush_no_aoo' && r.value === true) === true;

  const maneuverRes = resolveCombatManeuver({
    maneuver: 'bull_rush',
    attackerSize: attackerEval.dagResult.effectiveSize,
    defenderSize: defenderEval.dagResult.effectiveSize,
    attackerBab: 0,
    defenderBab: 0,
    attackerStrMod: atkStrMod,
    defenderStrOrDexMod: defStrMod,
    attackerTouchAttackBonus: attackerEval.dagResult.attackBonus,
    defenderTouchAC: defenderEval.dagResult.acBreakdown.touchAC,
    hasImprovedManeuverFeat: false,
    overrides: {
      opposedBonus: resolvedBullRushBonus,
      provokesAoO: !suppressesAoO
    },
    defenderStabilityBonus: defenderEval.selfTags.includes('trait:stability') ? BULL_RUSH_STABILITY_BONUS : 0,
    ...(params.forcedOpposedRolls !== undefined ? { forcedOpposedRolls: params.forcedOpposedRolls } : {})
  });

  const atkName = resolveEntityDisplayName(state, attackerId, 'Attacker');

  if (!maneuverRes.opposedSuccess) {
    const missState = addMessage(
      state,
      `[Bull Rush] ${atkName} (${maneuverRes.attackerTotal}) fails to push back ${defName} (${maneuverRes.defenderTotal}).`,
      MessageLogCategory.CombatMiss
    );
    return {
      state: missState,
      success: false,
      attackerTotal: maneuverRes.attackerTotal,
      defenderTotal: maneuverRes.defenderTotal,
      pushedSquares: 0,
      collidedWithWall: false,
      wallCrashDamage: 0,
      finalPosition: { x: defenderPos.x, y: defenderPos.y }
    };
  }

  const margin = Math.max(0, maneuverRes.attackerTotal - maneuverRes.defenderTotal);
  const maxSquares = 1 + Math.floor(margin / BULL_RUSH_EXTRA_SQUARE_STEP);
  const dx = Math.sign(defenderPos.x - attackerPos.x);
  const dy = Math.sign(defenderPos.y - attackerPos.y);

  let nextState = state;
  let pushedSquares = 0;
  let collidedWithWall = false;
  let finalPosition: { readonly x: number; readonly y: number } = { x: defenderPos.x, y: defenderPos.y };

  if (dx !== 0 || dy !== 0) {
    const pushRes = displaceEntityAlongVector({
      state,
      entityId: defenderId,
      maxSteps: maxSquares,
      dx,
      dy,
      context: {
        mode: 'forced_push',
        isForced: true,
        provokesAoO: false,
        sourceEntityId: attackerId
      }
    });
    nextState = pushRes.state;
    pushedSquares = pushRes.stepsMoved;
    collidedWithWall = pushRes.stopReason === 'solid_obstacle';
    finalPosition = pushRes.finalPos;
  }

  const pushedFt = pushedSquares * FEET_PER_GRID_SQUARE;
  const sizeLabel = defenderEval.dagResult.effectiveSize;
  nextState = addMessage(
    nextState,
    `[Bull Rush] ${atkName} (${maneuverRes.attackerTotal} vs ${maneuverRes.defenderTotal}) pushes ${defName} (${sizeLabel}) back ${pushedFt} ft!`,
    MessageLogCategory.CombatHit
  );

  let wallCrashDamage = 0;
  if (collidedWithWall) {
    const dcProfile = resolveDungeonCrasherProfile(attackerEval.statModifiers ?? [], attackerEval.selfTags);
    if (dcProfile.diceCount > 0) {
      const diceExpr = `${dcProfile.diceCount}d6`;
      const roll = evaluateDiceExpression(diceExpr);
      wallCrashDamage = Math.max(1, roll.total + dcProfile.strMultiplier * atkStrMod);
      const existingDmg = getComponent(nextState, defenderId, ComponentType.Damage) as DamageComponent | undefined;
      nextState = addComponent(nextState, defenderId, {
        type: ComponentType.Damage,
        instances: [
          ...(existingDmg?.instances ?? []),
          {
            amount: wallCrashDamage,
            sourceEntityId: attackerId,
            tags: ['melee', 'physical', 'bludgeoning', 'dungeon_crasher']
          }
        ]
      });
      nextState = addMessage(
        nextState,
        `[Dungeon Crasher] ${defName} slams into a solid wall for ${wallCrashDamage} bludgeoning damage (${diceExpr} + ${dcProfile.strMultiplier}x STR)!`,
        MessageLogCategory.CombatHit
      );
    }
  }

  return {
    state: nextState,
    success: true,
    attackerTotal: maneuverRes.attackerTotal,
    defenderTotal: maneuverRes.defenderTotal,
    pushedSquares,
    collidedWithWall,
    wallCrashDamage,
    finalPosition
  };
}
