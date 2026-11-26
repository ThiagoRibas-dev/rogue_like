import { computeAbilityModifier, computeEffectiveAbilityScore, createAbilityScoreState } from './abilities.ts';
import { hydrateRaceAsArchetype } from './archetype/race_hydrator.ts';
import { synthesizeDragonFromRaceTier, synthesizeElementalFromRaceTier } from './family_synthesizer.ts';
import { buildHitDieTrackFromClass } from './progression.ts';
import {
  buildClassAndDomainEffectModifiers,
  collectActiveGrantedAndVirtualFeats
} from './progression/ledger_modifiers.ts';
import { collectActiveClassFeaturesAndPools } from './progression/ledger_features_spells.ts';
import { evaluateRacialModifiers } from './races.ts';
import { buildCreatureTypeAndSubtypeModifiers } from './semantic_tags.ts';
import type { AbilityScoresRecord, DnD35EntityData, StatModifier } from './types/dnd35e.types.ts';
import type {
  DnD35Archetype,
  DnD35ClassDefinition,
  DnD35DomainDefinition,
  DnD35RaceDefinition
} from './types/dnd35e_system.types.ts';

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

  const raceDef: DnD35RaceDefinition | undefined =
    'id' in archetypeOrRace && 'creatureType' in archetypeOrRace
      ? (archetypeOrRace as DnD35RaceDefinition)
      : (systemContent?.['races'] as Record<string, DnD35RaceDefinition> | undefined)?.[archetype.archetypeId];

  let tracks = archetype.tracks;
  if (levelOverride !== undefined && archetype.tracks.length > 0) {
    const first = archetype.tracks[0]!;
    const overriddenLevels = Math.max(1, levelOverride);
    const classDefs = systemContent?.['classes'] as Record<string, DnD35ClassDefinition> | undefined;
    const firstClassDef = classDefs?.[first.trackId];
    if (firstClassDef) {
      const rebuilt = buildHitDieTrackFromClass(firstClassDef, overriddenLevels);
      tracks = [
        {
          trackId: rebuilt.trackId,
          levels: rebuilt.levels,
          hitDieSides: firstClassDef.hitDieSides,
          babCurve: rebuilt.babCurve,
          fortCurve: rebuilt.fortCurve,
          refCurve: rebuilt.refCurve,
          willCurve: rebuilt.willCurve,
          skillPointsPerLevel: rebuilt.skillPointsPerLevel,
          ...(rebuilt.explicitBab !== undefined ? { explicitBab: rebuilt.explicitBab } : {}),
          ...(rebuilt.explicitFort !== undefined ? { explicitFort: rebuilt.explicitFort } : {}),
          ...(rebuilt.explicitRef !== undefined ? { explicitRef: rebuilt.explicitRef } : {}),
          ...(rebuilt.explicitWill !== undefined ? { explicitWill: rebuilt.explicitWill } : {}),
          ...(rebuilt.trackCategory !== undefined ? { trackCategory: rebuilt.trackCategory } : {})
        },
        ...archetype.tracks.slice(1)
      ];
    } else {
      const { explicitBab: _b, explicitFort: _f, explicitRef: _r, explicitWill: _w, ...curveTrack } = first;
      tracks = [{ ...curveTrack, levels: overriddenLevels }, ...archetype.tracks.slice(1)];
    }
  }

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

  const racialMods = raceDef ? evaluateRacialModifiers(raceDef) : { statModifiers: [], grantedTags: [] };
  const subtypes = Array.from(new Set([...(archetype.subtypes ?? []), ...racialMods.grantedTags]));

  const providerMods = buildCreatureTypeAndSubtypeModifiers(
    archetype.creatureType,
    subtypes,
    chaMod,
    `archetype:${archetype.archetypeId}`,
    systemContent
  );

  let classAndDomainMods: ReadonlyArray<StatModifier> = [];
  let grantedFeats: ReadonlyArray<string> = [];
  let scalingPools: Record<string, number> | undefined;
  let activeClassFeatures: ReadonlyArray<string> | undefined;

  const classesDict = systemContent?.['classes'] as Record<string, DnD35ClassDefinition> | undefined;
  if (
    classesDict &&
    tracks.some((t) => t.trackCategory === 'pc' || t.trackCategory === 'npc' || t.trackCategory === 'prestige')
  ) {
    const domainsDict = (systemContent?.['domains'] as Record<string, DnD35DomainDefinition> | undefined) ?? {};
    const featPoolSummary = collectActiveClassFeaturesAndPools(tracks, [], classesDict);
    classAndDomainMods = buildClassAndDomainEffectModifiers(tracks, [], [], classesDict, domainsDict);
    grantedFeats = collectActiveGrantedAndVirtualFeats(tracks, [], [], classesDict, domainsDict);
    scalingPools = featPoolSummary.scalingPools;
    activeClassFeatures = featPoolSummary.activeFeatureIds;
  }

  const mergedFeats = Array.from(new Set([...archetype.feats, ...grantedFeats]));
  const allStatModifiers = [...providerMods, ...racialMods.statModifiers, ...classAndDomainMods];

  return {
    archetypeId: archetype.archetypeId,
    ...(raceDef !== undefined ? { raceId: raceDef.id } : {}),
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
    feats: mergedFeats,
    skillRanks: archetype.skillRanks,
    ...(archetype.creatureType !== undefined ? { creatureType: archetype.creatureType } : {}),
    subtypes,
    ...(raceDef?.automaticLanguages && raceDef.automaticLanguages.length > 0
      ? { languages: [...raceDef.automaticLanguages] }
      : {}),
    levelAdjustment: archetype.levelAdjustment ?? 0,
    ...(scalingPools !== undefined ? { scalingPools } : {}),
    ...(activeClassFeatures !== undefined ? { activeClassFeatures } : {}),
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
    anatomyBodyPlan: archetype.anatomyBodyPlan ?? 'humanoid_biped',
    naturalWeapons: archetype.naturalWeapons ?? [],
    hasPounce: archetype.hasPounce ?? false,
    singleActionsOnly: archetype.singleActionsOnly ?? false,
    ...(archetype.isCompletelyFillingSpace !== undefined
      ? { isCompletelyFillingSpace: archetype.isCompletelyFillingSpace }
      : {}),
    ...(archetype.footprint !== undefined ? { footprint: archetype.footprint } : {}),
    ...(archetype.footprintsBySize !== undefined ? { footprintsBySize: archetype.footprintsBySize } : {}),
    statModifiers: allStatModifiers
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
  defaultEquipment: [],
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
  defaultEquipment: [],
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
 * or falls back to `archetypes` if provided.
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
      const dragonRace = races?.[`dragon_${parts[1]!}`];
      const ageCategoryId = parts.slice(2).join('_');
      if (dragonRace?.rhdProgression?.tiers?.some((t) => t.tierId === ageCategoryId)) {
        return synthesizeDragonFromRaceTier(dragonRace, ageCategoryId);
      }
    }
  }

  if (archetypeId.startsWith('elemental_')) {
    const parts = archetypeId.split('_');
    if (parts.length >= 3) {
      const elementalRace = races?.[`elemental_${parts[1]}`];
      const stepId = parts.slice(2).join('_');
      if (elementalRace?.rhdProgression?.tiers?.some((t) => t.tierId === stepId)) {
        return synthesizeElementalFromRaceTier(elementalRace, stepId);
      }
    }
  }

  return undefined;
}
