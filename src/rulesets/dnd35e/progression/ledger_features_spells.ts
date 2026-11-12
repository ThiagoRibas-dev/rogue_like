import { collectClassFeaturesUpToLevel, computeEffectiveClassCastingLevel, getClassLevelRow } from '../progression.ts';
import { isActivationConditionMet } from '../effect_bundle.ts';
import type {
  DnD35CharacterLevelRecord,
  DnD35ClassSpellbookState,
  DnD35SpellSchool,
  HitDieTrack,
  StatModifier
} from '../types/dnd35e.types.ts';
import type { DnD35ClassDefinition, DnD35SystemContent } from '../types/dnd35e_system.types.ts';

/** Flat HP penalty per negative level (-5 HP per PHB p. 308). */
export const HP_PENALTY_PER_NEGATIVE_LEVEL = 5;

/** Aggregated active class features, cross-class scaling pools, and granted tags across all class tracks. */
export interface AggregatedClassFeaturesAndPools {
  readonly activeFeatureIds: ReadonlyArray<string>;
  readonly scalingPools: Readonly<Record<string, number>>;
  readonly grantedTags: ReadonlyArray<string>;
}

/**
 * Aggregates active class features across all owned class tracks, applying declarative
 * duplicate-feature upgrades (`upgradeOnDuplicateFeatureId`, e.g. Barbarian 2 + Rogue 4 Uncanny Dodge
 * upgrading to Improved Uncanny Dodge), cross-class scaling pools (`scalingPoolContribution` for
 * Uncanny Dodge, Turn Undead, and Familiar master levels), and literacy / restriction tags.
 */
export function collectActiveClassFeaturesAndPools(
  tracks: ReadonlyArray<HitDieTrack>,
  selectedAcfs: ReadonlyArray<string>,
  classRegistry: Readonly<Record<string, DnD35ClassDefinition>>,
  spentLiteracySkillPoints = false,
  suppressedBundleIds: ReadonlyArray<string> = []
): AggregatedClassFeaturesAndPools {
  const grantedTags = new Set<string>();
  const hasLiterateClass = tracks.some((t) => {
    if (t.levels <= 0) return false;
    const def = classRegistry[t.trackId];
    return def !== undefined && def.grantsLiteracy !== false;
  });
  if (hasLiterateClass || spentLiteracySkillPoints) {
    grantedTags.add('trait:literate');
  }

  const seenFeatures = new Set<string>();
  const activeFeatureIds: string[] = [];
  const scalingPools: Record<string, number> = {};

  for (const track of tracks) {
    if (track.levels <= 0) continue;
    const classDef = classRegistry[track.trackId];
    if (!classDef) continue;
    const trackFeatures = collectClassFeaturesUpToLevel(classDef, track.levels, selectedAcfs);
    for (const featId of trackFeatures) {
      if (suppressedBundleIds.includes(featId)) continue;
      const detail = classDef.featureDetails[featId];
      if (detail?.activationCondition) {
        const checksLiteracy =
          detail.activationCondition.selfTagsNone?.some((t) => t.startsWith('trait:')) ||
          detail.activationCondition.selfTagsAll?.some((t) => t.startsWith('trait:'));
        if (checksLiteracy && !isActivationConditionMet(detail.activationCondition, Array.from(grantedTags))) {
          continue;
        }
      }

      if (seenFeatures.has(featId)) {
        const upgradeId = detail?.upgradeOnDuplicateFeatureId;
        if (upgradeId && !seenFeatures.has(upgradeId)) {
          seenFeatures.add(upgradeId);
          activeFeatureIds.push(upgradeId);
        }
      } else {
        seenFeatures.add(featId);
        activeFeatureIds.push(featId);
      }

      for (const tag of detail?.grantedTags ?? []) {
        grantedTags.add(tag);
      }

      const poolContrib = detail?.scalingPoolContribution;
      if (poolContrib && track.levels >= poolContrib.minClassLevel) {
        const contribution = Math.max(0, Math.floor(track.levels * poolContrib.multiplier + poolContrib.offset));
        scalingPools[poolContrib.poolId] = (scalingPools[poolContrib.poolId] ?? 0) + contribution;
      }
    }
  }

  return {
    activeFeatureIds,
    scalingPools,
    grantedTags: Array.from(grantedTags)
  };
}

/**
 * Reconstructs isolated per-class spellbooks (`spellbooksByClass`) across all spellcasting classes
 * owned by an actor, respecting Prestige Class `advancesSpellcasting` target selections and
 * Divine Prayerbook full-list access rules.
 */
export function buildActorSpellbooksByClass(
  tracks: ReadonlyArray<HitDieTrack>,
  levelHistory: ReadonlyArray<DnD35CharacterLevelRecord>,
  domains: ReadonlyArray<string>,
  prohibitedSchools: ReadonlyArray<DnD35SpellSchool>,
  sysContent: DnD35SystemContent
): Readonly<Record<string, DnD35ClassSpellbookState>> {
  const spellbooks: Record<string, DnD35ClassSpellbookState> = {};

  for (const track of tracks) {
    if (track.levels <= 0) continue;
    const classDef = sysContent.classes[track.trackId];
    if (!classDef || classDef.castingMode === 'none' || classDef.castingTradition === 'none') {
      continue;
    }
    const hasOwnSpellTable = classDef.progression.some((r) => r.spellsPerDay !== undefined);
    if (classDef.isPrestige && !hasOwnSpellTable) {
      continue;
    }

    const effectiveCasterLevel = computeEffectiveClassCastingLevel(tracks, classDef, sysContent.classes, levelHistory);
    const clampedLevel = Math.max(1, Math.min(classDef.maxLevel, effectiveCasterLevel));
    const row = getClassLevelRow(classDef, clampedLevel);
    const spellsPerDay: Record<string, number> = { ...(row?.spellsPerDay ?? {}) };
    const slotLevels = Object.keys(spellsPerDay)
      .map((k) => Number(k))
      .filter((n) => !Number.isNaN(n));
    const maxCastableSpellLevel = slotLevels.length > 0 ? Math.max(...slotLevels) : -1;

    const spellAcquisitionMode: 'spellbook_scribed' | 'spontaneous_known' | 'prayerbook_full_list' =
      classDef.spellAcquisitionMode && classDef.spellAcquisitionMode !== 'none'
        ? classDef.spellAcquisitionMode
        : classDef.castingTradition === 'divine' && classDef.castingMode === 'prepared'
          ? 'prayerbook_full_list'
          : classDef.castingMode === 'spontaneous'
            ? 'spontaneous_known'
            : 'spellbook_scribed';

    const knownSet = new Set<string>();
    if (spellAcquisitionMode === 'prayerbook_full_list') {
      if (maxCastableSpellLevel >= 0) {
        for (const spell of Object.values(sysContent.spells)) {
          const classLvl = spell.levelByClass[classDef.id];
          if (classLvl !== undefined && classLvl <= maxCastableSpellLevel) {
            knownSet.add(spell.id);
            continue;
          }
          if (classDef.id === 'cleric') {
            for (const domId of domains) {
              const domLvl = spell.levelByDomain[domId];
              if (domLvl !== undefined && domLvl <= maxCastableSpellLevel) {
                knownSet.add(spell.id);
              }
            }
          }
        }
      }
    } else {
      if (classDef.id === 'wizard' && maxCastableSpellLevel >= 0) {
        for (const spell of Object.values(sysContent.spells)) {
          if (spell.levelByClass['wizard'] === 0 && !prohibitedSchools.includes(spell.school as DnD35SpellSchool)) {
            knownSet.add(spell.id);
          }
        }
      }
      for (const rec of levelHistory) {
        const explicitClassSpells = rec.learnedSpellsByClass?.[classDef.id];
        if (explicitClassSpells) {
          for (const spId of explicitClassSpells) {
            knownSet.add(spId);
          }
          continue;
        }
        const advancesThisClass =
          rec.classId === classDef.id || (rec.advancedSpellcastingClassIds?.includes(classDef.id) ?? false);
        if (advancesThisClass) {
          for (const spId of rec.learnedSpells) {
            const spDef = sysContent.spells[spId];
            if (!spDef || spDef.levelByClass[classDef.id] !== undefined) {
              knownSet.add(spId);
            }
          }
        }
      }
    }

    spellbooks[classDef.id] = {
      classId: classDef.id,
      castingMode: classDef.castingMode,
      castingTradition: classDef.castingTradition,
      spellAcquisitionMode,
      governingAbility: classDef.castingKeyAbility ?? 'int',
      effectiveCasterLevel,
      maxCastableSpellLevel,
      knownSpellIds: Array.from(knownSet),
      preparedSpellIds: [],
      spellsPerDay,
      ...(row?.domainSpellSlots !== undefined ? { domainSpellSlots: row.domainSpellSlots } : {})
    };
  }

  return spellbooks;
}

/**
 * Builds Unified Effect Provider StatModifiers for temporary negative levels.
 */
export function buildNegativeLevelModifiers(negativeLevels: number): ReadonlyArray<StatModifier> {
  if (negativeLevels <= 0) return [];
  const penalty = -negativeLevels;
  const hpPenalty = -negativeLevels * HP_PENALTY_PER_NEGATIVE_LEVEL;
  return [
    {
      targetStat: 'attack',
      value: penalty,
      bonusType: 'untyped',
      sourceId: 'condition:negative_level',
      sourcePath: 'condition:negative_level/attack'
    },
    {
      targetStat: 'fort',
      value: penalty,
      bonusType: 'untyped',
      sourceId: 'condition:negative_level',
      sourcePath: 'condition:negative_level/save:fort'
    },
    {
      targetStat: 'ref',
      value: penalty,
      bonusType: 'untyped',
      sourceId: 'condition:negative_level',
      sourcePath: 'condition:negative_level/save:ref'
    },
    {
      targetStat: 'will',
      value: penalty,
      bonusType: 'untyped',
      sourceId: 'condition:negative_level',
      sourcePath: 'condition:negative_level/save:will'
    },
    {
      targetStat: 'max_hp',
      value: hpPenalty,
      bonusType: 'untyped',
      sourceId: 'condition:negative_level',
      sourcePath: 'condition:negative_level/vitality:hp'
    }
  ];
}
