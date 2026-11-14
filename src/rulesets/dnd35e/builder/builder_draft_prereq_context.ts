import { isActivationConditionMet, parseParameterizedFeatId } from '../effect_bundle.ts';
import type { PrerequisiteEvalContext } from '../prerequisites.ts';
import { buildHitDieTrackFromClass, collectClassFeaturesUpToLevel } from '../progression.ts';
import { collectClassChoiceFeats } from '../progression/ledger_choices.ts';
import { evaluateRacialModifiers } from '../races.ts';
import type { AbilityId, HitDieTrack } from '../types/dnd35e.types.ts';
import type { DnD35SystemContent } from '../types/dnd35e_system.types.ts';
import type { CharacterCreationDraft } from './builder_core.ts';
import {
  collectActorNaturalWeaponIds,
  computeActorSpellcastingPrereqMetrics,
  countMetamagicAndItemCreationFeats,
  DEFAULT_HAND_COUNT,
  MARILITH_HAND_COUNT
} from './builder_prereq_helpers.ts';
import { collectActorProficiencies } from './builder_prereq_proficiencies.ts';

/**
 * Builds a complete `PrerequisiteEvalContext` for a 1st-level `CharacterCreationDraft`
 * (including racial traits, class features, domains, weapon/armor proficiencies, and half-caster CL rules).
 *
 * @param draft Current `CharacterCreationDraft`.
 * @param sysContent Loaded D&D 3.5e system content.
 * @param accumulatedFeatsThisStep Feats already chosen in earlier slots during Step 5.
 * @returns Complete `PrerequisiteEvalContext`.
 */
export function buildCreationDraftPrerequisiteContext(
  draft: CharacterCreationDraft,
  sysContent: DnD35SystemContent,
  accumulatedFeatsThisStep: ReadonlyArray<string> = []
): PrerequisiteEvalContext {
  const raceDef = sysContent.races[draft.raceId];
  const classDef = sysContent.classes[draft.classId];

  const abilityScores: Record<AbilityId, number | null> = {
    str: draft.baseAbilityScores.str + (raceDef?.abilityAdjustments.str ?? 0),
    dex: draft.baseAbilityScores.dex + (raceDef?.abilityAdjustments.dex ?? 0),
    con: draft.baseAbilityScores.con + (raceDef?.abilityAdjustments.con ?? 0),
    int: draft.baseAbilityScores.int + (raceDef?.abilityAdjustments.int ?? 0),
    wis: draft.baseAbilityScores.wis + (raceDef?.abilityAdjustments.wis ?? 0),
    cha: draft.baseAbilityScores.cha + (raceDef?.abilityAdjustments.cha ?? 0)
  };

  if (!raceDef || !classDef) {
    return {
      abilityScores,
      totalBab: classDef?.progression[0]?.bab ?? 0,
      skillRanks: draft.skillRanks,
      feats: accumulatedFeatsThisStep,
      tags: [],
      casterLevel: 0,
      sizeCategory: raceDef?.size ?? 'medium',
      alignment: draft.alignment,
      raceId: draft.raceId
    };
  }

  const simulatedTracks: HitDieTrack[] = [buildHitDieTrackFromClass(classDef, 1)];
  const activeFeatures = collectClassFeaturesUpToLevel(classDef, 1, draft.selectedAcfs);

  const racialEval = evaluateRacialModifiers(raceDef);
  const tags = new Set<string>([
    `size:${raceDef.size}`,
    raceDef.creatureType,
    `type:${raceDef.creatureType}`,
    ...racialEval.grantedTags
  ]);
  for (const sub of raceDef.subtypes ?? []) {
    tags.add(sub);
    tags.add(`subtype:${sub}`);
  }
  if (classDef.grantsLiteracy !== false) {
    tags.add('trait:literate');
  }
  const tagSnapshot = Array.from(tags);
  for (const fId of activeFeatures) {
    tags.add(`feature:${fId}`);
    const detail = classDef.featureDetails[fId];
    if (!detail || !isActivationConditionMet(detail.activationCondition, tagSnapshot)) {
      continue;
    }
    for (const gTag of detail.grantedTags ?? []) {
      tags.add(gTag);
    }
  }
  for (const domId of draft.domains) {
    tags.add(`domain:${domId}`);
    const domDef = sysContent.domains[domId];
    for (const gTag of domDef?.grantedPowerBundle?.grantedTags ?? []) {
      tags.add(gTag);
    }
  }
  if ((raceDef.movementModes?.fly ?? 0) > 0) {
    tags.add('movement:fly');
  }
  const activeTags = Array.from(tags);

  const autoGrantedFeats: string[] = [...(raceDef.feats ?? [])];
  for (const bundle of raceDef.traitBundles ?? []) {
    autoGrantedFeats.push(...(bundle.grantedFeats ?? []));
  }
  for (const fId of activeFeatures) {
    const detail = classDef.featureDetails[fId];
    if (detail?.grantedFeats) {
      autoGrantedFeats.push(...detail.grantedFeats);
    }
  }
  for (const domId of draft.domains) {
    const domDef = sysContent.domains[domId];
    if (domDef?.featGrants) {
      autoGrantedFeats.push(...domDef.featGrants);
    }
    if (domDef?.grantedPowerBundle?.grantedFeats) {
      autoGrantedFeats.push(...domDef.grantedPowerBundle.grantedFeats);
    }
  }
  const choiceFeats = collectClassChoiceFeats(
    activeFeatures,
    draft.domains,
    draft.deityFavoredWeaponId,
    draft.combatStyle,
    draft.familiarId,
    [],
    {},
    [],
    sysContent,
    activeTags
  );
  const allFeats = Array.from(new Set([...autoGrantedFeats, ...choiceFeats, ...accumulatedFeatsThisStep]));
  const featTagSnapshot = Array.from(tags);
  for (const rawFeatId of allFeats) {
    const parsed = parseParameterizedFeatId(rawFeatId);
    const featDef = sysContent.feats[rawFeatId] ?? sysContent.feats[parsed.baseFeatId];
    const bundle = featDef?.effectBundle;
    if (!bundle || !isActivationConditionMet(bundle.activationCondition, featTagSnapshot)) {
      continue;
    }
    for (const gTag of bundle.grantedTags ?? []) {
      tags.add(gTag);
    }
  }
  const activeTagsWithFeats = Array.from(tags);

  const profs = collectActorProficiencies(
    simulatedTracks,
    sysContent.classes,
    raceDef.id,
    allFeats,
    activeTagsWithFeats,
    draft.domains,
    draft.deityFavoredWeaponId,
    sysContent
  );

  const castingMetrics = computeActorSpellcastingPrereqMetrics(
    simulatedTracks,
    sysContent.classes,
    undefined,
    undefined,
    draft.domains,
    { classId: classDef.id, spellIds: draft.knownSpells },
    sysContent
  );

  const characterLevel = Math.max(1, (raceDef.rhdProgression?.baseHdCount ?? 0) + 1);
  const handCount = raceDef.anatomyBodyPlan === 'marilith_6arm' ? MARILITH_HAND_COUNT : DEFAULT_HAND_COUNT;
  let naturalAttackCount = 0;
  for (const nw of raceDef.naturalWeapons ?? []) {
    naturalAttackCount += nw.count ?? 1;
  }

  return {
    abilityScores,
    totalBab: classDef.progression[0]?.bab ?? 0,
    skillRanks: draft.skillRanks,
    feats: allFeats,
    tags: activeTagsWithFeats,
    casterLevel: castingMetrics.casterLevel,
    sizeCategory: raceDef.size,
    alignment: draft.alignment,
    raceId: raceDef.id,
    maxArcaneSpellLevel: castingMetrics.maxArcaneSpellLevel,
    maxDivineSpellLevel: castingMetrics.maxDivineSpellLevel,
    maxPreparedArcaneSpellLevel: castingMetrics.maxPreparedArcaneSpellLevel,
    maxSpontaneousArcaneSpellLevel: castingMetrics.maxSpontaneousArcaneSpellLevel,
    maxPreparedDivineSpellLevel: castingMetrics.maxPreparedDivineSpellLevel,
    maxSpontaneousDivineSpellLevel: castingMetrics.maxSpontaneousDivineSpellLevel,
    classLevels: { [classDef.id]: 1 },
    characterLevel,
    proficientWeaponCategories: profs.proficientWeaponCategories,
    proficientWeaponIds: profs.proficientWeaponIds,
    proficientArmorCategories: profs.proficientArmorCategories,
    proficientShieldCategories: profs.proficientShieldCategories,
    naturalAttackCount,
    naturalWeaponIds: collectActorNaturalWeaponIds(raceDef.naturalWeapons),
    handCount,
    naturalArmorBonus: raceDef.naturalArmorBonus ?? 0,
    flySpeedFt: raceDef.movementModes?.fly ?? 0,
    maxSlaCasterLevel: 0,
    metamagicOrItemCreationFeatCount: countMetamagicAndItemCreationFeats(allFeats, sysContent),
    spellCountBySchool: castingMetrics.spellCountBySchool,
    maxSpellLevelBySchool: castingMetrics.maxSpellLevelBySchool,
    ...(draft.arcaneSchool !== undefined ? { arcaneSchool: draft.arcaneSchool } : {})
  };
}
