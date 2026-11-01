import type { AbilityId, AbilityScoresRecord, DnD35EntityData, HitDieTrack } from './types/dnd35e.types.ts';
import type { DnD35Template } from './types/dnd35e_system.types.ts';

/** Undead Hit Die sides (`d12`). */
const UNDEAD_HIT_DIE_SIDES = 12;

/** Mindless Undead fixed Wisdom score (`10`). */
const MINDLESS_UNDEAD_WIS = 10;

/** Mindless Undead fixed Charisma score (`1`). */
const MINDLESS_UNDEAD_CHA = 1;

/**
 * Applies an inherited or acquired creature template to an existing D&D 3.5e actor chassis,
 * producing a new immutable DnD35EntityData with all transformations applied.
 *
 * @param base Base entity data chassis.
 * @param template Template definition containing creature type shifts, stat deltas, and traits.
 * @returns Transformed DnD35EntityData.
 */
export function applyCreatureTemplate(base: DnD35EntityData, template: DnD35Template): DnD35EntityData {
  if (
    template.targetCreatureTypes &&
    template.targetCreatureTypes.length > 0 &&
    base.creatureType &&
    !template.targetCreatureTypes.includes(base.creatureType)
  ) {
    throw new Error(
      `Template "${template.name}" cannot be applied to creature type "${base.creatureType}". Allowed: ${template.targetCreatureTypes.join(', ')}`
    );
  }

  // 1. Creature Type and Subtypes
  const creatureType = template.resultCreatureType ?? base.creatureType;
  const existingSubtypes = base.subtypes ?? [];
  const mergedSubtypes = Array.from(new Set([...existingSubtypes, ...template.addSubtypes]));

  // 2. Size category
  const sizeCategory = template.sizeCategoryChange ?? base.sizeCategory;

  // 3. Ability Scores (including Undead CON: null and Mindless INT: null / WIS: 10 / CHA: 1)
  const isMindlessTemplate =
    template.grantedTags.includes('mindless') ||
    template.templateId === 'skeleton' ||
    template.templateId === 'zombie';
  const nextScores: Record<string, { base: number | null; inherentBonus: number; damage: number; drain: number; tempPenalty: number }> = {};
  const stats: ReadonlyArray<AbilityId> = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

  for (const s of stats) {
    const current = base.abilityScores[s];
    const delta = template.abilityScoreModifiers[s] ?? 0;

    if (creatureType === 'undead' && s === 'con') {
      nextScores[s] = {
        base: null,
        inherentBonus: 0,
        damage: 0,
        drain: 0,
        tempPenalty: 0
      };
      continue;
    }

    if (isMindlessTemplate && s === 'int') {
      nextScores[s] = {
        base: null,
        inherentBonus: 0,
        damage: 0,
        drain: 0,
        tempPenalty: 0
      };
      continue;
    }

    if (isMindlessTemplate && s === 'wis') {
      nextScores[s] = {
        ...current,
        base: MINDLESS_UNDEAD_WIS
      };
      continue;
    }

    if (isMindlessTemplate && s === 'cha') {
      nextScores[s] = {
        ...current,
        base: MINDLESS_UNDEAD_CHA
      };
      continue;
    }

    if (current.base === null) {
      nextScores[s] = { ...current };
    } else {
      nextScores[s] = {
        ...current,
        base: Math.max(1, current.base + delta)
      };
    }
  }

  // 4. Hit Die Track Rebuilding for Acquired Undead Templates (PRIM-1.6)
  let nextTracks: ReadonlyArray<HitDieTrack> = base.tracks;
  if (template.templateId === 'skeleton' || template.templateId === 'zombie') {
    const totalBaseLevels = Math.max(
      1,
      base.tracks.reduce((sum, t) => sum + t.levels, 0)
    );
    const undeadHd = template.templateId === 'zombie' ? totalBaseLevels * 2 : totalBaseLevels;
    nextTracks = [
      {
        trackId: 'undead',
        levels: undeadHd,
        hitDieSides: UNDEAD_HIT_DIE_SIDES,
        babCurve: 'half',
        fortCurve: 'poor',
        refCurve: 'poor',
        willCurve: 'good',
        skillPointsPerLevel: 0
      }
    ];
  } else if (creatureType === 'undead') {
    nextTracks = base.tracks.map((track) => ({
      ...track,
      hitDieSides: UNDEAD_HIT_DIE_SIDES
    }));
  }

  // 5. Natural Armor
  const naturalArmorBonus = Math.max(0, base.naturalArmorBonus + template.naturalArmorBonusDelta);

  // 6. Damage Reduction
  let damageReduction = base.damageReduction;
  if (template.damageReduction) {
    if (!damageReduction || template.damageReduction.amount >= damageReduction.amount) {
      damageReduction = template.damageReduction;
    }
  }

  // 7. Energy Resistances
  const energyResistance: Record<string, number> = { ...base.energyResistance };
  for (const [key, val] of Object.entries(template.energyResistance)) {
    energyResistance[key] = Math.max(energyResistance[key] ?? 0, val);
  }

  // 8. Immunities
  const immunities = Array.from(new Set([...base.immunities, ...template.immunities]));

  // 9. Spell Resistance
  let spellResistance = base.spellResistance;
  if (template.spellResistanceBonus !== undefined) {
    spellResistance = Math.max(spellResistance ?? 0, template.spellResistanceBonus);
  }

  // 10. Feats
  const feats = Array.from(new Set([...base.feats, ...template.grantedFeats]));

  // 11. Level Adjustment
  const levelAdjustment = (base.levelAdjustment ?? 0) + template.levelAdjustmentDelta;

  // 12. Single actions only (Zombies)
  const isZombie = template.templateId === 'zombie' || template.grantedTags.includes('single_actions_only');
  const singleActionsOnly = isZombie ? true : (base.singleActionsOnly ?? false);

  return {
    ...base,
    creatureType,
    subtypes: mergedSubtypes,
    sizeCategory,
    abilityScores: nextScores as unknown as AbilityScoresRecord,
    tracks: nextTracks,
    naturalArmorBonus,
    damageReduction,
    energyResistance,
    immunities,
    spellResistance,
    feats,
    levelAdjustment,
    singleActionsOnly
  };
}

/** Alias for applying an inherited template (`PRIM-1.5`). */
export const applyInheritedTemplate = applyCreatureTemplate;

/** Alias for applying an acquired template (`PRIM-1.6`). */
export const applyAcquiredTemplate = applyCreatureTemplate;

/** Canonical SRD Celestial Creature template (inherited). */
export const CELESTIAL_TEMPLATE: DnD35Template = {
  templateId: 'celestial',
  name: 'Celestial Creature',
  kind: 'inherited',
  resultCreatureType: 'magical_beast',
  addSubtypes: ['extraplanar', 'good'],
  abilityScoreModifiers: {},
  naturalArmorBonusDelta: 0,
  damageReduction: {
    amount: 5,
    bypassTags: ['magic']
  },
  energyResistance: {
    acid: 5,
    cold: 5,
    electricity: 5
  },
  immunities: [],
  spellResistanceBonus: 10,
  grantedFeats: [],
  grantedTags: ['celestial', 'smite_evil'],
  levelAdjustmentDelta: 2
};

/** Canonical SRD Fiendish Creature template (inherited). */
export const FIENDISH_TEMPLATE: DnD35Template = {
  templateId: 'fiendish',
  name: 'Fiendish Creature',
  kind: 'inherited',
  resultCreatureType: 'magical_beast',
  addSubtypes: ['extraplanar', 'evil'],
  abilityScoreModifiers: {},
  naturalArmorBonusDelta: 0,
  damageReduction: {
    amount: 5,
    bypassTags: ['magic']
  },
  energyResistance: {
    cold: 5,
    fire: 5
  },
  immunities: [],
  spellResistanceBonus: 10,
  grantedFeats: [],
  grantedTags: ['fiendish', 'smite_good'],
  levelAdjustmentDelta: 2
};

/** Canonical SRD Skeleton template (acquired). */
export const SKELETON_TEMPLATE: DnD35Template = {
  templateId: 'skeleton',
  name: 'Skeleton',
  kind: 'acquired',
  targetCreatureTypes: ['humanoid', 'monstrous_humanoid', 'animal', 'dragon', 'magical_beast', 'giant'],
  resultCreatureType: 'undead',
  addSubtypes: [],
  abilityScoreModifiers: {
    dex: 2
  },
  naturalArmorBonusDelta: 2,
  damageReduction: {
    amount: 5,
    bypassTags: ['bludgeoning']
  },
  energyResistance: {},
  immunities: ['cold'],
  grantedFeats: ['improved_initiative'],
  grantedTags: ['undead', 'mindless'],
  levelAdjustmentDelta: 0
};

/** Canonical SRD Zombie template (acquired). */
export const ZOMBIE_TEMPLATE: DnD35Template = {
  templateId: 'zombie',
  name: 'Zombie',
  kind: 'acquired',
  targetCreatureTypes: ['humanoid', 'monstrous_humanoid', 'animal', 'dragon', 'magical_beast', 'giant'],
  resultCreatureType: 'undead',
  addSubtypes: [],
  abilityScoreModifiers: {
    str: 2,
    dex: -2
  },
  naturalArmorBonusDelta: 2,
  damageReduction: {
    amount: 5,
    bypassTags: ['slashing']
  },
  energyResistance: {},
  immunities: [],
  grantedFeats: ['toughness'],
  grantedTags: ['undead', 'single_actions_only'],
  levelAdjustmentDelta: 0
};

/** Canonical SRD Lich template (acquired). */
export const LICH_TEMPLATE: DnD35Template = {
  templateId: 'lich',
  name: 'Lich',
  kind: 'acquired',
  targetCreatureTypes: ['humanoid'],
  resultCreatureType: 'undead',
  addSubtypes: ['augmented_humanoid'],
  abilityScoreModifiers: {
    int: 2,
    wis: 2,
    cha: 2
  },
  naturalArmorBonusDelta: 5,
  damageReduction: {
    amount: 15,
    bypassTags: ['bludgeoning', 'magic'],
    requireAllTags: true
  },
  energyResistance: {},
  immunities: ['cold', 'electricity'],
  spellResistanceBonus: 15,
  grantedFeats: [],
  grantedTags: ['undead', 'fear_aura', 'paralyzing_touch'],
  levelAdjustmentDelta: 4
};
