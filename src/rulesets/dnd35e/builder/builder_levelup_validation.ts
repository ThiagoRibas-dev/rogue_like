import { computeAbilityModifier, computeEffectiveAbilityScore } from '../abilities.ts';
import { parseParameterizedFeatId } from '../effect_bundle.ts';
import { evaluatePrerequisiteAST, type PrerequisiteEvalContext } from '../prerequisites.ts';
import {
  aggregateProgressionChassis,
  collectClassFeaturesUpToLevel,
  computeEffectiveClassCastingLevel,
  getEligibleBaseCastingClassesForPrestige
} from '../progression.ts';
import type { DnD35EntityData } from '../types/dnd35e.types.ts';
import type { DnD35SystemContent } from '../types/dnd35e_system.types.ts';
import {
  calculateLevelSkillPointBudget,
  calculateSkillAllocationCost,
  computeLevelUpFeatSlots,
  getEffectiveClassSkillIds,
  isFeatAllowedInSlot,
  type LevelUpChoice
} from './builder_core.ts';
import { buildPostLevelUpPrerequisiteContext, buildPrerequisiteContextForActor } from './builder_prereq_context.ts';
import { computeClassSpellSelectionBudget, validateClassSpellSelection } from './builder_spells.ts';

/** Hit Dice interval for +1 Ability Score Increases (`4`). */
const ABILITY_SCORE_INCREASE_HD_STEP = 4;

/** Skill point cost required for an illiterate character (e.g. Barbarian) to gain Literacy (`2`). */
const LITERACY_SKILL_POINT_COST = 2;

/**
 * Validates a specific step of the Level-Up modal.
 *
 * @param dndData Current actor `DnD35EntityData`.
 * @param choice Current `LevelUpChoice` draft.
 * @param stepKey Step tab identifier (`'class' | 'skills' | 'feats' | 'spells:<classId>'`).
 * @param sysContent Loaded D&D 3.5e system content.
 * @returns Validation result `{ valid, reason? }`.
 */
export function validateLevelUpStep(
  dndData: DnD35EntityData,
  choice: LevelUpChoice,
  stepKey: string,
  sysContent: DnD35SystemContent
): { readonly valid: boolean; readonly reason?: string } {
  const classDef = sysContent.classes[choice.classId];
  if (!classDef) {
    return { valid: false, reason: 'Please select a valid class to advance.' };
  }

  const conMod = computeAbilityModifier(computeEffectiveAbilityScore(dndData.abilityScores.con));
  const prevChassis = aggregateProgressionChassis(dndData.tracks, conMod, dndData.levelAdjustment ?? 0);
  const newTotalHd = prevChassis.totalHD + 1;
  const existingTrack = dndData.tracks.find((t) => t.trackId === classDef.id);
  const nextClassLevel = (existingTrack ? existingTrack.levels : 0) + 1;

  if (stepKey === 'class') {
    if (nextClassLevel > classDef.maxLevel) {
      return { valid: false, reason: `Already at maximum level (${classDef.maxLevel}) for ${classDef.name}.` };
    }
    if (classDef.allowedAlignments && classDef.allowedAlignments.length > 0) {
      if (dndData.alignment !== undefined && !classDef.allowedAlignments.includes(dndData.alignment)) {
        return {
          valid: false,
          reason: `${classDef.name} requires alignment in: ${classDef.allowedAlignments.join(', ')}.`
        };
      }
    }
    const prereqCtx = buildPrerequisiteContextForActor(dndData, sysContent.classes, sysContent);
    if (classDef.prerequisites) {
      if (!evaluatePrerequisiteAST(classDef.prerequisites, prereqCtx)) {
        return { valid: false, reason: `Prerequisites not met for ${classDef.name}.` };
      }
    }
    for (const acfId of choice.selectedAcfs ?? []) {
      const acf = classDef.acfSwaps.find((a) => a.acfId === acfId && a.level === nextClassLevel);
      if (!acf) {
        return {
          valid: false,
          reason: `Invalid Alternate Class Feature "${acfId}" for ${classDef.name} level ${nextClassLevel}.`
        };
      }
      if (acf.requiredArcaneSchool && dndData.arcaneSchool !== acf.requiredArcaneSchool) {
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
    if (newTotalHd % ABILITY_SCORE_INCREASE_HD_STEP === 0 && !choice.abilityScoreIncrease) {
      return { valid: false, reason: `Select a +1 Ability Score Increase for reaching HD ${newTotalHd}.` };
    }
    const prevFeatures = collectClassFeaturesUpToLevel(
      classDef,
      existingTrack ? existingTrack.levels : 0,
      dndData.selectedAcfs ?? []
    );
    const currFeatures = collectClassFeaturesUpToLevel(classDef, nextClassLevel, [
      ...(dndData.selectedAcfs ?? []),
      ...(choice.selectedAcfs ?? [])
    ]);
    const newFeatures = currFeatures.filter((f) => !prevFeatures.includes(f));

    if (newFeatures.includes('combat_style') && !choice.combatStyle) {
      return {
        valid: false,
        reason: `${classDef.name} at level ${nextClassLevel} must choose a Combat Style (Archery or Two-Weapon).`
      };
    }

    if (newFeatures.some((f) => f.startsWith('favored_enemy_'))) {
      if (!choice.favoredEnemyAdded) {
        return { valid: false, reason: `${classDef.name} at level ${nextClassLevel} must select a new Favored Enemy.` };
      }
      if (prevFeatures.some((f) => f.startsWith('favored_enemy_')) && !choice.favoredEnemyBoosted) {
        return {
          valid: false,
          reason: `${classDef.name} at level ${nextClassLevel} must increase bonus against an existing Favored Enemy.`
        };
      }
    }

    const prevCompPool = prevFeatures.reduce((max, fId) => {
      const contrib = classDef.featureDetails[fId]?.scalingPoolContribution;
      if (contrib?.poolId === 'animal_companion_effective_level') {
        const eff = existingTrack ? existingTrack.levels : 0;
        return eff >= (contrib.minClassLevel ?? 1) ? Math.max(max, eff * contrib.multiplier + contrib.offset) : max;
      }
      return max;
    }, 0);
    const nextCompPool = currFeatures.reduce((max, fId) => {
      const contrib = classDef.featureDetails[fId]?.scalingPoolContribution;
      if (contrib?.poolId === 'animal_companion_effective_level') {
        return nextClassLevel >= (contrib.minClassLevel ?? 1)
          ? Math.max(max, nextClassLevel * contrib.multiplier + contrib.offset)
          : max;
      }
      return max;
    }, 0);

    const hasAnimalCompanion =
      dndData.animalCompanionId !== undefined ||
      (dndData.companions ?? []).some((c) => c.tags.includes('animal_companion'));

    if (prevCompPool === 0 && nextCompPool > 0 && !hasAnimalCompanion && !choice.animalCompanionId) {
      return { valid: false, reason: `${classDef.name} at level ${nextClassLevel} must select an Animal Companion.` };
    }

    const rogueSpecialFeatId = newFeatures.find((f) => f.startsWith('rogue_special_ability_'));
    if (rogueSpecialFeatId && !choice.rogueSpecialAbility) {
      return { valid: false, reason: `${classDef.name} at level ${nextClassLevel} must choose a Special Ability.` };
    }
    const prcSlots = getEligibleBaseCastingClassesForPrestige(
      dndData.tracks,
      classDef,
      nextClassLevel,
      sysContent.classes
    );
    const nonEmptySlots = prcSlots.filter((s) => s.eligibleClassIds.length > 0);
    if (nonEmptySlots.length > 0) {
      const chosen = choice.advancedSpellcastingClassIds ?? [];
      if (chosen.length < nonEmptySlots.length || chosen.some((c) => !c)) {
        return {
          valid: false,
          reason: `Select which base spellcasting class(es) ${classDef.name} advances.`
        };
      }
    }
    return { valid: true };
  }

  if (stepKey === 'skills') {
    const raceDef = dndData.raceId ? sysContent.races[dndData.raceId] : undefined;
    let effInt = computeEffectiveAbilityScore(dndData.abilityScores.int);
    if (choice.abilityScoreIncrease === 'int' && effInt !== null) effInt += 1;
    const intMod = computeAbilityModifier(effInt);
    const budget = calculateLevelSkillPointBudget(
      classDef.skillPointsPerLevel,
      intMod,
      false,
      0,
      raceDef?.extraSkillPointsPerLevel ?? 0
    );
    const activeLevelClassSkills = getEffectiveClassSkillIds(classDef, dndData.domains ?? [], sysContent);
    const literacyCost = choice.spendSkillPointsForLiteracy === true ? LITERACY_SKILL_POINT_COST : 0;
    const spent = calculateSkillAllocationCost(choice.addedSkillRanks, activeLevelClassSkills) + literacyCost;
    if (spent > budget) return { valid: false, reason: `Skill points overspent (${spent}/${budget}).` };
    if (spent < budget)
      return { valid: false, reason: `Allocate all remaining skill points (${spent}/${budget} spent).` };
    return { valid: true };
  }

  if (stepKey === 'feats') {
    const activeAcfs = [...(dndData.selectedAcfs ?? []), ...(choice.selectedAcfs ?? [])];
    const slots = computeLevelUpFeatSlots(classDef, nextClassLevel, newTotalHd, activeAcfs);
    if (choice.selectedFeats.length !== slots.length) {
      return {
        valid: false,
        reason: `Select ${slots.length} feat(s) before continuing (${choice.selectedFeats.length}/${slots.length} selected).`
      };
    }
    const accumulatedFeats: string[] = [];
    for (let i = 0; i < choice.selectedFeats.length; i++) {
      const featId = choice.selectedFeats[i]!;
      const slot = slots[i];
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
      const ctx = buildPostLevelUpPrerequisiteContext(dndData, choice, classDef, sysContent, accumulatedFeats);
      if (featDef.repeatable?.mode !== 'stacking' && ctx.feats.includes(featId)) {
        return { valid: false, reason: `Duplicate non-stacking feat selected: ${featDef.name}` };
      }
      if (!slot?.ignorePrerequisites && featDef.prerequisites) {
        const evalCtx: PrerequisiteEvalContext = targetId ? { ...ctx, targetId } : ctx;
        if (!evaluatePrerequisiteAST(featDef.prerequisites, evalCtx)) {
          return { valid: false, reason: `Prerequisites not met for feat: ${featDef.name}` };
        }
      }
      accumulatedFeats.push(featId);
    }
    return { valid: true };
  }

  if (stepKey.startsWith('spells:')) {
    const targetClassId = stepKey.slice('spells:'.length);
    const targetClassDef = sysContent.classes[targetClassId];
    if (!targetClassDef) return { valid: true };

    const prevCasterLvl = computeEffectiveClassCastingLevel(
      dndData.tracks,
      targetClassDef,
      sysContent.classes,
      dndData.levelHistory
    );
    const nextCasterLvl = prevCasterLvl + 1;
    let effInt = computeEffectiveAbilityScore(dndData.abilityScores.int);
    if (choice.abilityScoreIncrease === 'int' && effInt !== null) effInt += 1;
    const intMod = computeAbilityModifier(effInt);
    const existingKnown = dndData.spellbooksByClass?.[targetClassId]?.knownSpellIds ?? dndData.knownSpells ?? [];
    const budget = computeClassSpellSelectionBudget(
      targetClassDef,
      prevCasterLvl,
      nextCasterLvl,
      intMod,
      dndData.prohibitedSchools ?? [],
      dndData.domains ?? [],
      existingKnown,
      sysContent,
      dndData.alignment
    );
    const selectedForClass =
      choice.learnedSpellsByClass?.[targetClassId] ??
      (choice.classId === targetClassId ? (choice.learnedSpells ?? []) : []);
    return validateClassSpellSelection(
      selectedForClass,
      budget,
      dndData.prohibitedSchools ?? [],
      dndData.domains ?? [],
      sysContent,
      dndData.alignment
    );
  }

  return { valid: true };
}
