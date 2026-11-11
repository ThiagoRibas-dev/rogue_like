import { canUseTriggeredReactionThisRound, incrementTriggeredReactionUse } from '../../../systems/stance.system.ts';
import type { TacticalDoctrineComponent } from '../../../types/components.types.ts';
import { evaluateSpellScalingRule } from '../magic/spell_effects.ts';
import { evaluateDiceExpression } from '../math/dice.ts';
import type { DamageReductionRule } from '../types/dnd35e.types.ts';
import type { DnD35DamageType } from '../types/dnd35e_system.types.ts';
import type { DnD35SpellEffectUnit } from '../types/system/spell_system.types.ts';
import { mitigateIncomingDamage } from './damage_vitality.ts';

/** Maximum grid distance in tiles (`1`, i.e. 5 ft.) considered adjacent for `melee_adjacent` / `melee_or_spell_adjacent`. */
const ADJACENT_MAX_TILE_DISTANCE = 1;

/**
 * Active target-side retaliation rider instance protecting an actor.
 */
export interface ActiveRetaliationRiderEntry {
  readonly spellId: string;
  readonly castId: string;
  readonly casterLevel: number;
  readonly unit: Extract<DnD35SpellEffectUnit, { readonly type: 'retaliation_rider' }>;
}

/**
 * Result of resolving all active target-side retaliation riders on a struck defender.
 */
export interface RetaliationResolutionResult {
  readonly totalDamageToAttacker: number;
  readonly updatedDefenderDoctrine: TacticalDoctrineComponent | undefined;
  readonly logMessages: ReadonlyArray<string>;
}

/**
 * Resolves all active target-side `retaliation_rider` units protecting a defender when struck by an attacker:
 * 1. Verifies trigger condition (`melee_adjacent` / `melee_or_spell_adjacent` require Chebyshev tile distance `<= 1`).
 * 2. Verifies per-round quota (`canUseTriggeredReactionThisRound` against `unit.maxUsesPerRound`).
 * 3. Rolls `unit.dice + evaluateSpellScalingRule(unit.flatBonusScaling, casterLevel)` damage.
 * 4. Mitigates against attacker's energy resistance / immunities (and DR unless `unit.bypassesDr === true`).
 * 5. Increments the defender's per-round usage counter on `TacticalDoctrineComponent` without consuming AoOs.
 *
 * @param params Structured retaliation resolution inputs.
 * @returns Total damage dealt back to the attacker, updated defender doctrine, and combat log entries.
 */
export function resolveRetaliationRiders(params: {
  readonly activeRiders: ReadonlyArray<ActiveRetaliationRiderEntry>;
  readonly defenderDoctrine: TacticalDoctrineComponent | undefined;
  readonly triggerType: 'melee' | 'spell' | 'ranged';
  readonly chebyshevDistanceTiles: number;
  readonly attackerName: string;
  readonly defenderName: string;
  readonly attackerDr?: DamageReductionRule | undefined;
  readonly attackerEnergyResistance?: Readonly<Record<string, number>> | undefined;
  readonly attackerImmunities?: ReadonlyArray<string> | undefined;
  readonly attackerVulnerabilities?: ReadonlyArray<string> | undefined;
  readonly forcedDiceTotal?: number | undefined;
}): RetaliationResolutionResult {
  if (params.activeRiders.length === 0) {
    return {
      totalDamageToAttacker: 0,
      updatedDefenderDoctrine: params.defenderDoctrine,
      logMessages: []
    };
  }

  let runningDoctrine = params.defenderDoctrine;
  let totalDamageToAttacker = 0;
  const logMessages: string[] = [];
  const isAdjacent = params.chebyshevDistanceTiles <= ADJACENT_MAX_TILE_DISTANCE;

  for (const entry of params.activeRiders) {
    const { unit, spellId, castId, casterLevel } = entry;
    if (unit.triggerCondition === 'melee_adjacent') {
      if (params.triggerType !== 'melee' || !isAdjacent) continue;
    } else if (unit.triggerCondition === 'melee_or_spell_adjacent') {
      if ((params.triggerType !== 'melee' && params.triggerType !== 'spell') || !isAdjacent) continue;
    }

    const triggerKey = `retaliation:${spellId}:${castId}:${unit.unitId}`;
    if (!canUseTriggeredReactionThisRound(runningDoctrine, triggerKey, unit.maxUsesPerRound)) {
      continue;
    }

    runningDoctrine = incrementTriggeredReactionUse(runningDoctrine, triggerKey);
    const rolledDice =
      params.forcedDiceTotal !== undefined ? params.forcedDiceTotal : evaluateDiceExpression(unit.dice).total;
    const flatBonus = evaluateSpellScalingRule(unit.flatBonusScaling, casterLevel);
    const rawDamage = Math.max(0, rolledDice + flatBonus);

    const dmgType: DnD35DamageType = unit.damageType;
    const effectiveDr = unit.bypassesDr ? undefined : params.attackerDr;
    const mitigated = mitigateIncomingDamage({
      rawDamage,
      damageType: dmgType,
      attackBypassTags: ['spell', dmgType, ...(unit.bypassesDr ? ['bypass:all'] : [])],
      ...(effectiveDr !== undefined ? { damageReduction: effectiveDr } : {}),
      ...(params.attackerEnergyResistance !== undefined ? { energyResistance: params.attackerEnergyResistance } : {}),
      ...(params.attackerImmunities !== undefined ? { immunities: params.attackerImmunities } : {}),
      ...(params.attackerVulnerabilities !== undefined ? { vulnerabilities: params.attackerVulnerabilities } : {})
    });

    totalDamageToAttacker += mitigated.finalDamage;
    logMessages.push(
      `Retaliating spectral blade (${params.defenderName}) strikes ${params.attackerName} for ${mitigated.finalDamage} ${dmgType} damage!`
    );
  }

  return {
    totalDamageToAttacker,
    updatedDefenderDoctrine: runningDoctrine,
    logMessages
  };
}
