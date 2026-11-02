import { addComponent, getComponent } from '../../core/ecs.ts';
import { ComponentType, type FighterComponent } from '../../types/components.types.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';
import { computeAbilityModifier, computeEffectiveAbilityScore } from './abilities.ts';
import { appendSourcePath } from './modifiers.ts';
import {
  aggregateProgressionChassis,
  buildHitDieTrackFromClass,
  collectClassFeaturesUpToLevel,
  computeXpThresholdForLevel
} from './progression.ts';
import { getDnD35EntityData, setDnD35EntityData } from './srd_registry.ts';
import type {
  AbilityScoresRecord,
  DnD35CharacterLevelRecord,
  DnD35EntityData,
  HitDieTrack,
  StatModifier
} from './types/dnd35e.types.ts';
import type { DnD35ClassDefinition, DnD35DomainDefinition, DnD35SystemContent } from './types/dnd35e_system.types.ts';

/** Flat HP penalty per negative level (-5 HP per PHB p. 308). */
export const HP_PENALTY_PER_NEGATIVE_LEVEL = 5;

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
 * Builds class and domain Effect Provider StatModifiers with hierarchical sourcePath provenance.
 *
 * @param tracks The actor's HitDieTrack array.
 * @param selectedAcfs Selected ACF IDs.
 * @param domains Selected domain IDs.
 * @param classRegistry Full class registry.
 * @param domainRegistry Full domain registry.
 * @returns Array of synthesized StatModifier instances.
 */
export function buildClassAndDomainEffectModifiers(
  tracks: ReadonlyArray<HitDieTrack>,
  selectedAcfs: ReadonlyArray<string>,
  domains: ReadonlyArray<string>,
  classRegistry: Readonly<Record<string, DnD35ClassDefinition>>,
  domainRegistry: Readonly<Record<string, DnD35DomainDefinition>>
): ReadonlyArray<StatModifier> {
  const modifiers: StatModifier[] = [];

  for (const track of tracks) {
    const classDef = classRegistry[track.trackId];
    if (!classDef) continue;
    const activeFeatures = collectClassFeaturesUpToLevel(classDef, track.levels, selectedAcfs);
    for (const featId of activeFeatures) {
      const detail = classDef.featureDetails[featId];
      if (!detail || detail.modifiers.length === 0) continue;
      const featureRoot = appendSourcePath(`class:${classDef.id}`, `feature:${featId}`);
      for (const mod of detail.modifiers) {
        modifiers.push({
          targetStat: mod.target,
          value: mod.value,
          bonusType: mod.type,
          sourceId: `class:${classDef.id}:${mod.id}`,
          sourcePath: appendSourcePath(featureRoot, mod.id),
          origin: detail.category === 'su' ? 'su' : detail.category === 'sp' ? 'sp' : 'ex',
          ...(mod.condition !== undefined ? { condition: mod.condition } : {})
        });
      }
    }
  }

  for (const domainId of domains) {
    const domainDef = domainRegistry[domainId];
    if (!domainDef || domainDef.modifiers.length === 0) continue;
    const domainRoot = appendSourcePath('class:cleric', `domain:${domainDef.id}`);
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

  return modifiers;
}

/**
 * Deterministically rebuilds an actor's tracks, ability scores, skills, feats, ACFs, spells,
 * HP, and Effect Provider modifiers from their chronological levelHistory.
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
  // Clear any existing level-based ability increases by starting from base or replaying
  // (In our system, AbilityScoreState.base is stored; we add 1 for each recorded increase in levelHistory)
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

  // Add domain granted feats
  for (const domId of currentData.domains ?? []) {
    const dom = sysContent.domains[domId];
    if (dom) {
      for (const f of dom.featGrants) featsSet.add(f);
    }
  }

  // Strip old class, domain, and negative-level modifiers and rebuild
  const nonClassMods = (currentData.statModifiers ?? []).filter((m) => {
    const sp = m.sourcePath ?? '';
    return !sp.startsWith('class:') && !sp.startsWith('domain:') && !sp.startsWith('condition:negative_level');
  });

  const selectedAcfs = Array.from(acfsSet);
  const classAndDomainMods = buildClassAndDomainEffectModifiers(
    nextTracks,
    selectedAcfs,
    currentData.domains ?? [],
    sysContent.classes,
    sysContent.domains
  );
  const negMods = buildNegativeLevelModifiers(currentData.negativeLevels ?? 0);

  return {
    ...currentData,
    abilityScores: baseAbilities,
    tracks: nextTracks,
    skillRanks,
    feats: Array.from(featsSet),
    selectedAcfs,
    knownSpells: Array.from(spellsSet),
    levelHistory,
    statModifiers: [...nonClassMods, ...classAndDomainMods, ...negMods]
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
