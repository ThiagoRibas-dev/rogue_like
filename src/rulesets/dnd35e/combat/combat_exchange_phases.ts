import { addComponent, getComponent } from '../../../core/ecs.ts';
import { addMessage, MessageLogCategory } from '../../../systems/message.system.ts';
import {
  ComponentType,
  type DamageComponent,
  type FighterComponent,
  type IdentityComponent,
  type PositionComponent
} from '../../../types/components.types.ts';
import type { EntityId, GameState } from '../../../types/game-state.types.ts';
import { getFactionRelation, isHostile } from '../../../utils/faction.ts';
import {
  evaluateConcealmentAndSenses,
  isFlankingTarget,
  resolveEffectiveTileIllumination
} from '../spatial/cover_senses.ts';
import type { DnD35EntityData, SensoryProfile } from '../types/dnd35e.types.ts';
import { evaluateDnD35eEntityDAG, type DnD35EntityDAGResult } from '../cartridge/dnd35e_dag_adapter.ts';
import { resolveAttackRoll } from './attack_roll.ts';
import type { DnD35ResolvedStrikeProfile } from './attack_routine.ts';
import { resolveCleaveFollowupEligibility } from './cleave_whirlwind.ts';

/** Standard flanking attack bonus in D&D 3.5e (PHB p. 153). */
const BASE_FLANKING_BONUS = 2;

/** Context resolved during Phase 1 (`PreAttackPhase`) of a strike exchange. */
export interface PreAttackContext {
  readonly effectiveAttackBonus: number;
  readonly strikeLabel: string;
  readonly concealmentMissChance: number;
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
  defenderEval: DnD35EntityDAGResult
): PreAttackContext {
  const attackerPos = getComponent(state, attackerId, ComponentType.Position) as PositionComponent | undefined;
  const defenderPos = getComponent(state, defenderId, ComponentType.Position) as PositionComponent | undefined;

  let flankingBonus = 0;
  let isFlanking = false;
  if (attackerPos && defenderPos) {
    const threateningAllyPositions: Array<{ readonly x: number; readonly y: number }> = [];
    for (const otherId of state.entities) {
      if (otherId === attackerId || otherId === defenderId) continue;
      const otherFighter = getComponent(state, otherId, ComponentType.Fighter) as FighterComponent | undefined;
      const otherPos = getComponent(state, otherId, ComponentType.Position) as PositionComponent | undefined;
      if (!otherFighter || otherFighter.hp <= 0 || !otherPos) continue;

      const isAlly =
        getFactionRelation(state, attackerId, otherId) === 'friendly' ||
        (!isHostile(state, attackerId, otherId) && isHostile(state, otherId, defenderId));
      if (!isAlly) continue;

      const distToDef = Math.max(Math.abs(otherPos.x - defenderPos.x), Math.abs(otherPos.y - defenderPos.y));
      if (distToDef <= 1) {
        threateningAllyPositions.push({ x: otherPos.x, y: otherPos.y });
      }
    }

    const defenderImmuneFlanking =
      defenderSelfTags.includes('trait:all_around_vision') ||
      defenderSelfTags.includes('trait:immune_flanking') ||
      defenderData.immunities.includes('flanking');

    isFlanking = isFlankingTarget(attackerPos, threateningAllyPositions, defenderPos, defenderImmuneFlanking);
    if (isFlanking) {
      flankingBonus = attackerEval.dagResult.flankingBonus ?? BASE_FLANKING_BONUS;
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
    const sensoryConcealment = evaluateConcealmentAndSenses(
      tileIllumination,
      attackerPos,
      defenderPos,
      observerSenses,
      {
        ...(targetInvisible ? { targetInvisible: true } : {}),
        ...(targetBlurred ? { targetBlurred: true } : {})
      }
    );
    concealmentMissChance = Math.max(concealmentMissChance, sensoryConcealment.missChancePercent);
  }

  let strikeLabel = strike.label;
  if (totalStrikes > 1 && strike.attackSource === 'manufactured_primary') {
    strikeLabel = `${strikeLabel} (Iterative ${strikeIndex + 1})`;
  }
  if (isFlanking) {
    strikeLabel = `${strikeLabel} [Flanking +${flankingBonus}]`;
  }

  return {
    effectiveAttackBonus: strike.attackBonus + flankingBonus,
    strikeLabel,
    concealmentMissChance
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
 * @returns Updated GameState and updated cleaves count.
 */
export function resolveOnDropCleaveFollowup(
  state: GameState,
  attackerId: EntityId,
  droppedDefenderId: EntityId,
  strike: DnD35ResolvedStrikeProfile,
  targetAC: number,
  attackerEval: DnD35EntityDAGResult,
  cleavesCount: number
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
  for (const candId of state.entities) {
    if (candId === droppedDefenderId || candId === attackerId) continue;
    const candFighter = getComponent(state, candId, ComponentType.Fighter) as FighterComponent | undefined;
    const candPos = getComponent(state, candId, ComponentType.Position) as PositionComponent | undefined;
    if (!candFighter || candFighter.hp <= 0 || !candPos) continue;

    const candDist = Math.max(Math.abs(attackerPos.x - candPos.x), Math.abs(attackerPos.y - candPos.y));
    if (candDist <= 1 && isHostile(state, attackerId, candId)) {
      cleaveTargetId = candId;
      const candIdentity = getComponent(state, candId, ComponentType.Identity) as IdentityComponent | undefined;
      if (candIdentity?.name) cleaveTargetName = candIdentity.name;
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
    hasBlindFight: attackerEval.hasBlindFight
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
