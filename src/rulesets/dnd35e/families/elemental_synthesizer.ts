import type { DnD35Archetype, DnD35RaceDefinition } from '../types/dnd35e_system.types.ts';

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
    defaultEquipment: elementalRace.defaultEquipment ?? [],
    cr: tier.cr
  };
}

/**
 * Synthesizes an SRD Elemental Archetype from a unified `races` registry (`Record<string, DnD35RaceDefinition>`)
 * or system content dictionary.
 *
 * @param familiesOrRaces Either `Record<string, DnD35RaceDefinition>` or `{ races: ... }`.
 * @param elementId Elemental type ('air' | 'earth' | 'fire' | 'water').
 * @param stepId Size/power step ('small' through 'elder').
 * @returns Synthesized `DnD35Archetype`.
 */
export function synthesizeElementalArchetype(
  familiesOrRaces: Record<string, unknown>,
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
  throw new Error(`Elemental race "elemental_${elementId}" not found or lacks progression tiers.`);
}
