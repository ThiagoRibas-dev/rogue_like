import { dndFloor } from '../math/multipliers.ts';
import { computeEffectiveClassCastingLevel } from '../progression.ts';
import type {
  DnD35CharacterLevelRecord,
  DnD35EntityData,
  DnD35SpellSchool,
  HitDieTrack
} from '../types/dnd35e.types.ts';
import type { DnD35ClassDefinition, DnD35SystemContent } from '../types/dnd35e_system.types.ts';

/** Minimum class level at which half-casters (Paladin, Ranger) gain a Caster Level (`4`). */
const HALF_CASTER_MIN_CLASS_LEVEL = 4;

/** Divisor for half-caster Caster Level (`floor(effectiveClassLevel / 2)`). */
const HALF_CASTER_CL_DIVISOR = 2;

/** Hand count for 6-armed Marilith body plans (`6`) vs standard humanoid/quadruped (`2`). */
export const MARILITH_HAND_COUNT = 6;
export const DEFAULT_HAND_COUNT = 2;

/** Canonical Item Creation & Metamagic feat IDs for Loremaster / prerequisite pool counting. */
const ITEM_CREATION_AND_METAMAGIC_FEAT_IDS: ReadonlySet<string> = new Set([
  'empower_spell',
  'enlarge_spell',
  'extend_spell',
  'heighten_spell',
  'maximize_spell',
  'quicken_spell',
  'silent_spell',
  'still_spell',
  'widen_spell',
  'brew_potion',
  'craft_magic_arms_and_armor',
  'craft_rod',
  'craft_staff',
  'craft_wand',
  'craft_wondrous_item',
  'forge_ring',
  'scribe_scroll'
]);

/**
 * Computes the effective Caster Level for a single class track per D&D 3.5e SRD rules.
 */
function computeSingleClassCasterLevel(
  classDef: DnD35ClassDefinition,
  tracks: ReadonlyArray<HitDieTrack>,
  classRegistry: Readonly<Record<string, DnD35ClassDefinition>>,
  levelHistory?: ReadonlyArray<DnD35CharacterLevelRecord>
): number {
  if (classDef.castingMode === 'none') return 0;
  const effectiveLevel = computeEffectiveClassCastingLevel(tracks, classDef, classRegistry, levelHistory);
  if (effectiveLevel <= 0) return 0;
  if (classDef.id === 'paladin' || classDef.id === 'ranger') {
    return effectiveLevel >= HALF_CASTER_MIN_CLASS_LEVEL ? dndFloor(effectiveLevel / HALF_CASTER_CL_DIVISOR) : 0;
  }
  return effectiveLevel;
}

/**
 * Counts how many Metamagic and Item Creation feats the actor possesses.
 */
export function countMetamagicAndItemCreationFeats(
  feats: ReadonlyArray<string>,
  sysContent?: Readonly<DnD35SystemContent>
): number {
  let count = 0;
  for (const featId of feats) {
    const baseId = featId.split(':')[0]!;
    const featDef = sysContent?.feats[baseId];
    if (featDef?.metamagicDescriptor !== undefined || ITEM_CREATION_AND_METAMAGIC_FEAT_IDS.has(baseId)) {
      count++;
    }
  }
  return count;
}

/**
 * Computes casting metrics (caster level, max arcane/divine prepared/spontaneous spell levels,
 * and known/accessible spell counts and max levels by school) across all tracks.
 */
export function computeActorSpellcastingPrereqMetrics(
  tracks: ReadonlyArray<HitDieTrack>,
  classRegistry: Readonly<Record<string, DnD35ClassDefinition>>,
  levelHistory: ReadonlyArray<DnD35CharacterLevelRecord> | undefined,
  spellbooksByClass: DnD35EntityData['spellbooksByClass'],
  domains: ReadonlyArray<string>,
  addedSpellsForClass?: { readonly classId: string; readonly spellIds: ReadonlyArray<string> },
  sysContent?: Readonly<DnD35SystemContent>
): {
  readonly casterLevel: number;
  readonly maxArcaneSpellLevel: number;
  readonly maxDivineSpellLevel: number;
  readonly maxPreparedArcaneSpellLevel: number;
  readonly maxSpontaneousArcaneSpellLevel: number;
  readonly maxPreparedDivineSpellLevel: number;
  readonly maxSpontaneousDivineSpellLevel: number;
  readonly spellCountBySchool: Readonly<Partial<Record<DnD35SpellSchool, number>>>;
  readonly maxSpellLevelBySchool: Readonly<Partial<Record<DnD35SpellSchool, number>>>;
} {
  let maxArcaneSpellLevel = 0;
  let maxDivineSpellLevel = 0;
  let maxPreparedArcaneSpellLevel = -1;
  let maxSpontaneousArcaneSpellLevel = -1;
  let maxPreparedDivineSpellLevel = -1;
  let maxSpontaneousDivineSpellLevel = -1;
  let highestCasterLevel = 0;

  const spellsBySchool = new Map<DnD35SpellSchool, Set<string>>();
  const maxSpellLevelBySchool: Partial<Record<DnD35SpellSchool, number>> = {};

  const recordSpellSchool = (spellId: string, spellLevel: number): void => {
    const spellDef = sysContent?.spells[spellId];
    if (!spellDef) return;
    const school = spellDef.school as DnD35SpellSchool;
    let set = spellsBySchool.get(school);
    if (!set) {
      set = new Set<string>();
      spellsBySchool.set(school, set);
    }
    set.add(spellId);
    const prevMax = maxSpellLevelBySchool[school] ?? -1;
    if (spellLevel > prevMax) {
      maxSpellLevelBySchool[school] = spellLevel;
    }
  };

  for (const track of tracks) {
    const classDef = classRegistry[track.trackId];
    if (!classDef || classDef.castingMode === 'none') continue;
    const effectiveLevel = computeEffectiveClassCastingLevel(tracks, classDef, classRegistry, levelHistory);
    const classCl = computeSingleClassCasterLevel(classDef, tracks, classRegistry, levelHistory);
    if (classCl > highestCasterLevel) {
      highestCasterLevel = classCl;
    }

    const row = classDef.progression.find((r) => r.level === effectiveLevel);
    if (!row || !row.spellsPerDay) continue;
    let highestSlot = -1;
    for (const [lvlKey, slots] of Object.entries(row.spellsPerDay)) {
      const spellLvl = Number(lvlKey);
      if (!Number.isNaN(spellLvl) && slots >= 0 && spellLvl > highestSlot) {
        highestSlot = spellLvl;
      }
    }
    if (highestSlot < 0) continue;

    if (classDef.castingTradition === 'arcane') {
      if (highestSlot > maxArcaneSpellLevel) maxArcaneSpellLevel = highestSlot;
      if (classDef.castingMode === 'prepared' && highestSlot > maxPreparedArcaneSpellLevel) {
        maxPreparedArcaneSpellLevel = highestSlot;
      } else if (classDef.castingMode === 'spontaneous' && highestSlot > maxSpontaneousArcaneSpellLevel) {
        maxSpontaneousArcaneSpellLevel = highestSlot;
      }
    } else if (classDef.castingTradition === 'divine') {
      if (highestSlot > maxDivineSpellLevel) maxDivineSpellLevel = highestSlot;
      if (classDef.castingMode === 'prepared' && highestSlot > maxPreparedDivineSpellLevel) {
        maxPreparedDivineSpellLevel = highestSlot;
      } else if (classDef.castingMode === 'spontaneous' && highestSlot > maxSpontaneousDivineSpellLevel) {
        maxSpontaneousDivineSpellLevel = highestSlot;
      }
    }

    if (sysContent) {
      if (classDef.spellAcquisitionMode === 'prayerbook_full_list') {
        for (const [spellId, spellDef] of Object.entries(sysContent.spells)) {
          const lvl = spellDef.levelByClass[classDef.id];
          if (lvl !== undefined && lvl <= highestSlot) {
            recordSpellSchool(spellId, lvl);
          }
        }
        for (const domId of domains) {
          const domDef = sysContent.domains[domId];
          if (!domDef) continue;
          for (const [lvlKey, spellId] of Object.entries(domDef.domainSpells)) {
            const lvl = Number(lvlKey);
            if (!Number.isNaN(lvl) && lvl <= highestSlot) {
              recordSpellSchool(spellId, lvl);
            }
          }
        }
      } else {
        const knownIds = new Set<string>(spellbooksByClass?.[classDef.id]?.knownSpellIds ?? []);
        if (addedSpellsForClass && addedSpellsForClass.classId === classDef.id) {
          for (const sId of addedSpellsForClass.spellIds) {
            knownIds.add(sId);
          }
        }
        for (const spellId of knownIds) {
          const spellDef = sysContent.spells[spellId];
          if (!spellDef) continue;
          const lvl = spellDef.levelByClass[classDef.id] ?? spellDef.level;
          if (lvl <= highestSlot) {
            recordSpellSchool(spellId, lvl);
          }
        }
      }
    }
  }

  const spellCountBySchool: Partial<Record<DnD35SpellSchool, number>> = {};
  for (const [school, set] of spellsBySchool.entries()) {
    spellCountBySchool[school] = set.size;
  }

  return {
    casterLevel: highestCasterLevel,
    maxArcaneSpellLevel,
    maxDivineSpellLevel,
    maxPreparedArcaneSpellLevel,
    maxSpontaneousArcaneSpellLevel,
    maxPreparedDivineSpellLevel,
    maxSpontaneousDivineSpellLevel,
    spellCountBySchool,
    maxSpellLevelBySchool
  };
}

/**
 * Counts total natural attack weapons on an actor.
 */
export function countActorNaturalAttacks(dndData: DnD35EntityData): number {
  let total = 0;
  for (const nw of dndData.naturalWeapons ?? []) {
    total += nw.count ?? 1;
  }
  return total;
}

/**
 * Computes maximum Spell-Like Ability (SLA) Caster Level on an actor.
 */
export function computeMaxSlaCasterLevel(
  dndData: DnD35EntityData,
  characterLevel: number,
  sysContent?: Readonly<DnD35SystemContent>
): number {
  let maxSlaCl = 0;
  const raceDef = dndData.raceId ? sysContent?.races[dndData.raceId] : undefined;
  for (const bundle of raceDef?.traitBundles ?? []) {
    if (bundle.category === 'sp' || bundle.usageMode === 'spell_like') {
      maxSlaCl = Math.max(maxSlaCl, characterLevel);
    }
    for (const ab of bundle.activatedAbilities ?? []) {
      if (ab.spellLikeSpellId !== undefined) {
        maxSlaCl = Math.max(maxSlaCl, characterLevel);
      }
    }
  }
  return maxSlaCl;
}
