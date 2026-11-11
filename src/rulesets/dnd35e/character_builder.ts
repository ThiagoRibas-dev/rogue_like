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

  const validAcfs = new Set(classDef.acfSwaps.filter((a) => a.level === 1).map((a) => a.acfId));
  const selectedAcfs = draft.selectedAcfs.filter((id) => validAcfs.has(id));
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
  const arcaneSchool = hasArcaneSchool ? (draft.arcaneSchool ?? 'universal') : undefined;
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
    favoredEnemyType,
    skillRanks,
    selectedFeats,
    knownSpells
  };
}
