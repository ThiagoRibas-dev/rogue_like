import { evaluateEffectBundle } from './srd_registry.ts';
import type { DnD35EntityData, HitDieTrack, StatModifier } from './types/dnd35e.types.ts';
import type { DnD35CreatureTypeEngine, DnD35RaceDefinition } from './types/dnd35e_system.types.ts';

/**
 * Result of applying an SRD 3.5e Race Definition to an actor's chassis.
 */
export interface AppliedRaceResult {
  readonly entityData: DnD35EntityData;
  readonly statModifiers: ReadonlyArray<StatModifier>;
  readonly ecl: number;
}

/** Minimum intelligence score for sentient playable characters (`3`). */
const MIN_SENTIENT_INT = 3;

/**
 * Applies an SRD 3.5e Race Definition to a base actor entity data record,
 * returning updated ability scores, size, speed, senses, SR, racial HD tracks,
 * `traitBundles`, and tag-conditional `StatModifier[]` (e.g., Dwarf +4 dodge AC vs Giants, +1 attack vs Orcs).
 *
 * @param base Base entity data chassis.
 * @param race SRD Race definition.
 * @param creatureTypeEngine Optional Creature Type RHD engine definition (`creatureTypes[race.creatureType]`).
 * @returns AppliedRaceResult with updated DnD35EntityData, StatModifiers, and ECL.
 */
export function applyRaceToActorChassis(
  base: DnD35EntityData,
  race: DnD35RaceDefinition,
  creatureTypeEngine?: DnD35CreatureTypeEngine
): AppliedRaceResult {
  const nextScores: Record<
    string,
    { base: number | null; inherentBonus: number; damage: number; drain: number; tempPenalty: number }
  > = {};
  const stats = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;

  for (const s of stats) {
    const current = base.abilityScores[s];
    const rawAdj = race.abilityAdjustments[s];
    if (
      rawAdj === null ||
      (s === 'con' && creatureTypeEngine?.hasConstitutionScore === false) ||
      (s === 'int' && creatureTypeEngine?.hasIntelligenceScore === false)
    ) {
      nextScores[s] = {
        base: null,
        inherentBonus: 0,
        damage: 0,
        drain: 0,
        tempPenalty: 0
      };
      continue;
    }

    const adjustment = rawAdj ?? 0;
    if (current.base === null) {
      nextScores[s] = { ...current };
    } else {
      let finalBase = current.base + adjustment;
      if (s === 'int') {
        finalBase = Math.max(MIN_SENTIENT_INT, finalBase);
      } else {
        finalBase = Math.max(1, finalBase);
      }
      nextScores[s] = {
        ...current,
        base: finalBase
      };
    }
  }

  // Racial Hit Dice tracks (e.g. Bugbear 3d8 Humanoid, Ogre 4d8 Giant)
  let nextTracks: ReadonlyArray<HitDieTrack> = base.tracks;
  const rhdCount = race.rhdProgression?.baseHdCount ?? race.racialHitDice?.count ?? 0;
  let racialHdCount = 0;

  if (rhdCount > 0) {
    racialHdCount = rhdCount;
    const hitDieSides = race.racialHitDice?.hitDieSides ?? creatureTypeEngine?.hitDieSides ?? 8;
    const babCurve = race.racialHitDice?.babCurve ?? creatureTypeEngine?.babCurve ?? 'three_quarters';
    const fortCurve =
      race.rhdProgression?.saveCurveOverrides?.fortCurve ??
      race.racialHitDice?.fortCurve ??
      creatureTypeEngine?.fortCurve ??
      'good';
    const refCurve =
      race.rhdProgression?.saveCurveOverrides?.refCurve ??
      race.racialHitDice?.refCurve ??
      creatureTypeEngine?.refCurve ??
      'poor';
    const willCurve =
      race.rhdProgression?.saveCurveOverrides?.willCurve ??
      race.racialHitDice?.willCurve ??
      creatureTypeEngine?.willCurve ??
      'poor';
    const skillPointsPerLevel = race.racialHitDice?.skillPointsPerLevel ?? creatureTypeEngine?.skillPointsPerLevel ?? 2;

    const racialTrack: HitDieTrack = {
      trackId: `racial_${race.id}`,
      levels: rhdCount,
      hitDieSides,
      babCurve,
      fortCurve,
      refCurve,
      willCurve,
      skillPointsPerLevel,
      trackCategory: 'racial_hd'
    };
    nextTracks = [
      racialTrack,
      ...base.tracks.filter((t) => !t.trackId.startsWith('racial_') && t.trackCategory !== 'racial_hd')
    ];
  }

  const classHdCount = base.tracks
    .filter((t) => !t.trackId.startsWith('racial_') && t.trackCategory !== 'racial_hd')
    .reduce((sum, t) => sum + t.levels, 0);
  const totalHd = Math.max(1, racialHdCount + classHdCount);

  // Spell Resistance Formula: base + perHitDie * totalHd (e.g. Drow / Svirfneblin 11 + HD)
  let spellResistance = base.spellResistance ?? race.spellResistance;
  if (race.spellResistanceFormula) {
    const computedSr = race.spellResistanceFormula.base + race.spellResistanceFormula.perHitDie * totalHd;
    spellResistance = Math.max(spellResistance ?? 0, computedSr);
  }

  // Sensory Profile
  const darkvisionRangeFt = Math.max(
    base.senses?.darkvisionRangeFt ?? 0,
    race.senses?.darkvisionRangeFt ?? 0,
    race.darkvisionFt ?? 0
  );
  const lowLightVision =
    (base.senses?.lowLightVision ?? false) || (race.senses?.lowLightVision ?? false) || (race.lowLightVision ?? false);
  const senses = {
    lowLightVision,
    darkvisionRangeFt,
    blindsenseRangeFt: Math.max(base.senses?.blindsenseRangeFt ?? 0, race.senses?.blindsenseRangeFt ?? 0),
    blindsightRangeFt: Math.max(base.senses?.blindsightRangeFt ?? 0, race.senses?.blindsightRangeFt ?? 0),
    tremorsenseRangeFt: Math.max(base.senses?.tremorsenseRangeFt ?? 0, race.senses?.tremorsenseRangeFt ?? 0),
    scentRangeFt: Math.max(base.senses?.scentRangeFt ?? 0, race.senses?.scentRangeFt ?? 0)
  };

  // Movement Modes
  const movementModes = {
    ...base.movementModes,
    ...(race.movementModes ?? {}),
    land: race.movementModes?.land ?? race.baseLandSpeedFt
  };

  // Natural Armor
  const naturalArmorBonus = Math.max(base.naturalArmorBonus, race.naturalArmorBonus ?? 0);

  // Energy Resistances
  const energyResistance: Record<string, number> = { ...base.energyResistance };
  if (race.energyResistances) {
    for (const [key, val] of Object.entries(race.energyResistances)) {
      energyResistance[key] = Math.max(energyResistance[key] ?? 0, val);
    }
  }

  // Subtypes & Trait Bundles
  const extraTraits = race.unencumberedSpeedInHeavyArmor ? ['trait:unencumbered_speed'] : [];
  const statModifiers: StatModifier[] = [...(base.statModifiers ?? [])];
  const raceRootPath = `race:${race.id}`;
  const suppressedBundles = base.suppressedBundleIds ?? [];

  for (const bundle of race.traitBundles ?? []) {
    const evalRes = evaluateEffectBundle(bundle, raceRootPath, suppressedBundles);
    if (!evalRes.isActive) continue;
    statModifiers.push(...evalRes.statModifiers);
    extraTraits.push(...evalRes.grantedTags);
  }

  const subtypes = Array.from(new Set([...(base.subtypes ?? []), ...race.subtypes, ...extraTraits]));

  for (const cm of race.conditionalModifiers ?? []) {
    statModifiers.push({
      targetStat: cm.target,
      value: cm.value,
      bonusType: cm.type,
      sourceId: `race:${race.id}:${cm.id}`,
      sourcePath: `${raceRootPath}/trait:${cm.id}`,
      origin: 'ex',
      condition: cm.condition
    });
  }

  if (race.saveBonuses) {
    if (race.saveBonuses.fort !== undefined) {
      statModifiers.push({
        targetStat: 'save_fort',
        value: race.saveBonuses.fort,
        bonusType: 'racial',
        sourceId: `race:${race.id}:save_fort`,
        sourcePath: `${raceRootPath}/save:fort`,
        origin: 'ex'
      });
    }
    if (race.saveBonuses.ref !== undefined) {
      statModifiers.push({
        targetStat: 'save_ref',
        value: race.saveBonuses.ref,
        bonusType: 'racial',
        sourceId: `race:${race.id}:save_ref`,
        sourcePath: `${raceRootPath}/save:ref`,
        origin: 'ex'
      });
    }
    if (race.saveBonuses.will !== undefined) {
      statModifiers.push({
        targetStat: 'save_will',
        value: race.saveBonuses.will,
        bonusType: 'racial',
        sourceId: `race:${race.id}:save_will`,
        sourcePath: `${raceRootPath}/save:will`,
        origin: 'ex'
      });
    }
  }

  const ecl = totalHd + (race.levelAdjustment ?? 0);

  const updatedEntityData: DnD35EntityData = {
    ...base,
    creatureType: race.creatureType,
    subtypes,
    sizeCategory: race.size,
    abilityScores: nextScores as unknown as DnD35EntityData['abilityScores'],
    tracks: nextTracks,
    naturalArmorBonus,
    energyResistance,
    ...(spellResistance !== undefined ? { spellResistance } : {}),
    senses,
    movementModes,
    levelAdjustment: race.levelAdjustment,
    statModifiers
  };

  return {
    entityData: updatedEntityData,
    statModifiers,
    ecl
  };
}
