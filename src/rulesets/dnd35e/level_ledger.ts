import { addComponent, getComponent } from '../../core/ecs.ts';
import { ComponentType, type FighterComponent } from '../../types/components.types.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';
import { computeAbilityModifier, computeEffectiveAbilityScore } from './abilities.ts';
import { aggregateProgressionChassis, buildHitDieTrackFromClass, computeXpThresholdForLevel } from './progression.ts';
import {
  buildActorSpellbooksByClass,
  buildNegativeLevelModifiers,
  collectActiveClassFeaturesAndPools,
  HP_PENALTY_PER_NEGATIVE_LEVEL
} from './progression/ledger_features_spells.ts';
import {
  buildClassAndDomainEffectModifiers,
  buildCombatRuleOverridesFromActiveRules,
  buildFeatEffectModifiers,
  collectActiveFeatRuleOverrides,
  collectActiveGrantedAndVirtualFeats,
  type ResolvedActiveCombatRules
} from './progression/ledger_modifiers.ts';
import { buildSkillRankThresholdModifiers } from './skills.ts';
import { getDnD35EntityData, projectDnD35ActorSemanticTags, setDnD35EntityData } from './srd_registry.ts';
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
  const abilityIncreases: Record<string, number> = { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 };
  for (const rec of levelHistory) {
    if (rec.abilityScoreIncrease) {
      abilityIncreases[rec.abilityScoreIncrease] = (abilityIncreases[rec.abilityScoreIncrease] ?? 0) + 1;
    }
  }

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
    statModifiers: [...nonClassMods, ...classAndDomainMods, ...featMods, ...skillThresholdMods, ...negMods]
  };
}

/**
 * Applies permanent level drain to an actor, popping the last `levelsDrained` records
 * from their chronological levelHistory and rebuilding actor state on the fly.
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

export { buildCombatRuleOverridesFromActiveRules, collectActiveFeatRuleOverrides, type ResolvedActiveCombatRules };
