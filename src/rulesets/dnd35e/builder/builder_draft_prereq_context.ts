import type { PrerequisiteEvalContext } from '../prerequisites.ts';
import { buildHitDieTrackFromClass, collectClassFeaturesUpToLevel } from '../progression.ts';
import { collectClassChoiceFeats } from '../progression/ledger_choices.ts';
import type { AbilityId, HitDieTrack } from '../types/dnd35e.types.ts';
import type { DnD35SystemContent } from '../types/dnd35e_system.types.ts';
import type { CharacterCreationDraft } from './builder_core.ts';
import {
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

  const tags = new Set<string>([`size:${raceDef.size}`, raceDef.creatureType, `type:${raceDef.creatureType}`]);
  for (const sub of raceDef.subtypes ?? []) {
    tags.add(sub);
    tags.add(`subtype:${sub}`);
  }
  for (const bundle of raceDef.traitBundles ?? []) {
    for (const gTag of bundle.grantedTags ?? []) {
      tags.add(gTag);
    }
  }
  for (const fId of activeFeatures) {
    tags.add(`feature:${fId}`);
    if (fId === 'turn_or_rebuke_undead' || fId === 'turn_undead_paladin' || fId === 'command_undead') {
      tags.add('feature:turn_or_rebuke');
    }
    if (fId === 'wild_shape_1' || fId.startsWith('wild_shape')) {
      tags.add('feature:wild_shape');
    }
    if (fId.startsWith('sneak_attack') || fId.startsWith('smite_') || fId === 'death_attack') {
      tags.add('trait:special_attack');
    }
    const detail = classDef.featureDetails[fId];
    for (const gTag of detail?.grantedTags ?? []) {
      tags.add(gTag);
    }
  }
  for (const domId of draft.domains) {
    const domDef = sysContent.domains[domId];
    for (const gTag of domDef?.grantedPowerBundle?.grantedTags ?? []) {
      tags.add(gTag);
    }
    if (
      domId === 'air' ||
      domId === 'earth' ||
      domId === 'fire' ||
      domId === 'water' ||
      domId === 'plant' ||
      domId === 'sun'
    ) {
      tags.add('feature:turn_or_rebuke');
    }
  }
  if ((raceDef.movementModes?.fly ?? 0) > 0) {
    tags.add('movement:fly');
  }
  if (raceDef.breathWeapon !== undefined) {
    tags.add('trait:special_attack');
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

  const profs = collectActorProficiencies(
    simulatedTracks,
    sysContent.classes,
    raceDef.id,
    allFeats,
    activeTags,
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
    tags: activeTags,
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
