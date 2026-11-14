import { computeAbilityModifier, computeEffectiveAbilityScore } from '../abilities.ts';
import type { PrerequisiteEvalContext } from '../prerequisites.ts';
import { aggregateProgressionChassis } from '../progression.ts';
import { projectDnD35ActorSemanticTags } from '../semantic_tags.ts';
import type { AbilityId, DnD35EntityData } from '../types/dnd35e.types.ts';
import type { DnD35ClassDefinition, DnD35SystemContent } from '../types/dnd35e_system.types.ts';
import {
  computeActorSpellcastingPrereqMetrics,
  computeMaxSlaCasterLevel,
  countActorNaturalAttacks,
  countMetamagicAndItemCreationFeats,
  DEFAULT_HAND_COUNT,
  MARILITH_HAND_COUNT
} from './builder_prereq_helpers.ts';
import { collectActorProficiencies } from './builder_prereq_proficiencies.ts';

export { buildCreationDraftPrerequisiteContext } from './builder_draft_prereq_context.ts';
export { buildPostLevelUpPrerequisiteContext } from './builder_levelup_prereq_context.ts';

/**
 * Builds a `PrerequisiteEvalContext` snapshot for an actor (`DnD35EntityData`) so feats, ACFs,
 * Templates, and Prestige Classes can be validated via `evaluatePrerequisiteAST()`.
 *
 * @param dndData The actor's `DnD35EntityData`.
 * @param classRegistry Loaded D&D 3.5e class definitions.
 * @param sysContent Optional full D&D 3.5e system content.
 * @returns `PrerequisiteEvalContext`.
 */
export function buildPrerequisiteContextForActor(
  dndData: DnD35EntityData,
  classRegistry: Readonly<Record<string, DnD35ClassDefinition>>,
  sysContent?: Readonly<DnD35SystemContent>
): PrerequisiteEvalContext {
  const conMod = computeAbilityModifier(computeEffectiveAbilityScore(dndData.abilityScores.con));
  const chassis = aggregateProgressionChassis(dndData.tracks, conMod, dndData.levelAdjustment ?? 0);
  const abilityScores: Record<AbilityId, number | null> = {
    str: computeEffectiveAbilityScore(dndData.abilityScores.str),
    dex: computeEffectiveAbilityScore(dndData.abilityScores.dex),
    con: computeEffectiveAbilityScore(dndData.abilityScores.con),
    int: computeEffectiveAbilityScore(dndData.abilityScores.int),
    wis: computeEffectiveAbilityScore(dndData.abilityScores.wis),
    cha: computeEffectiveAbilityScore(dndData.abilityScores.cha)
  };

  const baseTags = projectDnD35ActorSemanticTags(dndData, [], undefined, classRegistry, sysContent?.skills);
  const raceDefForTags = dndData.raceId ? sysContent?.races[dndData.raceId] : undefined;
  const activeTags =
    raceDefForTags?.breathWeapon !== undefined && !baseTags.includes('trait:special_attack')
      ? [...baseTags, 'trait:special_attack']
      : baseTags;

  const classLevels: Record<string, number> = {};
  let characterLevel = 0;
  for (const track of dndData.tracks) {
    if (track.levels > 0) {
      characterLevel += track.levels;
      if (track.trackCategory !== 'racial_hd') {
        classLevels[track.trackId] = (classLevels[track.trackId] ?? 0) + track.levels;
      }
    }
  }
  characterLevel = Math.max(1, characterLevel);

  const profs = collectActorProficiencies(
    dndData.tracks,
    classRegistry,
    dndData.raceId,
    dndData.feats,
    activeTags,
    dndData.domains ?? [],
    dndData.deityFavoredWeaponId,
    sysContent
  );

  const castingMetrics = computeActorSpellcastingPrereqMetrics(
    dndData.tracks,
    classRegistry,
    dndData.levelHistory,
    dndData.spellbooksByClass,
    dndData.domains ?? [],
    undefined,
    sysContent
  );

  const handCount = dndData.anatomyBodyPlan === 'marilith_6arm' ? MARILITH_HAND_COUNT : DEFAULT_HAND_COUNT;

  return {
    abilityScores,
    totalBab: chassis.totalBab,
    skillRanks: dndData.skillRanks,
    feats: dndData.feats,
    tags: activeTags,
    casterLevel: castingMetrics.casterLevel,
    sizeCategory: dndData.sizeCategory,
    ...(dndData.alignment !== undefined ? { alignment: dndData.alignment } : {}),
    ...(dndData.raceId !== undefined ? { raceId: dndData.raceId } : {}),
    maxArcaneSpellLevel: castingMetrics.maxArcaneSpellLevel,
    maxDivineSpellLevel: castingMetrics.maxDivineSpellLevel,
    maxPreparedArcaneSpellLevel: castingMetrics.maxPreparedArcaneSpellLevel,
    maxSpontaneousArcaneSpellLevel: castingMetrics.maxSpontaneousArcaneSpellLevel,
    maxPreparedDivineSpellLevel: castingMetrics.maxPreparedDivineSpellLevel,
    maxSpontaneousDivineSpellLevel: castingMetrics.maxSpontaneousDivineSpellLevel,
    classLevels,
    characterLevel,
    proficientWeaponCategories: profs.proficientWeaponCategories,
    proficientWeaponIds: profs.proficientWeaponIds,
    proficientArmorCategories: profs.proficientArmorCategories,
    proficientShieldCategories: profs.proficientShieldCategories,
    naturalAttackCount: countActorNaturalAttacks(dndData),
    handCount,
    naturalArmorBonus: dndData.naturalArmorBonus,
    flySpeedFt: dndData.movementModes?.fly ?? 0,
    maxSlaCasterLevel: computeMaxSlaCasterLevel(dndData, characterLevel, sysContent),
    metamagicOrItemCreationFeatCount: countMetamagicAndItemCreationFeats(dndData.feats, sysContent),
    spellCountBySchool: castingMetrics.spellCountBySchool,
    maxSpellLevelBySchool: castingMetrics.maxSpellLevelBySchool,
    ...(dndData.arcaneSchool !== undefined ? { arcaneSchool: dndData.arcaneSchool } : {})
  };
}
