import type { DnD35SpellSchool } from '../types/dnd35e.types.ts';
import type { DnD35ClassDefinition, DnD35SpellDefinition, DnD35SystemContent } from '../types/dnd35e_system.types.ts';

/**
 * Returns the spell level of a spell for a given class (or Cleric domain), or `null` if the spell is not on that class's spell list.
 *
 * @param spell Spell definition.
 * @param classId Class identifier (`'wizard'`, `'cleric'`, etc.).
 * @param domainIds Active Cleric domain IDs.
 * @returns Effective spell level (`0..9`) or `null`.
 */
export function getSpellLevelForClass(
  spell: DnD35SpellDefinition,
  classId: string,
  domainIds: ReadonlyArray<string> = []
): number | null {
  const classLevel = spell.levelByClass[classId];
  if (classLevel !== undefined) {
    return classLevel;
  }
  if (classId === 'cleric') {
    for (const domId of domainIds) {
      const domLvl = spell.levelByDomain[domId];
      if (domLvl !== undefined) {
        return domLvl;
      }
    }
  }
  return null;
}

/**
 * Checks whether a spell is legal for a character creation draft or level-up given their class,
 * maximum castable spell level, Cleric domains, and Wizard prohibited schools.
 *
 * @param spell Spell definition.
 * @param classId Class identifier.
 * @param maxCastableLevel Highest spell level the class can cast at this level (`0` or `1` at level 1).
 * @param prohibitedSchools Wizard prohibited schools.
 * @param domainIds Selected Cleric domains.
 * @returns `{ selectable: boolean; effectiveLevel: number | null; reason?: string }`.
 */
export function isSpellSelectableForDraft(
  spell: DnD35SpellDefinition,
  classId: string,
  maxCastableLevel: number,
  prohibitedSchools: ReadonlyArray<DnD35SpellSchool> = [],
  domainIds: ReadonlyArray<string> = []
): { readonly selectable: boolean; readonly effectiveLevel: number | null; readonly reason?: string } {
  const effectiveLevel = getSpellLevelForClass(spell, classId, domainIds);
  if (effectiveLevel === null) {
    return { selectable: false, effectiveLevel: null, reason: 'Not on class spell list' };
  }
  if (effectiveLevel > maxCastableLevel) {
    return {
      selectable: false,
      effectiveLevel,
      reason: `Requires spell level ${effectiveLevel} slots`
    };
  }
  if (prohibitedSchools.includes(spell.school as DnD35SpellSchool)) {
    return {
      selectable: false,
      effectiveLevel,
      reason: `Prohibited school (${spell.school})`
    };
  }
  return { selectable: true, effectiveLevel };
}

/**
 * Resolves the canonical spell acquisition mode for a class (`'none' | 'spellbook_scribed' | 'spontaneous_known' | 'prayerbook_full_list'`).
 *
 * @param classDef Class definition.
 * @returns Resolved spell acquisition mode.
 */
export function resolveClassSpellAcquisitionMode(
  classDef: DnD35ClassDefinition | undefined
): 'none' | 'spellbook_scribed' | 'spontaneous_known' | 'prayerbook_full_list' {
  if (!classDef || classDef.castingMode === 'none' || classDef.castingTradition === 'none') {
    return 'none';
  }
  if (classDef.spellAcquisitionMode) {
    return classDef.spellAcquisitionMode;
  }
  if (classDef.castingTradition === 'divine' && classDef.castingMode === 'prepared') {
    return 'prayerbook_full_list';
  }
  if (classDef.castingMode === 'spontaneous') {
    return 'spontaneous_known';
  }
  return 'spellbook_scribed';
}

/** Per-class spell selection budget for a Character Creation or Level-Up step. */
export interface ClassSpellSelectionBudget {
  readonly classId: string;
  readonly className: string;
  readonly spellAcquisitionMode: 'none' | 'spellbook_scribed' | 'spontaneous_known' | 'prayerbook_full_list';
  readonly requiresManualSelection: boolean;
  readonly prevEffectiveCasterLevel: number;
  readonly nextEffectiveCasterLevel: number;
  readonly maxCastableLevel: number;
  readonly autoGrantedCantripIds: ReadonlyArray<string>;
  /** Free-pick spell count across any castable spell level 1..maxCastableLevel (e.g. Wizard +2 spells at Lv 2+). */
  readonly freePickCount: number;
  /** Exact new spells to pick per spell level (e.g. Sorcerer/Bard/Assassin spellsKnown delta, or Wizard 3+INT Lv1 spells). */
  readonly requiredBySpellLevel: Readonly<Record<number, number>>;
}

/**
 * Computes the exact spell selection budget for a class advancing from `prevEffectiveCasterLevel`
 * to `nextEffectiveCasterLevel`.
 */
export function computeClassSpellSelectionBudget(
  classDef: DnD35ClassDefinition | undefined,
  prevEffectiveCasterLevel: number,
  nextEffectiveCasterLevel: number,
  intModifier: number,
  prohibitedSchools: ReadonlyArray<DnD35SpellSchool>,
  domainIds: ReadonlyArray<string>,
  alreadyKnownSpellIds: ReadonlyArray<string>,
  sysContent: DnD35SystemContent
): ClassSpellSelectionBudget {
  const mode = resolveClassSpellAcquisitionMode(classDef);
  if (
    !classDef ||
    mode === 'none' ||
    nextEffectiveCasterLevel <= prevEffectiveCasterLevel ||
    nextEffectiveCasterLevel <= 0
  ) {
    return {
      classId: classDef?.id ?? '',
      className: classDef?.name ?? '',
      spellAcquisitionMode: mode,
      requiresManualSelection: false,
      prevEffectiveCasterLevel,
      nextEffectiveCasterLevel,
      maxCastableLevel: -1,
      autoGrantedCantripIds: [],
      freePickCount: 0,
      requiredBySpellLevel: {}
    };
  }

  const clampedNow = Math.min(classDef.maxLevel, nextEffectiveCasterLevel);
  const rowNow = classDef.progression.find((r) => r.level === clampedNow);
  let maxCastableLevel = -1;
  if (rowNow?.spellsPerDay) {
    for (const [lvlKey, slots] of Object.entries(rowNow.spellsPerDay)) {
      const lvl = Number(lvlKey);
      if (!Number.isNaN(lvl) && slots >= 0 && lvl > maxCastableLevel) {
        maxCastableLevel = lvl;
      }
    }
  }

  if (maxCastableLevel < 0 || mode === 'prayerbook_full_list') {
    return {
      classId: classDef.id,
      className: classDef.name,
      spellAcquisitionMode: mode,
      requiresManualSelection: false,
      prevEffectiveCasterLevel,
      nextEffectiveCasterLevel,
      maxCastableLevel,
      autoGrantedCantripIds: [],
      freePickCount: 0,
      requiredBySpellLevel: {}
    };
  }

  const getUnlearnedSelectableAtLevel = (lvl: number): ReadonlyArray<DnD35SpellDefinition> =>
    Object.values(sysContent.spells).filter(
      (sp) =>
        !alreadyKnownSpellIds.includes(sp.id) &&
        isSpellSelectableForDraft(sp, classDef.id, maxCastableLevel, prohibitedSchools, domainIds).selectable &&
        getSpellLevelForClass(sp, classDef.id, domainIds) === lvl
    );

  if (mode === 'spellbook_scribed') {
    if (prevEffectiveCasterLevel === 0) {
      const autoGrantedCantripIds = getUnlearnedSelectableAtLevel(0).map((s) => s.id);
      const availLvl1 = getUnlearnedSelectableAtLevel(1).length;
      const targetLvl1 = Math.min(availLvl1, Math.max(1, 3 + Math.max(0, intModifier)));
      const requiredBySpellLevel: Record<number, number> = targetLvl1 > 0 ? { 1: targetLvl1 } : {};
      return {
        classId: classDef.id,
        className: classDef.name,
        spellAcquisitionMode: mode,
        requiresManualSelection: targetLvl1 > 0,
        prevEffectiveCasterLevel,
        nextEffectiveCasterLevel,
        maxCastableLevel,
        autoGrantedCantripIds,
        freePickCount: 0,
        requiredBySpellLevel
      };
    }

    let totalUnlearned = 0;
    for (let l = 1; l <= maxCastableLevel; l++) {
      totalUnlearned += getUnlearnedSelectableAtLevel(l).length;
    }
    const levelDelta = Math.max(1, nextEffectiveCasterLevel - prevEffectiveCasterLevel);
    const freePickCount = Math.min(totalUnlearned, 2 * levelDelta);
    return {
      classId: classDef.id,
      className: classDef.name,
      spellAcquisitionMode: mode,
      requiresManualSelection: freePickCount > 0,
      prevEffectiveCasterLevel,
      nextEffectiveCasterLevel,
      maxCastableLevel,
      autoGrantedCantripIds: [],
      freePickCount,
      requiredBySpellLevel: {}
    };
  }

  const clampedPrev = prevEffectiveCasterLevel > 0 ? Math.min(classDef.maxLevel, prevEffectiveCasterLevel) : 0;
  const rowPrev = clampedPrev > 0 ? classDef.progression.find((r) => r.level === clampedPrev) : undefined;
  const requiredBySpellLevel: Record<number, number> = {};
  let totalRequired = 0;

  for (let lvl = 0; lvl <= maxCastableLevel; lvl++) {
    const nowKnown = rowNow?.spellsKnown?.[String(lvl)] ?? 0;
    const prevKnown = rowPrev?.spellsKnown?.[String(lvl)] ?? 0;
    const delta = Math.max(0, nowKnown - prevKnown);
    if (delta > 0) {
      const avail = getUnlearnedSelectableAtLevel(lvl).length;
      const clamped = Math.min(delta, avail);
      if (clamped > 0) {
        requiredBySpellLevel[lvl] = clamped;
        totalRequired += clamped;
      }
    }
  }

  return {
    classId: classDef.id,
    className: classDef.name,
    spellAcquisitionMode: mode,
    requiresManualSelection: totalRequired > 0,
    prevEffectiveCasterLevel,
    nextEffectiveCasterLevel,
    maxCastableLevel,
    autoGrantedCantripIds: [],
    freePickCount: 0,
    requiredBySpellLevel
  };
}

/**
 * Validates that a set of selected spell IDs for a class satisfies its `ClassSpellSelectionBudget`.
 */
export function validateClassSpellSelection(
  selectedSpellIds: ReadonlyArray<string>,
  budget: ClassSpellSelectionBudget,
  prohibitedSchools: ReadonlyArray<DnD35SpellSchool>,
  domainIds: ReadonlyArray<string>,
  sysContent: DnD35SystemContent
): { readonly valid: boolean; readonly reason?: string } {
  if (!budget.requiresManualSelection) {
    return { valid: true };
  }

  const manualPicks = selectedSpellIds.filter((id) => !budget.autoGrantedCantripIds.includes(id));

  for (const spId of manualPicks) {
    const sp = sysContent.spells[spId];
    if (!sp) {
      return { valid: false, reason: `Unknown spell "${spId}".` };
    }
    const sel = isSpellSelectableForDraft(sp, budget.classId, budget.maxCastableLevel, prohibitedSchools, domainIds);
    if (!sel.selectable) {
      return { valid: false, reason: `${sp.name}: ${sel.reason ?? 'Not selectable'}` };
    }
  }

  if (budget.freePickCount > 0) {
    const validLvlPicks = manualPicks.filter((spId) => {
      const sp = sysContent.spells[spId];
      const lvl = sp ? getSpellLevelForClass(sp, budget.classId, domainIds) : null;
      return lvl !== null && lvl >= 1 && lvl <= budget.maxCastableLevel;
    });
    if (validLvlPicks.length !== budget.freePickCount) {
      return {
        valid: false,
        reason: `Select ${budget.freePickCount} new spell(s) for ${budget.className} (${validLvlPicks.length}/${budget.freePickCount} selected).`
      };
    }
    return { valid: true };
  }

  const countsByLevel: Record<number, number> = {};
  for (const spId of manualPicks) {
    const sp = sysContent.spells[spId];
    if (!sp) continue;
    const lvl = getSpellLevelForClass(sp, budget.classId, domainIds);
    if (lvl !== null) {
      countsByLevel[lvl] = (countsByLevel[lvl] ?? 0) + 1;
    }
  }

  for (const [lvlKey, reqCount] of Object.entries(budget.requiredBySpellLevel)) {
    const lvl = Number(lvlKey);
    const actual = countsByLevel[lvl] ?? 0;
    if (actual !== reqCount) {
      return {
        valid: false,
        reason: `Select ${reqCount} level-${lvl} spell(s) for ${budget.className} (${actual}/${reqCount} selected).`
      };
    }
  }

  for (const [lvlKey, actual] of Object.entries(countsByLevel)) {
    const lvl = Number(lvlKey);
    const reqCount = budget.requiredBySpellLevel[lvl] ?? 0;
    if (actual > reqCount) {
      return {
        valid: false,
        reason: `Too many level-${lvl} spells selected for ${budget.className} (${actual}/${reqCount}).`
      };
    }
  }

  return { valid: true };
}
