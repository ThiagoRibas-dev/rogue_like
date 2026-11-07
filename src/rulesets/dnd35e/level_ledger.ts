import type { EntityId, GameState } from '../../types/game-state.types.ts';
import { FAVORED_ENEMY_BONUS_STEP } from './companions.ts';
import { buildHitDieTrackFromClass } from './progression.ts';
import { buildClassChoiceModifiers, collectClassChoiceFeats } from './progression/ledger_choices.ts';
import {
  buildActorSpellbooksByClass,
  buildNegativeLevelModifiers,
  collectActiveClassFeaturesAndPools
} from './progression/ledger_features_spells.ts';
import {
  applyNegativeLevelsToActor,
  applyPermanentLevelDrainToActor as applyPermanentLevelDrain
} from './progression/ledger_level_drain.ts';
import {
  buildClassAndDomainEffectModifiers,
  buildCombatRuleOverridesFromActiveRules,
  buildFeatEffectModifiers,
  collectActiveFeatRuleOverrides,
  collectActiveGrantedAndVirtualFeats,
  type ResolvedActiveCombatRules
} from './progression/ledger_modifiers.ts';
import { buildSkillRankThresholdModifiers } from './skills.ts';
import { projectDnD35ActorSemanticTags } from './srd_registry.ts';
import type {
  AbilityScoresRecord,
  DnD35CharacterLevelRecord,
  DnD35EntityData,
  HitDieTrack
} from './types/dnd35e.types.ts';
import type { DnD35SystemContent } from './types/dnd35e_system.types.ts';

export * from './progression/ledger_features_spells.ts';
export * from './progression/ledger_modifiers.ts';

/**
 * Deterministically rebuilds an actor's tracks, ability scores, skills, feats, ACFs, spells,
 * per-class spellbooks, scaling pools, HP, and Effect Provider modifiers from their chronological levelHistory.
 *
 * @param currentData Current actor `DnD35EntityData`.
 * @param levelHistory Chronological level records.
 * @param sysContent Loaded D&D 3.5e system content.
 * @returns Rebuilt `DnD35EntityData`.
 */
export function rebuildActorStateFromLevelHistory(
  currentData: DnD35EntityData,
  levelHistory: ReadonlyArray<DnD35CharacterLevelRecord>,
  sysContent: DnD35SystemContent
): DnD35EntityData {
  const classCounts = new Map<string, number>();
  const classOrder: string[] = [];
  for (const rec of levelHistory) {
    const current = classCounts.get(rec.classId) ?? 0;
    classCounts.set(rec.classId, current + 1);
    if (!classOrder.includes(rec.classId)) {
      classOrder.push(rec.classId);
    }
  }

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

  const baseAbilities: AbilityScoresRecord = currentData.abilityScores;
  const skillRanks: Record<string, number> = {};
  const rebuiltFeats: string[] = [];
  const acfsSet = new Set<string>();
  const spellsSet = new Set<string>();

  for (const rec of levelHistory) {
    for (const [sId, delta] of Object.entries(rec.addedSkillRanks)) {
      skillRanks[sId] = (skillRanks[sId] ?? 0) + delta;
    }
    for (const f of rec.selectedFeats) {
      const baseId = f.includes(':') ? f.split(':')[0]! : f;
      const featDef = sysContent.feats?.[f] ?? sysContent.feats?.[baseId];
      const isStacking = featDef?.repeatable?.mode === 'stacking' || f === 'toughness' || f === 'extra_turning';
      if (isStacking || !rebuiltFeats.includes(f)) {
        rebuiltFeats.push(f);
      }
    }
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
    if (!rebuiltFeats.includes(f)) {
      rebuiltFeats.push(f);
    }
  }

  const deityFavoredWeaponId =
    levelHistory.find((r) => r.deityFavoredWeaponId)?.deityFavoredWeaponId ?? currentData.deityFavoredWeaponId;
  const combatStyle = levelHistory.find((r) => r.combatStyle)?.combatStyle ?? currentData.combatStyle;
  const familiarId = levelHistory.find((r) => r.familiarId)?.familiarId ?? currentData.familiarId;
  const animalCompanionId =
    levelHistory.find((r) => r.animalCompanionId)?.animalCompanionId ?? currentData.animalCompanionId;

  const feMap = new Map<string, number>();
  const hasHistoryFavoredEnemies = levelHistory.some(
    (r) => r.favoredEnemyAdded !== undefined || r.favoredEnemyBoosted !== undefined
  );
  if (!hasHistoryFavoredEnemies && currentData.favoredEnemies) {
    for (const fe of currentData.favoredEnemies) feMap.set(fe.creatureType, fe.bonus);
  }
  for (const rec of levelHistory) {
    if (rec.favoredEnemyAdded) {
      feMap.set(rec.favoredEnemyAdded, Math.max(FAVORED_ENEMY_BONUS_STEP, feMap.get(rec.favoredEnemyAdded) ?? 0));
    }
    if (rec.favoredEnemyBoosted) {
      feMap.set(
        rec.favoredEnemyBoosted,
        (feMap.get(rec.favoredEnemyBoosted) ?? FAVORED_ENEMY_BONUS_STEP) + FAVORED_ENEMY_BONUS_STEP
      );
    }
  }
  const favoredEnemies = Array.from(feMap.entries()).map(([creatureType, bonus]) => ({ creatureType, bonus }));

  const rogueSpecialAbilities = Array.from(
    new Set([
      ...(currentData.rogueSpecialAbilities ?? []),
      ...levelHistory.map((r) => r.rogueSpecialAbility).filter((a): a is string => Boolean(a))
    ])
  );

  const choiceFeats = collectClassChoiceFeats(
    nextTracks,
    currentData.domains ?? [],
    deityFavoredWeaponId,
    combatStyle,
    familiarId,
    rogueSpecialAbilities,
    sysContent,
    activeTags
  );
  for (const f of choiceFeats) {
    if (!rebuiltFeats.includes(f)) rebuiltFeats.push(f);
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

  const nonClassMods = (currentData.statModifiers ?? []).filter((m) => {
    const sp = m.sourcePath ?? '';
    return (
      !sp.startsWith('class:') &&
      !sp.startsWith('domain:') &&
      !sp.startsWith('familiar:') &&
      !sp.startsWith('condition:negative_level') &&
      !sp.startsWith('skill:') &&
      !sp.startsWith('feat:')
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
  const choiceMods = buildClassChoiceModifiers(favoredEnemies, familiarId, sysContent);
  const featMods = buildFeatEffectModifiers(rebuiltFeats, sysContent.feats, suppressedIds, activeTags);
  const skillThresholdMods = sysContent.skills ? buildSkillRankThresholdModifiers(skillRanks, sysContent.skills) : [];
  const negMods = buildNegativeLevelModifiers(currentData.negativeLevels ?? 0);

  return {
    ...currentData,
    abilityScores: baseAbilities,
    tracks: nextTracks,
    skillRanks,
    feats: rebuiltFeats,
    selectedAcfs,
    knownSpells: Array.from(spellsSet),
    spellbooksByClass,
    scalingPools: featurePoolSummary.scalingPools,
    activeClassFeatures: featurePoolSummary.activeFeatureIds,
    levelHistory,
    ...(deityFavoredWeaponId !== undefined ? { deityFavoredWeaponId } : {}),
    ...(combatStyle !== undefined ? { combatStyle } : {}),
    ...(familiarId !== undefined ? { familiarId } : {}),
    ...(animalCompanionId !== undefined ? { animalCompanionId } : {}),
    favoredEnemies,
    rogueSpecialAbilities,
    statModifiers: [
      ...nonClassMods,
      ...classAndDomainMods,
      ...choiceMods,
      ...featMods,
      ...skillThresholdMods,
      ...negMods
    ]
  };
}

/**
 * Applies permanent level drain to an actor, popping the last `levelsDrained` records
 * from their chronological levelHistory and rebuilding actor state on the fly.
 *
 * @param state Current GameState.
 * @param entityId Target actor EntityId.
 * @param levelsDrained Number of levels to permanently drain.
 * @returns Updated GameState and success indicator.
 */
export function applyPermanentLevelDrainToActor(
  state: GameState,
  entityId: EntityId,
  levelsDrained: number
): { readonly state: GameState; readonly success: boolean; readonly errorReason?: string } {
  return applyPermanentLevelDrain(state, entityId, levelsDrained, rebuildActorStateFromLevelHistory);
}

export {
  applyNegativeLevelsToActor,
  buildCombatRuleOverridesFromActiveRules,
  collectActiveFeatRuleOverrides,
  type ResolvedActiveCombatRules
};
