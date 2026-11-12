import { scaleWeaponDamageDice } from '../equipment/weapon_scaling.ts';
import { SIZE_METRICS } from '../spatial/grid_geometry.ts';
import type { CreatureSizeCategory } from '../types/dnd35e.types.ts';
import type {
  DnD35Archetype,
  DnD35DamageType,
  DnD35RaceDefinition,
  NaturalWeaponDescriptor
} from '../types/dnd35e_system.types.ts';

/**
 * Synthesizes a True Dragon `DnD35Archetype` directly from a unified `DnD35RaceDefinition` (`dragon_<variety>`)
 * and one of its 12 `rhdProgression.tiers` (`wyrmling`..`great_wyrm`), unlocking the tier's
 * creature-specific `unlockedNaturalWeapons`.
 *
 * @param dragonRace Unified Dragon race definition (`dragon_red`, `dragon_gold`, etc.).
 * @param ageCategoryId Age category tier ID (`wyrmling` through `great_wyrm`).
 * @returns Synthesized `DnD35Archetype`.
 */
export function synthesizeDragonFromRaceTier(dragonRace: DnD35RaceDefinition, ageCategoryId: string): DnD35Archetype {
  const tier = dragonRace.rhdProgression.tiers.find((t) => t.tierId === ageCategoryId);
  if (!tier) {
    throw new Error(`Unknown dragon age category "${ageCategoryId}" on race "${dragonRace.id}".`);
  }

  const targetSize: CreatureSizeCategory = tier.sizeCategory;
  const sizeRank = SIZE_METRICS[targetSize].rankIndex;
  const totalHd = tier.hitDice;

  const baseScores = dragonRace.defaultAbilityScores ?? {
    str: 10 + (dragonRace.abilityAdjustments.str ?? 0),
    dex: 10 + (dragonRace.abilityAdjustments.dex ?? 0),
    con: 10 + (dragonRace.abilityAdjustments.con ?? 0),
    int: 10 + (dragonRace.abilityAdjustments.int ?? 0),
    wis: 10 + (dragonRace.abilityAdjustments.wis ?? 0),
    cha: 10 + (dragonRace.abilityAdjustments.cha ?? 0)
  };

  const abilityScores = {
    str: (baseScores.str ?? 10) + tier.abilityAdjustmentsDelta.str,
    dex: Math.max(1, (baseScores.dex ?? 10) + tier.abilityAdjustmentsDelta.dex),
    con: (baseScores.con ?? 10) + tier.abilityAdjustmentsDelta.con,
    int: (baseScores.int ?? 10) + tier.abilityAdjustmentsDelta.int,
    wis: (baseScores.wis ?? 10) + tier.abilityAdjustmentsDelta.wis,
    cha: (baseScores.cha ?? 10) + tier.abilityAdjustmentsDelta.cha
  };

  const naturalArmor = (dragonRace.naturalArmorBonus ?? 0) + tier.naturalArmorBonusDelta;
  const biteDice = scaleWeaponDamageDice('1d8', 'medium', targetSize);
  const clawDice = scaleWeaponDamageDice('1d6', 'medium', targetSize);

  const scaledBaseWeapons: NaturalWeaponDescriptor[] = [
    {
      id: 'bite',
      name: 'Bite',
      naturalType: 'bite',
      isPrimary: true,
      count: 1,
      damageDice: biteDice,
      damageType: 'piercing' as DnD35DamageType,
      critThreatMin: 20,
      critMultiplier: 2
    },
    {
      id: 'claw',
      name: 'Claw',
      naturalType: 'claw',
      isPrimary: false,
      count: 2,
      damageDice: clawDice,
      damageType: 'slashing' as DnD35DamageType,
      critThreatMin: 20,
      critMultiplier: 2
    }
  ];

  const naturalWeapons: NaturalWeaponDescriptor[] = [...scaledBaseWeapons, ...tier.unlockedNaturalWeapons];
  const varietyShortId = dragonRace.id.replace(/^dragon_/, '');

  return {
    archetypeId: `dragon_${varietyShortId}_${ageCategoryId}`,
    sizeCategory: targetSize,
    abilityScores,
    tracks: [
      {
        trackId: 'racial_dragon',
        levels: totalHd,
        hitDieSides: 12,
        babCurve: 'full',
        fortCurve: 'good',
        refCurve: 'good',
        willCurve: 'good',
        skillPointsPerLevel: 6,
        trackCategory: 'racial_hd'
      }
    ],
    weaponDice: biteDice,
    weaponDamageType: 'piercing',
    weaponCritThreatMin: 20,
    weaponCritMultiplier: 2,
    weaponBypassTags: ['magic'],
    armorBonus: 0,
    shieldBonus: 0,
    naturalArmorBonus: naturalArmor,
    damageReduction: tier.damageReduction,
    energyResistance: dragonRace.energyResistances ?? {},
    immunities: dragonRace.immunities,
    vulnerabilities: dragonRace.vulnerabilities,
    spellResistance: tier.spellResistance,
    feats: dragonRace.feats.length > 0 ? dragonRace.feats : ['hover', 'flyby_attack', 'power_attack', 'cleave'],
    skillRanks: { search: totalHd, spot: totalHd, listen: totalHd },
    creatureType: 'dragon',
    subtypes: dragonRace.subtypes,
    levelAdjustment: 0,
    senses: dragonRace.senses ?? {
      lowLightVision: true,
      darkvisionRangeFt: 120,
      blindsenseRangeFt: 60,
      blindsightRangeFt: 0,
      tremorsenseRangeFt: 0,
      scentRangeFt: 0
    },
    movementModes: {
      land: dragonRace.movementModes?.land ?? 40,
      fly: dragonRace.movementModes?.fly ?? 150,
      maneuverability: sizeRank >= SIZE_METRICS.gargantuan.rankIndex ? 'clumsy' : 'poor'
    },
    naturalWeapons,
    hasPounce: false,
    singleActionsOnly: false,
    advancementRanges: [],
    defaultEquipment: dragonRace.defaultEquipment ?? [],
    cr: tier.cr
  };
}

/**
 * Synthesizes a canonical SRD True Dragon Archetype from a unified `races` registry (`Record<string, DnD35RaceDefinition>`)
 * or system content dictionary.
 *
 * @param familiesOrRaces Either `Record<string, DnD35RaceDefinition>` or `{ races: ... }`.
 * @param varietyId Dragon variety ID ('red', 'black', 'blue', 'green', 'white', 'gold', 'silver', 'brass', 'bronze', 'copper').
 * @param ageCategoryId Age category ID ('wyrmling' through 'great_wyrm').
 * @returns Synthesized DnD35Archetype.
 */
export function synthesizeTrueDragonArchetype(
  familiesOrRaces: Record<string, unknown>,
  varietyId: string,
  ageCategoryId: string
): DnD35Archetype {
  const asRecord = familiesOrRaces as Record<string, unknown>;
  const racesMap =
    (asRecord['races'] as Record<string, DnD35RaceDefinition> | undefined) ??
    (asRecord[`dragon_${varietyId}`] !== undefined ? (asRecord as Record<string, DnD35RaceDefinition>) : undefined);

  const dragonRace = racesMap?.[`dragon_${varietyId}`];
  if (dragonRace && dragonRace.rhdProgression?.tiers?.length > 0) {
    return synthesizeDragonFromRaceTier(dragonRace, ageCategoryId);
  }
  throw new Error(`Dragon race "dragon_${varietyId}" not found or lacks progression tiers.`);
}
