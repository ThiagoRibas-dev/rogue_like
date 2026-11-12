import { synthesizeDragonFromRaceTier, synthesizeElementalFromRaceTier } from '../family_synthesizer.ts';
import { computeNpcClassCrContribution } from '../progression.ts';
import type {
  DnD35Archetype,
  DnD35ClassDefinition,
  DnD35CreatureTypeEngine,
  DnD35ProgressionTrack,
  DnD35RaceDefinition
} from '../types/dnd35e_system.types.ts';

/**
 * Hydrates a `DnD35Archetype` from a unified `DnD35RaceDefinition` (`races/<id>.json`),
 * deriving its RHD progression track from `creatureTypes[race.creatureType]` + `race.rhdProgression`
 * or applying the 1-HD Humanoid replacement rule (`baseHdCount === 0` defaults to `defaultClassLevels` or `warrior 1`).
 *
 * @param systemContent Loaded D&D 3.5e system content dictionary.
 * @param raceDef Unified race definition.
 * @param options Optional tier ID (`wyrmling`, `adult`, `elder`) or class level overrides.
 * @returns Hydrated `DnD35Archetype`.
 */
export function hydrateRaceAsArchetype(
  systemContent: Record<string, unknown> | undefined,
  raceDef: DnD35RaceDefinition,
  options?: {
    readonly tierId?: string | undefined;
    readonly classLevels?: ReadonlyArray<{ readonly classId: string; readonly levels: number }> | undefined;
  }
): DnD35Archetype {
  if (options?.tierId) {
    if (raceDef.id.startsWith('dragon_')) {
      return synthesizeDragonFromRaceTier(raceDef, options.tierId);
    }
    if (raceDef.id.startsWith('elemental_')) {
      return synthesizeElementalFromRaceTier(raceDef, options.tierId);
    }
  }

  const creatureTypes = systemContent?.['creatureTypes'] as Record<string, DnD35CreatureTypeEngine> | undefined;
  const classes = systemContent?.['classes'] as Record<string, DnD35ClassDefinition> | undefined;
  const ctEngine = creatureTypes?.[raceDef.creatureType];

  const baseHdCount = raceDef.rhdProgression?.baseHdCount ?? raceDef.racialHitDice?.count ?? 0;
  const tracks: DnD35ProgressionTrack[] = [];

  if (baseHdCount > 0) {
    let fortCurve =
      raceDef.rhdProgression?.saveCurveOverrides?.fortCurve ??
      raceDef.racialHitDice?.fortCurve ??
      ctEngine?.fortCurve ??
      'good';
    let refCurve =
      raceDef.rhdProgression?.saveCurveOverrides?.refCurve ??
      raceDef.racialHitDice?.refCurve ??
      ctEngine?.refCurve ??
      'poor';
    let willCurve =
      raceDef.rhdProgression?.saveCurveOverrides?.willCurve ??
      raceDef.racialHitDice?.willCurve ??
      ctEngine?.willCurve ??
      'poor';

    if (ctEngine?.goodSaveBySubtype) {
      for (const sub of raceDef.subtypes) {
        const subSaves = ctEngine.goodSaveBySubtype[sub];
        if (subSaves) {
          fortCurve = subSaves.fortCurve;
          refCurve = subSaves.refCurve;
          willCurve = subSaves.willCurve;
          break;
        }
      }
    }

    tracks.push({
      trackId: raceDef.creatureType,
      levels: baseHdCount,
      hitDieSides: raceDef.racialHitDice?.hitDieSides ?? ctEngine?.hitDieSides ?? 8,
      babCurve: raceDef.racialHitDice?.babCurve ?? ctEngine?.babCurve ?? 'three_quarters',
      fortCurve,
      refCurve,
      willCurve,
      skillPointsPerLevel: raceDef.racialHitDice?.skillPointsPerLevel ?? ctEngine?.skillPointsPerLevel ?? 2,
      trackCategory: 'racial_hd'
    });
  }

  const requestedClassLevels =
    options?.classLevels ??
    (raceDef.defaultClassLevels && raceDef.defaultClassLevels.length > 0
      ? raceDef.defaultClassLevels
      : baseHdCount === 0
        ? [{ classId: 'warrior', levels: 1 }]
        : []);

  for (const cl of requestedClassLevels) {
    const clsDef = classes?.[cl.classId];
    const row1 = clsDef?.progression?.[0];
    const row4 = clsDef?.progression?.[3];
    const babCurve: 'full' | 'three_quarters' | 'half' =
      row1?.bab === 1
        ? 'full'
        : row4?.bab === 3
          ? 'three_quarters'
          : cl.classId === 'warrior'
            ? 'full'
            : 'three_quarters';
    const fortCurve: 'good' | 'poor' = row1?.fortSave === 2 ? 'good' : cl.classId === 'warrior' ? 'good' : 'poor';
    const refCurve: 'good' | 'poor' = row1?.refSave === 2 ? 'good' : 'poor';
    const willCurve: 'good' | 'poor' = row1?.willSave === 2 ? 'good' : 'poor';

    tracks.push({
      trackId: cl.classId,
      levels: cl.levels,
      hitDieSides: clsDef?.hitDieSides ?? 8,
      babCurve,
      fortCurve,
      refCurve,
      willCurve,
      skillPointsPerLevel: clsDef?.skillPointsPerLevel ?? 2,
      trackCategory: clsDef?.isPrestige ? 'prestige' : clsDef?.isNpcClass || cl.classId === 'warrior' ? 'npc' : 'pc'
    });
  }

  const defaultScores = raceDef.defaultAbilityScores ?? {
    str: raceDef.abilityAdjustments.str === null ? null : 10 + (raceDef.abilityAdjustments.str ?? 0),
    dex: raceDef.abilityAdjustments.dex === null ? null : 10 + (raceDef.abilityAdjustments.dex ?? 0),
    con:
      ctEngine?.hasConstitutionScore === false || raceDef.abilityAdjustments.con === null
        ? null
        : 10 + (raceDef.abilityAdjustments.con ?? 0),
    int:
      ctEngine?.hasIntelligenceScore === false || raceDef.abilityAdjustments.int === null
        ? null
        : 10 + (raceDef.abilityAdjustments.int ?? 0),
    wis: raceDef.abilityAdjustments.wis === null ? null : 10 + (raceDef.abilityAdjustments.wis ?? 0),
    cha: raceDef.abilityAdjustments.cha === null ? null : 10 + (raceDef.abilityAdjustments.cha ?? 0)
  };

  const primaryNatural = raceDef.naturalWeapons[0];
  const weaponDice = raceDef.weaponDice ?? primaryNatural?.damageDice ?? '1d6';
  const weaponDamageType = raceDef.weaponDamageType ?? primaryNatural?.damageType ?? 'slashing';
  const weaponCritThreatMin = raceDef.weaponCritThreatMin ?? primaryNatural?.critThreatMin ?? 20;
  const weaponCritMultiplier = raceDef.weaponCritMultiplier ?? primaryNatural?.critMultiplier ?? 2;
  const weaponBypassTags = raceDef.weaponBypassTags ?? [weaponDamageType];

  const totalHd = Math.max(
    1,
    tracks.reduce((sum, t) => sum + t.levels, 0)
  );
  let spellResistance = raceDef.spellResistance;
  if (raceDef.spellResistanceFormula) {
    const computedSr = raceDef.spellResistanceFormula.base + raceDef.spellResistanceFormula.perHitDie * totalHd;
    spellResistance = Math.max(spellResistance ?? 0, computedSr);
  }

  const totalNpcLevels = tracks.filter((t) => t.trackCategory === 'npc').reduce((s, t) => s + t.levels, 0);
  const computedCr =
    raceDef.cr ?? (baseHdCount === 0 && totalNpcLevels > 0 ? computeNpcClassCrContribution(totalNpcLevels, false) : 1);

  return {
    archetypeId: raceDef.id,
    sizeCategory: raceDef.size,
    abilityScores: defaultScores,
    tracks,
    weaponDice,
    weaponDamageType,
    weaponCritThreatMin,
    weaponCritMultiplier,
    weaponBypassTags,
    armorBonus: raceDef.armorBonus ?? 0,
    shieldBonus: raceDef.shieldBonus ?? 0,
    naturalArmorBonus: raceDef.naturalArmorBonus ?? 0,
    ...(raceDef.damageReduction !== undefined ? { damageReduction: raceDef.damageReduction } : {}),
    energyResistance: raceDef.energyResistances ?? {},
    immunities: raceDef.immunities ?? [],
    vulnerabilities: raceDef.vulnerabilities ?? [],
    ...(spellResistance !== undefined ? { spellResistance } : {}),
    feats: raceDef.feats ?? [],
    skillRanks: raceDef.skillRanks ?? {},
    creatureType: raceDef.creatureType,
    subtypes: raceDef.subtypes ?? [],
    levelAdjustment: raceDef.levelAdjustment ?? 0,
    ...(raceDef.senses !== undefined
      ? { senses: raceDef.senses }
      : raceDef.darkvisionFt !== undefined || raceDef.lowLightVision !== undefined
        ? {
            senses: {
              lowLightVision: raceDef.lowLightVision ?? false,
              darkvisionRangeFt: raceDef.darkvisionFt ?? 0,
              blindsenseRangeFt: 0,
              blindsightRangeFt: 0,
              tremorsenseRangeFt: 0,
              scentRangeFt: 0
            }
          }
        : {}),
    movementModes: raceDef.movementModes ?? { land: raceDef.baseLandSpeedFt },
    anatomyBodyPlan: raceDef.anatomyBodyPlan ?? 'humanoid_biped',
    naturalWeapons: raceDef.naturalWeapons ?? [],
    defaultEquipment: raceDef.defaultEquipment ?? [],
    hasPounce: raceDef.hasPounce ?? false,
    singleActionsOnly: raceDef.singleActionsOnly ?? false,
    advancementRanges: raceDef.rhdProgression?.advancementRanges ?? [],
    ...(raceDef.magicImmunityExceptions !== undefined
      ? { magicImmunityExceptions: raceDef.magicImmunityExceptions }
      : {}),
    cr: computedCr
  };
}
