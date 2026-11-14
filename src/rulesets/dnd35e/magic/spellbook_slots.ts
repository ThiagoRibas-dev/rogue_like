/**
 * @file D&D 3.5e Spellbook Slot & Spontaneous Casting Resolver.
 * Computes Level 0..9 slot matrices, ability bonus slots, specialist school slots,
 * domain bonus slots, and spontaneous conversion targets.
 */

import { computeAbilityModifier } from '../abilities.ts';
import { canCastSpellOfLevel, computeBonusSpellSlots } from './spellcasting.ts';
import type {
  AbilityScoresRecord,
  DnD35ClassSpellbookState,
  DnD35EntityData,
  DnD35PreparedSlotEntry
} from '../types/dnd35e.types.ts';
import type { DnD35SystemContent } from '../types/dnd35e_system.types.ts';

const MAX_SPELL_LEVEL = 9;

export interface SpellLevelSlotSummary {
  readonly spellLevel: number;
  readonly baseSlots: number;
  readonly bonusSlots: number;
  readonly generalSlots: number;
  readonly domainSlots: number;
  readonly specialistSlots: number;
  readonly totalSlots: number;
  readonly saveDc: number;
  readonly canCast: boolean;
}

/**
 * Computes slot matrix across all levels (0..9) for a class track.
 */
export function computeClassLevelSlotSummaries(
  book: DnD35ClassSpellbookState,
  dndData: Partial<DnD35EntityData>,
  effectiveAbilities: AbilityScoresRecord | undefined,
  systemContent: DnD35SystemContent | undefined
): ReadonlyArray<SpellLevelSlotSummary> {
  const govAb = book.governingAbility;
  const abScore = effectiveAbilities?.[govAb]?.base ?? 10;
  const abMod = computeAbilityModifier(abScore);
  const classDef = systemContent?.classes?.[book.classId];
  const track = dndData.tracks?.find((t) => t.trackId === book.classId);
  const classLevel = track?.levels ?? 1;
  const progRow = classDef?.progression?.[classLevel - 1];

  const summaries: SpellLevelSlotSummary[] = [];

  for (let lvl = 0; lvl <= MAX_SPELL_LEVEL; lvl++) {
    const lvlKey = String(lvl);
    const baseRaw = progRow?.spellsPerDay?.[lvlKey];
    if (baseRaw === undefined && lvl > 0) {
      // Class cannot cast spells of this level
      continue;
    }
    const baseSlots = baseRaw ?? 0;
    const canCast = canCastSpellOfLevel(abScore, lvl) && (baseSlots > 0 || (lvl > 0 && baseRaw !== undefined));
    const bonusSlots = canCast && lvl > 0 ? computeBonusSpellSlots(abScore, lvl) : 0;
    const generalSlots = canCast ? baseSlots + bonusSlots : 0;

    // Cleric domain bonus slot
    const domainSlots =
      (progRow?.domainSpellSlots?.[lvlKey] ?? 0) > 0 && (dndData.domains?.length ?? 0) > 0 && canCast ? 1 : 0;

    // Wizard specialist school slot
    const specialistSlots =
      book.classId === 'wizard' &&
      lvl > 0 &&
      canCast &&
      generalSlots > 0 &&
      dndData.arcaneSchool &&
      dndData.arcaneSchool !== 'universal'
        ? 1
        : 0;

    const totalSlots = generalSlots + domainSlots + specialistSlots;
    const saveDc = 10 + lvl + abMod;

    summaries.push({
      spellLevel: lvl,
      baseSlots,
      bonusSlots,
      generalSlots,
      domainSlots,
      specialistSlots,
      totalSlots,
      saveDc,
      canCast
    });
  }

  return summaries;
}

/**
 * Reconciles structured `preparedSlots` array with current slot capacities.
 */
export function reconcilePreparedSlots(
  book: DnD35ClassSpellbookState,
  summaries: ReadonlyArray<SpellLevelSlotSummary>,
  spellsRegistry?: Readonly<Record<string, { readonly levelByClass?: Readonly<Record<string, number>> } | undefined>>
): ReadonlyArray<DnD35PreparedSlotEntry> {
  const existingMap = new Map<string, DnD35PreparedSlotEntry>();
  for (const s of book.preparedSlots ?? []) {
    existingMap.set(s.slotId, s);
  }

  const legacyPool =
    (book.preparedSlots === undefined || book.preparedSlots.length === 0) && book.preparedSpellIds.length > 0
      ? [...book.preparedSpellIds]
      : [];

  const takeLegacySpellForLevel = (spellLevel: number): string | undefined => {
    if (legacyPool.length === 0) return undefined;
    if (!spellsRegistry) {
      return spellLevel === 0 ? legacyPool.shift() : undefined;
    }
    const idx = legacyPool.findIndex((spId) => {
      const def = spellsRegistry[spId];
      const lv = def?.levelByClass?.[book.classId] ?? def?.levelByClass?.['sorcerer_wizard'];
      return lv === spellLevel;
    });
    if (idx === -1) return undefined;
    const [picked] = legacyPool.splice(idx, 1);
    return picked;
  };

  const result: DnD35PreparedSlotEntry[] = [];

  for (const sum of summaries) {
    if (!sum.canCast) continue;

    // General slots
    for (let i = 0; i < sum.generalSlots; i++) {
      const slotId = `lv${sum.spellLevel}_gen_${i}`;
      const existing = existingMap.get(slotId);
      if (existing) {
        result.push(existing);
      } else {
        const seededSpellId = takeLegacySpellForLevel(sum.spellLevel);
        result.push({
          slotId,
          spellLevel: sum.spellLevel,
          slotKind: 'general',
          ...(seededSpellId !== undefined ? { preparedSpellId: seededSpellId } : {}),
          expended: false
        });
      }
    }

    // Domain slots
    for (let i = 0; i < sum.domainSlots; i++) {
      const slotId = `lv${sum.spellLevel}_dom_${i}`;
      const existing = existingMap.get(slotId);
      result.push(
        existing ?? {
          slotId,
          spellLevel: sum.spellLevel,
          slotKind: 'domain',
          expended: false
        }
      );
    }

    // Specialist slots
    for (let i = 0; i < sum.specialistSlots; i++) {
      const slotId = `lv${sum.spellLevel}_spec_${i}`;
      const existing = existingMap.get(slotId);
      result.push(
        existing ?? {
          slotId,
          spellLevel: sum.spellLevel,
          slotKind: 'specialist',
          expended: false
        }
      );
    }
  }

  return result;
}

const CURE_SPELLS_BY_LEVEL: Readonly<Record<number, string>> = {
  0: 'cure_minor_wounds',
  1: 'cure_light_wounds',
  2: 'cure_moderate_wounds',
  3: 'cure_serious_wounds',
  4: 'cure_critical_wounds',
  5: 'cure_light_wounds_mass',
  6: 'cure_moderate_wounds_mass',
  7: 'cure_serious_wounds_mass',
  8: 'cure_critical_wounds_mass'
};

const INFLICT_SPELLS_BY_LEVEL: Readonly<Record<number, string>> = {
  0: 'inflict_minor_wounds',
  1: 'inflict_light_wounds',
  2: 'inflict_moderate_wounds',
  3: 'inflict_serious_wounds',
  4: 'inflict_critical_wounds',
  5: 'inflict_light_wounds_mass',
  6: 'inflict_moderate_wounds_mass',
  7: 'inflict_serious_wounds_mass',
  8: 'inflict_critical_wounds_mass'
};

const SUMMON_NATURES_ALLY_BY_LEVEL: Readonly<Record<number, string>> = {
  1: 'summon_natures_ally_i',
  2: 'summon_natures_ally_ii',
  3: 'summon_natures_ally_iii',
  4: 'summon_natures_ally_iv',
  5: 'summon_natures_ally_v',
  6: 'summon_natures_ally_vi',
  7: 'summon_natures_ally_vii',
  8: 'summon_natures_ally_viii',
  9: 'summon_natures_ally_ix'
};

export interface SpontaneousConversionOption {
  readonly spellId: string;
  readonly label: string;
}

/**
 * Returns available spontaneous conversion spells for a prepared slot.
 */
export function getSpontaneousConversionTargets(
  classId: string,
  spellLevel: number,
  dndData: Partial<DnD35EntityData>,
  systemContent: DnD35SystemContent | undefined,
  preferredPolarity?: 'positive' | 'negative'
): ReadonlyArray<SpontaneousConversionOption> {
  const options: SpontaneousConversionOption[] = [];
  const hasSpell = (id: string): boolean =>
    !systemContent?.spells || Object.keys(systemContent.spells).length === 0 || systemContent.spells[id] !== undefined;

  if (classId === 'cleric') {
    const hasDomainSpontaneity = dndData.selectedAcfs?.some(
      (a) => a === 'cleric_domain_spontaneity_1' || a === 'domain_spontaneity'
    );
    if (hasDomainSpontaneity) {
      for (const domId of dndData.domains ?? []) {
        const domDef = systemContent?.domains?.[domId];
        const spId = domDef?.domainSpells?.[String(spellLevel)];
        if (spId && hasSpell(spId)) {
          options.push({ spellId: spId, label: `Domain: ${domDef.name}` });
        }
      }
      if (options.length > 0) return options;
    }

    const isGood = dndData.alignment?.endsWith('G') ?? false;
    const isEvil = dndData.alignment?.endsWith('E') ?? false;
    if ((isGood || (!isEvil && preferredPolarity !== 'negative')) && CURE_SPELLS_BY_LEVEL[spellLevel]) {
      const sp = CURE_SPELLS_BY_LEVEL[spellLevel]!;
      if (hasSpell(sp)) options.push({ spellId: sp, label: 'Cure Wounds' });
    }
    if ((isEvil || (!isGood && preferredPolarity !== 'positive')) && INFLICT_SPELLS_BY_LEVEL[spellLevel]) {
      const sp = INFLICT_SPELLS_BY_LEVEL[spellLevel]!;
      if (hasSpell(sp)) options.push({ spellId: sp, label: 'Inflict Wounds' });
    }
  } else if (classId === 'druid') {
    const targetSpell = SUMMON_NATURES_ALLY_BY_LEVEL[spellLevel];
    if (targetSpell && hasSpell(targetSpell)) {
      options.push({ spellId: targetSpell, label: "Summon Nature's Ally" });
    }
  }

  return options;
}
