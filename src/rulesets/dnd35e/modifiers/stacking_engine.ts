import { matchesEntityTagCondition } from '../../../systems/reaction.system.ts';
import type {
  BonusType,
  OriginLayer,
  ShadowedModifierEntry,
  StatModifier,
  StatQueryContext,
  StatResolutionBreakdown,
  SuppressedModifierEntry
} from '../types/dnd35e.types.ts';
import {
  classifyModifierOriginLayer,
  getModifierSourcePath,
  isArmorOrNaturalBonus,
  isSuppressedByAntimagic
} from './provenance.ts';

/**
 * Resolves a list of `StatModifier` entries with full winner/shadowed/suppressed provenance
 * and orthogonal `OriginLayer` breakdown:
 * - Records suppressed modifiers with reasons (`'antimagic'`, `'touch_attack'`, `'flat_footed'`, `'tag_condition'`, `'origin_suppressed'`).
 * - Preserves `[Force]` armor/shield modifiers against incorporeal touch attacks.
 * - Resolves same-type bonus competition, recording shadowed losers with the winner's `sourcePath`.
 * - Resolves compound enhancement folding for legacy single-pass callers.
 * - Computes total modifier sum and itemized sums by `OriginLayer`.
 *
 * @param modifiers Candidate `StatModifier` entries for the target stat.
 * @param context Optional query context (`inAntimagicField`, `ignoreArmorAndNatural`, `selfTags`, `targetTags`, etc.).
 * @returns Complete `StatResolutionBreakdown`.
 */
export function resolveTypedModifiersWithBreakdown(
  modifiers: ReadonlyArray<StatModifier>,
  context?: StatQueryContext
): StatResolutionBreakdown {
  const inAntimagic = context?.inAntimagicField === true;
  const ignoreArmor = context?.ignoreArmorAndNatural === true;
  const againstIncorporealTouch = context?.againstIncorporealTouch === true;
  const ignoreDodge = context?.ignorePositiveDexAndDodge === true;
  const suppressedLayers = context?.suppressedOriginLayers ?? [];

  const byOriginLayer: Record<OriginLayer, number> = {
    base: 0,
    racial: 0,
    progression: 0,
    form: 0,
    equipment: 0,
    temporary: 0,
    environment: 0
  };

  const activeModifiers: StatModifier[] = [];
  const shadowedModifiers: ShadowedModifierEntry[] = [];
  const suppressedModifiers: SuppressedModifierEntry[] = [];

  const candidates: StatModifier[] = [];

  for (const mod of modifiers) {
    const layer = classifyModifierOriginLayer(mod);
    if (suppressedLayers.includes(layer)) {
      suppressedModifiers.push({ modifier: mod, reason: 'origin_suppressed' });
      continue;
    }

    if (inAntimagic && isSuppressedByAntimagic(mod)) {
      suppressedModifiers.push({ modifier: mod, reason: 'antimagic' });
      continue;
    }

    if (ignoreArmor && isArmorOrNaturalBonus(mod.bonusType)) {
      const isForceEffect =
        againstIncorporealTouch &&
        (mod.bonusType === 'armor' || mod.bonusType === 'shield') &&
        mod.effectTags?.includes('force') === true;

      if (!isForceEffect) {
        suppressedModifiers.push({ modifier: mod, reason: 'touch_attack' });
        continue;
      }
    }

    if (ignoreDodge && mod.bonusType === 'dodge' && mod.value > 0) {
      suppressedModifiers.push({ modifier: mod, reason: 'flat_footed' });
      continue;
    }

    if (
      mod.condition &&
      !matchesEntityTagCondition(mod.condition, context?.targetTags, context?.effectTags, context?.selfTags)
    ) {
      suppressedModifiers.push({ modifier: mod, reason: 'tag_condition' });
      continue;
    }

    candidates.push(mod);
  }

  const circumstanceBySource: Record<string, StatModifier[]> = {};
  const nonStackingBuckets: Partial<Record<BonusType, StatModifier[]>> = {};

  for (const mod of candidates) {
    if (mod.value < 0) {
      activeModifiers.push(mod);
      byOriginLayer[classifyModifierOriginLayer(mod)] += mod.value;
      continue;
    }

    if (mod.value === 0) {
      continue;
    }

    if (mod.bonusType === 'dodge' || mod.bonusType === 'untyped') {
      activeModifiers.push(mod);
      byOriginLayer[classifyModifierOriginLayer(mod)] += mod.value;
      continue;
    }

    if (mod.bonusType === 'circumstance') {
      const bucket = circumstanceBySource[mod.sourceId] ?? [];
      bucket.push(mod);
      circumstanceBySource[mod.sourceId] = bucket;
      continue;
    }

    const bucket = nonStackingBuckets[mod.bonusType] ?? [];
    bucket.push(mod);
    nonStackingBuckets[mod.bonusType] = bucket;
  }

  for (const bucket of Object.values(circumstanceBySource)) {
    if (bucket.length === 0) continue;
    bucket.sort((a, b) => b.value - a.value);
    const winner = bucket[0];
    if (winner !== undefined) {
      activeModifiers.push(winner);
      byOriginLayer[classifyModifierOriginLayer(winner)] += winner.value;
      const winnerPath = getModifierSourcePath(winner);
      for (let i = 1; i < bucket.length; i++) {
        const loser = bucket[i];
        if (loser !== undefined) {
          shadowedModifiers.push({ modifier: loser, shadowedBySourcePath: winnerPath });
        }
      }
    }
  }

  const resolveCompoundGroup = (
    baseType: 'armor' | 'shield' | 'natural_armor',
    enhType: 'armor_enhancement' | 'shield_enhancement' | 'natural_armor_enhancement'
  ): void => {
    const baseMods = nonStackingBuckets[baseType] ?? [];
    const enhMods = nonStackingBuckets[enhType] ?? [];

    if (baseMods.length === 0 && enhMods.length === 0) {
      return;
    }

    const mundaneBaseMods = baseMods.filter((m) => m.origin === 'mundane' || m.sourceId === baseType);
    const standaloneMods = baseMods.filter((m) => m.origin !== 'mundane' && m.sourceId !== baseType);

    mundaneBaseMods.sort((a, b) => b.value - a.value);
    enhMods.sort((a, b) => b.value - a.value);
    standaloneMods.sort((a, b) => b.value - a.value);

    const bestMundane = mundaneBaseMods[0];
    const bestEnh = enhMods[0];
    const bestStandalone = standaloneMods[0];

    const mundaneCompoundValue = (bestMundane?.value ?? 0) + (bestEnh?.value ?? 0);
    const standaloneValue = bestStandalone?.value ?? 0;

    if (bestMundane !== undefined || bestEnh !== undefined) {
      if (mundaneCompoundValue >= standaloneValue) {
        if (bestMundane !== undefined) {
          activeModifiers.push(bestMundane);
          byOriginLayer[classifyModifierOriginLayer(bestMundane)] += bestMundane.value;
        }
        if (bestEnh !== undefined) {
          activeModifiers.push(bestEnh);
          byOriginLayer[classifyModifierOriginLayer(bestEnh)] += bestEnh.value;
        }
        const winnerPath = bestMundane ? getModifierSourcePath(bestMundane) : getModifierSourcePath(bestEnh!);
        if (bestStandalone !== undefined) {
          shadowedModifiers.push({ modifier: bestStandalone, shadowedBySourcePath: winnerPath });
        }
        for (let i = 1; i < mundaneBaseMods.length; i++) {
          const m = mundaneBaseMods[i];
          if (m) shadowedModifiers.push({ modifier: m, shadowedBySourcePath: winnerPath });
        }
        for (let i = 1; i < enhMods.length; i++) {
          const m = enhMods[i];
          if (m) shadowedModifiers.push({ modifier: m, shadowedBySourcePath: getModifierSourcePath(bestEnh!) });
        }
        for (let i = 1; i < standaloneMods.length; i++) {
          const m = standaloneMods[i];
          if (m) shadowedModifiers.push({ modifier: m, shadowedBySourcePath: winnerPath });
        }
      } else {
        activeModifiers.push(bestStandalone!);
        byOriginLayer[classifyModifierOriginLayer(bestStandalone!)] += bestStandalone!.value;
        const winnerPath = getModifierSourcePath(bestStandalone!);
        if (bestMundane !== undefined) {
          shadowedModifiers.push({ modifier: bestMundane, shadowedBySourcePath: winnerPath });
        }
        if (bestEnh !== undefined) {
          shadowedModifiers.push({ modifier: bestEnh, shadowedBySourcePath: winnerPath });
        }
        for (const m of mundaneBaseMods) {
          if (m !== bestMundane) shadowedModifiers.push({ modifier: m, shadowedBySourcePath: winnerPath });
        }
        for (const m of enhMods) {
          if (m !== bestEnh) shadowedModifiers.push({ modifier: m, shadowedBySourcePath: winnerPath });
        }
        for (let i = 1; i < standaloneMods.length; i++) {
          const m = standaloneMods[i];
          if (m) shadowedModifiers.push({ modifier: m, shadowedBySourcePath: winnerPath });
        }
      }
    } else if (bestStandalone !== undefined) {
      activeModifiers.push(bestStandalone);
      byOriginLayer[classifyModifierOriginLayer(bestStandalone)] += bestStandalone.value;
      const winnerPath = getModifierSourcePath(bestStandalone);
      for (let i = 1; i < standaloneMods.length; i++) {
        const m = standaloneMods[i];
        if (m) shadowedModifiers.push({ modifier: m, shadowedBySourcePath: winnerPath });
      }
    }
  };

  resolveCompoundGroup('armor', 'armor_enhancement');
  resolveCompoundGroup('shield', 'shield_enhancement');
  resolveCompoundGroup('natural_armor', 'natural_armor_enhancement');

  const formOverrideMods = nonStackingBuckets['form_override'] ?? [];
  const baseMods = nonStackingBuckets['base'] ?? [];

  if (formOverrideMods.length > 0) {
    formOverrideMods.sort((a, b) => b.value - a.value);
    const overrideWinner = formOverrideMods[0];
    if (overrideWinner !== undefined) {
      activeModifiers.push(overrideWinner);
      byOriginLayer[classifyModifierOriginLayer(overrideWinner)] += overrideWinner.value;
      const winnerPath = getModifierSourcePath(overrideWinner);
      for (let i = 1; i < formOverrideMods.length; i++) {
        const loser = formOverrideMods[i];
        if (loser) shadowedModifiers.push({ modifier: loser, shadowedBySourcePath: winnerPath });
      }
      for (const baseMod of baseMods) {
        shadowedModifiers.push({ modifier: baseMod, shadowedBySourcePath: winnerPath });
      }
    }
  } else if (baseMods.length > 0) {
    baseMods.sort((a, b) => b.value - a.value);
    const baseWinner = baseMods[0];
    if (baseWinner !== undefined) {
      activeModifiers.push(baseWinner);
      byOriginLayer[classifyModifierOriginLayer(baseWinner)] += baseWinner.value;
      const winnerPath = getModifierSourcePath(baseWinner);
      for (let i = 1; i < baseMods.length; i++) {
        const loser = baseMods[i];
        if (loser) shadowedModifiers.push({ modifier: loser, shadowedBySourcePath: winnerPath });
      }
    }
  }

  const handledTypes: ReadonlyArray<BonusType> = [
    'armor',
    'armor_enhancement',
    'shield',
    'shield_enhancement',
    'natural_armor',
    'natural_armor_enhancement',
    'form_override',
    'base'
  ];

  for (const [typeKey, bucket] of Object.entries(nonStackingBuckets)) {
    const bonusType = typeKey as BonusType;
    if (handledTypes.includes(bonusType) || !bucket || bucket.length === 0) {
      continue;
    }

    bucket.sort((a, b) => b.value - a.value);
    const winner = bucket[0];
    if (winner !== undefined) {
      activeModifiers.push(winner);
      byOriginLayer[classifyModifierOriginLayer(winner)] += winner.value;
      const winnerPath = getModifierSourcePath(winner);
      for (let i = 1; i < bucket.length; i++) {
        const loser = bucket[i];
        if (loser !== undefined) {
          shadowedModifiers.push({ modifier: loser, shadowedBySourcePath: winnerPath });
        }
      }
    }
  }

  const total = activeModifiers.reduce((acc, m) => acc + m.value, 0);

  return {
    total,
    activeModifiers,
    shadowedModifiers,
    suppressedModifiers,
    byOriginLayer
  };
}

/**
 * Resolves a list of `StatModifier` entries according to the D&D 3.5e 18-type Bonus Stacking Matrix.
 * Delegates to `resolveTypedModifiersWithBreakdown` ensuring 100% mathematical and logic parity.
 *
 * @param modifiers Candidate `StatModifier` entries for the target stat.
 * @param context Optional query context (`inAntimagicField`, `ignoreArmorAndNatural`, `selfTags`, `targetTags`, etc.).
 * @returns Net resolved integer modifier sum.
 */
export function resolveTypedModifiers(modifiers: ReadonlyArray<StatModifier>, context?: StatQueryContext): number {
  return resolveTypedModifiersWithBreakdown(modifiers, context).total;
}

/** Alias for resolveTypedModifiers. */
export const resolveStatModifiers = resolveTypedModifiers;
