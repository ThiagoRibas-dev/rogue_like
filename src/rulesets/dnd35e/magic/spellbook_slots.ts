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
import type { DnD35SpontaneousConversionMode, DnD35SystemContent } from '../types/dnd35e_system.types.ts';
import { collectClassFeaturesUpToLevel } from '../progression.ts';

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
 * Returns true if `spellId` is granted at `spellLevel` by ANY domain in `actorDomains` (`1..N` domains),
 * checking both `spellDef.levelByDomain[domId]` and `domainRegistry[domId].domainSpells[String(spellLevel)]`.
 * Supports actors with any number of domains gained from base classes, multiclassing, prestige classes, or feats.
 *
 * @param spellId Spell identifier.
 * @param spellDef Optional spell definition with `levelByDomain`.
 * @param spellLevel Target spell level (0..9).
 * @param actorDomains All domain IDs owned by the actor (`0..N`).
 * @param domainRegistry Campaign/ruleset domain registry mapping `domId -> { domainSpells }`.
 * @returns True if any owned domain grants `spellId` at `spellLevel`.
 */
export function isActorDomainSpellAtLevel(
  spellId: string,
  spellDef: { readonly levelByDomain?: Readonly<Record<string, number>> } | undefined,
  spellLevel: number,
  actorDomains: ReadonlyArray<string> | undefined,
  domainRegistry:
    Readonly<Record<string, { readonly domainSpells?: Readonly<Record<string, string>> } | undefined>> | undefined
): boolean {
  if (!actorDomains || actorDomains.length === 0) return false;
  const lvlKey = String(spellLevel);
  for (const domId of actorDomains) {
    if (spellDef?.levelByDomain?.[domId] === spellLevel) return true;
    if (domainRegistry?.[domId]?.domainSpells?.[lvlKey] === spellId) return true;
  }
  return false;
}

/**
 * Collects all spell IDs granted by ANY domain in `actorDomains` (`1..N` domains) up to `maxSpellLevel`,
 * inspecting both `domainRegistry[domId].domainSpells` and `spellRegistry[spId].levelByDomain`.
 *
 * @param actorDomains All domain IDs owned by the actor (`0..N`).
 * @param domainRegistry Domain registry.
 * @param spellRegistry Optional spell registry to scan `levelByDomain` declarations.
 * @param maxSpellLevel Optional inclusive cap on spell level (default `9`).
 * @returns Deduplicated array of granted domain spell IDs.
 */
export function collectActorDomainSpellIds(
  actorDomains: ReadonlyArray<string> | undefined,
  domainRegistry:
    Readonly<Record<string, { readonly domainSpells?: Readonly<Record<string, string>> } | undefined>> | undefined,
  spellRegistry?: Readonly<
    Record<string, { readonly id?: string; readonly levelByDomain?: Readonly<Record<string, number>> } | undefined>
  >,
  maxSpellLevel = MAX_SPELL_LEVEL
): ReadonlyArray<string> {
  if (!actorDomains || actorDomains.length === 0) return [];
  const ids = new Set<string>();

  for (const domId of actorDomains) {
    const domDef = domainRegistry?.[domId];
    if (domDef?.domainSpells) {
      for (const [lvlKey, spId] of Object.entries(domDef.domainSpells)) {
        const lvl = Number(lvlKey);
        if (!Number.isNaN(lvl) && lvl <= maxSpellLevel && spId) {
          ids.add(spId);
        }
      }
    }
  }

  if (spellRegistry) {
    for (const [spKey, sp] of Object.entries(spellRegistry)) {
      if (!sp?.levelByDomain) continue;
      for (const domId of actorDomains) {
        const domLvl = sp.levelByDomain[domId];
        if (domLvl !== undefined && domLvl <= maxSpellLevel) {
          ids.add(sp.id ?? spKey);
        }
      }
    }
  }

  return Array.from(ids);
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

    // Domain bonus slot (from class progression or spellbook state for any domain-granting class)
    const progDomainSlots = progRow?.domainSpellSlots?.[lvlKey] ?? book.domainSpellSlots?.[lvlKey] ?? 0;
    const domainSlots = progDomainSlots > 0 && (dndData.domains?.length ?? 0) > 0 && canCast ? progDomainSlots : 0;

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
  for (const s of book.preparedSlots ?? []) existingMap.set(s.slotId, s);

  const legacyPool =
    (book.preparedSlots === undefined || book.preparedSlots.length === 0) && book.preparedSpellIds.length > 0
      ? [...book.preparedSpellIds]
      : [];

  const takeLegacySpellForLevel = (spellLevel: number): string | undefined => {
    if (legacyPool.length === 0) return undefined;
    if (!spellsRegistry) return spellLevel === 0 ? legacyPool.shift() : undefined;
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
    for (let i = 0; i < sum.generalSlots; i++) {
      const slotId = `lv${sum.spellLevel}_gen_${i}`;
      const existing = existingMap.get(slotId);
      if (existing) {
        result.push(existing);
      } else {
        const seeded = takeLegacySpellForLevel(sum.spellLevel);
        result.push({
          slotId,
          spellLevel: sum.spellLevel,
          slotKind: 'general',
          ...(seeded ? { preparedSpellId: seeded } : {}),
          expended: false
        });
      }
    }
    for (let i = 0; i < sum.domainSlots; i++) {
      const slotId = `lv${sum.spellLevel}_dom_${i}`;
      result.push(
        existingMap.get(slotId) ?? { slotId, spellLevel: sum.spellLevel, slotKind: 'domain', expended: false }
      );
    }
    for (let i = 0; i < sum.specialistSlots; i++) {
      const slotId = `lv${sum.spellLevel}_spec_${i}`;
      result.push(
        existingMap.get(slotId) ?? { slotId, spellLevel: sum.spellLevel, slotKind: 'specialist', expended: false }
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

/** Resolves active spontaneous conversion modes for a class from its declarative `featureDetails`. */
export function resolveActiveSpontaneousConversionModes(
  classId: string,
  dndData: Partial<DnD35EntityData>,
  systemContent: DnD35SystemContent | undefined
): ReadonlyArray<DnD35SpontaneousConversionMode> {
  const classDef = systemContent?.classes?.[classId];
  const featureDetails = classDef?.featureDetails;
  if (classDef && featureDetails && Object.keys(featureDetails).length > 0) {
    const track = dndData.tracks?.find((t) => t.trackId === classId);
    const level = track ? Math.max(1, track.levels) : 1;
    const activeFeatures = dndData.activeClassFeatures?.length
      ? dndData.activeClassFeatures
      : collectClassFeaturesUpToLevel(classDef, level, dndData.selectedAcfs ?? []);

    const modes = new Set<DnD35SpontaneousConversionMode>();
    for (const featId of activeFeatures) {
      const mode = featureDetails[featId]?.spontaneousConversionMode;
      if (mode) modes.add(mode);
    }
    if (modes.size > 0) return Array.from(modes);
  }

  if (classId === 'cleric') return ['cure_or_inflict'];
  if (classId === 'druid') return ['summon_nature_ally'];
  return [];
}

/**
 * Returns true if `spellId` is eligible to be prepared into a `domain` spell slot at `spellLevel`.
 * Standard clerics may prepare any spell granted at `spellLevel` by their owned domains.
 * Clerics with the *Spontaneous Domain Casting* ACF (`spontaneousConversionMode === 'domain'`, PHB II p. 37)
 * may ALSO prepare their alignment-appropriate *Cure* or *Inflict* spell of `spellLevel` in their domain spell slots.
 */
export function canPrepareSpellInDomainSlot(
  spellId: string,
  spellDef: { readonly levelByDomain?: Readonly<Record<string, number>> } | undefined,
  spellLevel: number,
  dndData: Partial<DnD35EntityData>,
  systemContent: DnD35SystemContent | undefined,
  classId = 'cleric'
): boolean {
  if (isActorDomainSpellAtLevel(spellId, spellDef, spellLevel, dndData.domains, systemContent?.domains)) {
    return true;
  }
  const modes = resolveActiveSpontaneousConversionModes(classId, dndData, systemContent);
  if (!modes.includes('domain')) return false;

  const isGood = dndData.alignment?.endsWith('G') ?? false;
  const isEvil = dndData.alignment?.endsWith('E') ?? false;
  if (!isEvil && CURE_SPELLS_BY_LEVEL[spellLevel] === spellId) return true;
  if (!isGood && INFLICT_SPELLS_BY_LEVEL[spellLevel] === spellId) return true;
  return false;
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

  const modes = resolveActiveSpontaneousConversionModes(classId, dndData, systemContent);

  if (modes.includes('domain')) {
    const ownedDomains = dndData.domains ?? [];
    const chosenDomId =
      dndData.spontaneousDomainId && ownedDomains.includes(dndData.spontaneousDomainId)
        ? dndData.spontaneousDomainId
        : (dndData.spontaneousDomainId ?? ownedDomains[0]);
    if (chosenDomId) {
      const seen = new Set<string>();
      const domDef = systemContent?.domains?.[chosenDomId];
      const domLabel = `Domain: ${domDef?.name ?? chosenDomId}`;
      for (let lvl = spellLevel; lvl >= 1; lvl--) {
        const spId = domDef?.domainSpells?.[String(lvl)];
        if (spId && !seen.has(spId) && hasSpell(spId)) {
          seen.add(spId);
          options.push({ spellId: spId, label: domLabel });
        }
        if (systemContent?.spells) {
          for (const [candKey, candDef] of Object.entries(systemContent.spells)) {
            const resolvedId = candDef.id ?? candKey;
            if (!seen.has(resolvedId) && candDef.levelByDomain?.[chosenDomId] === lvl) {
              seen.add(resolvedId);
              options.push({ spellId: resolvedId, label: domLabel });
            }
          }
        }
      }
    }
    if (options.length > 0) return options;
  }

  if (modes.includes('cure_or_inflict')) {
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
  }

  if (modes.includes('summon_nature_ally')) {
    const targetSpell = SUMMON_NATURES_ALLY_BY_LEVEL[spellLevel];
    if (targetSpell && hasSpell(targetSpell)) {
      options.push({ spellId: targetSpell, label: "Summon Nature's Ally" });
    }
  }

  return options;
}
