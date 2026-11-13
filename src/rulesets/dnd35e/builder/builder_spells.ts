import type { DnD35Alignment, DnD35SpellSchool } from '../types/dnd35e.types.ts';
import type { DnD35ClassDefinition, DnD35SpellDefinition, DnD35SystemContent } from '../types/dnd35e_system.types.ts';

/** Divine spellcasting classes subject to SRD aligned spell restrictions (`[Good]`, `[Evil]`, `[Lawful]`, `[Chaotic]`). */
const DIVINE_ALIGNED_RESTRICTED_CLASSES: ReadonlySet<string> = new Set([
  'cleric',
  'druid',
  'paladin',
  'blackguard',
  'ranger',
  'adept'
]);

/**
 * Checks whether a spell's alignment descriptors (`good`, `evil`, `lawful`, `chaotic`)
 * are permitted for a divine caster of `alignment` in `classId`.
 * Per D&D 3.5e SRD, Clerics, Druids, Paladins, Rangers, Adepts, and Blackguards cannot cast spells
 * with an alignment descriptor opposed to their alignment.
 *
 * @param spell Spell definition.
 * @param classId Casting class ID.
 * @param alignment Actor's alignment (optional).
 * @returns `{ allowed: boolean; reason?: string }`.
 */
export function isSpellAlignmentAllowedForActor(
  spell: DnD35SpellDefinition,
  classId: string,
  alignment?: DnD35Alignment
): { readonly allowed: boolean; readonly reason?: string } {
  if (!alignment || !DIVINE_ALIGNED_RESTRICTED_CLASSES.has(classId)) {
    return { allowed: true };
  }
  const descriptors = (spell.descriptors ?? []).map((d) => d.toLowerCase());
  if (descriptors.length === 0) {
    return { allowed: true };
  }

  const isGood = alignment.endsWith('G');
  const isEvil = alignment.endsWith('E');
  const isLawful = alignment.startsWith('L');
  const isChaotic = alignment.startsWith('C');

  if (isGood && descriptors.includes('evil')) {
    return { allowed: false, reason: 'Good divine casters cannot cast [Evil] spells' };
  }
  if (isEvil && descriptors.includes('good')) {
    return { allowed: false, reason: 'Evil divine casters cannot cast [Good] spells' };
  }
  if (isLawful && (descriptors.includes('chaotic') || descriptors.includes('chaos'))) {
    return { allowed: false, reason: 'Lawful divine casters cannot cast [Chaotic] spells' };
  }
  if (isChaotic && (descriptors.includes('lawful') || descriptors.includes('law'))) {
    return { allowed: false, reason: 'Chaotic divine casters cannot cast [Lawful] spells' };
  }
  return { allowed: true };
}

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
  domainIds: ReadonlyArray<string> = [],
  actorAccessTags: ReadonlyArray<string> = []
): number | null {
  const classLevel = spell.levelByClass[classId];
  if (classLevel !== undefined) {
    return classLevel;
  }
  if (domainIds.length > 0) {
    for (const domId of domainIds) {
      const domLvl = spell.levelByDomain[domId] ?? spell.levelByAccessTag?.[`domain:${domId}`];
      if (domLvl !== undefined) return domLvl;
    }
  }
  const classTagLvl = spell.levelByAccessTag?.[`class:${classId}`];
  if (classTagLvl !== undefined) return classTagLvl;
  if (actorAccessTags.length > 0 && spell.levelByAccessTag) {
    for (const tag of actorAccessTags) {
      const tagLvl = spell.levelByAccessTag[tag];
      if (tagLvl !== undefined) return tagLvl;
    }
  }
  return null;
}

/**
 * Checks whether a spell is legal for a character creation draft or level-up given their class,
 * maximum castable spell level, Cleric domains, Wizard prohibited schools, and alignment.
 *
 * @param spell Spell definition.
 * @param classId Class identifier.
 * @param maxCastableLevel Highest spell level the class can cast at this level (`0` or `1` at level 1).
 * @param prohibitedSchools Wizard prohibited schools.
 * @param domainIds Selected Cleric domains.
 * @param alignment Optional actor alignment for SRD divine aligned spell restrictions.
 * @returns `{ selectable: boolean; effectiveLevel: number | null; reason?: string }`.
 */
export function isSpellSelectableForDraft(
  spell: DnD35SpellDefinition,
  classId: string,
  maxCastableLevel: number,
  prohibitedSchools: ReadonlyArray<DnD35SpellSchool> = [],
  domainIds: ReadonlyArray<string> = [],
  alignment?: DnD35Alignment
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
  const alignCheck = isSpellAlignmentAllowedForActor(spell, classId, alignment);
  if (!alignCheck.allowed) {
    return {
      selectable: false,
      effectiveLevel,
      ...(alignCheck.reason !== undefined ? { reason: alignCheck.reason } : {})
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
  sysContent: DnD35SystemContent,
  alignment?: DnD35Alignment
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
        isSpellSelectableForDraft(sp, classDef.id, maxCastableLevel, prohibitedSchools, domainIds, alignment)
          .selectable &&
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
  sysContent: DnD35SystemContent,
  alignment?: DnD35Alignment
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
    const sel = isSpellSelectableForDraft(
      sp,
      budget.classId,
      budget.maxCastableLevel,
      prohibitedSchools,
      domainIds,
      alignment
    );
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
