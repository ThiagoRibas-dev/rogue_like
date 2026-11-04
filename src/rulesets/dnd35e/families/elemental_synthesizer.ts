import { scaleWeaponDamageDice } from '../equipment_physics.ts';
import type { DnD35Archetype, DnD35DragonFamiliesData, DnD35RaceDefinition } from '../types/dnd35e_system.types.ts';

/**
 * Synthesizes an Elemental `DnD35Archetype` directly from a unified `DnD35RaceDefinition` (`elemental_<element>`)
 * and one of its 6 `rhdProgression.tiers` (`small`, `medium`, `large`, `huge`, `greater`, `elder`).
 *
 * @param elementalRace Unified Elemental race definition (`elemental_air`, `elemental_earth`, etc.).
 * @param stepId Step tier ID (`small` through `elder`).
 * @returns Synthesized `DnD35Archetype`.
 */
export function synthesizeElementalFromRaceTier(elementalRace: DnD35RaceDefinition, stepId: string): DnD35Archetype {
  const tier = elementalRace.rhdProgression.tiers.find((t) => t.tierId === stepId);
  if (!tier) {
    throw new Error(`Unknown elemental step "${stepId}" on race "${elementalRace.id}".`);
  }

  const baseScores = elementalRace.defaultAbilityScores ?? {
    str: 10 + (elementalRace.abilityAdjustments.str ?? 0),
    dex: 10 + (elementalRace.abilityAdjustments.dex ?? 0),
    con: 10 + (elementalRace.abilityAdjustments.con ?? 0),
    int: 10 + (elementalRace.abilityAdjustments.int ?? 0),
    wis: 10 + (elementalRace.abilityAdjustments.wis ?? 0),
    cha: 10 + (elementalRace.abilityAdjustments.cha ?? 0)
  };

  const scaledScores = {
    str: (baseScores.str ?? 10) + tier.abilityAdjustmentsDelta.str,
    dex: Math.max(1, (baseScores.dex ?? 10) + tier.abilityAdjustmentsDelta.dex),
    con: (baseScores.con ?? 10) + tier.abilityAdjustmentsDelta.con,
    int: (baseScores.int ?? 4) + tier.abilityAdjustmentsDelta.int,
    wis: (baseScores.wis ?? 11) + tier.abilityAdjustmentsDelta.wis,
    cha: (baseScores.cha ?? 11) + tier.abilityAdjustmentsDelta.cha
  };

  const elementId = elementalRace.id.replace(/^elemental_/, '');
  const isHeavyElement = elementId === 'earth' || elementId === 'water';
  const fortCurve = elementalRace.rhdProgression.saveCurveOverrides?.fortCurve ?? (isHeavyElement ? 'good' : 'poor');
  const refCurve = elementalRace.rhdProgression.saveCurveOverrides?.refCurve ?? (isHeavyElement ? 'poor' : 'good');
  const willCurve = elementalRace.rhdProgression.saveCurveOverrides?.willCurve ?? 'poor';
  const slamWeapon = tier.unlockedNaturalWeapons[0] ?? elementalRace.naturalWeapons[0]!;

  return {
    archetypeId: `elemental_${elementId}_${stepId}`,
    sizeCategory: tier.sizeCategory,
    abilityScores: scaledScores,
    tracks: [
      {
        trackId: 'racial_elemental',
        levels: tier.hitDice,
        hitDieSides: 8,
        babCurve: 'three_quarters',
        fortCurve,
        refCurve,
        willCurve,
        skillPointsPerLevel: 2,
        trackCategory: 'racial_hd'
      }
    ],
    weaponDice: slamWeapon.damageDice,
    weaponDamageType: 'bludgeoning',
    weaponCritThreatMin: 20,
    weaponCritMultiplier: 2,
    weaponBypassTags: ['bludgeoning'],
    armorBonus: 0,
    shieldBonus: 0,
    naturalArmorBonus: (elementalRace.naturalArmorBonus ?? 3) + tier.naturalArmorBonusDelta,
    damageReduction: tier.damageReduction,
    energyResistance: elementalRace.energyResistances ?? {},
    immunities: elementalRace.immunities,
    vulnerabilities: elementalRace.vulnerabilities,
    feats: elementalRace.feats.length > 0 ? elementalRace.feats : ['dodge', 'improved_initiative'],
    skillRanks: { listen: tier.hitDice, spot: tier.hitDice },
    creatureType: 'elemental',
    subtypes: elementalRace.subtypes,
    levelAdjustment: 0,
    senses: elementalRace.senses ?? {
      lowLightVision: false,
      darkvisionRangeFt: 60,
      blindsenseRangeFt: 0,
      blindsightRangeFt: 0,
      tremorsenseRangeFt: elementId === 'earth' ? 60 : 0,
      scentRangeFt: 0
    },
    naturalWeapons: tier.unlockedNaturalWeapons.length > 0 ? tier.unlockedNaturalWeapons : elementalRace.naturalWeapons,
    hasPounce: false,
    singleActionsOnly: false,
    advancementRanges: [],
    cr: tier.cr
  };
}

/**
 * SRD 6-Step Elemental Progression Deltas from Small baseline (`small`, `medium`, `large`, `huge`, `greater`, `elder`).
 */
const ELEMENTAL_STEP_MODIFIERS: Readonly<
  Record<
    string,
    {
      readonly strDelta: number;
      readonly dexDelta: number;
      readonly conDelta: number;
      readonly naturalArmorDelta: number;
      readonly slamCount: number;
      readonly drAmount: number;
    }
  >
> = {
  small: { strDelta: 0, dexDelta: 0, conDelta: 0, naturalArmorDelta: 0, slamCount: 1, drAmount: 0 },
  medium: { strDelta: 2, dexDelta: 4, conDelta: 2, naturalArmorDelta: 1, slamCount: 1, drAmount: 0 },
  large: { strDelta: 6, dexDelta: 8, conDelta: 4, naturalArmorDelta: 2, slamCount: 2, drAmount: 5 },
  huge: { strDelta: 10, dexDelta: 12, conDelta: 6, naturalArmorDelta: 3, slamCount: 2, drAmount: 5 },
  greater: { strDelta: 12, dexDelta: 14, conDelta: 6, naturalArmorDelta: 5, slamCount: 2, drAmount: 10 },
  elder: { strDelta: 14, dexDelta: 16, conDelta: 6, naturalArmorDelta: 6, slamCount: 2, drAmount: 10 }
};

/**
 * Synthesizes an SRD Elemental Archetype from either a unified `races` registry (`Record<string, DnD35RaceDefinition>`)
 * or legacy `DnD35DragonFamiliesData`.
 *
 * @param familiesOrRaces Either `Record<string, DnD35RaceDefinition>`, `{ races: ... }`, or legacy `DnD35DragonFamiliesData`.
 * @param elementId Elemental type ('air' | 'earth' | 'fire' | 'water').
 * @param stepId Size/power step ('small' through 'elder').
 * @returns Synthesized `DnD35Archetype`.
 */
export function synthesizeElementalArchetype(
  familiesOrRaces: DnD35DragonFamiliesData | Record<string, unknown>,
  elementId: 'air' | 'earth' | 'fire' | 'water',
  stepId: string
): DnD35Archetype {
  const asRecord = familiesOrRaces as Record<string, unknown>;
  const racesMap =
    (asRecord['races'] as Record<string, DnD35RaceDefinition> | undefined) ??
    (asRecord[`elemental_${elementId}`] !== undefined ? (asRecord as Record<string, DnD35RaceDefinition>) : undefined);

  const elementalRace = racesMap?.[`elemental_${elementId}`];
  if (elementalRace && elementalRace.rhdProgression?.tiers?.length > 0) {
    return synthesizeElementalFromRaceTier(elementalRace, stepId);
  }

  const familiesData = familiesOrRaces as DnD35DragonFamiliesData;
  const step = familiesData.elementalSteps?.[stepId];
  if (!step) {
    throw new Error(`Unknown elemental step: ${stepId}`);
  }

  const baseStats: Record<
    string,
    { str: number; dex: number; con: number; int: number; wis: number; cha: number; baseNatArmor: number }
  > = {
    air: { str: 10, dex: 17, con: 10, int: 4, wis: 11, cha: 11, baseNatArmor: 3 },
    earth: { str: 17, dex: 8, con: 13, int: 4, wis: 11, cha: 11, baseNatArmor: 7 },
    fire: { str: 10, dex: 13, con: 10, int: 4, wis: 11, cha: 11, baseNatArmor: 3 },
    water: { str: 14, dex: 10, con: 13, int: 4, wis: 11, cha: 11, baseNatArmor: 6 }
  };

  const stat = baseStats[elementId] ?? { str: 10, dex: 10, con: 10, int: 4, wis: 11, cha: 11, baseNatArmor: 3 };
  const stepMod = ELEMENTAL_STEP_MODIFIERS[stepId] ?? ELEMENTAL_STEP_MODIFIERS['small']!;

  const isHeavyElement = elementId === 'earth' || elementId === 'water';
  const scaledScores = {
    str: stat.str + (isHeavyElement ? stepMod.dexDelta : stepMod.strDelta),
    dex: Math.max(1, stat.dex + (isHeavyElement ? 0 : stepMod.dexDelta)),
    con: stat.con + stepMod.conDelta,
    int: step.hitDice >= 16 ? 8 : step.hitDice >= 8 ? 6 : stat.int,
    wis: stat.wis,
    cha: stat.cha
  };

  const slamDice = scaleWeaponDamageDice('1d6', 'small', step.sizeCategory);
  const fortCurve = isHeavyElement ? 'good' : 'poor';
  const refCurve = isHeavyElement ? 'poor' : 'good';

  return {
    archetypeId: `elemental_${elementId}_${stepId}`,
    sizeCategory: step.sizeCategory,
    abilityScores: scaledScores,
    tracks: [
      {
        trackId: 'racial_elemental',
        levels: step.hitDice,
        hitDieSides: 8,
        babCurve: 'three_quarters',
        fortCurve,
        refCurve,
        willCurve: 'poor',
        skillPointsPerLevel: 2,
        trackCategory: 'racial_hd'
      }
    ],
    weaponDice: slamDice,
    weaponDamageType: 'bludgeoning',
    weaponCritThreatMin: 20,
    weaponCritMultiplier: 2,
    weaponBypassTags: ['bludgeoning'],
    armorBonus: 0,
    shieldBonus: 0,
    naturalArmorBonus: stat.baseNatArmor + stepMod.naturalArmorDelta,
    damageReduction: stepMod.drAmount > 0 ? { amount: stepMod.drAmount, bypassTags: ['-'] } : undefined,
    energyResistance: elementId === 'fire' ? { fire: 100 } : {},
    immunities: ['poison', 'sleep', 'paralysis', 'stunning', 'critical_hits', 'flanking'],
    vulnerabilities: elementId === 'fire' ? ['cold'] : [],
    feats: ['dodge', 'improved_initiative'],
    skillRanks: { listen: step.hitDice, spot: step.hitDice },
    creatureType: 'elemental',
    subtypes: ['extraplanar', elementId],
    levelAdjustment: 0,
    senses: {
      lowLightVision: false,
      darkvisionRangeFt: 60,
      blindsenseRangeFt: 0,
      blindsightRangeFt: 0,
      tremorsenseRangeFt: elementId === 'earth' ? 60 : 0,
      scentRangeFt: 0
    },
    naturalWeapons: [
      {
        id: 'slam',
        name: 'Slam',
        naturalType: 'slam',
        isPrimary: true,
        count: stepMod.slamCount,
        damageDice: slamDice,
        damageType: 'bludgeoning',
        critThreatMin: 20,
        critMultiplier: 2
      }
    ],
    hasPounce: false,
    singleActionsOnly: false,
    advancementRanges: [],
    cr: step.cr
  };
}
