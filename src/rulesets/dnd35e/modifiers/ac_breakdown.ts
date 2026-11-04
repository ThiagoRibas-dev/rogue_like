import { matchesEntityTagCondition } from '../../../systems/reaction.system.ts';
import { SIZE_METRICS } from '../spatial/grid_geometry.ts';
import type {
  ACBreakdownDTO,
  CreatureSizeCategory,
  OriginLayer,
  StatModifier,
  StatQueryContext
} from '../types/dnd35e.types.ts';
import {
  appendSourcePath,
  DND35E_BASE_AC,
  getModifierSourcePath,
  isSuppressedByAntimagic,
  SIZE_AC_AND_ATTACK_MODIFIERS,
  SIZE_CATEGORIES_BY_RANK
} from './provenance.ts';
import { resolveTypedModifiers } from './stacking_engine.ts';

/**
 * Resolves an actor's Effective Size Category from base size, form overrides, and non-stacking size steps.
 *
 * @param baseSize The entity's base `CreatureSizeCategory` (e.g. from race).
 * @param sizeModifiers Active `StatModifier` entries targeting `'size'`.
 * @param context Optional query context.
 * @returns Resolved size category, rank index, and winning source path.
 */
export function resolveEffectiveSizeCategory(
  baseSize: CreatureSizeCategory,
  sizeModifiers: ReadonlyArray<StatModifier>,
  context?: StatQueryContext
): { readonly sizeCategory: CreatureSizeCategory; readonly rankIndex: number; readonly winningSourcePath: string } {
  let rank = SIZE_METRICS[baseSize].rankIndex;
  let winningSourcePath = appendSourcePath(undefined, `race:base/size:${baseSize}`);

  const validModifiers = sizeModifiers.filter((mod) => {
    if (context?.inAntimagicField === true && isSuppressedByAntimagic(mod)) {
      return false;
    }
    if (
      mod.condition &&
      !matchesEntityTagCondition(mod.condition, context?.targetTags, context?.effectTags, context?.selfTags)
    ) {
      return false;
    }
    return true;
  });

  const formOverrides = validModifiers.filter((m) => m.bonusType === 'form_override');
  if (formOverrides.length > 0) {
    const sorted = [...formOverrides].sort((a, b) => b.value - a.value);
    const topOverride = sorted[0];
    if (topOverride !== undefined) {
      rank = topOverride.value;
      winningSourcePath = getModifierSourcePath(topOverride);
    }
  }

  const sizeSteps = validModifiers.filter((m) => m.bonusType === 'size_step');
  let maxPos = 0;
  let minNeg = 0;
  for (const step of sizeSteps) {
    if (step.value > maxPos) maxPos = step.value;
    if (step.value < minNeg) minNeg = step.value;
  }
  const netStep = maxPos + minNeg;
  const clampedRank = Math.max(-4, Math.min(4, rank + netStep));
  const category = SIZE_CATEGORIES_BY_RANK[clampedRank] ?? 'medium';

  return {
    sizeCategory: category,
    rankIndex: clampedRank,
    winningSourcePath
  };
}

/**
 * Builds declarative `StatModifier` entries emitted by an Effective Size Category (Unified Effect Provider).
 * Emits `'size'` bonusType modifiers targeting `'ac'`, `'attack'`, `'grapple'`, and `'hide'`.
 *
 * @param sizeCategory The resolved Effective Size Category.
 * @param parentSourcePath Optional parent provenance path (e.g. winning size root).
 * @returns Array of declarative `StatModifier` entries.
 */
export function buildSizeEffectProviderModifiers(
  sizeCategory: CreatureSizeCategory,
  parentSourcePath?: string
): ReadonlyArray<StatModifier> {
  const metric = SIZE_METRICS[sizeCategory];
  const sizeRoot = appendSourcePath(parentSourcePath, `size:${sizeCategory}`);

  return [
    {
      targetStat: 'ac',
      value: metric.attackAndAcModifier,
      bonusType: 'size',
      sourceId: 'size_effect_provider',
      sourcePath: appendSourcePath(sizeRoot, 'ac_size_mod'),
      origin: 'ex'
    },
    {
      targetStat: 'attack',
      value: metric.attackAndAcModifier,
      bonusType: 'size',
      sourceId: 'size_effect_provider',
      sourcePath: appendSourcePath(sizeRoot, 'attack_size_mod'),
      origin: 'ex'
    },
    {
      targetStat: 'grapple',
      value: metric.specialSizeModifier,
      bonusType: 'size',
      sourceId: 'size_effect_provider',
      sourcePath: appendSourcePath(sizeRoot, 'grapple_size_mod'),
      origin: 'ex'
    },
    {
      targetStat: 'hide',
      value: metric.hideModifier,
      bonusType: 'size',
      sourceId: 'size_effect_provider',
      sourcePath: appendSourcePath(sizeRoot, 'hide_size_mod'),
      origin: 'ex'
    }
  ];
}

/**
 * Computes the Contextual Armor Class Triplet (`fullAC`, `touchAC`, `flatFootedAC`)
 * for an entity given its Dexterity modifier, size category, and active AC modifiers.
 * Avoids double-counting size if a `bonusType: 'size'` modifier is already present in `acModifiers`.
 *
 * @param dexModifier Raw Dexterity ability modifier.
 * @param sizeCategory Entity's 9-tier `CreatureSizeCategory`.
 * @param acModifiers Array of `StatModifier` entries targeting `'ac'`.
 * @param options Optional contextual parameters.
 * @returns Complete `ACBreakdownDTO`.
 */
export function computeEffectiveAC(
  dexModifier: number,
  sizeCategory: CreatureSizeCategory,
  acModifiers: ReadonlyArray<StatModifier>,
  options?: {
    readonly maxDexBonus?: number | undefined;
    readonly hasUncannyDodge?: boolean | undefined;
    readonly inAntimagicField?: boolean | undefined;
    readonly againstIncorporealTouch?: boolean | undefined;
    readonly selfTags?: ReadonlyArray<string> | undefined;
    readonly targetTags?: ReadonlyArray<string> | undefined;
    readonly effectTags?: ReadonlyArray<string> | undefined;
    readonly suppressedOriginLayers?: ReadonlyArray<OriginLayer> | undefined;
  }
): ACBreakdownDTO {
  const effectiveDexMod = options?.maxDexBonus !== undefined ? Math.min(dexModifier, options.maxDexBonus) : dexModifier;
  const inAntimagicField = options?.inAntimagicField === true;
  const hasUncannyDodge = options?.hasUncannyDodge === true;
  const againstIncorporealTouch = options?.againstIncorporealTouch === true;

  const sharedContext: StatQueryContext = {
    inAntimagicField,
    ...(options?.selfTags !== undefined ? { selfTags: options.selfTags } : {}),
    ...(options?.targetTags !== undefined ? { targetTags: options.targetTags } : {}),
    ...(options?.effectTags !== undefined ? { effectTags: options.effectTags } : {}),
    ...(options?.suppressedOriginLayers !== undefined ? { suppressedOriginLayers: options.suppressedOriginLayers } : {})
  };

  const sizeAcMod = acModifiers.find((m) => m.bonusType === 'size' && m.targetStat === 'ac');
  const sizeModFromMetrics = SIZE_AC_AND_ATTACK_MODIFIERS[sizeCategory];
  const sizeContribution = sizeAcMod !== undefined ? sizeAcMod.value : sizeModFromMetrics;
  const shouldAddExternalSize = sizeAcMod === undefined;

  const fullMods = resolveTypedModifiers(acModifiers, sharedContext);
  const touchMods = resolveTypedModifiers(acModifiers, {
    ...sharedContext,
    ignoreArmorAndNatural: true,
    ...(againstIncorporealTouch ? { againstIncorporealTouch: true } : {})
  });
  const flatFootedMods = resolveTypedModifiers(acModifiers, {
    ...sharedContext,
    ignorePositiveDexAndDodge: !hasUncannyDodge
  });

  const flatFootedDex = hasUncannyDodge ? effectiveDexMod : Math.min(0, effectiveDexMod);
  const externalSize = shouldAddExternalSize ? sizeContribution : 0;

  return {
    fullAC: DND35E_BASE_AC + effectiveDexMod + externalSize + fullMods,
    touchAC: DND35E_BASE_AC + effectiveDexMod + externalSize + touchMods,
    flatFootedAC: DND35E_BASE_AC + flatFootedDex + externalSize + flatFootedMods,
    baseAC: DND35E_BASE_AC,
    dexContribution: effectiveDexMod,
    sizeContribution,
    modifierTotal: fullMods
  };
}
