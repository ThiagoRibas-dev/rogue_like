import { computeAbilityModifier } from '../abilities.ts';
import { parseParameterizedFeatId } from '../effect_bundle.ts';
import { evaluatePrerequisiteAST, type PrerequisiteEvalContext } from '../prerequisites.ts';
import { collectClassFeaturesUpToLevel } from '../progression.ts';
import type { DnD35SystemContent } from '../types/dnd35e_system.types.ts';
import {
  calculateLevelSkillPointBudget,
  calculatePointBuyCost,
  calculateSkillAllocationCost,
  type CharacterCreationDraft,
  computeFirstLevelFeatSlotBudget,
  getEffectiveClassSkillIds,
  isFeatAllowedInSlot,
  STARTING_EQUIPMENT_PACKAGES,
  validateSpecialistSchoolSelection
} from './builder_core.ts';
import { validateLevelUpStep } from './builder_levelup_validation.ts';
import {
  buildCreationDraftPrerequisiteContext,
  buildPostLevelUpPrerequisiteContext,
  buildPrerequisiteContextForActor
} from './builder_prereq_context.ts';
import { computeClassSpellSelectionBudget, validateClassSpellSelection } from './builder_spells.ts';

export {
  buildCreationDraftPrerequisiteContext,
  buildPostLevelUpPrerequisiteContext,
  buildPrerequisiteContextForActor,
  validateLevelUpStep
};

/**
 * Validates a specific step of the Character Creation draft.
 *
 * @param draft Current `CharacterCreationDraft`.
 * @param stepId Step identifier (`'race' | 'class' | 'abilities' | 'skills' | 'feats' | 'spells' | 'equipment'`).
 * @param sysContent Loaded D&D 3.5e system content.
 * @returns Validation result `{ valid, reason? }`.
 */
export function validateCharacterCreationStep(
  draft: CharacterCreationDraft,
  stepId: 'race' | 'class' | 'abilities' | 'skills' | 'feats' | 'spells' | 'equipment',
  sysContent: DnD35SystemContent
): { readonly valid: boolean; readonly reason?: string } {
  const raceDef = sysContent.races[draft.raceId];
  const classDef = sysContent.classes[draft.classId];

  if (stepId === 'race') {
    if (!raceDef) return { valid: false, reason: 'Please select a valid race.' };
    return { valid: true };
  }

  if (stepId === 'class') {
    if (!classDef) return { valid: false, reason: 'Please select a valid class.' };
    if (classDef.allowedAlignments && classDef.allowedAlignments.length > 0) {
      if (!classDef.allowedAlignments.includes(draft.alignment)) {
        return {
          valid: false,
          reason: `${classDef.name} requires alignment in: ${classDef.allowedAlignments.join(', ')}.`
        };
      }
    }
    const prereqCtx = buildCreationDraftPrerequisiteContext(draft, sysContent);
    for (const acfId of draft.selectedAcfs) {
      const acf = classDef.acfSwaps.find((a) => a.acfId === acfId && a.level === 1);
      if (!acf) {
        return { valid: false, reason: `Invalid Alternate Class Feature "${acfId}" for ${classDef.name} level 1.` };
      }
      if (acf.requiredArcaneSchool && draft.arcaneSchool !== acf.requiredArcaneSchool) {
        return {
          valid: false,
          reason: `${acf.name} requires ${acf.requiredArcaneSchool} school specialization.`
        };
      }
      if (acf.prerequisites && !evaluatePrerequisiteAST(acf.prerequisites, prereqCtx)) {
        return {
          valid: false,
          reason: `Prerequisites not met for Alternate Class Feature: ${acf.name}.`
        };
      }
    }
    const activeFeatures = collectClassFeaturesUpToLevel(classDef, 1, draft.selectedAcfs);
    const hasDomainsFeature = activeFeatures.includes('cleric_domains') || activeFeatures.includes('deity_domains');
    if (hasDomainsFeature) {
      if (draft.domains.length !== 2) {
        return { valid: false, reason: 'Clerics must select exactly 2 deity domains.' };
      }
      for (const domainId of draft.domains) {
        const dom = sysContent.domains[domainId];
        if (dom?.allowedAlignments && !dom.allowedAlignments.includes(draft.alignment)) {
          return {
            valid: false,
            reason: `Domain ${dom.name} requires alignment in: ${dom.allowedAlignments.join(', ')}.`
          };
        }
      }
      if (draft.domains.includes('war') && !draft.deityFavoredWeaponId) {
        return { valid: false, reason: "Clerics with the War domain must select their deity's favored weapon." };
      }
    }
    if (activeFeatures.includes('arcane_school_specialization')) {
      const schoolCheck = validateSpecialistSchoolSelection(draft.arcaneSchool ?? 'universal', draft.prohibitedSchools);
      if (!schoolCheck.valid) return schoolCheck;
    }
    const grantsAnimalCompanion = activeFeatures.some(
      (fId) =>
        classDef.featureDetails[fId]?.scalingPoolContribution?.poolId === 'animal_companion_effective_level' &&
        (classDef.featureDetails[fId]?.scalingPoolContribution?.minClassLevel ?? 1) <= 1
    );
    if (grantsAnimalCompanion && !draft.animalCompanionId) {
      return { valid: false, reason: `${classDef.name} must select a 1st-level Animal Companion.` };
    }
    const grantsFavoredEnemy = activeFeatures.some((fId) => fId.startsWith('favored_enemy_'));
    if (grantsFavoredEnemy && !draft.favoredEnemyType) {
      return { valid: false, reason: `${classDef.name} must select a 1st-level Favored Enemy.` };
    }
    return { valid: true };
  }

  if (stepId === 'abilities') {
    if (draft.abilityMethod === 'point_buy') {
      const spent = calculatePointBuyCost(draft.baseAbilityScores);
      if (spent !== draft.pointBuyBudget) {
        return {
          valid: false,
          reason: `Spend all Point-Buy points before continuing (${spent}/${draft.pointBuyBudget} spent).`
        };
      }
    }
    return { valid: true };
  }

  if (stepId === 'skills') {
    if (!raceDef || !classDef) return { valid: false, reason: 'Select race and class first.' };
    const intMod = computeAbilityModifier(draft.baseAbilityScores.int + (raceDef.abilityAdjustments.int ?? 0));
    const budget = calculateLevelSkillPointBudget(
      classDef.skillPointsPerLevel,
      intMod,
      true,
      raceDef.extraSkillPointsFirstLevel,
      raceDef.extraSkillPointsPerLevel
    );
    const classSkills = getEffectiveClassSkillIds(classDef, draft.domains, sysContent);
    const spent = calculateSkillAllocationCost(draft.skillRanks, classSkills);
    if (spent > budget) return { valid: false, reason: `Skill points overspent (${spent}/${budget}).` };
    if (spent < budget)
      return { valid: false, reason: `Allocate all remaining skill points (${spent}/${budget} spent).` };
    return { valid: true };
  }

  if (stepId === 'feats') {
    if (!raceDef || !classDef) return { valid: false, reason: 'Select race and class first.' };
    const featBudget = computeFirstLevelFeatSlotBudget(raceDef, classDef, draft.selectedAcfs);
    if (draft.selectedFeats.length !== featBudget.totalSlots) {
      return {
        valid: false,
        reason: `Select ${featBudget.totalSlots} feat(s) before continuing (${draft.selectedFeats.length}/${featBudget.totalSlots} selected).`
      };
    }

    const accumulatedFeats: string[] = [];
    for (let i = 0; i < draft.selectedFeats.length; i++) {
      const featId = draft.selectedFeats[i]!;
      const slot = featBudget.slots[i];
      const { baseFeatId, targetId } = parseParameterizedFeatId(featId);
      const featDef = sysContent.feats[baseFeatId];
      if (!featDef) {
        return { valid: false, reason: `Unknown feat selected: ${featId}` };
      }
      if (slot && !isFeatAllowedInSlot(featDef, slot)) {
        return { valid: false, reason: `Feat ${featDef.name} is not permitted in ${slot.label}.` };
      }
      if (featDef.repeatable?.mode === 'targeted' && !targetId) {
        return { valid: false, reason: `Feat ${featDef.name} requires a specific target selection.` };
      }
      const baseCtx = buildCreationDraftPrerequisiteContext(draft, sysContent, accumulatedFeats);
      if (featDef.repeatable?.mode !== 'stacking' && baseCtx.feats.includes(featId)) {
        return { valid: false, reason: `Duplicate non-stacking feat selected: ${featDef.name}` };
      }
      if (!slot?.ignorePrerequisites && featDef.prerequisites) {
        const ctx: PrerequisiteEvalContext = targetId ? { ...baseCtx, targetId } : baseCtx;
        if (!evaluatePrerequisiteAST(featDef.prerequisites, ctx)) {
          return { valid: false, reason: `Prerequisites not met for feat: ${featDef.name}` };
        }
      }
      accumulatedFeats.push(featId);
    }
    return { valid: true };
  }

  if (stepId === 'spells') {
    if (!classDef || !raceDef) return { valid: true };
    const intMod = computeAbilityModifier(draft.baseAbilityScores.int + (raceDef.abilityAdjustments.int ?? 0));
    const spellBudget = computeClassSpellSelectionBudget(
      classDef,
      0,
      1,
      intMod,
      draft.prohibitedSchools,
      draft.domains,
      [],
      sysContent,
      draft.alignment
    );
    return validateClassSpellSelection(
      draft.knownSpells,
      spellBudget,
      draft.prohibitedSchools,
      draft.domains,
      sysContent,
      draft.alignment
    );
  }

  if (stepId === 'equipment') {
    const pkg = STARTING_EQUIPMENT_PACKAGES.find((p) => p.id === draft.equipmentPackageId);
    if (!pkg) return { valid: false, reason: 'Please select a starting equipment package.' };
    return { valid: true };
  }

  return { valid: true };
}
