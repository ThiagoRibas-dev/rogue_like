import { dndFloor } from '../math/multipliers.ts';
import type { DnD35CharacterLevelRecord, HitDieTrack } from '../types/dnd35e.types.ts';
import type { DnD35ClassDefinition, DnD35ClassLevelRow } from '../types/dnd35e_system.types.ts';

/**
 * Looks up the exact progression row for a class at `classLevel` (1..maxLevel).
 *
 * @param classDef Class definition from System Content.
 * @param classLevel Target class level (1-indexed).
 * @returns The matching `DnD35ClassLevelRow`, or `undefined` if out of bounds.
 */
export function getClassLevelRow(classDef: DnD35ClassDefinition, classLevel: number): DnD35ClassLevelRow | undefined {
  const clamped = dndFloor(classLevel);
  if (clamped < 1) return undefined;
  return classDef.progression.find((row) => row.level === clamped);
}

/**
 * Builds a `HitDieTrack` for a character class at `classLevel`, reading exact BAB and base saves
 * from the class's level-by-level progression table.
 *
 * @param classDef Class definition from System Content.
 * @param classLevel Class level achieved (>= 1).
 * @returns Populated `HitDieTrack` with explicit table BAB and saves.
 */
export function buildHitDieTrackFromClass(classDef: DnD35ClassDefinition, classLevel: number): HitDieTrack {
  const clamped = Math.max(1, Math.min(classDef.maxLevel, dndFloor(classLevel)));
  const row = getClassLevelRow(classDef, clamped) ?? classDef.progression[classDef.progression.length - 1]!;
  const trackCategory: 'pc' | 'npc' | 'prestige' = classDef.isPrestige
    ? 'prestige'
    : classDef.isNpcClass
      ? 'npc'
      : 'pc';
  return {
    trackId: classDef.id,
    levels: clamped,
    hitDieSides: classDef.hitDieSides,
    babCurve: 'half',
    fortCurve: 'poor',
    refCurve: 'poor',
    willCurve: 'poor',
    skillPointsPerLevel: classDef.skillPointsPerLevel,
    explicitBab: row.bab,
    explicitFort: row.fortSave,
    explicitRef: row.refSave,
    explicitWill: row.willSave,
    trackCategory
  };
}

/** Describes a spellcasting advancement choice slot required when taking a Prestige Class level. */
export interface PrestigeSpellcastingAdvancementSlot {
  readonly slotKey: 'arcane' | 'divine' | 'any';
  readonly label: string;
  readonly eligibleClassIds: ReadonlyArray<string>;
}

/**
 * Resolves the required base spellcasting class selection slots for a Prestige Class at `nextPrcLevel`.
 *
 * @param tracks Owned HitDieTracks on the actor prior to or including the level.
 * @param prcDef Prestige Class definition.
 * @param nextPrcLevel Target class level in the Prestige Class (1..maxLevel).
 * @param classRegistry Full class registry.
 * @returns Array of advancement slots requiring a target base class.
 */
export function getEligibleBaseCastingClassesForPrestige(
  tracks: ReadonlyArray<{ readonly trackId: string; readonly levels: number }>,
  prcDef: DnD35ClassDefinition,
  nextPrcLevel: number,
  classRegistry: Readonly<Record<string, DnD35ClassDefinition>>
): ReadonlyArray<PrestigeSpellcastingAdvancementSlot> {
  if (!prcDef.isPrestige) return [];
  const row = getClassLevelRow(prcDef, nextPrcLevel);
  const mode = row?.advancesSpellcasting;
  if (!mode) return [];

  const ownedBaseCasters = tracks
    .filter((t) => t.levels > 0)
    .map((t) => classRegistry[t.trackId])
    .filter(
      (c): c is DnD35ClassDefinition =>
        c !== undefined && !c.isPrestige && c.castingMode !== 'none' && c.castingTradition !== 'none'
    );

  if (mode === 'arcane') {
    return [
      {
        slotKey: 'arcane',
        label: 'Arcane Spellcasting Class (+1 Effective Level)',
        eligibleClassIds: ownedBaseCasters.filter((c) => c.castingTradition === 'arcane').map((c) => c.id)
      }
    ];
  }
  if (mode === 'divine') {
    return [
      {
        slotKey: 'divine',
        label: 'Divine Spellcasting Class (+1 Effective Level)',
        eligibleClassIds: ownedBaseCasters.filter((c) => c.castingTradition === 'divine').map((c) => c.id)
      }
    ];
  }
  if (mode === 'both') {
    return [
      {
        slotKey: 'arcane',
        label: 'Arcane Spellcasting Class (+1 Effective Level)',
        eligibleClassIds: ownedBaseCasters.filter((c) => c.castingTradition === 'arcane').map((c) => c.id)
      },
      {
        slotKey: 'divine',
        label: 'Divine Spellcasting Class (+1 Effective Level)',
        eligibleClassIds: ownedBaseCasters.filter((c) => c.castingTradition === 'divine').map((c) => c.id)
      }
    ];
  }
  return [
    {
      slotKey: 'any',
      label: 'Spellcasting Class (+1 Effective Level)',
      eligibleClassIds: ownedBaseCasters.map((c) => c.id)
    }
  ];
}

/**
 * Computes the effective class casting level for a base casting class across all tracks,
 * adding base class levels plus any levels in Prestige Classes that advance this class.
 *
 * @param tracks All active tracks on the actor.
 * @param baseClassDef The base casting class definition.
 * @param classRegistry The full class registry.
 * @param levelHistory Optional chronological level history with explicit Prestige target choices.
 * @returns Total effective caster level in this class's spell progression.
 */
export function computeEffectiveClassCastingLevel(
  tracks: ReadonlyArray<HitDieTrack>,
  baseClassDef: DnD35ClassDefinition,
  classRegistry: Readonly<Record<string, DnD35ClassDefinition>>,
  levelHistory?: ReadonlyArray<DnD35CharacterLevelRecord>
): number {
  if (baseClassDef.castingTradition === 'none' || baseClassDef.castingMode === 'none') {
    return 0;
  }
  let effectiveLevel = 0;
  for (const track of tracks) {
    if (track.trackId === baseClassDef.id) {
      effectiveLevel += track.levels;
      continue;
    }
    if (baseClassDef.isPrestige) continue;
    const prcDef = classRegistry[track.trackId];
    if (!prcDef || !prcDef.isPrestige) continue;
    for (let lvl = 1; lvl <= track.levels; lvl++) {
      const row = getClassLevelRow(prcDef, lvl);
      if (!row?.advancesSpellcasting) continue;

      const explicitRec = levelHistory?.find((rec) => rec.classId === prcDef.id && rec.classLevel === lvl);
      if (explicitRec?.advancedSpellcastingClassIds && explicitRec.advancedSpellcastingClassIds.length > 0) {
        if (explicitRec.advancedSpellcastingClassIds.includes(baseClassDef.id)) {
          effectiveLevel += 1;
        }
        continue;
      }

      const slots = getEligibleBaseCastingClassesForPrestige(tracks, prcDef, lvl, classRegistry);
      for (const slot of slots) {
        if (slot.eligibleClassIds[0] === baseClassDef.id) {
          effectiveLevel += 1;
        }
      }
    }
  }
  return effectiveLevel;
}
