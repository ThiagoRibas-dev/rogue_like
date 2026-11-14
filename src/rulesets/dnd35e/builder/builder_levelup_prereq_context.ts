import { computeAbilityModifier, computeEffectiveAbilityScore } from '../abilities.ts';
import type { PrerequisiteEvalContext } from '../prerequisites.ts';
import {
  aggregateProgressionChassis,
  buildHitDieTrackFromClass,
  collectClassFeaturesUpToLevel
} from '../progression.ts';
import { collectClassChoiceFeats } from '../progression/ledger_choices.ts';
import { projectDnD35ActorSemanticTags } from '../semantic_tags.ts';
import type { AbilityId, DnD35CharacterLevelRecord, DnD35EntityData, HitDieTrack } from '../types/dnd35e.types.ts';
import type { DnD35ClassDefinition, DnD35SystemContent } from '../types/dnd35e_system.types.ts';
import type { LevelUpChoice } from './builder_core.ts';
import {
  computeActorSpellcastingPrereqMetrics,
  computeMaxSlaCasterLevel,
  countActorNaturalAttacks,
  countMetamagicAndItemCreationFeats,
  DEFAULT_HAND_COUNT,
  MARILITH_HAND_COUNT
} from './builder_prereq_helpers.ts';
import { collectActorProficiencies } from './builder_prereq_proficiencies.ts';

/**
 * Builds a forward-projected `PrerequisiteEvalContext` representing the actor *after* applying the current level-up
 * choice (ability score increase, advanced class BAB/saves, added skill ranks, and feats granted or selected this level).
 *
 * @param dndData Current entity data before level-up.
 * @param choice The current level-up selection.
 * @param classDef Class definition of the advancing class.
 * @param sysContent Complete system content.
 * @param accumulatedFeatsThisLevel Feats chosen in earlier slots of the same level-up.
 * @returns Post-level-up `PrerequisiteEvalContext`.
 */
export function buildPostLevelUpPrerequisiteContext(
  dndData: DnD35EntityData,
  choice: LevelUpChoice,
  classDef: DnD35ClassDefinition,
  sysContent: DnD35SystemContent,
  accumulatedFeatsThisLevel: ReadonlyArray<string> = []
): PrerequisiteEvalContext {
  const abilityScores: Record<AbilityId, number | null> = {
    str: computeEffectiveAbilityScore(dndData.abilityScores.str),
    dex: computeEffectiveAbilityScore(dndData.abilityScores.dex),
    con: computeEffectiveAbilityScore(dndData.abilityScores.con),
    int: computeEffectiveAbilityScore(dndData.abilityScores.int),
    wis: computeEffectiveAbilityScore(dndData.abilityScores.wis),
    cha: computeEffectiveAbilityScore(dndData.abilityScores.cha)
  };
  if (choice.abilityScoreIncrease && abilityScores[choice.abilityScoreIncrease] !== null) {
    abilityScores[choice.abilityScoreIncrease] = (abilityScores[choice.abilityScoreIncrease] as number) + 1;
  }

  const existingTrack = dndData.tracks.find((t) => t.trackId === classDef.id);
  const nextClassLevel = (existingTrack ? existingTrack.levels : 0) + 1;

  const simulatedTracks: HitDieTrack[] = dndData.tracks.map((t) =>
    t.trackId === classDef.id ? buildHitDieTrackFromClass(classDef, nextClassLevel) : t
  );
  if (!existingTrack) {
    simulatedTracks.push(buildHitDieTrackFromClass(classDef, 1));
  }

  const conMod = computeAbilityModifier(abilityScores.con);
  const chassis = aggregateProgressionChassis(simulatedTracks, conMod, dndData.levelAdjustment ?? 0);

  const simulatedSkills: Record<string, number> = { ...dndData.skillRanks };
  for (const [skillId, ranks] of Object.entries(choice.addedSkillRanks)) {
    if (ranks > 0) {
      simulatedSkills[skillId] = (simulatedSkills[skillId] ?? 0) + ranks;
    }
  }

  const activeFeatures = collectClassFeaturesUpToLevel(classDef, nextClassLevel, [
    ...(dndData.selectedAcfs ?? []),
    ...(choice.selectedAcfs ?? [])
  ]);
  const combinedActiveFeatures = Array.from(new Set([...(dndData.activeClassFeatures ?? []), ...activeFeatures]));
  const combinedDomains = Array.from(new Set(dndData.domains ?? []));
  const simulatedDndForTags: DnD35EntityData = {
    ...dndData,
    tracks: simulatedTracks,
    activeClassFeatures: combinedActiveFeatures,
    domains: combinedDomains,
    skillRanks: simulatedSkills
  };
  const activeTags = projectDnD35ActorSemanticTags(
    simulatedDndForTags,
    [],
    undefined,
    sysContent.classes,
    sysContent.skills
  );

  const choiceFeats = collectClassChoiceFeats(
    combinedActiveFeatures,
    combinedDomains,
    choice.deityFavoredWeaponId ?? dndData.deityFavoredWeaponId,
    choice.combatStyle ?? dndData.combatStyle,
    choice.familiarId ?? dndData.familiarId,
    dndData.companions,
    dndData.scalingPools ?? {},
    [...(dndData.rogueSpecialAbilities ?? []), ...(choice.rogueSpecialAbility ? [choice.rogueSpecialAbility] : [])],
    sysContent,
    activeTags
  );

  const simulatedFeats: string[] = [...(dndData.feats ?? []), ...choiceFeats, ...accumulatedFeatsThisLevel];
  for (const featKey of activeFeatures) {
    const featDetail = classDef.featureDetails[featKey];
    if (featDetail?.grantedFeats) {
      simulatedFeats.push(...featDetail.grantedFeats);
    }
  }
  const deduplicatedFeats = Array.from(new Set(simulatedFeats));

  const classLevels: Record<string, number> = {};
  let characterLevel = 0;
  for (const track of simulatedTracks) {
    if (track.levels > 0) {
      characterLevel += track.levels;
      if (track.trackCategory !== 'racial_hd') {
        classLevels[track.trackId] = (classLevels[track.trackId] ?? 0) + track.levels;
      }
    }
  }
  characterLevel = Math.max(1, characterLevel);

  const profs = collectActorProficiencies(
    simulatedTracks,
    sysContent.classes,
    dndData.raceId,
    deduplicatedFeats,
    activeTags,
    combinedDomains,
    choice.deityFavoredWeaponId ?? dndData.deityFavoredWeaponId,
    sysContent
  );

  const simulatedHistory: DnD35CharacterLevelRecord[] = [
    ...(dndData.levelHistory ?? []),
    {
      characterLevel,
      classId: classDef.id,
      classLevel: nextClassLevel,
      hpRolled: 1,
      addedSkillRanks: choice.addedSkillRanks,
      selectedFeats: choice.selectedFeats,
      selectedAcfs: choice.selectedAcfs ?? [],
      learnedSpells: choice.learnedSpells ?? [],
      ...(choice.advancedSpellcastingClassIds !== undefined
        ? { advancedSpellcastingClassIds: choice.advancedSpellcastingClassIds }
        : {}),
      ...(choice.learnedSpellsByClass !== undefined ? { learnedSpellsByClass: choice.learnedSpellsByClass } : {})
    }
  ];

  const castingMetrics = computeActorSpellcastingPrereqMetrics(
    simulatedTracks,
    sysContent.classes,
    simulatedHistory,
    dndData.spellbooksByClass,
    combinedDomains,
    choice.learnedSpells ? { classId: classDef.id, spellIds: choice.learnedSpells } : undefined,
    sysContent
  );

  const handCount = dndData.anatomyBodyPlan === 'marilith_6arm' ? MARILITH_HAND_COUNT : DEFAULT_HAND_COUNT;

  return {
    abilityScores,
    totalBab: chassis.totalBab,
    skillRanks: simulatedSkills,
    feats: deduplicatedFeats,
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
    metamagicOrItemCreationFeatCount: countMetamagicAndItemCreationFeats(deduplicatedFeats, sysContent),
    spellCountBySchool: castingMetrics.spellCountBySchool,
    maxSpellLevelBySchool: castingMetrics.maxSpellLevelBySchool,
    ...(dndData.arcaneSchool !== undefined ? { arcaneSchool: dndData.arcaneSchool } : {})
  };
}
