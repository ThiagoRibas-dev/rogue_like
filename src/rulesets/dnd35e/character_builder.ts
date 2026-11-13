import { computeAbilityModifier } from './abilities.ts';
import { parseParameterizedFeatId } from './effect_bundle.ts';
import { evaluatePrerequisiteAST, type PrerequisiteEvalContext } from './prerequisites.ts';
import {
  calculateLevelSkillPointBudget,
  calculateSkillAllocationCost,
  type CharacterCreationDraft,
  computeFirstLevelFeatSlotBudget,
  getEffectiveClassSkillIds,
  getSkillMaxRanks,
  isFeatAllowedInSlot
} from './builder/builder_core.ts';
import { buildCreationDraftPrerequisiteContext } from './builder/builder_prereq_context.ts';
import { computeClassSpellSelectionBudget, isSpellSelectableForDraft } from './builder/builder_spells.ts';
import { collectClassFeaturesUpToLevel } from './progression.ts';
import type { DnD35Alignment } from './types/dnd35e.types.ts';
import type { DnD35SystemContent } from './types/dnd35e_system.types.ts';

export * from './builder/builder_core.ts';
export * from './builder/builder_spells.ts';
export * from './builder/builder_validation.ts';
export * from './builder/builder_hydrator_creation.ts';
export * from './builder/builder_hydrator_levelup.ts';

/**
 * Sanitizes a `CharacterCreationDraft` whenever `raceId`, `classId`, `domains`, or `prohibitedSchools` changes.
 */
export function sanitizeDraftOnRaceOrClassChange(
  draft: CharacterCreationDraft,
  sysContent: DnD35SystemContent
): CharacterCreationDraft {
  const raceDef = sysContent.races[draft.raceId];
  const classDef = sysContent.classes[draft.classId];
  if (!raceDef || !classDef) return draft;

  const allowedAlignments = classDef.allowedAlignments;
  const alignment: DnD35Alignment =
    allowedAlignments && allowedAlignments.length > 0 && !allowedAlignments.includes(draft.alignment)
      ? allowedAlignments[0]!
      : draft.alignment;

  const baseFeatures1 = collectClassFeaturesUpToLevel(classDef, 1, []);
  const hasArcaneSchoolBase = baseFeatures1.includes('arcane_school_specialization');
  const arcaneSchool = hasArcaneSchoolBase ? (draft.arcaneSchool ?? 'universal') : undefined;

  const selectedAcfs = draft.selectedAcfs.filter((id) => {
    const acf = classDef.acfSwaps.find((a) => a.acfId === id && a.level === 1);
    if (!acf) return false;
    if (acf.requiredArcaneSchool && arcaneSchool !== acf.requiredArcaneSchool) {
      return false;
    }
    return true;
  });
  const activeFeatures = collectClassFeaturesUpToLevel(classDef, 1, selectedAcfs);

  const hasDomains = activeFeatures.includes('cleric_domains');
  const grantsFamiliar = activeFeatures.some(
    (fId) => classDef.featureDetails?.[fId]?.scalingPoolContribution?.poolId === 'familiar_master_effective_level'
  );
  const grantsAnimalCompanion = activeFeatures.some((fId) => {
    const contrib = classDef.featureDetails?.[fId]?.scalingPoolContribution;
    return contrib?.poolId === 'animal_companion_effective_level' && (contrib.minClassLevel ?? 1) <= 1;
  });
  const hasArcaneSchool = activeFeatures.includes('arcane_school_specialization');
  const hasFavoredEnemy = activeFeatures.some((fId) => fId.startsWith('favored_enemy_'));

  const domains = hasDomains ? draft.domains.slice(0, 2) : [];
  const deityFavoredWeaponId =
    hasDomains && domains.includes('war') ? (draft.deityFavoredWeaponId ?? 'longsword') : undefined;
  const familiarId = grantsFamiliar ? draft.familiarId : undefined;
  const animalCompanionId = grantsAnimalCompanion ? (draft.animalCompanionId ?? 'wolf') : undefined;
  const prohibitedSchools = hasArcaneSchool && arcaneSchool !== 'universal' ? draft.prohibitedSchools : [];
  const favoredEnemyType = hasFavoredEnemy ? (draft.favoredEnemyType ?? 'undead') : undefined;

  const classSkills = getEffectiveClassSkillIds(classDef, domains, sysContent);
  const intAdj = raceDef.abilityAdjustments.int ?? 0;
  const intMod = computeAbilityModifier(draft.baseAbilityScores.int + intAdj);
  const totalHd = Math.max(1, (raceDef.rhdProgression?.baseHdCount ?? 0) + 1);
  const budget = calculateLevelSkillPointBudget(
    classDef.skillPointsPerLevel,
    intMod,
    true,
    raceDef.extraSkillPointsFirstLevel,
    raceDef.extraSkillPointsPerLevel
  );

  const clampedRanks: Record<string, number> = {};
  for (const [skillId, ranks] of Object.entries(draft.skillRanks)) {
    if (ranks <= 0) continue;
    const isClass = classSkills.includes(skillId);
    const maxCap = getSkillMaxRanks(totalHd, isClass);
    const clamped = Math.min(ranks, maxCap);
    const finalized = isClass ? Math.floor(clamped) : Math.floor(clamped * 2) / 2;
    if (finalized > 0) {
      clampedRanks[skillId] = finalized;
    }
  }
  const newCost = calculateSkillAllocationCost(clampedRanks, classSkills);
  const skillRanks = newCost <= budget ? clampedRanks : {};

  const intermediateDraft: CharacterCreationDraft = {
    ...draft,
    alignment,
    selectedAcfs,
    domains,
    deityFavoredWeaponId,
    familiarId,
    animalCompanionId,
    arcaneSchool,
    prohibitedSchools,
    favoredEnemyType,
    skillRanks
  };

  const featBudget = computeFirstLevelFeatSlotBudget(raceDef, classDef, selectedAcfs);
  const selectedFeats: string[] = [];
  for (const featId of draft.selectedFeats) {
    if (selectedFeats.length >= featBudget.totalSlots) break;
    const slot = featBudget.slots[selectedFeats.length];
    const { baseFeatId, targetId } = parseParameterizedFeatId(featId);
    const featDef = sysContent.feats[baseFeatId];
    if (!featDef) continue;
    if (slot && !isFeatAllowedInSlot(featDef, slot)) continue;
    if (featDef.repeatable?.mode === 'targeted' && !targetId) continue;
    const baseCtx = buildCreationDraftPrerequisiteContext(intermediateDraft, sysContent, selectedFeats);
    if (featDef.repeatable?.mode !== 'stacking' && baseCtx.feats.includes(featId)) continue;
    const ctxWithTarget: PrerequisiteEvalContext = targetId ? { ...baseCtx, targetId } : baseCtx;
    if (
      slot?.ignorePrerequisites ||
      !featDef.prerequisites ||
      evaluatePrerequisiteAST(featDef.prerequisites, ctxWithTarget)
    ) {
      selectedFeats.push(featId);
    }
  }

  const spellBudget = computeClassSpellSelectionBudget(
    classDef,
    0,
    1,
    intMod,
    prohibitedSchools,
    domains,
    [],
    sysContent,
    alignment
  );

  const knownSpells =
    spellBudget.maxCastableLevel >= 0
      ? draft.knownSpells.filter((spellId) => {
          const spell = sysContent.spells[spellId];
          if (!spell) return false;
          return isSpellSelectableForDraft(
            spell,
            classDef.id,
            spellBudget.maxCastableLevel,
            prohibitedSchools,
            domains,
            alignment
          ).selectable;
        })
      : [];

  return {
    ...intermediateDraft,
    selectedFeats,
    knownSpells
  };
}
