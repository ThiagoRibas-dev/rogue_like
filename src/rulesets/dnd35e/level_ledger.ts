import { addComponent, getComponent } from '../../core/ecs.ts';
import { ComponentType, type FighterComponent } from '../../types/components.types.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';
import { computeAbilityModifier, computeEffectiveAbilityScore } from './abilities.ts';
import { appendSourcePath } from './modifiers.ts';
import {
  aggregateProgressionChassis,
  buildHitDieTrackFromClass,
  collectClassFeaturesUpToLevel,
  computeEffectiveClassCastingLevel,
  computeXpThresholdForLevel,
  getClassLevelRow
} from './progression.ts';
import { buildSkillRankThresholdModifiers } from './skills.ts';
import {
  evaluateEffectBundle,
  getDnD35EntityData,
  isActivationConditionMet,
  projectDnD35ActorSemanticTags,
  setDnD35EntityData
} from './srd_registry.ts';
import type {
  AbilityScoresRecord,
  DnD35CharacterLevelRecord,
  DnD35ClassSpellbookState,
  DnD35EntityData,
  DnD35SpellSchool,
  HitDieTrack,
  StatModifier,
  StatModifierCondition
} from './types/dnd35e.types.ts';
import type { DnD35ClassDefinition, DnD35DomainDefinition, DnD35SystemContent } from './types/dnd35e_system.types.ts';

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
 *
 * @param tracks The actor's HitDieTrack array.
 * @param selectedAcfs Selected ACF swap IDs.
 * @param classRegistry Full class registry.
 * @param spentLiteracySkillPoints Optional flag if the actor spent 2 skill points to gain literacy.
 * @param suppressedBundleIds Optional list of suppressed feature IDs.
 * @returns `AggregatedClassFeaturesAndPools`.
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
        // Check permanent literacy/trait conditions at Horizon 2
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
 *
 * @param tracks The actor's HitDieTrack array.
 * @param levelHistory Chronological level records.
 * @param domains Selected Cleric domain IDs.
 * @param prohibitedSchools Prohibited arcane spell schools (for Specialist Wizards).
 * @param sysContent Loaded D&D 3.5e system content.
 * @returns Dictionary of `DnD35ClassSpellbookState` keyed by `classId`.
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
    // Pure spellcasting-advancement Prestige Classes (like Mystic Theurge or Archmage) advance a base class's spellbook rather than creating their own
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
 *
 * @param negativeLevels Number of active negative levels (>= 0).
 * @returns Array of StatModifier entries with sourcePath: "condition:negative_level".
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

/**
 * Collects all active granted and virtual feats from class features and domain granted power bundles,
 * respecting `suppressedBundleIds` and `activationCondition` tag checks (e.g. Ranger Combat Style in light/no armor).
 *
 * @param tracks The actor's HitDieTrack array.
 * @param selectedAcfs Selected ACF IDs.
 * @param domains Selected domain IDs.
 * @param classRegistry Full class registry.
 * @param domainRegistry Full domain registry.
 * @param suppressedBundleIds Optional list of suppressed bundle or feature IDs.
 * @param activeSelfTags Optional semantic self-tags projected by the actor.
 * @returns Deduplicated array of granted feat IDs.
 */
export function collectActiveGrantedAndVirtualFeats(
  tracks: ReadonlyArray<HitDieTrack>,
  selectedAcfs: ReadonlyArray<string>,
  domains: ReadonlyArray<string>,
  classRegistry: Readonly<Record<string, DnD35ClassDefinition>>,
  domainRegistry: Readonly<Record<string, DnD35DomainDefinition>>,
  suppressedBundleIds: ReadonlyArray<string> = [],
  activeSelfTags?: ReadonlyArray<string>
): ReadonlyArray<string> {
  const granted = new Set<string>();

  for (const track of tracks) {
    const classDef = classRegistry[track.trackId];
    if (!classDef) continue;
    const activeFeatures = collectClassFeaturesUpToLevel(classDef, track.levels, selectedAcfs);
    for (const featId of activeFeatures) {
      if (suppressedBundleIds.includes(featId)) continue;
      const detail = classDef.featureDetails[featId];
      if (!detail) continue;
      if (!isActivationConditionMet(detail.activationCondition, activeSelfTags)) continue;

      for (const gf of detail.grantedFeats ?? []) {
        granted.add(gf);
      }
      for (const vf of detail.virtualFeatGrants ?? []) {
        granted.add(vf.featId);
      }
    }
  }

  for (const domainId of domains) {
    const domainDef = domainRegistry[domainId];
    if (!domainDef) continue;
    if (domainDef.grantedPowerBundle) {
      if (suppressedBundleIds.includes(domainDef.grantedPowerBundle.bundleId)) continue;
      const evalRes = evaluateEffectBundle(
        domainDef.grantedPowerBundle,
        appendSourcePath('class:cleric', `domain:${domainDef.id}`),
        suppressedBundleIds,
        activeSelfTags
      );
      for (const gf of evalRes.grantedFeats) {
        granted.add(gf);
      }
      for (const f of domainDef.featGrants) {
        granted.add(f);
      }
    } else {
      for (const f of domainDef.featGrants) {
        granted.add(f);
      }
    }
  }

  return Array.from(granted);
}

/**
 * Builds class and domain Effect Provider StatModifiers with hierarchical sourcePath provenance.
 * Preserves `detail.activationCondition` merged onto emitted `StatModifier.condition` so Horizon 3
 * (`evaluateDnD35ActorStatDAG`) dynamically activates or suppresses modifiers when armor or load changes.
 *
 * @param tracks The actor's HitDieTrack array.
 * @param selectedAcfs Selected ACF IDs.
 * @param domains Selected domain IDs.
 * @param classRegistry Full class registry.
 * @param domainRegistry Full domain registry.
 * @param suppressedBundleIds Optional list of suppressed bundle or feature IDs.
 * @param activeSelfTags Optional semantic self-tags projected by the actor.
 * @returns Array of synthesized StatModifier instances.
 */
export function buildClassAndDomainEffectModifiers(
  tracks: ReadonlyArray<HitDieTrack>,
  selectedAcfs: ReadonlyArray<string>,
  domains: ReadonlyArray<string>,
  classRegistry: Readonly<Record<string, DnD35ClassDefinition>>,
  domainRegistry: Readonly<Record<string, DnD35DomainDefinition>>,
  suppressedBundleIds: ReadonlyArray<string> = [],
  activeSelfTags?: ReadonlyArray<string>
): ReadonlyArray<StatModifier> {
  const modifiers: StatModifier[] = [];

  for (const track of tracks) {
    const classDef = classRegistry[track.trackId];
    if (!classDef) continue;
    const activeFeatures = collectClassFeaturesUpToLevel(classDef, track.levels, selectedAcfs);
    for (const featId of activeFeatures) {
      if (suppressedBundleIds.includes(featId)) continue;
      const detail = classDef.featureDetails[featId];
      if (!detail) continue;

      const featureRoot = appendSourcePath(`class:${classDef.id}`, `feature:${featId}`);
      for (const mod of detail.modifiers) {
        const mergedCondition: StatModifierCondition | undefined =
          detail.activationCondition !== undefined || mod.condition !== undefined
            ? {
                ...(mod.condition ?? {}),
                ...(detail.activationCondition?.selfTagsAll !== undefined || mod.condition?.selfTagsAll !== undefined
                  ? {
                      selfTagsAll: Array.from(
                        new Set([
                          ...(detail.activationCondition?.selfTagsAll ?? []),
                          ...(mod.condition?.selfTagsAll ?? [])
                        ])
                      )
                    }
                  : {}),
                ...(detail.activationCondition?.selfTagsAny !== undefined || mod.condition?.selfTagsAny !== undefined
                  ? {
                      selfTagsAny: Array.from(
                        new Set([
                          ...(detail.activationCondition?.selfTagsAny ?? []),
                          ...(mod.condition?.selfTagsAny ?? [])
                        ])
                      )
                    }
                  : {}),
                ...(detail.activationCondition?.selfTagsNone !== undefined || mod.condition?.selfTagsNone !== undefined
                  ? {
                      selfTagsNone: Array.from(
                        new Set([
                          ...(detail.activationCondition?.selfTagsNone ?? []),
                          ...(mod.condition?.selfTagsNone ?? [])
                        ])
                      )
                    }
                  : {})
              }
            : undefined;
        modifiers.push({
          targetStat: mod.target,
          value: mod.value,
          bonusType: mod.type,
          sourceId: `class:${classDef.id}:${mod.id}`,
          sourcePath: appendSourcePath(featureRoot, mod.id),
          origin: detail.category === 'su' ? 'su' : detail.category === 'sp' ? 'sp' : 'ex',
          ...(mergedCondition !== undefined ? { condition: mergedCondition } : {})
        });
      }
    }
  }

  for (const domainId of domains) {
    const domainDef = domainRegistry[domainId];
    if (!domainDef) continue;
    const domainRoot = appendSourcePath('class:cleric', `domain:${domainDef.id}`);
    if (domainDef.grantedPowerBundle) {
      const evalRes = evaluateEffectBundle(
        domainDef.grantedPowerBundle,
        domainRoot,
        suppressedBundleIds,
        activeSelfTags
      );
      modifiers.push(...evalRes.statModifiers);
    } else {
      for (const mod of domainDef.modifiers) {
        modifiers.push({
          targetStat: mod.target,
          value: mod.value,
          bonusType: mod.type,
          sourceId: `domain:${domainDef.id}:${mod.id}`,
          sourcePath: appendSourcePath(domainRoot, mod.id),
          origin: 'su',
          ...(mod.condition !== undefined ? { condition: mod.condition } : {})
        });
      }
    }
  }

  return modifiers;
}

/**
 * Deterministically rebuilds an actor's tracks, ability scores, skills, feats, ACFs, spells,
 * per-class spellbooks, scaling pools, HP, and Effect Provider modifiers from their chronological levelHistory.
 *
 * @param currentData The actor's existing DnD35EntityData.
 * @param levelHistory The chronological array of level records.
 * @param sysContent The loaded D&D 3.5e system content.
 * @returns Reconstructed DnD35EntityData.
 */
export function rebuildActorStateFromLevelHistory(
  currentData: DnD35EntityData,
  levelHistory: ReadonlyArray<DnD35CharacterLevelRecord>,
  sysContent: DnD35SystemContent
): DnD35EntityData {
  // Count levels per class in exact order of appearance
  const classCounts = new Map<string, number>();
  const classOrder: string[] = [];
  for (const rec of levelHistory) {
    const current = classCounts.get(rec.classId) ?? 0;
    classCounts.set(rec.classId, current + 1);
    if (!classOrder.includes(rec.classId)) {
      classOrder.push(rec.classId);
    }
  }

  // Preserve any racial HD tracks (tracks that do not belong to classes)
  const racialTracks = currentData.tracks.filter((t) => sysContent.classes[t.trackId] === undefined);
  const classTracks: HitDieTrack[] = [];
  for (const classId of classOrder) {
    const classDef = sysContent.classes[classId];
    const levels = classCounts.get(classId) ?? 1;
    if (classDef) {
      classTracks.push(buildHitDieTrackFromClass(classDef, levels));
    }
  }
  const nextTracks: ReadonlyArray<HitDieTrack> = [...racialTracks, ...classTracks];

  // Replay ability score increases from history
  const baseAbilities: AbilityScoresRecord = currentData.abilityScores;
  const abilityIncreases: Record<string, number> = { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 };
  for (const rec of levelHistory) {
    if (rec.abilityScoreIncrease) {
      abilityIncreases[rec.abilityScoreIncrease] = (abilityIncreases[rec.abilityScoreIncrease] ?? 0) + 1;
    }
  }

  // Replay aggregated skills, feats, acfs, spells
  const skillRanks: Record<string, number> = {};
  const featsSet = new Set<string>();
  const acfsSet = new Set<string>();
  const spellsSet = new Set<string>();

  for (const rec of levelHistory) {
    for (const [sId, delta] of Object.entries(rec.addedSkillRanks)) {
      skillRanks[sId] = (skillRanks[sId] ?? 0) + delta;
    }
    for (const f of rec.selectedFeats) featsSet.add(f);
    for (const a of rec.selectedAcfs) acfsSet.add(a);
    for (const sp of rec.learnedSpells) spellsSet.add(sp);
  }

  const selectedAcfs = Array.from(acfsSet);
  const suppressedIds = currentData.suppressedBundleIds ?? [];

  const featurePoolSummary = collectActiveClassFeaturesAndPools(
    nextTracks,
    selectedAcfs,
    sysContent.classes,
    currentData.spentLiteracySkillPoints ?? false,
    suppressedIds
  );

  const preliminaryData: DnD35EntityData = {
    ...currentData,
    tracks: nextTracks,
    activeClassFeatures: featurePoolSummary.activeFeatureIds,
    scalingPools: featurePoolSummary.scalingPools
  };
  const activeTags = projectDnD35ActorSemanticTags(
    preliminaryData,
    featurePoolSummary.grantedTags,
    undefined,
    sysContent.classes
  );

  const bundleGrantedFeats = collectActiveGrantedAndVirtualFeats(
    nextTracks,
    selectedAcfs,
    currentData.domains ?? [],
    sysContent.classes,
    sysContent.domains,
    suppressedIds,
    activeTags
  );
  for (const f of bundleGrantedFeats) {
    featsSet.add(f);
  }

  const spellbooksByClass = buildActorSpellbooksByClass(
    nextTracks,
    levelHistory,
    currentData.domains ?? [],
    currentData.prohibitedSchools ?? [],
    sysContent
  );
  for (const sb of Object.values(spellbooksByClass)) {
    for (const spId of sb.knownSpellIds) {
      spellsSet.add(spId);
    }
  }

  // Strip old class, domain, skill threshold, and negative-level modifiers and rebuild
  const nonClassMods = (currentData.statModifiers ?? []).filter((m) => {
    const sp = m.sourcePath ?? '';
    return (
      !sp.startsWith('class:') &&
      !sp.startsWith('domain:') &&
      !sp.startsWith('condition:negative_level') &&
      !sp.startsWith('skill:')
    );
  });

  const classAndDomainMods = buildClassAndDomainEffectModifiers(
    nextTracks,
    selectedAcfs,
    currentData.domains ?? [],
    sysContent.classes,
    sysContent.domains,
    suppressedIds,
    activeTags
  );
  const skillThresholdMods = sysContent.skills ? buildSkillRankThresholdModifiers(skillRanks, sysContent.skills) : [];
  const negMods = buildNegativeLevelModifiers(currentData.negativeLevels ?? 0);

  return {
    ...currentData,
    abilityScores: baseAbilities,
    tracks: nextTracks,
    skillRanks,
    feats: Array.from(featsSet),
    selectedAcfs,
    knownSpells: Array.from(spellsSet),
    spellbooksByClass,
    scalingPools: featurePoolSummary.scalingPools,
    activeClassFeatures: featurePoolSummary.activeFeatureIds,
    levelHistory,
    statModifiers: [...nonClassMods, ...classAndDomainMods, ...skillThresholdMods, ...negMods]
  };
}

/**
 * Applies permanent level drain to an actor, popping the last `levelsDrained` records
 * from their chronological levelHistory and rebuilding actor state on the fly.
 *
 * @param state The current GameState.
 * @param entityId The target actor's EntityId.
 * @param levelsDrained Number of permanent levels to drain (>= 1).
 * @returns Resulting GameState.
 */
export function applyPermanentLevelDrainToActor(
  state: GameState,
  entityId: EntityId,
  levelsDrained: number
): { readonly state: GameState; readonly success: boolean; readonly errorReason?: string } {
  const sysContent = state.campaign.systemContent as DnD35SystemContent | undefined;
  if (!sysContent || !sysContent.classes) {
    return { state, success: false, errorReason: 'D&D 3.5e system content not loaded.' };
  }
  const dndData = getDnD35EntityData(state, entityId);
  const history = dndData.levelHistory ?? [];
  if (history.length === 0) {
    return { state, success: false, errorReason: 'Actor has no levelHistory to drain.' };
  }

  const drainCount = Math.max(1, Math.floor(levelsDrained));
  const remainingCount = Math.max(0, history.length - drainCount);
  const updatedHistory = history.slice(0, remainingCount);

  const updatedData = rebuildActorStateFromLevelHistory(dndData, updatedHistory, sysContent);
  const nextState = setDnD35EntityData(state, entityId, updatedData);

  const fighter = getComponent(nextState, entityId, ComponentType.Fighter) as FighterComponent | undefined;
  if (!fighter) {
    return { state: nextState, success: true };
  }

  const conMod = computeAbilityModifier(computeEffectiveAbilityScore(updatedData.abilityScores.con));
  const chassis = aggregateProgressionChassis(updatedData.tracks, conMod, updatedData.levelAdjustment ?? 0);

  const newXpFloor = computeXpThresholdForLevel(chassis.ecl);
  return {
    state: addComponent(nextState, entityId, {
      ...fighter,
      level: chassis.ecl,
      maxHp: chassis.maxHp,
      hp: Math.min(fighter.hp, chassis.maxHp),
      attack: chassis.totalBab,
      xp: Math.min(fighter.xp, newXpFloor)
    }),
    success: true
  };
}

/**
 * Applies temporary negative levels to an actor.
 *
 * @param state The current GameState.
 * @param entityId The target actor's EntityId.
 * @param negativeLevels Total negative level count to set (>= 0).
 * @returns Resulting GameState.
 */
export function applyNegativeLevelsToActor(state: GameState, entityId: EntityId, negativeLevels: number): GameState {
  const sysContent = state.campaign.systemContent as DnD35SystemContent | undefined;
  if (!sysContent) return state;
  const dndData = getDnD35EntityData(state, entityId);
  const count = Math.max(0, Math.floor(negativeLevels));

  const nonNegMods = (dndData.statModifiers ?? []).filter(
    (m) => !(m.sourcePath ?? '').startsWith('condition:negative_level')
  );
  const negMods = buildNegativeLevelModifiers(count);

  const updatedData: DnD35EntityData = {
    ...dndData,
    negativeLevels: count,
    statModifiers: [...nonNegMods, ...negMods]
  };

  const nextState = setDnD35EntityData(state, entityId, updatedData);
  const fighter = getComponent(nextState, entityId, ComponentType.Fighter) as FighterComponent | undefined;
  if (!fighter) return nextState;

  const conMod = computeAbilityModifier(computeEffectiveAbilityScore(updatedData.abilityScores.con));
  const chassis = aggregateProgressionChassis(updatedData.tracks, conMod, updatedData.levelAdjustment ?? 0);
  const effectiveMaxHp = Math.max(1, chassis.maxHp - count * HP_PENALTY_PER_NEGATIVE_LEVEL);

  return addComponent(nextState, entityId, {
    ...fighter,
    maxHp: effectiveMaxHp,
    hp: Math.min(fighter.hp, effectiveMaxHp),
    attack: Math.max(0, chassis.totalBab - count)
  });
}
