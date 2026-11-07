import { computeAbilityModifier } from './abilities.ts';
import { CLERIC_REQUIRED_DOMAIN_COUNT } from './companions.ts';
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
import { computeClassSpellSelectionBudget, isSpellSelectableForDraft } from './builder/builder_spells.ts';
import {
  applyNegativeLevelsToActor,
  applyPermanentLevelDrainToActor,
  buildActorSpellbooksByClass,
  buildClassAndDomainEffectModifiers,
  collectActiveClassFeaturesAndPools,
  collectActiveGrantedAndVirtualFeats,
  rebuildActorStateFromLevelHistory
} from './level_ledger.ts';
import { computeNpcClassCrContribution } from './progression.ts';
import type { DnD35Alignment } from './types/dnd35e.types.ts';
import type { DnD35SystemContent } from './types/dnd35e_system.types.ts';

export {
  applyNegativeLevelsToActor,
  applyPermanentLevelDrainToActor,
  buildActorSpellbooksByClass,
  buildClassAndDomainEffectModifiers,
  collectActiveClassFeaturesAndPools,
  collectActiveGrantedAndVirtualFeats,
  computeNpcClassCrContribution,
  rebuildActorStateFromLevelHistory
};

export * from './builder/builder_core.ts';
export * from './builder/builder_spells.ts';
export * from './builder/builder_validation.ts';
export * from './builder/builder_hydrator.ts';

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

  const domains = classDef.id === 'cleric' ? draft.domains.slice(0, CLERIC_REQUIRED_DOMAIN_COUNT) : [];
  const deityFavoredWeaponId =
    classDef.id === 'cleric' && domains.includes('war') ? (draft.deityFavoredWeaponId ?? 'longsword') : undefined;
  const familiarId = classDef.id === 'wizard' || classDef.id === 'sorcerer' ? draft.familiarId : undefined;
  const animalCompanionId = classDef.id === 'druid' ? (draft.animalCompanionId ?? 'wolf') : undefined;
  const arcaneSchool = classDef.id === 'wizard' ? (draft.arcaneSchool ?? 'universal') : undefined;
  const prohibitedSchools = classDef.id === 'wizard' && arcaneSchool !== 'universal' ? draft.prohibitedSchools : [];

  const validAcfs = new Set(classDef.acfSwaps.filter((a) => a.level === 1).map((a) => a.acfId));
  const selectedAcfs = draft.selectedAcfs.filter((id) => validAcfs.has(id));

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

  const featBudget = computeFirstLevelFeatSlotBudget(raceDef, classDef);
  const strAdj = raceDef.abilityAdjustments.str ?? 0;
  const dexAdj = raceDef.abilityAdjustments.dex ?? 0;
  const conAdj = raceDef.abilityAdjustments.con ?? 0;
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
    skillRanks,
    feats: [],
    tags: [`type:${raceDef.creatureType}`, `size:${raceDef.size}`],
    casterLevel: classDef.castingMode !== 'none' ? 1 : 0,
    sizeCategory: raceDef.size,
    alignment,
    raceId: raceDef.id
  };

  const selectedFeats: string[] = [];
  for (const featId of draft.selectedFeats) {
    if (selectedFeats.length >= featBudget.totalSlots) break;
    const slot = featBudget.slots[selectedFeats.length];
    const { baseFeatId, targetId } = parseParameterizedFeatId(featId);
    const featDef = sysContent.feats[baseFeatId];
    if (!featDef) continue;
    if (slot && !isFeatAllowedInSlot(featDef, slot)) continue;
    const ctxWithAccumulated: PrerequisiteEvalContext = {
      ...prereqCtx,
      feats: selectedFeats,
      ...(targetId ? { targetId } : {})
    };
    if (
      slot?.ignorePrerequisites ||
      !featDef.prerequisites ||
      evaluatePrerequisiteAST(featDef.prerequisites, ctxWithAccumulated)
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
    sysContent
  );

  const knownSpells =
    spellBudget.maxCastableLevel >= 0
      ? draft.knownSpells.filter((spellId) => {
          const spell = sysContent.spells[spellId];
          if (!spell) return false;
          return isSpellSelectableForDraft(spell, classDef.id, spellBudget.maxCastableLevel, prohibitedSchools, domains)
            .selectable;
        })
      : [];

  return {
    ...draft,
    alignment,
    selectedAcfs,
    domains,
    deityFavoredWeaponId,
    familiarId,
    animalCompanionId,
    arcaneSchool,
    prohibitedSchools,
    favoredEnemyType: classDef.id === 'ranger' ? (draft.favoredEnemyType ?? 'undead') : undefined,
    skillRanks,
    selectedFeats,
    knownSpells
  };
}
