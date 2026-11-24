import type { StatusEffectPolarity } from '../../../types/components.types.ts';
import { getTurnsPerDay, getTurnsPerHour, getTurnsPerMinute, type TurnDurationScale } from '../../../utils/duration.ts';
import { evaluateDiceExpression } from '../math/dice.ts';
import type { StatModifier } from '../types/dnd35e.types.ts';
import { DND35E_DEFAULT_WORLD_CLOCK_CONFIG } from '../world_clock.ts';

/** Default fallback duration in rounds when an instantaneous spell inflicts a lingering condition without explicit duration. */
const DEFAULT_INSTANTANEOUS_CONDITION_DURATION_ROUNDS = 2;

/** Duration multiplier granted by Extend Spell metamagic (`2x`). */
export const EXTEND_METAMAGIC_DURATION_MULTIPLIER = 2;

/** Minimum positive duration in rounds (`1`) for non-instantaneous timed spells. */
const MIN_ACTIVE_SPELL_DURATION_ROUNDS = 1;

/** Fallback target caster level when a legacy modifier without `StatusEffectsComponent` metadata is targeted by Dispel Magic. */
export const DEFAULT_DISPEL_FALLBACK_CL = 1;

/** Canonical UI and canvas pip colors keyed by `StatusEffectPolarity`. */
export const POLARITY_COLORS: Readonly<Record<StatusEffectPolarity, string>> = {
  buff: '#2ed573',
  debuff: '#ff4757',
  mixed: '#a855f7',
  neutral: '#f1c40f'
};

/** Parsed D&D 3.5e spell duration breakdown in 6-second global turns. */
export interface ParsedSpellDuration {
  readonly durationTurns: number;
  readonly isPermanent: boolean;
  readonly isConcentration: boolean;
}

const STAT_LABEL_MAP: Readonly<Record<string, string>> = {
  str: 'STR',
  dex: 'DEX',
  con: 'CON',
  int: 'INT',
  wis: 'WIS',
  cha: 'CHA',
  attack: 'Attack',
  strike_attack: 'Attack',
  damage: 'Damage',
  strike_damage: 'Damage',
  ac: 'AC',
  ac_deflection: 'AC',
  ac_insight: 'AC',
  natural_armor: 'Natural Armor',
  fort: 'Fort',
  save_fort: 'Fort',
  ref: 'Ref',
  save_ref: 'Ref',
  will: 'Will',
  save_will: 'Will',
  saves: 'Saves',
  save_all: 'Saves',
  saves_all: 'Saves',
  saving_throw: 'Saves',
  save_fear: 'Saves vs Fear',
  skills: 'Skills',
  skill_all: 'Skills',
  speed: 'Speed',
  land_speed: 'Speed',
  max_hp: 'Max HP',
  size: 'Size',
  spell_resistance: 'SR',
  fortification: 'Fortification',
  concealment: 'Concealment',
  concealment_miss_chance: 'Miss Chance',
  initiative: 'Init',
  grapple: 'Grapple',
  caster_level: 'Caster Level',
  spell_save_dc: 'Spell DC',
  spell_dc: 'Spell DC',
  extra_full_bab_attacks: 'Extra Attack',
  interaction_reach_tiles: 'Reach (tiles)'
};

/** Precomputed turn multipliers derived from the active `TurnDurationScale`. */
interface DurationUnitMultipliers {
  readonly turnsPerMinute: number;
  readonly turnsPerHour: number;
  readonly turnsPerDay: number;
}

function buildDurationMultipliers(scale: TurnDurationScale): DurationUnitMultipliers {
  return {
    turnsPerMinute: Math.max(1, Math.round(getTurnsPerMinute(scale))),
    turnsPerHour: Math.max(1, Math.round(getTurnsPerHour(scale))),
    turnsPerDay: Math.max(1, Math.round(getTurnsPerDay(scale)))
  };
}

function unitRoundsMultiplier(unitToken: string, mults: DurationUnitMultipliers): number {
  const lower = unitToken.toLowerCase();
  if (lower.startsWith('day')) return mults.turnsPerDay;
  if (lower.startsWith('hour') || lower === 'hr' || lower === 'hrs') return mults.turnsPerHour;
  if (lower.startsWith('min')) return mults.turnsPerMinute;
  return 1;
}

function evaluateScalarOrDice(token: string): number {
  const trimmed = token.trim();
  if (/^\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10);
  }
  return Math.max(0, evaluateDiceExpression(trimmed).total);
}

function parseDurationSegment(segment: string, casterLevel: number, mults: DurationUnitMultipliers): number {
  const clean = segment.trim().toLowerCase();
  if (!clean) return 0;

  const perLevelMatch =
    /^(\d+d\d+(?:[+-]\d+)?|\d+)\s*(rounds?|minutes?|mins?|hours?|hrs?|days?)\s*(?:\/|per)\s*(?:(\d+)\s*)?(?:levels?|cl)$/.exec(
      clean
    );
  if (perLevelMatch) {
    const qty = evaluateScalarOrDice(perLevelMatch[1] ?? '1');
    const unitMult = unitRoundsMultiplier(perLevelMatch[2] ?? 'round', mults);
    const clStep = perLevelMatch[3] ? Math.max(1, Number.parseInt(perLevelMatch[3], 10)) : 1;
    const steps = Math.floor(Math.max(1, casterLevel) / clStep);
    return qty * unitMult * steps;
  }

  const fixedMatch = /^(\d+d\d+(?:[+-]\d+)?|\d+)\s*(rounds?|minutes?|mins?|hours?|hrs?|days?)$/.exec(clean);
  if (fixedMatch) {
    const qty = evaluateScalarOrDice(fixedMatch[1] ?? '1');
    const unitMult = unitRoundsMultiplier(fixedMatch[2] ?? 'round', mults);
    return qty * unitMult;
  }

  return 0;
}

/**
 * Parses a declarative D&D 3.5e spell duration string (covering fixed, per-level, dice,
 * compound, concentration, permanent, and instantaneous formats) into global game turns
 * according to the active `TurnDurationScale` (defaulting to `DND35E_DEFAULT_WORLD_CLOCK_CONFIG`).
 *
 * @param rawDuration Declarative duration string from spell or unit definition.
 * @param casterLevel Effective Caster Level of the cast.
 * @param options Optional Extend Spell, instantaneous-condition fallback, and clock scale controls.
 * @returns Parsed duration breakdown (`durationTurns`, `isPermanent`, `isConcentration`).
 */
export function parseSpellDurationTurns(
  rawDuration: string | undefined,
  casterLevel: number,
  options?: {
    readonly extend?: boolean | undefined;
    readonly fallbackRoundsForCondition?: boolean | undefined;
    readonly isConditionOrBuffSpell?: boolean | undefined;
    readonly clock?: TurnDurationScale | undefined;
  }
): ParsedSpellDuration {
  const cl = Math.max(1, casterLevel);
  const mults = buildDurationMultipliers(options?.clock ?? DND35E_DEFAULT_WORLD_CLOCK_CONFIG);
  const raw = (rawDuration ?? 'instantaneous').trim().toLowerCase().replace(/_/g, ' ');
  if (!raw || raw === 'instantaneous') {
    if (options?.fallbackRoundsForCondition === true) {
      const base = DEFAULT_INSTANTANEOUS_CONDITION_DURATION_ROUNDS;
      return {
        durationTurns: options.extend === true ? base * EXTEND_METAMAGIC_DURATION_MULTIPLIER : base,
        isPermanent: false,
        isConcentration: false
      };
    }
    return { durationTurns: 0, isPermanent: false, isConcentration: false };
  }

  if (raw === 'permanent' || raw.startsWith('permanent ')) {
    return { durationTurns: 0, isPermanent: true, isConcentration: false };
  }

  let working = raw
    .replace(/\s+or until discharged$/, '')
    .replace(/\s+until discharged$/, '')
    .trim();

  let isConcentration = false;
  if (working === 'concentration') {
    const base = mults.turnsPerMinute;
    return {
      durationTurns: options?.extend === true ? base * EXTEND_METAMAGIC_DURATION_MULTIPLIER : base,
      isPermanent: false,
      isConcentration: true
    };
  }
  if (working.startsWith('concentration')) {
    isConcentration = true;
    const upToIdx = working.indexOf('up to ');
    if (upToIdx >= 0) {
      working = working.slice(upToIdx + 'up to '.length).trim();
    } else {
      working = working.replace(/^concentration[,\s]*/, '').trim();
    }
  }

  if (working.includes('/')) {
    const slashParts = working.split('/').map((p) => p.trim());
    if (slashParts[0] === 'instantaneous' && slashParts[1]) {
      working = slashParts[1];
    }
  }

  if (working.includes(' or ')) {
    working = working.split(' or ')[0]!.trim();
  }

  let totalTurns = 0;
  if (working === '1 use/level' || working === '1 use per level') {
    totalTurns = cl;
  } else if (working === 'see text' || working === 'varies') {
    totalTurns =
      options?.fallbackRoundsForCondition === true || options?.isConditionOrBuffSpell === true
        ? cl * mults.turnsPerMinute
        : 0;
  } else {
    const parts = working.split('+').map((p) => p.trim());
    for (const part of parts) {
      totalTurns += parseDurationSegment(part, cl, mults);
    }
    if (parts.length > 0 && totalTurns === 0 && isConcentration) {
      totalTurns = mults.turnsPerMinute;
    }
  }

  if (totalTurns > 0 && options?.extend === true) {
    totalTurns *= EXTEND_METAMAGIC_DURATION_MULTIPLIER;
  }

  return {
    durationTurns: totalTurns > 0 ? Math.max(MIN_ACTIVE_SPELL_DURATION_ROUNDS, totalTurns) : 0,
    isPermanent: false,
    isConcentration
  };
}

/**
 * Classifies an effect's polarity strictly from emitted modifier signs, ability harm,
 * condition presence, and unit target role (zero content-ID checks).
 */
export function classifyEffectPolarity(
  modifiers: ReadonlyArray<StatModifier>,
  options?: {
    readonly linkedConditionId?: string | undefined;
    readonly hasAbilityHarm?: boolean | undefined;
    readonly targetRole?: string | undefined;
  }
): StatusEffectPolarity {
  let hasPositive = false;
  let hasNegative = options?.hasAbilityHarm === true;

  for (const mod of modifiers) {
    if (mod.value > 0) hasPositive = true;
    else if (mod.value < 0) hasNegative = true;
  }

  if (options?.linkedConditionId && options.linkedConditionId !== 'none') {
    if (!hasPositive) {
      hasNegative = true;
    } else if (options.targetRole === 'secondary_enemy') {
      hasNegative = true;
    }
  }

  if (hasPositive && hasNegative) return 'mixed';
  if (hasPositive) return 'buff';
  if (hasNegative) return 'debuff';
  return options?.targetRole === 'secondary_enemy' ? 'debuff' : 'neutral';
}

function formatStatLabel(targetStat: string): string {
  const mapped = STAT_LABEL_MAP[targetStat];
  if (mapped) return mapped;
  if (targetStat.startsWith('skill:')) {
    return targetStat
      .slice('skill:'.length)
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }
  return targetStat
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function formatGrantedTagLabel(tag: string): string | undefined {
  if (tag === 'weapon:magic') return 'Magic Weapon';
  if (tag.endsWith('_active') || tag.startsWith('status:')) return undefined;
  return tag
    .replace(/^[^:]+:/, '')
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Generates a concise human-readable tooltip summary of active spell modifiers, tags, and conditions.
 */
export function formatSpellModifiersSummary(
  modifiers: ReadonlyArray<StatModifier>,
  options?: {
    readonly grantedTags?: ReadonlyArray<string> | undefined;
    readonly linkedConditionId?: string | undefined;
    readonly extraNotes?: ReadonlyArray<string> | undefined;
  }
): string {
  const parts: string[] = [];

  for (const mod of modifiers) {
    if (mod.targetStat === 'quicken_max_spell_level') {
      parts.push(`Quicken <= Lvl ${mod.value}`);
      continue;
    }
    if (mod.targetStat === 'retaliation_rider_active') {
      parts.push('Retaliation Aura');
      continue;
    }
    const sign = mod.value >= 0 ? `+${mod.value}` : `${mod.value}`;
    const typeLabel =
      mod.bonusType !== 'untyped' && mod.bonusType !== 'size_step' ? ` ${mod.bonusType.replace(/_/g, ' ')}` : '';
    const statLabel = formatStatLabel(mod.targetStat);
    parts.push(`${sign}${typeLabel} ${statLabel}`);
  }

  for (const tag of options?.grantedTags ?? []) {
    const label = formatGrantedTagLabel(tag);
    if (label && !parts.includes(label)) {
      parts.push(label);
    }
  }

  if (options?.linkedConditionId && options.linkedConditionId !== 'none') {
    const condLabel = options.linkedConditionId
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
    if (!parts.includes(condLabel)) {
      parts.push(condLabel);
    }
  }

  for (const note of options?.extraNotes ?? []) {
    if (note && !parts.includes(note)) {
      parts.push(note);
    }
  }

  return parts.join(', ');
}
