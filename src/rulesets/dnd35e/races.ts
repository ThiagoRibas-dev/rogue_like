import type { StatModifier } from './types/dnd35e.types.ts';
import type { DnD35EntityData, HitDieTrack } from './types/dnd35e.types.ts';
import type { DnD35RaceDefinition } from './types/dnd35e_system.types.ts';

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
 * and tag-conditional `StatModifier[]` (e.g., Dwarf +4 dodge AC vs Giants, +1 attack vs Orcs).
 *
 * @param base Base entity data chassis.
 * @param race SRD Race definition.
 * @returns AppliedRaceResult with updated DnD35EntityData, StatModifiers, and ECL.
 */
export function applyRaceToActorChassis(
  base: DnD35EntityData,
  race: DnD35RaceDefinition
): AppliedRaceResult {
  const nextScores: Record<string, { base: number | null; inherentBonus: number; damage: number; drain: number; tempPenalty: number }> = {};
  const stats = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;

  for (const s of stats) {
    const current = base.abilityScores[s];
    const adjustment = race.abilityAdjustments[s] ?? 0;
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

  // Racial Hit Dice tracks (e.g. Bugbear 3d8 Humanoid)
  let nextTracks: ReadonlyArray<HitDieTrack> = base.tracks;
  let racialHdCount = 0;
  if (race.racialHitDice) {
    racialHdCount = race.racialHitDice.count;
    const racialTrack: HitDieTrack = {
      trackId: `racial_${race.id}`,
      levels: race.racialHitDice.count,
      hitDieSides: race.racialHitDice.hitDieSides,
      babCurve: race.racialHitDice.babCurve,
      fortCurve: race.racialHitDice.fortCurve,
      refCurve: race.racialHitDice.refCurve,
      willCurve: race.racialHitDice.willCurve,
      skillPointsPerLevel: race.racialHitDice.skillPointsPerLevel
    };
    nextTracks = [racialTrack, ...base.tracks.filter((t) => !t.trackId.startsWith('racial_'))];
  }

  const classHdCount = base.tracks
    .filter((t) => !t.trackId.startsWith('racial_'))
    .reduce((sum, t) => sum + t.levels, 0);
  const totalHd = Math.max(1, racialHdCount + classHdCount);

  // Spell Resistance Formula: base + perHitDie * totalHd (e.g. Drow / Svirfneblin 11 + HD)
  let spellResistance = base.spellResistance;
  if (race.spellResistanceFormula) {
    const computedSr = race.spellResistanceFormula.base + race.spellResistanceFormula.perHitDie * totalHd;
    spellResistance = Math.max(spellResistance ?? 0, computedSr);
  }

  // Sensory Profile
  const darkvisionRangeFt = Math.max(
    base.senses?.darkvisionRangeFt ?? 0,
    race.darkvisionFt ?? 0
  );
  const lowLightVision = (base.senses?.lowLightVision ?? false) || (race.lowLightVision ?? false);
  const senses = {
    lowLightVision,
    darkvisionRangeFt,
    blindsenseRangeFt: base.senses?.blindsenseRangeFt ?? 0,
    blindsightRangeFt: base.senses?.blindsightRangeFt ?? 0,
    tremorsenseRangeFt: base.senses?.tremorsenseRangeFt ?? 0,
    scentRangeFt: base.senses?.scentRangeFt ?? 0
  };

  // Movement Modes
  const movementModes = {
    ...base.movementModes,
    land: race.baseLandSpeedFt
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

  // Subtypes (including unencumbered_speed trait tag when applicable)
  const extraTraits = race.unencumberedSpeedInHeavyArmor ? ['trait:unencumbered_speed'] : [];
  const subtypes = Array.from(new Set([...(base.subtypes ?? []), ...race.subtypes, ...extraTraits]));

  // Stat Modifiers (preserving existing modifiers on base and appending race provider modifiers)
  const statModifiers: StatModifier[] = [...(base.statModifiers ?? [])];
  const raceRootPath = `race:${race.id}`;

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
