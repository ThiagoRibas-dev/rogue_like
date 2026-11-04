import { computeAbilityModifier, computeEffectiveAbilityScore, createAbilityScoreState } from './abilities.ts';
import { hydrateRaceAsArchetype } from './archetype/race_hydrator.ts';
import {
  synthesizeDragonFromRaceTier,
  synthesizeElementalArchetype,
  synthesizeElementalFromRaceTier,
  synthesizeTrueDragonArchetype
} from './family_synthesizer.ts';
import { buildCreatureTypeAndSubtypeModifiers } from './semantic_tags.ts';
import type { AbilityScoresRecord, DnD35EntityData } from './types/dnd35e.types.ts';
import type { DnD35Archetype, DnD35DragonFamiliesData, DnD35RaceDefinition } from './types/dnd35e_system.types.ts';

export * from './archetype/race_hydrator.ts';

/**
 * Helper to construct a 6-Ability Score record from raw base scores (`number | null`).
 *
 * @param raw `{ str, dex, con, int, wis, cha }`.
 * @returns Initialized `AbilityScoresRecord`.
 */
export function buildAbilityScoresRecord(raw: {
  readonly str: number | null;
  readonly dex: number | null;
  readonly con: number | null;
  readonly int: number | null;
  readonly wis: number | null;
  readonly cha: number | null;
}): AbilityScoresRecord {
  return {
    str: createAbilityScoreState(raw.str),
    dex: createAbilityScoreState(raw.dex),
    con: createAbilityScoreState(raw.con),
    int: createAbilityScoreState(raw.int),
    wis: createAbilityScoreState(raw.wis),
    cha: createAbilityScoreState(raw.cha)
  };
}

/**
 * Hydrates a runtime `DnD35EntityData` instance from either a declarative `DnD35Archetype`
 * or a unified `DnD35RaceDefinition` (`races/<id>.json`).
 *
 * @param archetypeOrRace Declarative `DnD35Archetype` or `DnD35RaceDefinition`.
 * @param levelOverride Optional character/monster level override from `FighterComponent`.
 * @param systemContent Optional system content for resolving creatureType/subtype modifiers.
 * @returns Runtime `DnD35EntityData`.
 */
export function hydrateArchetypeData(
  archetypeOrRace: DnD35Archetype | DnD35RaceDefinition,
  levelOverride?: number,
  systemContent?: Record<string, unknown>
): DnD35EntityData {
  const archetype: DnD35Archetype =
    'archetypeId' in archetypeOrRace ? archetypeOrRace : hydrateRaceAsArchetype(systemContent, archetypeOrRace);

  const tracks =
    levelOverride !== undefined && archetype.tracks.length > 0
      ? [{ ...archetype.tracks[0]!, levels: Math.max(1, levelOverride) }, ...archetype.tracks.slice(1)]
      : archetype.tracks;

  const normalizedDr =
    archetype.damageReduction !== undefined
      ? {
          amount: archetype.damageReduction.amount,
          bypassTags: archetype.damageReduction.bypassTags,
          ...(archetype.damageReduction.requireAllTags !== undefined
            ? { requireAllTags: archetype.damageReduction.requireAllTags }
            : {})
        }
      : undefined;

  const abilityScores = buildAbilityScoresRecord(archetype.abilityScores);
  const chaMod = computeAbilityModifier(computeEffectiveAbilityScore(abilityScores.cha));
  const subtypes = archetype.subtypes ?? [];
  const providerMods = buildCreatureTypeAndSubtypeModifiers(
    archetype.creatureType,
    subtypes,
    chaMod,
    `archetype:${archetype.archetypeId}`,
    systemContent
  );

  return {
    archetypeId: archetype.archetypeId,
    sizeCategory: archetype.sizeCategory,
    abilityScores,
    tracks,
    weaponDice: archetype.weaponDice,
    weaponDamageType: archetype.weaponDamageType,
    weaponCritThreatMin: archetype.weaponCritThreatMin,
    weaponCritMultiplier: archetype.weaponCritMultiplier,
    weaponBypassTags: archetype.weaponBypassTags,
    armorBonus: archetype.armorBonus,
    shieldBonus: archetype.shieldBonus,
    naturalArmorBonus: archetype.naturalArmorBonus,
    ...(normalizedDr !== undefined ? { damageReduction: normalizedDr } : {}),
    energyResistance: archetype.energyResistance,
    immunities: archetype.immunities,
    vulnerabilities: archetype.vulnerabilities,
    ...(archetype.spellResistance !== undefined ? { spellResistance: archetype.spellResistance } : {}),
    nonlethalDamage: 0,
    tempHp: 0,
    isStable: true,
    conditions: [],
    feats: archetype.feats,
    skillRanks: archetype.skillRanks,
    ...(archetype.creatureType !== undefined ? { creatureType: archetype.creatureType } : {}),
    subtypes,
    levelAdjustment: archetype.levelAdjustment ?? 0,
    ...(archetype.senses !== undefined ? { senses: archetype.senses } : {}),
    ...(archetype.movementModes !== undefined
      ? {
          movementModes: {
            land: archetype.movementModes.land,
            ...(archetype.movementModes.burrow !== undefined ? { burrow: archetype.movementModes.burrow } : {}),
            ...(archetype.movementModes.climb !== undefined ? { climb: archetype.movementModes.climb } : {}),
            ...(archetype.movementModes.fly !== undefined ? { fly: archetype.movementModes.fly } : {}),
            ...(archetype.movementModes.swim !== undefined ? { swim: archetype.movementModes.swim } : {}),
            ...(archetype.movementModes.maneuverability !== undefined
              ? { maneuverability: archetype.movementModes.maneuverability }
              : {})
          }
        }
      : {}),
    ...(archetype.anatomyBodyPlan !== undefined ? { anatomyBodyPlan: archetype.anatomyBodyPlan } : {}),
    naturalWeapons: archetype.naturalWeapons ?? [],
    hasPounce: archetype.hasPounce ?? false,
    singleActionsOnly: archetype.singleActionsOnly ?? false,
    statModifiers: providerMods
  };
}

/** Default Player Character archetype preset (Human Level 1 Fighter with Heroic Array). */
export const DEFAULT_PLAYER_ARCHETYPE: DnD35Archetype = {
  archetypeId: 'player',
  sizeCategory: 'medium',
  subtypes: [],
  levelAdjustment: 0,
  abilityScores: { str: 16, dex: 14, con: 14, int: 12, wis: 12, cha: 10 },
  tracks: [
    {
      trackId: 'fighter',
      levels: 1,
      hitDieSides: 10,
      babCurve: 'full',
      fortCurve: 'good',
      refCurve: 'poor',
      willCurve: 'poor',
      skillPointsPerLevel: 2,
      trackCategory: 'pc'
    }
  ],
  weaponDice: '1d8',
  weaponDamageType: 'slashing',
  weaponCritThreatMin: 19,
  weaponCritMultiplier: 2,
  weaponBypassTags: ['slashing'],
  naturalWeapons: [],
  hasPounce: false,
  singleActionsOnly: false,
  advancementRanges: [],
  armorBonus: 4,
  shieldBonus: 2,
  naturalArmorBonus: 0,
  energyResistance: {},
  immunities: [],
  vulnerabilities: [],
  feats: ['power_attack', 'cleave', 'combat_reflexes'],
  skillRanks: { tumble: 4, jump: 4, intimidate: 4, spot: 2 },
  cr: 1
};

/** Default fallback creature archetype preset. */
export const DEFAULT_CREATURE_ARCHETYPE: DnD35Archetype = {
  archetypeId: 'default_creature',
  sizeCategory: 'medium',
  subtypes: [],
  levelAdjustment: 0,
  abilityScores: { str: 14, dex: 12, con: 12, int: 8, wis: 10, cha: 8 },
  tracks: [
    {
      trackId: 'creature',
      levels: 1,
      hitDieSides: 8,
      babCurve: 'three_quarters',
      fortCurve: 'good',
      refCurve: 'poor',
      willCurve: 'poor',
      skillPointsPerLevel: 2,
      trackCategory: 'racial_hd'
    }
  ],
  weaponDice: '1d6',
  weaponDamageType: 'slashing',
  weaponCritThreatMin: 20,
  weaponCritMultiplier: 2,
  weaponBypassTags: ['slashing'],
  naturalWeapons: [],
  hasPounce: false,
  singleActionsOnly: false,
  advancementRanges: [],
  armorBonus: 0,
  shieldBonus: 0,
  naturalArmorBonus: 1,
  energyResistance: {},
  immunities: [],
  vulnerabilities: [],
  feats: [],
  skillRanks: {},
  cr: 1
};

/**
 * Resolves a `DnD35Archetype` by ID from unified `races/<id>.json` (including Dragon age category
 * tiers `dragon_<variety>_<age>` and Elemental size steps `elemental_<element>_<step>`),
 * or falls back to `archetypes` / `dragonFamilies` if provided.
 */
export function getDnD35Archetype(
  systemContent: Record<string, unknown> | undefined,
  archetypeId: string
): DnD35Archetype | undefined {
  const archetypes = systemContent?.['archetypes'] as Record<string, DnD35Archetype> | undefined;
  if (archetypes?.[archetypeId]) {
    return archetypes[archetypeId];
  }

  if (archetypeId === 'player') {
    return DEFAULT_PLAYER_ARCHETYPE;
  }
  if (archetypeId === 'default_creature') {
    return DEFAULT_CREATURE_ARCHETYPE;
  }

  const races = systemContent?.['races'] as Record<string, DnD35RaceDefinition> | undefined;
  if (races?.[archetypeId]) {
    return hydrateRaceAsArchetype(systemContent, races[archetypeId]!);
  }

  if (archetypeId.startsWith('dragon_')) {
    const parts = archetypeId.split('_');
    if (parts.length >= 3) {
      const varietyId = parts[1]!;
      const ageCategoryId = parts.slice(2).join('_');
      const dragonRace = races?.[`dragon_${varietyId}`];
      if (dragonRace && dragonRace.rhdProgression?.tiers?.some((t) => t.tierId === ageCategoryId)) {
        return synthesizeDragonFromRaceTier(dragonRace, ageCategoryId);
      }
      const dragonFamilies = systemContent?.['dragonFamilies'] as DnD35DragonFamiliesData | undefined;
      if (dragonFamilies?.varieties?.[varietyId] && dragonFamilies?.ageCategories?.[ageCategoryId]) {
        return synthesizeTrueDragonArchetype(dragonFamilies, varietyId, ageCategoryId);
      }
    }
  }

  if (archetypeId.startsWith('elemental_')) {
    const parts = archetypeId.split('_');
    if (parts.length >= 3) {
      const elementId = parts[1] as 'air' | 'earth' | 'fire' | 'water';
      const stepId = parts.slice(2).join('_');
      const elementalRace = races?.[`elemental_${elementId}`];
      if (elementalRace && elementalRace.rhdProgression?.tiers?.some((t) => t.tierId === stepId)) {
        return synthesizeElementalFromRaceTier(elementalRace, stepId);
      }
      const dragonFamilies = systemContent?.['dragonFamilies'] as DnD35DragonFamiliesData | undefined;
      if (dragonFamilies?.elementalSteps?.[stepId]) {
        return synthesizeElementalArchetype(dragonFamilies, elementId, stepId);
      }
    }
  }

  return undefined;
}
