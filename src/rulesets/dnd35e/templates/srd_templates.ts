import type { DnD35Template } from '../types/dnd35e_system.types.ts';

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
  specialQualityBundles: [],
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
  specialQualityBundles: [],
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
  hitDieOverride: 12,
  stripClassLevels: true,
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
  specialQualityBundles: [],
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
  hitDieOverride: 12,
  hdMultiplier: 2,
  stripClassLevels: true,
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
  specialQualityBundles: [],
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
  specialQualityBundles: [],
  levelAdjustmentDelta: 4
};
