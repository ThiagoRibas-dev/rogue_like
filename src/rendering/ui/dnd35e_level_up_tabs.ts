import {
  type ClassSpellSelectionBudget,
  computeClassSpellSelectionBudget,
  type LevelUpChoice
} from '../../rulesets/dnd35e/character_builder.ts';
import {
  computeEffectiveClassCastingLevel,
  getEligibleBaseCastingClassesForPrestige
} from '../../rulesets/dnd35e/progression.ts';
import type { DnD35EntityData } from '../../rulesets/dnd35e/types/dnd35e.types.ts';
import type { DnD35ClassDefinition, DnD35SystemContent } from '../../rulesets/dnd35e/types/dnd35e_system.types.ts';

/** Descriptor for a per-class spell learning tab during Level-Up. */
export interface SpellTabDescriptor {
  readonly tabId: `spells:${string}`;
  readonly classId: string;
  readonly className: string;
  readonly castingTradition: string;
  readonly budget: ClassSpellSelectionBudget;
}

/**
 * Computes the Prestige Class spellcasting advancement slots and per-class spell tabs for a level-up draft.
 */
export function computeLevelUpSpellTabs(
  dndData: DnD35EntityData,
  activeCls: DnD35ClassDefinition,
  nextClassLevel: number,
  intMod: number,
  draft: LevelUpChoice,
  sys: DnD35SystemContent
): {
  readonly prestigeSlots: ReturnType<typeof getEligibleBaseCastingClassesForPrestige>;
  readonly effectivePrestigeTargets: ReadonlyArray<string>;
  readonly spellTabs: ReadonlyArray<SpellTabDescriptor>;
} {
  const prestigeSlots = getEligibleBaseCastingClassesForPrestige(
    dndData.tracks,
    activeCls,
    nextClassLevel,
    sys.classes
  );

  let effectivePrestigeTargets = [...(draft.advancedSpellcastingClassIds ?? [])];
  if (prestigeSlots.length > 0 && effectivePrestigeTargets.length === 0) {
    effectivePrestigeTargets = prestigeSlots
      .map((slot) => slot.eligibleClassIds[0])
      .filter((id): id is string => id !== undefined);
  }

  const advancedCastingClassIds: string[] = [];
  if (activeCls.castingMode !== 'none' && !activeCls.isPrestige) {
    advancedCastingClassIds.push(activeCls.id);
  }
  for (const targetId of effectivePrestigeTargets) {
    if (targetId && !advancedCastingClassIds.includes(targetId)) {
      advancedCastingClassIds.push(targetId);
    }
  }

  const spellTabs: SpellTabDescriptor[] = [];

  for (const targetClassId of advancedCastingClassIds) {
    const targetCls = sys.classes[targetClassId];
    if (!targetCls) continue;
    const prevEffLvl = computeEffectiveClassCastingLevel(dndData.tracks, targetCls, sys.classes, dndData.levelHistory);
    const nextEffLvl = prevEffLvl + 1;
    const existingKnown =
      dndData.spellbooksByClass?.[targetClassId]?.knownSpellIds ??
      (targetClassId === dndData.tracks[0]?.trackId ? (dndData.knownSpells ?? []) : []);
    const spBudget = computeClassSpellSelectionBudget(
      targetCls,
      prevEffLvl,
      nextEffLvl,
      intMod,
      dndData.prohibitedSchools ?? [],
      dndData.domains ?? [],
      existingKnown,
      sys,
      dndData.alignment
    );
    if (spBudget.requiresManualSelection) {
      spellTabs.push({
        tabId: `spells:${targetClassId}`,
        classId: targetClassId,
        className: targetCls.name,
        castingTradition: targetCls.castingTradition,
        budget: spBudget
      });
    }
  }

  return { prestigeSlots, effectivePrestigeTargets, spellTabs };
}
