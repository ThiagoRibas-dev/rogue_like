import { computeAbilityModifier, computeEffectiveAbilityScore } from '../abilities.ts';
import { evaluatePrerequisiteAST, type PrerequisiteEvalContext } from '../prerequisites.ts';
import {
  aggregateProgressionChassis,
  computeEffectiveClassCastingLevel,
  getEligibleBaseCastingClassesForPrestige
} from '../progression.ts';
import { projectDnD35ActorSemanticTags } from '../semantic_tags.ts';
import type { AbilityId, DnD35EntityData } from '../types/dnd35e.types.ts';
import type { DnD35ClassDefinition, DnD35SystemContent } from '../types/dnd35e_system.types.ts';
import {
  calculateLevelSkillPointBudget,
  calculatePointBuyCost,
  calculateSkillAllocationCost,
  type CharacterCreationDraft,
  computeFirstLevelFeatSlotBudget,
  getEffectiveClassSkillIds,
  type LevelUpChoice,
  STARTING_EQUIPMENT_PACKAGES,
  validateSpecialistSchoolSelection
} from './builder_core.ts';
import { computeClassSpellSelectionBudget, validateClassSpellSelection } from './builder_spells.ts';

/**
 * Builds a `PrerequisiteEvalContext` snapshot for an actor (`DnD35EntityData`) so feats and
 * Prestige Classes can be validated via `evaluatePrerequisiteAST()`.
 *
 * @param dndData The actor's `DnD35EntityData`.
 * @param classRegistry Loaded D&D 3.5e class definitions.
 * @returns `PrerequisiteEvalContext`.
 */
export function buildPrerequisiteContextForActor(
  dndData: DnD35EntityData,
  classRegistry: Readonly<Record<string, DnD35ClassDefinition>>
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

  let maxArcaneSpellLevel = 0;
  let maxDivineSpellLevel = 0;
  let totalCasterLevel = 0;

  for (const track of dndData.tracks) {
    const classDef = classRegistry[track.trackId];
    if (!classDef || classDef.castingMode === 'none') continue;
    totalCasterLevel += track.levels;
    const row = classDef.progression.find((r) => r.level === track.levels);
    if (!row || !row.spellsPerDay) continue;
    let highestSlot = 0;
    for (const [lvlKey, slots] of Object.entries(row.spellsPerDay)) {
      const spellLvl = Number(lvlKey);
      if (!Number.isNaN(spellLvl) && slots >= 0 && spellLvl > highestSlot) {
        highestSlot = spellLvl;
      }
    }
    if (classDef.castingTradition === 'arcane' && highestSlot > maxArcaneSpellLevel) {
      maxArcaneSpellLevel = highestSlot;
    } else if (classDef.castingTradition === 'divine' && highestSlot > maxDivineSpellLevel) {
      maxDivineSpellLevel = highestSlot;
    }
  }

  return {
    abilityScores,
    totalBab: chassis.totalBab,
    skillRanks: dndData.skillRanks,
    feats: dndData.feats,
    tags: projectDnD35ActorSemanticTags(dndData),
    casterLevel: totalCasterLevel,
    sizeCategory: dndData.sizeCategory,
    ...(dndData.alignment !== undefined ? { alignment: dndData.alignment } : {}),
    ...(dndData.raceId !== undefined ? { raceId: dndData.raceId } : {}),
    maxArcaneSpellLevel,
    maxDivineSpellLevel
  };
}

/**
 * Validates a specific step of the Character Creation draft (`race`, `class`, `abilities`, `skills`, `feats`, `spells`, `equipment`).
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
    if (classDef.id === 'cleric' && draft.domains.length !== 2) {
      return { valid: false, reason: 'Clerics must select exactly 2 deity domains.' };
    }
    if (classDef.id === 'wizard') {
      const schoolCheck = validateSpecialistSchoolSelection(draft.arcaneSchool ?? 'universal', draft.prohibitedSchools);
      if (!schoolCheck.valid) return schoolCheck;
    }
    if (classDef.id === 'ranger' && !draft.favoredEnemyType) {
      return { valid: false, reason: 'Rangers must select a 1st-level Favored Enemy.' };
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
    const strAdj = raceDef.abilityAdjustments.str ?? 0;
    const dexAdj = raceDef.abilityAdjustments.dex ?? 0;
    const conAdj = raceDef.abilityAdjustments.con ?? 0;
    const intAdj = raceDef.abilityAdjustments.int ?? 0;
    const wisAdj = raceDef.abilityAdjustments.wis ?? 0;
    const chaAdj = raceDef.abilityAdjustments.cha ?? 0;
    const firstLevelBab = classDef.progression[0]?.bab ?? 0;

    const prereqCtx: PrerequisiteEvalContext = {
      abilityScores: {
        str: draft.baseAbilityScores.str + strAdj,
        dex: draft.baseAbilityScores.dex + dexAdj,
        con: draft.baseAbilityScores.con + conAdj,
        int: draft.baseAbilityScores.int + intAdj,
        wis: draft.baseAbilityScores.wis + wisAdj,
        cha: draft.baseAbilityScores.cha + chaAdj
      },
      totalBab: firstLevelBab,
      skillRanks: draft.skillRanks,
      feats: [],
      tags: [`type:${raceDef.creatureType}`, `size:${raceDef.size}`],
      casterLevel: classDef.castingMode !== 'none' ? 1 : 0,
      sizeCategory: raceDef.size,
      alignment: draft.alignment,
      raceId: draft.raceId
    };

    const accumulatedFeats: string[] = [];
    for (const featId of draft.selectedFeats) {
      const featDef = sysContent.feats[featId];
      if (!featDef) {
        return { valid: false, reason: `Unknown feat selected: ${featId}` };
      }
      const ctxWithAccumulated: PrerequisiteEvalContext = {
        ...prereqCtx,
        feats: accumulatedFeats
      };
      if (featDef.prerequisites && !evaluatePrerequisiteAST(featDef.prerequisites, ctxWithAccumulated)) {
        return { valid: false, reason: `Prerequisites not met for feat: ${featDef.name}` };
      }
      accumulatedFeats.push(featId);
    }

    const featBudget = computeFirstLevelFeatSlotBudget(raceDef, classDef);
    if (draft.selectedFeats.length !== featBudget.totalSlots) {
      return {
        valid: false,
        reason: `Select ${featBudget.totalSlots} feat(s) before continuing (${draft.selectedFeats.length}/${featBudget.totalSlots} selected).`
      };
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
      sysContent
    );
    return validateClassSpellSelection(
      draft.knownSpells,
      spellBudget,
      draft.prohibitedSchools,
      draft.domains,
      sysContent
    );
  }

  if (stepId === 'equipment') {
    const pkg = STARTING_EQUIPMENT_PACKAGES.find((p) => p.id === draft.equipmentPackageId);
    if (!pkg) return { valid: false, reason: 'Please select a starting equipment package.' };
    return { valid: true };
  }

  return { valid: true };
}

/**
 * Validates a specific step of the Level-Up modal (`class`, `skills`, `feats`, or `spells:<classId>`).
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
    if (classDef.prerequisites) {
      const prereqCtx = buildPrerequisiteContextForActor(dndData, sysContent.classes);
      if (!evaluatePrerequisiteAST(classDef.prerequisites, prereqCtx)) {
        return { valid: false, reason: `Prerequisites not met for ${classDef.name}.` };
      }
    }
    if (newTotalHd % 4 === 0 && !choice.abilityScoreIncrease) {
      return { valid: false, reason: `Select a +1 Ability Score Increase for reaching HD ${newTotalHd}.` };
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
    const literacyCost = choice.spendSkillPointsForLiteracy === true ? 2 : 0;
    const spent = calculateSkillAllocationCost(choice.addedSkillRanks, activeLevelClassSkills) + literacyCost;
    if (spent > budget) return { valid: false, reason: `Skill points overspent (${spent}/${budget}).` };
    if (spent < budget)
      return { valid: false, reason: `Allocate all remaining skill points (${spent}/${budget} spent).` };
    return { valid: true };
  }

  if (stepKey === 'feats') {
    const gainsGeneralFeat = newTotalHd % 3 === 0;
    const row = classDef.progression.find((r) => r.level === nextClassLevel);
    const gainsBonusFeat = row?.bonusFeatSlot === true;
    const totalFeatSlots = (gainsGeneralFeat ? 1 : 0) + (gainsBonusFeat ? 1 : 0);
    if (choice.selectedFeats.length !== totalFeatSlots) {
      return {
        valid: false,
        reason: `Select ${totalFeatSlots} feat(s) before continuing (${choice.selectedFeats.length}/${totalFeatSlots} selected).`
      };
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
      sysContent
    );
    const selectedForClass =
      choice.learnedSpellsByClass?.[targetClassId] ??
      (choice.classId === targetClassId ? (choice.learnedSpells ?? []) : []);
    return validateClassSpellSelection(
      selectedForClass,
      budget,
      dndData.prohibitedSchools ?? [],
      dndData.domains ?? [],
      sysContent
    );
  }

  return { valid: true };
}
