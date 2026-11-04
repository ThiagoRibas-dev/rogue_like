import type {
  AbilityScoresRecord,
  CreatureSizeCategory,
  HitDieTrack,
  OriginLayer,
  StatModifier,
  StatQueryContext,
  StatResolutionBreakdown
} from '../types/dnd35e.types.ts';
import { classifyModifierOriginLayer, getModifierSourcePath } from './provenance.ts';

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
 * Partitioned buckets of modifiers for the 4-Stage Topological DAG.
 */
export interface PartitionedDAGModifiers {
  readonly modsByStat: Readonly<Record<string, ReadonlyArray<StatModifier>>>;
  readonly naExtraMods: ReadonlyArray<StatModifier>;
  readonly wornArmorExtraMods: ReadonlyArray<StatModifier>;
  readonly wornShieldExtraMods: ReadonlyArray<StatModifier>;
  readonly rawStandaloneAcMods: ReadonlyArray<StatModifier>;
}

/**
 * Single-pass $O(N)$ bucket partitioning of allModifiers across all DAG stages.
 *
 * @param allModifiers Input StatModifier array.
 * @returns PartitionedDAGModifiers.
 */
export function partitionDAGModifiers(allModifiers: ReadonlyArray<StatModifier>): PartitionedDAGModifiers {
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

  return {
    modsByStat,
    naExtraMods,
    wornArmorExtraMods,
    wornShieldExtraMods,
    rawStandaloneAcMods
  };
}

/**
 * Emits a Stage 4 synthetic AC modifier representing the resolved Stage 3 compound defense sub-stat
 * (`'natural_armor'`, `'worn_armor_bonus'`, or `'worn_shield_bonus'`), preserving the primary winning
 * `sourcePath` and any `effectTags` (such as `'force'`) from Stage 3 active modifiers.
 *
 * @param breakdown Stage 3 StatResolutionBreakdown.
 * @param bonusType Emitted Stage 4 bonusType.
 * @param sourceId Emitted Stage 4 sourceId.
 * @param fallbackSourcePath Fallback provenance path.
 * @param origin Emitted modifier origin.
 * @returns Synthetic Stage 4 StatModifier.
 */
export function buildStage3CompoundEmittedModifier(
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
 *
 * @param resolution Stage 4 AC resolution breakdown.
 * @param substatBreakdowns Stage 3 compound sub-stat breakdowns.
 * @returns Refined StatResolutionBreakdown.
 */
export function refineStage4AcBreakdownOriginLayers(
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
