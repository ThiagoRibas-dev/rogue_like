import { computeAbilityModifier, computeEffectiveAbilityScore } from './abilities.ts';
import { buildCreatureTypeAndSubtypeModifiers } from './srd_registry.ts';
import type { AbilityId, AbilityScoresRecord, DnD35EntityData, HitDieTrack, StatModifier } from './types/dnd35e.types.ts';
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
  let creatureType = template.resultCreatureType ?? base.creatureType;
  if (template.convertTypeMap && base.creatureType && template.convertTypeMap[base.creatureType]) {
    creatureType = template.convertTypeMap[base.creatureType]!;
  }
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

  const abilityMods = template.abilityScoreModifiers ?? {};
  for (const s of stats) {
    const current = base.abilityScores[s];
    const delta = abilityMods[s] ?? 0;

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
      let finalBase = current.base + delta;
      if (s === 'int' && template.minimumIntelligence !== undefined) {
        finalBase = Math.max(template.minimumIntelligence, finalBase);
      } else {
        finalBase = Math.max(1, finalBase);
      }
      nextScores[s] = {
        ...current,
        base: finalBase
      };
    }
  }

  // 4. Hit Die Track Rebuilding for Acquired Undead Templates (PRIM-1.6)
  // SRD Skeleton & Zombie drop class HD and retain only racial HD (or 1 HD if the creature only had class levels).
  const pcClassIds: ReadonlyArray<string> = [
    'barbarian',
    'bard',
    'cleric',
    'druid',
    'fighter',
    'monk',
    'paladin',
    'ranger',
    'rogue',
    'sorcerer',
    'wizard'
  ];
  const racialTracks = base.tracks.filter((t) => !pcClassIds.includes(t.trackId));
  const baseRacialLevels =
    racialTracks.length > 0
      ? Math.max(
          1,
          racialTracks.reduce((sum, t) => sum + t.levels, 0)
        )
      : 1;
  let nextTracks: ReadonlyArray<HitDieTrack> = base.tracks;
  if (template.templateId === 'skeleton' || template.templateId === 'zombie') {
    const hdMult = template.hdMultiplier ?? (template.templateId === 'zombie' ? 2 : 1);
    const bonusHd = template.bonusHitDice ?? 0;
    const undeadHd = Math.max(1, Math.floor(baseRacialLevels * hdMult) + bonusHd);
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

  const effectiveTotalHd = nextTracks.reduce((sum, t) => sum + t.levels, 0);

  // 5. Natural Armor
  let naturalArmorBonus = base.naturalArmorBonus;
  if (template.stripNaturalArmor) {
    naturalArmorBonus = 0;
  }
  if (template.sizeTieredNaturalArmor && template.sizeTieredNaturalArmor[sizeCategory] !== undefined) {
    naturalArmorBonus = Math.max(naturalArmorBonus, template.sizeTieredNaturalArmor[sizeCategory]!);
  } else {
    naturalArmorBonus = Math.max(0, naturalArmorBonus + (template.naturalArmorBonusDelta ?? 0));
  }

  // 6. Damage Reduction (including HD-tiered scaling)
  let damageReduction = base.damageReduction;
  if (template.damageReduction) {
    if (!damageReduction || template.damageReduction.amount >= damageReduction.amount) {
      damageReduction = template.damageReduction;
    }
  }

  // 7. Energy Resistances (including HD-tiered scaling)
  const energyResistance: Record<string, number> = { ...base.energyResistance };
  const baseTemplateResistances = { ...(template.energyResistance ?? {}), ...(template.energyResistances ?? {}) };
  for (const [key, val] of Object.entries(baseTemplateResistances)) {
    energyResistance[key] = Math.max(energyResistance[key] ?? 0, val);
  }

  if (template.hdTieredScaling) {
    for (const tier of template.hdTieredScaling) {
      if (effectiveTotalHd >= tier.minHd && (tier.maxHd === undefined || effectiveTotalHd <= tier.maxHd)) {
        if (tier.damageReduction) {
          if (!damageReduction || tier.damageReduction.amount >= damageReduction.amount) {
            damageReduction = tier.damageReduction;
          }
        }
        const tierResistances = { ...(tier.energyResistance ?? {}), ...(tier.energyResistances ?? {}) };
        for (const [key, val] of Object.entries(tierResistances)) {
          energyResistance[key] = Math.max(energyResistance[key] ?? 0, typeof val === 'number' ? val : 0);
        }
      }
    }
  }

  // 8. Immunities
  const immunities = Array.from(new Set([...(base.immunities ?? []), ...(template.immunities ?? [])]));

  // 9. Spell Resistance (formula or bonus)
  let spellResistance = base.spellResistance;
  if (template.spellResistanceFormula) {
    const rawSr = template.spellResistanceFormula.base + template.spellResistanceFormula.perHitDie * effectiveTotalHd;
    const cappedSr = template.spellResistanceFormula.max !== undefined
      ? Math.min(template.spellResistanceFormula.max, rawSr)
      : rawSr;
    spellResistance = Math.max(spellResistance ?? 0, cappedSr);
  } else if (template.spellResistanceBonus !== undefined) {
    spellResistance = Math.max(spellResistance ?? 0, template.spellResistanceBonus);
  }

  // 10. Feats
  const feats = Array.from(new Set([...(base.feats ?? []), ...(template.grantedFeats ?? [])]));

  // 11. Natural Weapons (e.g. Claws/Bites granted by Half-Dragon / Vampire)
  const naturalWeapons = template.grantedNaturalWeapons
    ? [...(base.naturalWeapons ?? []), ...template.grantedNaturalWeapons]
    : base.naturalWeapons;

  // 12. Level Adjustment
  const levelAdjustment = (base.levelAdjustment ?? 0) + (template.levelAdjustmentDelta ?? 0);

  // 13. Single actions only (Zombies)
  const grantedTags = template.grantedTags ?? [];
  const isZombie = template.templateId === 'zombie' || grantedTags.includes('single_actions_only');
  const singleActionsOnly = isZombie ? true : (base.singleActionsOnly ?? false);

  // 14. Emit Effect Provider StatModifiers with hierarchical sourcePath
  const resolvedAbilityScores = nextScores as unknown as AbilityScoresRecord;
  const chaMod = computeAbilityModifier(computeEffectiveAbilityScore(resolvedAbilityScores.cha));
  const templateRootPath = `template:${template.templateId}`;
  const providerMods = buildCreatureTypeAndSubtypeModifiers(
    creatureType,
    mergedSubtypes,
    chaMod,
    templateRootPath
  );
  const nextStatModifiers: StatModifier[] = [...(base.statModifiers ?? []), ...providerMods];

  if (template.deflectionBonusFromChaMinOne && !mergedSubtypes.includes('incorporeal')) {
    nextStatModifiers.push({
      targetStat: 'ac',
      value: Math.max(1, chaMod),
      bonusType: 'deflection',
      sourceId: `template:${template.templateId}:deflection_ac`,
      sourcePath: `${templateRootPath}/trait:deflection_ac`,
      origin: 'su'
    });
  }

  return {
    ...base,
    creatureType,
    subtypes: mergedSubtypes,
    sizeCategory,
    abilityScores: resolvedAbilityScores,
    tracks: nextTracks,
    naturalArmorBonus,
    damageReduction,
    energyResistance,
    immunities,
    spellResistance,
    feats,
    naturalWeapons,
    levelAdjustment,
    singleActionsOnly,
    statModifiers: nextStatModifiers
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
