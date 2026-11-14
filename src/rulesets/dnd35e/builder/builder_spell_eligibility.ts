import type { DnD35Alignment, DnD35SpellSchool } from '../types/dnd35e.types.ts';
import type { DnD35ClassDefinition, DnD35SpellDefinition } from '../types/dnd35e_system.types.ts';

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
  if (descriptors.length === 0) return { allowed: true };

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
 * Returns the spell level of a spell for a given class (or Cleric domain), or `null` if not on the class list.
 */
export function getSpellLevelForClass(
  spell: DnD35SpellDefinition,
  classId: string,
  domainIds: ReadonlyArray<string> = [],
  actorAccessTags: ReadonlyArray<string> = []
): number | null {
  const classLevel = spell.levelByClass[classId];
  if (classLevel !== undefined) return classLevel;
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
 * Checks whether a spell is legal for a character creation draft or level-up.
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
    return { selectable: false, effectiveLevel, reason: `Requires spell level ${effectiveLevel} slots` };
  }
  if (prohibitedSchools.includes(spell.school as DnD35SpellSchool)) {
    return { selectable: false, effectiveLevel, reason: `Prohibited school (${spell.school})` };
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
 * Resolves the canonical spell acquisition mode for a class.
 */
export function resolveClassSpellAcquisitionMode(
  classDef: DnD35ClassDefinition | undefined
): 'none' | 'spellbook_scribed' | 'spontaneous_known' | 'prayerbook_full_list' {
  if (!classDef || classDef.castingMode === 'none' || classDef.castingTradition === 'none') {
    return 'none';
  }
  if (classDef.spellAcquisitionMode) return classDef.spellAcquisitionMode;
  if (classDef.castingTradition === 'divine' && classDef.castingMode === 'prepared') {
    return 'prayerbook_full_list';
  }
  if (classDef.castingMode === 'spontaneous') return 'spontaneous_known';
  return 'spellbook_scribed';
}
