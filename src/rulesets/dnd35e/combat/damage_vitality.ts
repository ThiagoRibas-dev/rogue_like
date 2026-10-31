import { rng } from '../../../core/rng.ts';
import { rollD20 } from '../math/dice.ts';
import { dndFloor } from '../math/multipliers.ts';
import type { DamageReductionRule, DnD35DamageType, SaveType, VitalityStatus } from '../types/dnd35e.types.ts';

/** HP threshold at which a living creature dies in D&D 3.5e (`-10`). */
export const DND35E_DEATH_HP_THRESHOLD = -10;

/** Single-hit lethal damage threshold that triggers a DC 15 Massive Damage Fortitude save (`50`). */
export const MASSIVE_DAMAGE_THRESHOLD = 50;

/** Vulnerability damage multiplier (`1.5x`, floored). */
const VULNERABILITY_MULTIPLIER = 1.5;

/** Stabilization percentage chance per round when Dying (`10%`). */
const DYING_STABILIZATION_PERCENT = 10;

/** Hardness threshold ignored by Adamantine weapons (`< 20`). */
const ADAMANTINE_BYPASS_HARDNESS_MAX = 20;

/** Physical weapon damage types subject to Damage Reduction (`DR`). */
const PHYSICAL_DAMAGE_TYPES: ReadonlyArray<DnD35DamageType> = ['bludgeoning', 'piercing', 'slashing'];

/**
 * Checks whether an incoming physical attack's bypass tags satisfy a defender's
 * `DamageReductionRule` (`DR X / bypassTags`).
 * Note: `DR X / -` (`bypassTags.length === 0` or `['-']`) is unbypassable.
 *
 * @param rule Defender's `DamageReductionRule`.
 * @param attackBypassTags Tags carried by the incoming attack (e.g. `['bludgeoning', 'magic']`).
 * @returns True if the attack bypasses DR completely.
 */
export function doesAttackBypassDR(rule: DamageReductionRule, attackBypassTags: ReadonlyArray<string>): boolean {
  if (rule.bypassTags.length === 0 || rule.bypassTags.includes('-')) {
    return false;
  }
  if (rule.requireAllTags === true) {
    return rule.bypassTags.every((t) => attackBypassTags.includes(t));
  }
  return rule.bypassTags.some((t) => attackBypassTags.includes(t));
}

/**
 * Mitigates an incoming damage instance through D&D 3.5e Immunity, Vulnerability (`+50%`),
 * Damage Reduction (`DR`), Energy Resistance, and Object Hardness:
 * - **Crucial SRD Rule**: If `DR` reduces physical damage to `0`, `suppressSecondaryInjuryRiders`
 *   is set to `true` (automatically preventing poison, disease, or stun riders on that hit).
 *
 * @param options Incoming damage and defender mitigation profile.
 * @returns `{ finalDamage: number, drAbsorbed: number, resistanceAbsorbed: number, suppressSecondaryInjuryRiders: boolean }`.
 */
export function mitigateIncomingDamage(options: {
  readonly rawDamage: number;
  readonly damageType: DnD35DamageType;
  readonly attackBypassTags: ReadonlyArray<string>;
  readonly damageReduction?: DamageReductionRule;
  readonly energyResistance?: Readonly<Record<string, number>>;
  readonly immunities?: ReadonlyArray<string>;
  readonly vulnerabilities?: ReadonlyArray<string>;
  readonly objectHardness?: number;
}): {
  readonly finalDamage: number;
  readonly drAbsorbed: number;
  readonly resistanceAbsorbed: number;
  readonly suppressSecondaryInjuryRiders: boolean;
} {
  if (options.rawDamage <= 0) {
    return {
      finalDamage: 0,
      drAbsorbed: 0,
      resistanceAbsorbed: 0,
      suppressSecondaryInjuryRiders: true
    };
  }

  if (options.immunities?.includes(options.damageType) === true) {
    return {
      finalDamage: 0,
      drAbsorbed: 0,
      resistanceAbsorbed: options.rawDamage,
      suppressSecondaryInjuryRiders: true
    };
  }

  let workingDamage = options.rawDamage;
  if (options.vulnerabilities?.includes(options.damageType) === true) {
    workingDamage = dndFloor(workingDamage * VULNERABILITY_MULTIPLIER);
  }

  let drAbsorbed = 0;
  let suppressSecondaryInjuryRiders = false;
  const isPhysical = PHYSICAL_DAMAGE_TYPES.includes(options.damageType);

  if (isPhysical && options.damageReduction !== undefined && options.damageReduction.amount > 0) {
    const bypassed = doesAttackBypassDR(options.damageReduction, options.attackBypassTags);
    if (!bypassed) {
      drAbsorbed = Math.min(workingDamage, options.damageReduction.amount);
      workingDamage -= drAbsorbed;
      if (workingDamage <= 0) {
        suppressSecondaryInjuryRiders = true;
      }
    }
  }

  let resistanceAbsorbed = 0;
  const resistAmount = options.energyResistance?.[options.damageType] ?? 0;
  if (!isPhysical && resistAmount > 0) {
    resistanceAbsorbed = Math.min(workingDamage, resistAmount);
    workingDamage -= resistanceAbsorbed;
  }

  if (options.objectHardness !== undefined && options.objectHardness > 0) {
    const adamantineBypass =
      options.attackBypassTags.includes('adamantine') && options.objectHardness < ADAMANTINE_BYPASS_HARDNESS_MAX;
    if (!adamantineBypass) {
      workingDamage = Math.max(0, workingDamage - options.objectHardness);
    }
  }

  return {
    finalDamage: Math.max(0, workingDamage),
    drAbsorbed,
    resistanceAbsorbed,
    suppressSecondaryInjuryRiders
  };
}

/**
 * Evaluates a creature's `VitalityStatus` given its current HP, nonlethal damage,
 * stability flag, and whether `CON === null` (Undead/Constructs).
 * - Undead and Constructs (`conIsNull === true`) are destroyed immediately at `0 HP`.
 * - Living creatures are `disabled` at `0 HP`, `dying`/`stable` at `-1 .. -9 HP`, and `dead` at `<= -10 HP`.
 * - When `hp > 0`, `nonlethalDamage === hp` causes `staggered`, and `nonlethalDamage > hp` causes `unconscious` (`disabled` / knocked out).
 *
 * @param currentHp Current hit points.
 * @param nonlethalDamage Current nonlethal damage total.
 * @param isStable Whether a dying creature has stabilized.
 * @param conIsNull True if the entity has `CON: null` (Undead/Construct).
 * @returns Resolved `VitalityStatus` and whether the entity is unconscious.
 */
export function evaluateVitalityStatus(
  currentHp: number,
  nonlethalDamage: number,
  isStable: boolean,
  conIsNull = false
): {
  readonly status: VitalityStatus;
  readonly isUnconscious: boolean;
  readonly triggersMassiveDamageCheck: boolean;
} {
  if (conIsNull) {
    return {
      status: currentHp <= 0 ? 'dead' : 'healthy',
      isUnconscious: currentHp <= 0,
      triggersMassiveDamageCheck: false
    };
  }

  if (currentHp <= DND35E_DEATH_HP_THRESHOLD) {
    return { status: 'dead', isUnconscious: true, triggersMassiveDamageCheck: false };
  }
  if (currentHp < 0) {
    return {
      status: isStable ? 'stable' : 'dying',
      isUnconscious: true,
      triggersMassiveDamageCheck: false
    };
  }
  if (currentHp === 0) {
    return { status: 'disabled', isUnconscious: false, triggersMassiveDamageCheck: false };
  }
  if (nonlethalDamage > currentHp) {
    return { status: 'disabled', isUnconscious: true, triggersMassiveDamageCheck: false };
  }
  if (nonlethalDamage === currentHp) {
    return { status: 'staggered', isUnconscious: false, triggersMassiveDamageCheck: false };
  }
  return { status: 'healthy', isUnconscious: false, triggersMassiveDamageCheck: false };
}

/**
 * Rolls the per-round `10%` stabilization check for a Dying creature (`-1 .. -9 HP`).
 * On failure, the creature loses `1 HP` (potentially reaching `-10` and dying).
 *
 * @param currentHp Current HP (`-1` to `-9`).
 * @param forcedPercentRoll Optional deterministic `1..100` roll override.
 * @returns `{ nextHp: number, isStable: boolean, isDead: boolean }`.
 */
export function rollDyingStabilization(
  currentHp: number,
  forcedPercentRoll?: number
): {
  readonly nextHp: number;
  readonly isStable: boolean;
  readonly isDead: boolean;
} {
  const roll = forcedPercentRoll !== undefined ? forcedPercentRoll : Math.floor(rng.getUniform() * 100) + 1;
  if (roll <= DYING_STABILIZATION_PERCENT) {
    return {
      nextHp: currentHp,
      isStable: true,
      isDead: false
    };
  }

  const nextHp = currentHp - 1;
  return {
    nextHp,
    isStable: false,
    isDead: nextHp <= DND35E_DEATH_HP_THRESHOLD
  };
}

/**
 * Resolves a `Fortitude`, `Reflex`, or `Will` Saving Throw with natural 1 / 20 automatic
 * failure/success bounds and `Evasion` / `Improved Evasion` damage scaling.
 *
 * @param options Save parameters.
 * @returns `{ success: boolean, naturalRoll: number, total: number, damageMultiplier: 0 | 0.5 | 1 }`.
 */
export function resolveSavingThrow(options: {
  readonly saveType: SaveType;
  readonly baseSave: number;
  readonly abilityModifier: number;
  readonly miscBonus?: number;
  readonly dc: number;
  readonly isReflexHalfDamageEffect?: boolean;
  readonly evasionTier?: 'none' | 'evasion' | 'improved_evasion';
  readonly forcedNaturalRoll?: number;
}): {
  readonly success: boolean;
  readonly naturalRoll: number;
  readonly total: number;
  readonly damageMultiplier: 0 | 0.5 | 1;
} {
  const totalMod = options.baseSave + options.abilityModifier + (options.miscBonus ?? 0);
  const d20 = rollD20('save', totalMod, options.forcedNaturalRoll);
  const success = !d20.isAutoFailure && (d20.isAutoSuccess || d20.total >= options.dc);

  const evasion = options.evasionTier ?? 'none';
  let damageMultiplier: 0 | 0.5 | 1 = success ? 0.5 : 1;

  if (options.saveType === 'ref' && options.isReflexHalfDamageEffect === true) {
    if (success) {
      damageMultiplier = evasion === 'none' ? 0.5 : 0;
    } else {
      damageMultiplier = evasion === 'improved_evasion' ? 0.5 : 1;
    }
  } else {
    damageMultiplier = success ? 0 : 1;
  }

  return {
    success,
    naturalRoll: d20.naturalRoll,
    total: d20.total,
    damageMultiplier
  };
}
