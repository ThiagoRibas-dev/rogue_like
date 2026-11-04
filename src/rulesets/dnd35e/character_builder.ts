import { computeAbilityModifier } from './abilities.ts';
import {
  calculateLevelSkillPointBudget,
  calculateSkillAllocationCost,
  type CharacterCreationDraft,
  computeFirstLevelFeatSlotBudget,
  getEffectiveClassSkillIds,
  getSkillMaxRanks
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

  const domains = classDef.id === 'cleric' ? draft.domains.slice(0, 2) : [];
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
  const selectedFeats = draft.selectedFeats.slice(0, featBudget.totalSlots);

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
    arcaneSchool,
    prohibitedSchools,
    ...(classDef.id === 'ranger' ? { favoredEnemyType: draft.favoredEnemyType ?? 'undead' } : {}),
    skillRanks,
    selectedFeats,
    knownSpells
  };
}
