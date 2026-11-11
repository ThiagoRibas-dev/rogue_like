import { resolveAttackRoll, type AttackResolutionResult } from '../combat/attack_roll.ts';
import { rollD20 } from '../math/dice.ts';
import { dndFloor } from '../math/multipliers.ts';
import type { DnD35ItemDefinition, DnD35SpellStrikeDescriptor } from '../types/dnd35e_system.types.ts';

/** Iterative BAB step interval (`5`). */
const ITERATIVE_BAB_STEP = 5;

/** Maximum number of iterative attacks from BAB (`4`). */
const MAX_ITERATIVE_ATTACKS = 4;

/** Default critical threat minimum (`20`). */
const DEFAULT_SPELL_STRIKE_CRIT_MIN = 20;

/** Default critical multiplier (`2`). */
const DEFAULT_SPELL_STRIKE_CRIT_MULT = 2;

/**
 * Result of resolving an isolated iterative spell-strike routine (e.g., *Spectral Assault*, *Scorching Ray*).
 */
export interface IterativeSpellStrikeResult {
  readonly blockedBySpellResistance: boolean;
  readonly srCheckTotal?: number | undefined;
  readonly strikes: ReadonlyArray<AttackResolutionResult>;
  readonly totalDamage: number;
  readonly critThreatMin: number;
  readonly critMultiplier: number;
}

/**
 * Resolves an isolated iterative spell-attack sequence (`spell_strike`), such as *Blade Tempest Invocation*'s
 * **Spectral Assault** (`BAB + WIS` iteratives, `1d8 + min(5, floor(CL / 3))` force damage, deity favored weapon
 * critical profile, isolated from physical weapon feats/STR, and checking Spell Resistance on the first hit).
 *
 * @param params Structured spell-strike resolution inputs.
 * @returns Complete `IterativeSpellStrikeResult` with per-strike outcomes and total damage.
 */
export function resolveIterativeSpellStrike(params: {
  readonly descriptor: DnD35SpellStrikeDescriptor;
  readonly totalBab: number;
  readonly castingAbilityModifier: number;
  readonly casterLevel: number;
  readonly spellPenetrationBonus?: number | undefined;
  readonly targetFullAC: number;
  readonly targetTouchAC: number;
  readonly targetSpellResistance?: number | undefined;
  readonly targetImmuneToCrits?: boolean | undefined;
  readonly targetConcealmentPercent?: number | undefined;
  readonly targetFortificationPercent?: number | undefined;
  readonly deityFavoredWeaponId?: string | undefined;
  readonly itemsRegistry?: Readonly<Record<string, DnD35ItemDefinition>> | undefined;
  readonly forcedSrRoll?: number | undefined;
  readonly forcedAttackRolls?: ReadonlyArray<number> | undefined;
  readonly forcedConfirmRolls?: ReadonlyArray<number> | undefined;
}): IterativeSpellStrikeResult {
  const { descriptor } = params;

  let critThreatMin = DEFAULT_SPELL_STRIKE_CRIT_MIN;
  let critMultiplier = DEFAULT_SPELL_STRIKE_CRIT_MULT;
  if (descriptor.critProfileSource === 'deity_favored_weapon') {
    const weaponId = params.deityFavoredWeaponId ?? 'longsword';
    const weaponDef = params.itemsRegistry?.[weaponId];
    if (weaponDef?.weaponStats) {
      critThreatMin = weaponDef.weaponStats.critThreatMin ?? DEFAULT_SPELL_STRIKE_CRIT_MIN;
      critMultiplier = weaponDef.weaponStats.critMultiplier ?? DEFAULT_SPELL_STRIKE_CRIT_MULT;
    }
  }

  let flatDamageBonus = 0;
  if (descriptor.flatBonusPerClInterval !== undefined && descriptor.flatBonusPerClInterval > 0) {
    flatDamageBonus = dndFloor(params.casterLevel / descriptor.flatBonusPerClInterval);
    if (descriptor.flatBonusMaxCap !== undefined) {
      flatDamageBonus = Math.min(descriptor.flatBonusMaxCap, flatDamageBonus);
    }
  }

  const iterativeOffsets: number[] = [0];
  if (descriptor.useIterativeBab && params.totalBab >= ITERATIVE_BAB_STEP + 1) {
    for (let step = 1; step < MAX_ITERATIVE_ATTACKS; step++) {
      const penalty = step * ITERATIVE_BAB_STEP;
      if (params.totalBab - penalty >= 1) {
        iterativeOffsets.push(-penalty);
      }
    }
  }

  const targetAC = descriptor.touchAttack ? params.targetTouchAC : params.targetFullAC;
  const targetSr = params.targetSpellResistance ?? 0;
  let srChecked = false;
  let srCheckTotal: number | undefined;

  const strikes: AttackResolutionResult[] = [];
  let totalDamage = 0;

  for (let i = 0; i < iterativeOffsets.length; i++) {
    const offset = iterativeOffsets[i]!;
    const strikeAttackBonus = params.totalBab + offset + params.castingAbilityModifier;
    const rollResult = resolveAttackRoll({
      attackBonus: strikeAttackBonus,
      targetAC,
      weaponDice: descriptor.dice,
      strModifier: 0,
      handedness: 'one_handed',
      flatDamageBonus,
      critThreatMin,
      critMultiplier,
      ...(params.targetConcealmentPercent !== undefined
        ? { concealmentMissChancePercent: params.targetConcealmentPercent }
        : {}),
      ...(params.targetFortificationPercent !== undefined
        ? { fortificationPercent: params.targetFortificationPercent }
        : {}),
      ...(params.targetImmuneToCrits !== undefined ? { targetImmuneToCrits: params.targetImmuneToCrits } : {}),
      ...(params.forcedAttackRolls?.[i] !== undefined ? { forcedAttackRoll: params.forcedAttackRolls[i] } : {}),
      ...(params.forcedConfirmRolls?.[i] !== undefined ? { forcedConfirmRoll: params.forcedConfirmRolls[i] } : {})
    });

    if (rollResult.hit && descriptor.allowsSpellResistanceOnFirstHit && targetSr > 0 && !srChecked) {
      srChecked = true;
      const srMod = params.casterLevel + (params.spellPenetrationBonus ?? 0);
      const srRoll = rollD20('caster_level_check', srMod, params.forcedSrRoll);
      srCheckTotal = srRoll.total;
      if (srRoll.total < targetSr) {
        return {
          blockedBySpellResistance: true,
          srCheckTotal,
          strikes: [],
          totalDamage: 0,
          critThreatMin,
          critMultiplier
        };
      }
    }

    strikes.push(rollResult);
    if (rollResult.hit) {
      totalDamage += rollResult.totalDamage;
    }
  }

  return {
    blockedBySpellResistance: false,
    srCheckTotal,
    strikes,
    totalDamage,
    critThreatMin,
    critMultiplier
  };
}
