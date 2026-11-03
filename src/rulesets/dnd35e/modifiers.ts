import type {
  AbilityId,
  AbilityScoreState,
  AbilityScoresRecord,
  ACBreakdownDTO,
  BonusType,
  CreatureSizeCategory,
  DnD35ResolvedActorStats,
  EffectProvenanceIndex,
  HitDieTrack,
  OriginLayer,
  SaveType,
  ShadowedModifierEntry,
  StatModifier,
  StatQueryContext,
  StatResolutionBreakdown,
  SuppressedModifierEntry
} from './types/dnd35e.types.ts';
import { ALL_ABILITY_IDS } from './types/dnd35e.types.ts';
import { SIZE_METRICS } from './spatial/grid_geometry.ts';
import { computeAbilityModifier, computeEffectiveAbilityScore } from './abilities.ts';
import { aggregateProgressionChassis } from './progression.ts';
import { matchesEntityTagCondition } from '../../systems/reaction.system.ts';

/** Base Armor Class before modifiers in D&D 3.5e (`10`). */
export const DND35E_BASE_AC = 10;

/** Size modifiers to Armor Class and Attack Rolls across all 9 creature sizes. */
export const SIZE_AC_AND_ATTACK_MODIFIERS: Readonly<Record<CreatureSizeCategory, number>> = {
  fine: 8,
  diminutive: 4,
  tiny: 2,
  small: 1,
  medium: 0,
  large: -1,
  huge: -2,
  gargantuan: -4,
  colossal: -8
};

/**
 * Maps integer rank indices (`-4` through `+4`) to their canonical `CreatureSizeCategory`.
 */
export const SIZE_CATEGORIES_BY_RANK: Readonly<Record<number, CreatureSizeCategory>> = {
  [-4]: 'fine',
  [-3]: 'diminutive',
  [-2]: 'tiny',
  [-1]: 'small',
  0: 'medium',
  1: 'large',
  2: 'huge',
  3: 'gargantuan',
  4: 'colossal'
};

/**
 * Appends a child segment to a parent provenance path (`"parent/child"`),
 * or returns `segment` when no parent path is present.
 *
 * @param parentPath Optional slash-delimited parent provenance path.
 * @param segment Child node segment (e.g., `'subtype:incorporeal'`, `'trait:construct_bonus_hp'`).
 * @returns Combined slash-delimited `sourcePath`.
 */
export function appendSourcePath(parentPath: string | undefined, segment: string): string {
  if (!parentPath || parentPath.trim().length === 0) {
    return segment;
  }
  return `${parentPath}/${segment}`;
}

/**
 * Returns the canonical provenance path for a modifier (`modifier.sourcePath ?? modifier.sourceId`).
 *
 * @param modifier The `StatModifier` to inspect.
 * @returns Non-empty provenance path string.
 */
export function getModifierSourcePath(modifier: StatModifier): string {
  return modifier.sourcePath ?? modifier.sourceId;
}

/**
 * Revokes (filters out) all `StatModifier` entries whose `sourcePath` (or `sourceId`)
 * matches `pathPrefix` or is a descendant of `pathPrefix/` (e.g., revoking `"spell:shapechange"`
 * removes `"spell:shapechange/form:iron_golem/type:construct/trait:construct_bonus_hp"`).
 *
 * @param modifiers Input array of `StatModifier` entries.
 * @param pathPrefix Root or intermediate provenance path prefix to revoke.
 * @returns Filtered array of remaining `StatModifier` entries.
 */
export function revokeModifiersByPathPrefix(
  modifiers: ReadonlyArray<StatModifier>,
  pathPrefix: string
): ReadonlyArray<StatModifier> {
  const normalizedPrefix = pathPrefix.endsWith('/') ? pathPrefix.slice(0, -1) : pathPrefix;
  const descendantPrefix = `${normalizedPrefix}/`;
  return modifiers.filter((mod) => {
    const path = getModifierSourcePath(mod);
    return path !== normalizedPrefix && !path.startsWith(descendantPrefix);
  });
}

/**
 * Builds a fast runtime lookup index (`EffectProvenanceIndex`) from an array of `StatModifier` entries,
 * indexing every modifier by its cumulative path prefixes (`byPathPrefix`), individual causal nodes (`byNode`),
 * and target stat (`byTargetStat`).
 *
 * @param modifiers Array of active `StatModifier` entries on an actor.
 * @returns `EffectProvenanceIndex` for $O(1)$ prefix, node, and stat breakdown queries.
 */
export function buildEffectProvenanceIndex(modifiers: ReadonlyArray<StatModifier>): EffectProvenanceIndex {
  const byPathPrefix: Record<string, StatModifier[]> = {};
  const byNode: Record<string, StatModifier[]> = {};
  const byTargetStat: Record<string, StatModifier[]> = {};

  for (const mod of modifiers) {
    const fullPath = getModifierSourcePath(mod);
    const segments = fullPath.split('/').filter((s) => s.length > 0);

    let cumulative = '';
    for (const seg of segments) {
      cumulative = cumulative.length === 0 ? seg : `${cumulative}/${seg}`;
      const prefixBucket = byPathPrefix[cumulative] ?? [];
      prefixBucket.push(mod);
      byPathPrefix[cumulative] = prefixBucket;

      const nodeBucket = byNode[seg] ?? [];
      if (!nodeBucket.includes(mod)) {
        nodeBucket.push(mod);
      }
      byNode[seg] = nodeBucket;
    }

    const statBucket = byTargetStat[mod.targetStat] ?? [];
    statBucket.push(mod);
    byTargetStat[mod.targetStat] = statBucket;
  }

  return {
    byPathPrefix,
    byNode,
    byTargetStat
  };
}

/**
 * Classifies a `StatModifier` into an orthogonal `OriginLayer` based on the root segment
 * of its hierarchical `sourcePath` (or `sourceId`).
 *
 * @param modifier The `StatModifier` to classify.
 * @returns The assigned `OriginLayer`.
 */
export function classifyModifierOriginLayer(modifier: StatModifier): OriginLayer {
  const fullPath = getModifierSourcePath(modifier);
  const rootSegment = fullPath.split('/')[0] ?? '';
  const prefix = rootSegment.includes(':') ? (rootSegment.split(':')[0] ?? '') : rootSegment;

  switch (prefix) {
    case 'race':
    case 'racial':
      return 'racial';
    case 'class':
    case 'feat':
    case 'template':
    case 'type':
    case 'subtype':
    case 'progression':
      return 'progression';
    case 'form':
    case 'wild_shape':
    case 'polymorph':
      return 'form';
    case 'item':
    case 'equip':
    case 'armor':
    case 'shield':
    case 'weapon':
    case 'equipment':
      return 'equipment';
    case 'spell':
    case 'condition':
    case 'stance':
    case 'effect':
    case 'temporary':
      return 'temporary';
    case 'field':
    case 'aura':
    case 'zone':
    case 'environment':
      return 'environment';
    default:
      return 'base';
  }
}

/**
 * Checks if a modifier origin is suppressed inside an Antimagic Field (`su`, `sp`, `spell`, `magical`).
 *
 * @param modifier The `StatModifier` to test.
 * @returns True if suppressed by Antimagic Field.
 */
function isSuppressedByAntimagic(modifier: StatModifier): boolean {
  if (modifier.origin === undefined) return false;
  switch (modifier.origin) {
    case 'magical':
    case 'spell':
    case 'sp':
    case 'su':
      return true;
    case 'ex':
    case 'mundane':
      return false;
  }
}

/**
 * Checks if a bonus type is a physical armor/shield/natural armor type ignored by Touch Attacks.
 *
 * @param bonusType The `BonusType` to check.
 * @returns True if ignored by Touch AC.
 */
function isArmorOrNaturalBonus(bonusType: BonusType): boolean {
  switch (bonusType) {
    case 'armor':
    case 'armor_enhancement':
    case 'shield':
    case 'shield_enhancement':
    case 'natural_armor':
    case 'natural_armor_enhancement':
      return true;
    default:
      return false;
  }
}

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
      // Check [Force] exemption for incorporeal touch attacks
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

  // Separate additive stacking types, penalties, circumstance by source, and non-stacking buckets
  const circumstanceBySource: Record<string, StatModifier[]> = {};
  const nonStackingBuckets: Partial<Record<BonusType, StatModifier[]>> = {};

  for (const mod of candidates) {
    if (mod.value < 0) {
      // Penalties stack additively
      activeModifiers.push(mod);
      byOriginLayer[classifyModifierOriginLayer(mod)] += mod.value;
      continue;
    }

    if (mod.value === 0) {
      continue;
    }

    if (mod.bonusType === 'dodge') {
      activeModifiers.push(mod);
      byOriginLayer[classifyModifierOriginLayer(mod)] += mod.value;
      continue;
    }

    if (mod.bonusType === 'untyped') {
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

  // Resolve circumstance bonuses (highest positive per sourceId)
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

  // Resolve compound enhancement folding for legacy callers (armor + armor_enhancement)
  const resolveCompoundGroup = (
    baseType: 'armor' | 'shield' | 'natural_armor',
    enhType: 'armor_enhancement' | 'shield_enhancement' | 'natural_armor_enhancement'
  ): void => {
    const baseMods = nonStackingBuckets[baseType] ?? [];
    const enhMods = nonStackingBuckets[enhType] ?? [];

    if (baseMods.length === 0 && enhMods.length === 0) {
      return;
    }

    // Distinguish physical/mundane base bonuses from standalone spell/magical armor
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
        // Mundane compound wins!
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
        // Standalone armor wins!
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

  // Form override vs base resolution
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

  // Resolve all other non-stacking bonus types
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

  // Form override check
  const formOverrides = validModifiers.filter((m) => m.bonusType === 'form_override');
  if (formOverrides.length > 0) {
    const sorted = [...formOverrides].sort((a, b) => b.value - a.value);
    const topOverride = sorted[0];
    if (topOverride !== undefined) {
      rank = topOverride.value;
      winningSourcePath = getModifierSourcePath(topOverride);
    }
  }

  // Size step check (non-stacking: highest positive step, lowest negative step)
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

  // Check if acModifiers already has a 'size' bonusType modifier targeting 'ac' (from Size Effect Provider)
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

/** Input parameters for the 4-Stage Sub-Stat Topological DAG evaluation. */
export interface DnD35ActorStatDAGInput {
  readonly baseSize: CreatureSizeCategory;
  readonly rawAbilities: AbilityScoresRecord;
  readonly tracks: ReadonlyArray<HitDieTrack>;
  readonly baseNaturalArmor?: number | undefined;
  readonly naturalArmorDelta?: number | undefined;
  readonly stripNaturalArmor?: boolean | undefined;
  readonly armorBonus?: number | undefined;
  readonly shieldBonus?: number | undefined;
  readonly maxDexBonus?: number | undefined;
  readonly baseSpeed?: number | undefined;
  readonly baseMaxHp?: number | undefined;
  readonly isIncorporeal?: boolean | undefined;
  readonly hasUncannyDodge?: boolean | undefined;
  readonly statModifiers?: ReadonlyArray<StatModifier> | undefined;
  readonly context?: StatQueryContext | undefined;
}

/**
 * Emits a Stage 4 synthetic AC modifier representing the resolved Stage 3 compound defense sub-stat
 * (`'natural_armor'`, `'worn_armor_bonus'`, or `'worn_shield_bonus'`), preserving the primary winning
 * `sourcePath` and any `effectTags` (such as `'force'`) from Stage 3 active modifiers.
 */
function buildStage3CompoundEmittedModifier(
  breakdown: StatResolutionBreakdown,
  bonusType: 'natural_armor' | 'armor' | 'shield',
  sourceId: 'natural_armor_substat' | 'worn_armor_substat' | 'worn_shield_substat',
  fallbackSourcePath: string,
  origin: 'ex' | 'mundane'
): StatModifier {
  const primaryWinner =
    breakdown.activeModifiers.find((m) => m.bonusType === 'form_override') ??
    breakdown.activeModifiers.find((m) => m.bonusType === 'base') ??
    breakdown.activeModifiers[0];

  const resolvedSourcePath = primaryWinner !== undefined ? getModifierSourcePath(primaryWinner) : fallbackSourcePath;

  const collectedEffectTags = new Set<string>();
  for (const activeMod of breakdown.activeModifiers) {
    if (activeMod.effectTags !== undefined) {
      for (const tag of activeMod.effectTags) {
        collectedEffectTags.add(tag);
      }
    }
  }

  return {
    targetStat: 'ac',
    value: breakdown.total,
    bonusType,
    sourceId,
    sourcePath: resolvedSourcePath,
    origin,
    ...(collectedEffectTags.size > 0 ? { effectTags: Array.from(collectedEffectTags) } : {})
  };
}

/**
 * Refines a Stage 4 AC `StatResolutionBreakdown` by replacing any active Stage 3 compound sub-stat
 * modifier's single-bucket `OriginLayer` entry with its multi-layer Stage 3 `byOriginLayer` breakdown.
 */
function refineStage4AcBreakdownOriginLayers(
  resolution: StatResolutionBreakdown,
  substatBreakdowns: Readonly<Record<string, StatResolutionBreakdown>>
): StatResolutionBreakdown {
  let needsRefinement = false;
  for (const mod of resolution.activeModifiers) {
    if (substatBreakdowns[mod.sourceId] !== undefined) {
      needsRefinement = true;
      break;
    }
  }
  if (!needsRefinement) {
    return resolution;
  }

  const nextByOriginLayer: Record<OriginLayer, number> = {
    ...resolution.byOriginLayer
  };

  for (const mod of resolution.activeModifiers) {
    const subBreakdown = substatBreakdowns[mod.sourceId];
    if (subBreakdown !== undefined) {
      const assignedLayer = classifyModifierOriginLayer(mod);
      nextByOriginLayer[assignedLayer] -= mod.value;
      for (const [layerKey, amount] of Object.entries(subBreakdown.byOriginLayer)) {
        nextByOriginLayer[layerKey as OriginLayer] += amount;
      }
    }
  }

  return {
    ...resolution,
    byOriginLayer: nextByOriginLayer
  };
}

/**
 * Evaluates an actor across the complete 4-Stage Topological Sub-Stat DAG:
 * 1. Stage 1 (`'size'`): Resolves Effective Size category and emits Size Effect Provider modifiers.
 * 2. Stage 2 (`'str'`..`'cha'`): Resolves typed ability score modifiers, computing effective ability scores and ability mods.
 * 3. Stage 3 (Compound Defenses): Resolves `'natural_armor'`, `'worn_armor_bonus'`, `'worn_shield_bonus'` sub-stats.
 * 4. Stage 4 (Combat Stats): Injects CHA Incorporeal Deflection, computes AC triplet, attack, damage, saves, and HP.
 *
 * @param input Complete actor DAG input parameters.
 * @returns Full `DnD35ResolvedActorStats` structure.
 */
export function evaluateDnD35ActorStatDAG(input: DnD35ActorStatDAGInput): DnD35ResolvedActorStats {
  const allModifiers = input.statModifiers ?? [];
  const baseContext = input.context ?? {};

  // Single-pass $O(N)$ bucket partitioning of allModifiers across all DAG stages
  const modsByStat: Record<string, StatModifier[]> = {};
  const naExtraMods: StatModifier[] = [];
  const wornArmorExtraMods: StatModifier[] = [];
  const wornShieldExtraMods: StatModifier[] = [];
  const rawStandaloneAcMods: StatModifier[] = [];

  for (const m of allModifiers) {
    const statBucket = modsByStat[m.targetStat];
    if (statBucket !== undefined) {
      statBucket.push(m);
    } else {
      modsByStat[m.targetStat] = [m];
    }

    if (m.targetStat === 'natural_armor' || m.bonusType === 'natural_armor_enhancement') {
      naExtraMods.push(m);
    }

    if (
      m.targetStat === 'worn_armor_bonus' ||
      (m.targetStat === 'armor' && (m.origin === 'mundane' || m.sourceId === 'armor')) ||
      m.bonusType === 'armor_enhancement'
    ) {
      wornArmorExtraMods.push(m);
    }

    if (
      m.targetStat === 'worn_shield_bonus' ||
      (m.targetStat === 'shield' && (m.origin === 'mundane' || m.sourceId === 'shield')) ||
      m.bonusType === 'shield_enhancement'
    ) {
      wornShieldExtraMods.push(m);
    }

    if (m.targetStat === 'ac') {
      const isCompoundEnhancement =
        m.bonusType === 'armor_enhancement' ||
        m.bonusType === 'shield_enhancement' ||
        m.bonusType === 'natural_armor_enhancement';
      const isMundaneArmor = m.bonusType === 'armor' && (m.origin === 'mundane' || m.sourceId === 'armor');
      const isMundaneShield = m.bonusType === 'shield' && (m.origin === 'mundane' || m.sourceId === 'shield');
      const isNaturalArmor = m.bonusType === 'natural_armor';

      if (!isCompoundEnhancement && !isMundaneArmor && !isMundaneShield && !isNaturalArmor) {
        rawStandaloneAcMods.push(m);
      }
    }
  }

  // ==========================================
  // STAGE 1: Size Sub-Stat & Effect Provider
  // ==========================================
  const sizeModifiers = modsByStat['size'] ?? [];
  const sizeResult = resolveEffectiveSizeCategory(input.baseSize, sizeModifiers, baseContext);
  const sizeEffectModifiers = buildSizeEffectProviderModifiers(sizeResult.sizeCategory, sizeResult.winningSourcePath);

  // Project 'size:<category>' (and incorporeal tag if flagged) into selfTags for subsequent stages
  const existingSelfTags = (baseContext.selfTags ?? []).filter((t) => !t.startsWith('size:'));
  const stageSelfTagSet = new Set<string>(existingSelfTags);
  stageSelfTagSet.add(`size:${sizeResult.sizeCategory}`);
  if (input.isIncorporeal === true) {
    stageSelfTagSet.add('incorporeal');
    stageSelfTagSet.add('subtype:incorporeal');
  }
  const stageSelfTags: ReadonlyArray<string> = Array.from(stageSelfTagSet);
  const stageContext: StatQueryContext = {
    ...baseContext,
    selfTags: stageSelfTags
  };

  // ==========================================
  // STAGE 2: Ability Score Sub-Stats
  // ==========================================
  const effectiveAbilitiesPartial: Record<AbilityId, AbilityScoreState> = {
    str: input.rawAbilities.str,
    dex: input.rawAbilities.dex,
    con: input.rawAbilities.con,
    int: input.rawAbilities.int,
    wis: input.rawAbilities.wis,
    cha: input.rawAbilities.cha
  };
  const effectiveAbilityModifiersPartial: Record<AbilityId, number> = {
    str: 0,
    dex: 0,
    con: 0,
    int: 0,
    wis: 0,
    cha: 0
  };

  for (const abId of ALL_ABILITY_IDS) {
    const rawState = input.rawAbilities[abId];
    const abilityMods = modsByStat[abId] ?? [];
    const typedBonusNet = resolveTypedModifiers(abilityMods, stageContext);
    const effScore = computeEffectiveAbilityScore(rawState, typedBonusNet);
    const effMod = computeAbilityModifier(effScore);

    effectiveAbilitiesPartial[abId] = {
      base: effScore,
      inherentBonus: 0,
      damage: 0,
      drain: 0,
      tempPenalty: 0
    };
    effectiveAbilityModifiersPartial[abId] = effMod;
  }

  // ==========================================
  // STAGE 3: Compound Defense Sub-Stats
  // ==========================================
  const stage4EmittedMods: StatModifier[] = [];

  // Natural Armor sub-stat
  const naMods: StatModifier[] = [];
  if (input.baseNaturalArmor && input.baseNaturalArmor > 0 && !input.stripNaturalArmor) {
    naMods.push({
      targetStat: 'natural_armor',
      value: input.baseNaturalArmor,
      bonusType: 'base',
      sourceId: 'race_natural_armor',
      sourcePath: 'race:base/natural_armor',
      origin: 'ex'
    });
  }
  if (input.naturalArmorDelta && input.naturalArmorDelta !== 0 && !input.stripNaturalArmor) {
    naMods.push({
      targetStat: 'natural_armor',
      value: input.naturalArmorDelta,
      bonusType: 'untyped',
      sourceId: 'template_natural_armor_delta',
      sourcePath: 'template:delta/natural_armor',
      origin: 'ex'
    });
  }
  for (const m of naExtraMods) {
    naMods.push(m);
  }
  const naturalArmorBreakdown = resolveTypedModifiersWithBreakdown(naMods, stageContext);
  if (naturalArmorBreakdown.total !== 0 && !input.stripNaturalArmor) {
    stage4EmittedMods.push(
      buildStage3CompoundEmittedModifier(
        naturalArmorBreakdown,
        'natural_armor',
        'natural_armor_substat',
        'race:base/natural_armor',
        'ex'
      )
    );
  }

  // Worn Armor sub-stat
  const wornArmorMods: StatModifier[] = [];
  if (input.armorBonus && input.armorBonus > 0) {
    wornArmorMods.push({
      targetStat: 'worn_armor_bonus',
      value: input.armorBonus,
      bonusType: 'base',
      sourceId: 'physical_armor',
      sourcePath: 'item:armor/base_armor',
      origin: 'mundane'
    });
  }
  for (const m of wornArmorExtraMods) {
    wornArmorMods.push(m);
  }
  const wornArmorBreakdown = resolveTypedModifiersWithBreakdown(wornArmorMods, stageContext);
  if (wornArmorBreakdown.total !== 0) {
    stage4EmittedMods.push(
      buildStage3CompoundEmittedModifier(
        wornArmorBreakdown,
        'armor',
        'worn_armor_substat',
        'item:armor/base_armor',
        'mundane'
      )
    );
  }

  // Worn Shield sub-stat
  const wornShieldMods: StatModifier[] = [];
  if (input.shieldBonus && input.shieldBonus > 0) {
    wornShieldMods.push({
      targetStat: 'worn_shield_bonus',
      value: input.shieldBonus,
      bonusType: 'base',
      sourceId: 'physical_shield',
      sourcePath: 'item:shield/base_shield',
      origin: 'mundane'
    });
  }
  for (const m of wornShieldExtraMods) {
    wornShieldMods.push(m);
  }
  const wornShieldBreakdown = resolveTypedModifiersWithBreakdown(wornShieldMods, stageContext);
  if (wornShieldBreakdown.total !== 0) {
    stage4EmittedMods.push(
      buildStage3CompoundEmittedModifier(
        wornShieldBreakdown,
        'shield',
        'worn_shield_substat',
        'item:shield/base_shield',
        'mundane'
      )
    );
  }

  // ==========================================
  // STAGE 4: Terminal Combat Stats
  // ==========================================
  // Dynamically synchronize Incorporeal CHA Deflection AC with Stage 2 effective CHA modifier
  const chaDeflection = Math.max(1, effectiveAbilityModifiersPartial.cha);
  let hasIncorporealDeflectionMod = false;
  const standaloneAcModifiers: StatModifier[] = rawStandaloneAcMods.map((m) => {
    if (m.sourceId === 'subtype:incorporeal:deflection_ac' || m.sourceId === 'incorporeal_cha_deflection') {
      hasIncorporealDeflectionMod = true;
      return {
        ...m,
        value: chaDeflection
      };
    }
    return m;
  });

  if ((input.isIncorporeal === true || stageSelfTagSet.has('subtype:incorporeal')) && !hasIncorporealDeflectionMod) {
    stage4EmittedMods.push({
      targetStat: 'ac',
      value: chaDeflection,
      bonusType: 'deflection',
      sourceId: 'incorporeal_cha_deflection',
      sourcePath: 'subtype:incorporeal/deflection_ac',
      origin: 'su'
    });
  }

  const sizeAcMod = sizeEffectModifiers.filter((m) => m.targetStat === 'ac');
  const allAcModifiers: StatModifier[] = [...standaloneAcModifiers, ...stage4EmittedMods, ...sizeAcMod];

  const hasUncannyDodge = input.hasUncannyDodge === true;
  const effectiveMaxDex = input.maxDexBonus ?? stageContext.maxDexBonus;
  const effectiveDexMod =
    effectiveMaxDex !== undefined
      ? Math.min(effectiveAbilityModifiersPartial.dex, effectiveMaxDex)
      : effectiveAbilityModifiersPartial.dex;
  const flatFootedDex = hasUncannyDodge ? effectiveDexMod : Math.min(0, effectiveDexMod);
  const sizeContribution = SIZE_AC_AND_ATTACK_MODIFIERS[sizeResult.sizeCategory];

  const substatBreakdowns: Readonly<Record<string, StatResolutionBreakdown>> = {
    natural_armor_substat: naturalArmorBreakdown,
    worn_armor_substat: wornArmorBreakdown,
    worn_shield_substat: wornShieldBreakdown
  };

  // Compute the 3 AC breakdowns once and derive ACBreakdownDTO directly (eliminating 3 redundant passes)
  const rawAcResolution = resolveTypedModifiersWithBreakdown(allAcModifiers, stageContext);
  const rawTouchAcResolution = resolveTypedModifiersWithBreakdown(allAcModifiers, {
    ...stageContext,
    ignoreArmorAndNatural: true,
    ...(stageContext.againstIncorporealTouch === true ? { againstIncorporealTouch: true } : {})
  });
  const rawFlatFootedAcResolution = resolveTypedModifiersWithBreakdown(allAcModifiers, {
    ...stageContext,
    ignorePositiveDexAndDodge: !hasUncannyDodge
  });

  const acResolution = refineStage4AcBreakdownOriginLayers(rawAcResolution, substatBreakdowns);
  const touchAcResolution = refineStage4AcBreakdownOriginLayers(rawTouchAcResolution, substatBreakdowns);
  const flatFootedAcResolution = refineStage4AcBreakdownOriginLayers(rawFlatFootedAcResolution, substatBreakdowns);

  // Note: sizeAcMod is already inside allAcModifiers, so externalSize is 0
  const acBreakdown: ACBreakdownDTO = {
    fullAC: DND35E_BASE_AC + effectiveDexMod + acResolution.total,
    touchAC: DND35E_BASE_AC + effectiveDexMod + touchAcResolution.total,
    flatFootedAC: DND35E_BASE_AC + flatFootedDex + flatFootedAcResolution.total,
    baseAC: DND35E_BASE_AC,
    dexContribution: effectiveDexMod,
    sizeContribution,
    modifierTotal: acResolution.total
  };

  // Chassis & Saves
  const conMod = effectiveAbilityModifiersPartial.con;
  const chassis = aggregateProgressionChassis(input.tracks, conMod);
  const strMod = effectiveAbilityModifiersPartial.str;
  const dexMod = effectiveAbilityModifiersPartial.dex;
  const wisMod = effectiveAbilityModifiersPartial.wis;

  const sharedSaveMods = modsByStat['saves'] ?? [];
  const fortMods = [...(modsByStat['fort'] ?? []), ...sharedSaveMods];
  const refMods = [...(modsByStat['ref'] ?? []), ...sharedSaveMods];
  const willMods = [...(modsByStat['will'] ?? []), ...sharedSaveMods];

  const fortTotal = chassis.baseSaves.fort + conMod + resolveTypedModifiers(fortMods, stageContext);
  const refTotal = chassis.baseSaves.ref + dexMod + resolveTypedModifiers(refMods, stageContext);
  const willTotal = chassis.baseSaves.will + wisMod + resolveTypedModifiers(willMods, stageContext);

  const saves: Record<SaveType, number> = {
    fort: fortTotal,
    ref: refTotal,
    will: willTotal
  };

  // Attack, Damage, HP, Speed
  const attackMods = modsByStat['attack'] ?? [];
  const sizeAtkMod = SIZE_METRICS[sizeResult.sizeCategory].attackAndAcModifier;
  const attackBonus = chassis.totalBab + strMod + sizeAtkMod + resolveTypedModifiers(attackMods, stageContext);

  const damageMods = modsByStat['damage'] ?? [];
  const damageBonus = strMod + resolveTypedModifiers(damageMods, stageContext);

  const maxHpMods = modsByStat['max_hp'] ?? [];
  const maxHpBonus = resolveTypedModifiers(maxHpMods, stageContext);
  const baseHp = input.baseMaxHp !== undefined && input.baseMaxHp > 0 ? input.baseMaxHp : chassis.maxHp;
  const maxHp = baseHp + maxHpBonus;

  const speedMods = [...(modsByStat['speed'] ?? []), ...(modsByStat['land_speed'] ?? [])];
  const speedBonus = resolveTypedModifiers(speedMods, stageContext);
  const speed = (input.baseSpeed ?? 30) + speedBonus;

  return {
    effectiveSize: sizeResult.sizeCategory,
    sizeRankIndex: sizeResult.rankIndex,
    sizeWinningSourcePath: sizeResult.winningSourcePath,
    effectiveAbilities: effectiveAbilitiesPartial,
    effectiveAbilityModifiers: effectiveAbilityModifiersPartial,
    naturalArmorBreakdown,
    wornArmorBreakdown,
    wornShieldBreakdown,
    acBreakdown,
    acResolution,
    touchAcResolution,
    flatFootedAcResolution,
    attackBonus,
    damageBonus,
    maxHp,
    saves,
    speed
  };
}
