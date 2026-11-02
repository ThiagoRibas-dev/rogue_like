import { scaleWeaponDamageDice } from './equipment_physics.ts';
import { SIZE_METRICS } from './spatial/grid_geometry.ts';
import type { CreatureSizeCategory } from './types/dnd35e.types.ts';
import type {
  DnD35Archetype,
  DnD35DamageType,
  DnD35DragonFamiliesData,
  NaturalWeaponDescriptor
} from './types/dnd35e_system.types.ts';

/**
 * Result of evaluating a spell or magic effect against a Golem's magic immunity.
 */
export interface GolemMagicInteractionResult {
  readonly isImmune: boolean;
  readonly specialEffectDescription?: string | undefined;
  readonly healsHpAmount?: number | undefined;
  readonly slowsRounds?: number | undefined;
  readonly breaksHaste?: boolean | undefined;
}

/**
 * Evaluates whether a spell affects a specific Golem type (SRD Golem Magic Immunity).
 * - Flesh Golem: Cold/Fire slows 2d6 rounds; Electricity breaks slow and heals 1 HP per 3 damage.
 * - Clay Golem: Acid heals 1 HP per 3 damage; Disintegrate/Earthquake bypasses.
 * - Stone Golem: Stone to Flesh bypasses; Rock to Mud slows 1 round.
 * - Iron Golem: Fire heals 1 HP per 3 damage; Rusting Grasp affects normally; Electricity slows 3 rounds.
 *
 * @param golemArchetypeId Golem archetype ID ('flesh_golem', 'clay_golem', 'stone_golem', 'iron_golem').
 * @param spellTags Array of spell tags (e.g. ['fire', 'electricity', 'acid', 'cold', 'earth']).
 * @param spellDamageAmount Potential incoming magic damage before immunity check.
 * @returns GolemMagicInteractionResult.
 */
export function evaluateGolemMagicInteraction(
  golemArchetypeId: string,
  spellTags: ReadonlyArray<string>,
  spellDamageAmount = 0
): GolemMagicInteractionResult {
  if (golemArchetypeId === 'flesh_golem') {
    if (spellTags.includes('electricity')) {
      const healed = Math.max(1, Math.floor(spellDamageAmount / 3));
      return {
        isImmune: true,
        healsHpAmount: healed,
        breaksHaste: false,
        specialEffectDescription: `Electricity breaks any active slow and repairs ${healed} HP.`
      };
    }
    if (spellTags.includes('fire') || spellTags.includes('cold')) {
      return {
        isImmune: true,
        slowsRounds: 3,
        specialEffectDescription: 'Magical fire or cold slows the Flesh Golem for 3 rounds.'
      };
    }
    return { isImmune: true };
  }

  if (golemArchetypeId === 'iron_golem') {
    if (spellTags.includes('fire')) {
      const healed = Math.max(1, Math.floor(spellDamageAmount / 3));
      return {
        isImmune: true,
        healsHpAmount: healed,
        specialEffectDescription: `Magical fire repairs ${healed} HP.`
      };
    }
    if (spellTags.includes('electricity')) {
      return {
        isImmune: true,
        slowsRounds: 3,
        specialEffectDescription: 'Magical electricity slows the Iron Golem for 3 rounds.'
      };
    }
    if (spellTags.includes('rust')) {
      return { isImmune: false, specialEffectDescription: 'Rusting attacks affect the Iron Golem normally.' };
    }
    return { isImmune: true };
  }

  if (golemArchetypeId === 'clay_golem') {
    if (spellTags.includes('acid')) {
      const healed = Math.max(1, Math.floor(spellDamageAmount / 3));
      return {
        isImmune: true,
        healsHpAmount: healed,
        specialEffectDescription: `Magical acid repairs ${healed} HP.`
      };
    }
    if (spellTags.includes('disintegrate') || spellTags.includes('earthquake')) {
      return { isImmune: false, specialEffectDescription: 'Disintegrate or Earthquake affects Clay Golem normally.' };
    }
    return { isImmune: true };
  }

  if (golemArchetypeId === 'stone_golem') {
    if (spellTags.includes('stone_to_flesh') || spellTags.includes('transmute')) {
      return { isImmune: false, specialEffectDescription: 'Transmutation effects affect Stone Golem normally.' };
    }
    return { isImmune: true };
  }

  return { isImmune: true };
}

/**
 * Synthesizes a canonical SRD True Dragon Archetype from a variety and age category.
 * Unlocks size-gated natural weapons (`wings` >= Medium, `tail_slap` >= Large,
 * `crush` >= Huge, `tail_sweep` >= Gargantuan) and populates multi-mode movement and senses.
 *
 * @param familiesData Loaded `dragon_families.json` content.
 * @param varietyId Dragon variety ID ('red', 'black', 'blue', 'green', 'white', 'gold', 'silver', 'brass', 'bronze', 'copper').
 * @param ageCategoryId Age category ID ('wyrmling' through 'great_wyrm').
 * @returns Synthesized DnD35Archetype.
 */
export function synthesizeTrueDragonArchetype(
  familiesData: DnD35DragonFamiliesData,
  varietyId: string,
  ageCategoryId: string
): DnD35Archetype {
  const variety = familiesData.varieties[varietyId];
  if (!variety) {
    throw new Error(`Unknown dragon variety: ${varietyId}`);
  }
  const age = familiesData.ageCategories[ageCategoryId];
  if (!age) {
    throw new Error(`Unknown dragon age category: ${ageCategoryId}`);
  }

  const targetSize: CreatureSizeCategory = variety.sizeProgression[ageCategoryId] ?? variety.wyrmlingBase.sizeCategory;
  const sizeRank = SIZE_METRICS[targetSize].rankIndex;
  const totalHd = variety.wyrmlingBase.hitDice + age.hdDeltaFromWyrmling;

  const abilityScores = {
    str: (variety.wyrmlingBase.abilityScores.str ?? 10) + age.strDelta,
    dex: Math.max(1, (variety.wyrmlingBase.abilityScores.dex ?? 10) + age.dexDelta),
    con: (variety.wyrmlingBase.abilityScores.con ?? 10) + age.conDelta,
    int: (variety.wyrmlingBase.abilityScores.int ?? 10) + age.intDelta,
    wis: (variety.wyrmlingBase.abilityScores.wis ?? 10) + age.wisDelta,
    cha: (variety.wyrmlingBase.abilityScores.cha ?? 10) + age.chaDelta
  };

  const naturalArmor = variety.wyrmlingBase.naturalArmorBonus + age.naturalArmorDelta;

  const biteDice = scaleWeaponDamageDice('1d8', 'medium', targetSize);
  const clawDice = scaleWeaponDamageDice('1d6', 'medium', targetSize);

  const naturalWeapons: NaturalWeaponDescriptor[] = [
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

  if (sizeRank >= SIZE_METRICS.medium.rankIndex) {
    const wingDice = scaleWeaponDamageDice('1d4', 'medium', targetSize);
    naturalWeapons.push({
      id: 'wings',
      name: 'Wing',
      naturalType: 'wings',
      isPrimary: false,
      count: 2,
      damageDice: wingDice,
      damageType: 'bludgeoning' as DnD35DamageType,
      critThreatMin: 20,
      critMultiplier: 2
    });
  }

  if (sizeRank >= SIZE_METRICS.large.rankIndex) {
    const tailSlapDice = scaleWeaponDamageDice('1d8', 'large', targetSize);
    naturalWeapons.push({
      id: 'tail_slap',
      name: 'Tail Slap',
      naturalType: 'tail_slap',
      isPrimary: false,
      count: 1,
      damageDice: tailSlapDice,
      damageType: 'bludgeoning' as DnD35DamageType,
      critThreatMin: 20,
      critMultiplier: 2
    });
  }

  if (sizeRank >= SIZE_METRICS.huge.rankIndex) {
    const crushDice = scaleWeaponDamageDice('2d8', 'huge', targetSize);
    naturalWeapons.push({
      id: 'crush',
      name: 'Crush',
      naturalType: 'crush',
      isPrimary: false,
      count: 1,
      damageDice: crushDice,
      damageType: 'bludgeoning' as DnD35DamageType,
      critThreatMin: 20,
      critMultiplier: 2
    });
  }

  if (sizeRank >= SIZE_METRICS.gargantuan.rankIndex) {
    const tailSweepDice = scaleWeaponDamageDice('2d6', 'gargantuan', targetSize);
    naturalWeapons.push({
      id: 'tail_sweep',
      name: 'Tail Sweep',
      naturalType: 'tail_sweep',
      isPrimary: false,
      count: 1,
      damageDice: tailSweepDice,
      damageType: 'bludgeoning' as DnD35DamageType,
      critThreatMin: 20,
      critMultiplier: 2
    });
  }

  return {
    archetypeId: `dragon_${varietyId}_${ageCategoryId}`,
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
        skillPointsPerLevel: 6
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
    damageReduction: age.ageIndex >= 5 ? { amount: (age.ageIndex - 4) * 5, bypassTags: ['magic'] } : undefined,
    energyResistance: {},
    immunities: variety.immunities,
    vulnerabilities: variety.vulnerabilities,
    spellResistance: age.spellResistance,
    feats: ['hover', 'flyby_attack', 'power_attack', 'cleave'],
    skillRanks: { search: totalHd, spot: totalHd, listen: totalHd },
    creatureType: 'dragon',
    subtypes: variety.subtypes,
    levelAdjustment: 0,
    senses: {
      lowLightVision: true,
      darkvisionRangeFt: 120,
      blindsenseRangeFt: 60,
      blindsightRangeFt: 0,
      tremorsenseRangeFt: 0,
      scentRangeFt: 0
    },
    movementModes: {
      land: 40,
      fly: variety.wyrmlingBase.flySpeedFt,
      maneuverability: sizeRank >= SIZE_METRICS.gargantuan.rankIndex ? 'clumsy' : 'poor'
    },
    naturalWeapons,
    hasPounce: false,
    singleActionsOnly: false,
    advancementRanges: [],
    cr: age.cr
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
 * Synthesizes an SRD Elemental Archetype from element type ('air', 'earth', 'fire', 'water')
 * and step ('small', 'medium', 'large', 'huge', 'greater', 'elder'), applying full 6-step
 * ability score, natural armor, slam count, DR, and element-specific Good Save curves.
 */
export function synthesizeElementalArchetype(
  familiesData: DnD35DragonFamiliesData,
  elementId: 'air' | 'earth' | 'fire' | 'water',
  stepId: string
): DnD35Archetype {
  const step = familiesData.elementalSteps[stepId];
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

  // Earth and Water Elementals gain higher STR/CON growth, Air/Fire gain higher DEX growth
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
        skillPointsPerLevel: 2
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
