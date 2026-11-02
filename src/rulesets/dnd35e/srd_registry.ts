import { addComponent, getComponent } from '../../core/ecs.ts';
import type {
  DnD35ActivatedAbilityDescriptor,
  DnD35Archetype,
  DnD35ClassDefinition,
  DnD35CreatureTypeEngine,
  DnD35DragonFamiliesData,
  DnD35EffectBundle,
  DnD35FeatGrantDescriptor,
  DnD35ProgressionTrack,
  DnD35RaceDefinition,
  DnD35RuleOverrideEntry,
  DnD35SubtypeDefinition,
  DnD35Template
} from './types/dnd35e_system.types.ts';
import {
  ComponentType,
  type EquipmentComponent,
  type FighterComponent,
  type IdentityComponent,
  type ItemComponent,
  type RulesetDataComponent,
  type TemplateComponent
} from '../../types/components.types.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';
import { computeAbilityModifier, computeEffectiveAbilityScore, createAbilityScoreState } from './abilities.ts';
import {
  synthesizeDragonFromRaceTier,
  synthesizeElementalArchetype,
  synthesizeElementalFromRaceTier,
  synthesizeTrueDragonArchetype
} from './family_synthesizer.ts';
import { appendSourcePath } from './modifiers.ts';
import { computeNpcClassCrContribution } from './progression.ts';
import type {
  AbilityScoresRecord,
  CreatureSizeCategory,
  DnD35DamageType,
  DnD35EntityData,
  StatModifier,
  StatModifierCondition
} from './types/dnd35e.types.ts';

/** Canonical SRD Construct Bonus HP by Size emitted by the `type:construct` Effect Provider. */
export const CONSTRUCT_BONUS_HP_BY_SIZE: Readonly<Partial<Record<CreatureSizeCategory, number>>> = {
  small: 10,
  medium: 20,
  large: 30,
  huge: 40,
  gargantuan: 60,
  colossal: 80
};

/** Result of evaluating a universal `DnD35EffectBundle`. */
export interface EvaluatedEffectBundleResult {
  readonly isActive: boolean;
  readonly statModifiers: ReadonlyArray<StatModifier>;
  readonly ruleOverrides: ReadonlyArray<DnD35RuleOverrideEntry>;
  readonly grantedTags: ReadonlyArray<string>;
  readonly grantedFeats: ReadonlyArray<string>;
  readonly virtualFeatGrants: ReadonlyArray<DnD35FeatGrantDescriptor>;
  readonly classSkillsAdded: ReadonlyArray<string>;
  readonly immunities: ReadonlyArray<string>;
  readonly vulnerabilities: ReadonlyArray<string>;
  readonly activatedAbilities: ReadonlyArray<DnD35ActivatedAbilityDescriptor>;
}

/**
 * Checks whether an Effect Bundle's `activationCondition` passes against an actor's active semantic self-tags.
 *
 * @param activationCondition Optional tag condition on the bundle or class feature.
 * @param activeSelfTags Optional array of active semantic tags on the actor.
 * @returns True if the bundle is active.
 */
export function isActivationConditionMet(
  activationCondition:
    | {
        readonly selfTagsAll?: ReadonlyArray<string> | undefined;
        readonly selfTagsAny?: ReadonlyArray<string> | undefined;
        readonly selfTagsNone?: ReadonlyArray<string> | undefined;
      }
    | undefined,
  activeSelfTags?: ReadonlyArray<string>
): boolean {
  if (!activationCondition || !activeSelfTags) return true;
  if (activationCondition.selfTagsAll && activationCondition.selfTagsAll.length > 0) {
    for (const reqTag of activationCondition.selfTagsAll) {
      if (!activeSelfTags.includes(reqTag)) return false;
    }
  }
  if (activationCondition.selfTagsAny && activationCondition.selfTagsAny.length > 0) {
    if (!activationCondition.selfTagsAny.some((t) => activeSelfTags.includes(t))) return false;
  }
  if (activationCondition.selfTagsNone && activationCondition.selfTagsNone.length > 0) {
    if (activationCondition.selfTagsNone.some((t) => activeSelfTags.includes(t))) return false;
  }
  return true;
}

/**
 * Evaluates a universal `DnD35EffectBundle` (`DnD35EffectBundleSchema`), checking atomic bundle
 * suppression (`suppressedBundleIds`), evaluating `activationCondition`, and tagging all emitted
 * `StatModifier`s with hierarchical `sourcePath` provenance (`"<parentSourcePath>/bundle:<bundleId>/<modId>"`).
 *
 * @param bundle The Effect Bundle definition.
 * @param parentSourcePath Parent provenance path (e.g. `"class:cleric/domain:war"` or `"race:dwarf"`).
 * @param suppressedBundleIds Optional array of suppressed bundle IDs on the actor (e.g. traded domain power).
 * @param activeSelfTags Optional active semantic self-tags on the actor for `activationCondition` gating.
 * @returns `EvaluatedEffectBundleResult`.
 */
export function evaluateEffectBundle(
  bundle: DnD35EffectBundle,
  parentSourcePath: string,
  suppressedBundleIds: ReadonlyArray<string> = [],
  activeSelfTags?: ReadonlyArray<string>
): EvaluatedEffectBundleResult {
  if (suppressedBundleIds.includes(bundle.bundleId)) {
    return {
      isActive: false,
      statModifiers: [],
      ruleOverrides: [],
      grantedTags: [],
      grantedFeats: [],
      virtualFeatGrants: [],
      classSkillsAdded: [],
      immunities: [],
      vulnerabilities: [],
      activatedAbilities: []
    };
  }

  const isActive = isActivationConditionMet(bundle.activationCondition, activeSelfTags);
  if (!isActive) {
    return {
      isActive: false,
      statModifiers: [],
      ruleOverrides: [],
      grantedTags: [],
      grantedFeats: [],
      virtualFeatGrants: [],
      classSkillsAdded: [],
      immunities: [],
      vulnerabilities: [],
      activatedAbilities: []
    };
  }

  const bundlePath = appendSourcePath(parentSourcePath, `bundle:${bundle.bundleId}`);
  const origin =
    bundle.category === 'su' || bundle.category === 'domain_power' ? 'su' : bundle.category === 'sp' ? 'sp' : 'ex';

  const statModifiers: StatModifier[] = bundle.modifiers.map((mod) => {
    const mergedCondition: StatModifierCondition | undefined =
      bundle.activationCondition || mod.condition
        ? {
            ...(mod.condition ?? {}),
            ...(bundle.activationCondition?.selfTagsAll !== undefined || mod.condition?.selfTagsAll !== undefined
              ? {
                  selfTagsAll: Array.from(
                    new Set([...(bundle.activationCondition?.selfTagsAll ?? []), ...(mod.condition?.selfTagsAll ?? [])])
                  )
                }
              : {}),
            ...(bundle.activationCondition?.selfTagsAny !== undefined || mod.condition?.selfTagsAny !== undefined
              ? {
                  selfTagsAny: Array.from(
                    new Set([...(bundle.activationCondition?.selfTagsAny ?? []), ...(mod.condition?.selfTagsAny ?? [])])
                  )
                }
              : {}),
            ...(bundle.activationCondition?.selfTagsNone !== undefined || mod.condition?.selfTagsNone !== undefined
              ? {
                  selfTagsNone: Array.from(
                    new Set([
                      ...(bundle.activationCondition?.selfTagsNone ?? []),
                      ...(mod.condition?.selfTagsNone ?? [])
                    ])
                  )
                }
              : {})
          }
        : undefined;

    return {
      targetStat: mod.target,
      value: mod.value,
      bonusType: mod.type,
      sourceId: `${bundle.bundleId}:${mod.id}`,
      sourcePath: appendSourcePath(bundlePath, mod.id),
      origin,
      ...(mergedCondition !== undefined ? { condition: mergedCondition } : {})
    };
  });

  return {
    isActive: true,
    statModifiers,
    ruleOverrides: bundle.ruleOverrides,
    grantedTags: bundle.grantedTags,
    grantedFeats: bundle.grantedFeats,
    virtualFeatGrants: bundle.virtualFeatGrants,
    classSkillsAdded: bundle.classSkillsAdded,
    immunities: bundle.immunities,
    vulnerabilities: bundle.vulnerabilities,
    activatedAbilities: bundle.activatedAbilities
  };
}

/**
 * Emits declarative `StatModifier` entries for an actor's Creature Type (`type:construct` bonus HP by size)
 * and Subtypes (`subtype:incorporeal` Charisma deflection AC bonus, min +1, plus any declarative subtype modifiers),
 * tagging each modifier with its hierarchical `sourcePath` lineage.
 *
 * @param creatureType Optional creature type ID (`'construct'`, `'undead'`, etc.).
 * @param subtypes Optional array of creature subtypes (`'incorporeal'`, etc.).
 * @param chaModifier Resolved Charisma modifier of the actor.
 * @param parentSourcePath Optional parent provenance path (e.g. `'template:ghost'` or `'archetype:iron_golem'`).
 * @param systemContent Optional loaded system content containing `subtypes` and `creatureTypes`.
 * @returns Array of declarative `StatModifier` entries.
 */
export function buildCreatureTypeAndSubtypeModifiers(
  creatureType: string | undefined,
  subtypes: ReadonlyArray<string> | undefined,
  chaModifier = 0,
  parentSourcePath?: string,
  systemContent?: Record<string, unknown>
): ReadonlyArray<StatModifier> {
  const mods: StatModifier[] = [];

  if (creatureType === 'construct') {
    const typePath = appendSourcePath(parentSourcePath, 'type:construct/trait:construct_bonus_hp');
    const customBonusTable =
      (systemContent?.['creatureTypes'] as Record<string, DnD35CreatureTypeEngine> | undefined)?.['construct']
        ?.constructBonusHpBySize ?? CONSTRUCT_BONUS_HP_BY_SIZE;
    for (const [sizeKey, bonusHp] of Object.entries(customBonusTable)) {
      if (bonusHp !== undefined && bonusHp > 0) {
        mods.push({
          targetStat: 'max_hp',
          value: bonusHp,
          bonusType: 'untyped',
          sourceId: `type:construct:bonus_hp:${sizeKey}`,
          sourcePath: typePath,
          origin: 'ex',
          condition: {
            selfTagsAll: ['type:construct', `size:${sizeKey}`]
          }
        });
      }
    }
  }

  if (subtypes && subtypes.includes('incorporeal')) {
    const incorporealDeflection = Math.max(1, chaModifier);
    const subtypePath = appendSourcePath(parentSourcePath, 'subtype:incorporeal/deflection_ac');
    mods.push({
      targetStat: 'ac',
      value: incorporealDeflection,
      bonusType: 'deflection',
      sourceId: 'subtype:incorporeal:deflection_ac',
      sourcePath: subtypePath,
      origin: 'su',
      condition: {
        selfTagsAll: ['subtype:incorporeal']
      }
    });
  }

  const subtypeRegistry = systemContent?.['subtypes'] as Record<string, DnD35SubtypeDefinition> | undefined;
  if (subtypeRegistry && subtypes) {
    for (const subId of subtypes) {
      const subDef = subtypeRegistry[subId];
      if (!subDef) continue;
      const subRoot = appendSourcePath(parentSourcePath, `subtype:${subId}`);
      for (const m of subDef.modifiers) {
        mods.push({
          targetStat: m.target,
          value: m.value,
          bonusType: m.type,
          sourceId: `subtype:${subId}:${m.id}`,
          sourcePath: appendSourcePath(subRoot, m.id),
          origin: 'ex',
          ...(m.condition !== undefined ? { condition: m.condition } : {})
        });
      }
      for (const bundle of subDef.traitBundles) {
        const evalRes = evaluateEffectBundle(bundle, subRoot);
        mods.push(...evalRes.statModifiers);
      }
    }
  }

  return mods;
}

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
    tracks.push({
      trackId: cl.classId,
      levels: cl.levels,
      hitDieSides: clsDef?.hitDieSides ?? 8,
      babCurve:
        cl.classId === 'warrior' || cl.classId === 'fighter' || cl.classId === 'barbarian' ? 'full' : 'three_quarters',
      fortCurve: cl.classId === 'warrior' || cl.classId === 'fighter' ? 'good' : 'poor',
      refCurve: cl.classId === 'rogue' || cl.classId === 'ranger' ? 'good' : 'poor',
      willCurve: cl.classId === 'cleric' || cl.classId === 'wizard' || cl.classId === 'adept' ? 'good' : 'poor',
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
    ...(raceDef.spellResistance !== undefined ? { spellResistance: raceDef.spellResistance } : {}),
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
    ...(raceDef.anatomyBodyPlan !== undefined ? { anatomyBodyPlan: raceDef.anatomyBodyPlan } : {}),
    naturalWeapons: raceDef.naturalWeapons ?? [],
    hasPounce: raceDef.hasPounce ?? false,
    singleActionsOnly: raceDef.singleActionsOnly ?? false,
    advancementRanges: raceDef.rhdProgression?.advancementRanges ?? [],
    cr: computedCr
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

/**
 * Projects semantic creature type, subtype, and size tags (`type:<creatureType>`,
 * `subtype:<subtype>`, `size:<sizeCategory>`) from `DnD35EntityData` (`PRIM-1.1`),
 * merging them deduplicated with any existing tags on the entity.
 *
 * @param dndData Resolved `DnD35EntityData` of the actor.
 * @param existingTags Optional existing tags from `TagsComponent`.
 * @returns Deduplicated array of semantic tags for `matchesEntityTagCondition`.
 */
export function projectDnD35ActorSemanticTags(
  dndData: DnD35EntityData,
  existingTags: ReadonlyArray<string> = []
): ReadonlyArray<string> {
  const tags = new Set<string>(existingTags);
  tags.add(`size:${dndData.sizeCategory}`);
  if (dndData.creatureType) {
    tags.add(dndData.creatureType);
    tags.add(`type:${dndData.creatureType}`);
  }
  for (const subtype of dndData.subtypes ?? []) {
    tags.add(subtype);
    tags.add(`subtype:${subtype}`);
  }
  return Array.from(tags);
}

/**
 * Retrieves or deterministically hydrates `DnD35EntityData` for an entity.
 *
 * @param state The current GameState.
 * @param entityId The target entity ID.
 * @returns Resolved `DnD35EntityData`.
 */
export function getDnD35EntityData(state: GameState, entityId: EntityId): DnD35EntityData {
  const rulesetComp = getComponent(state, entityId, ComponentType.RulesetData) as RulesetDataComponent | undefined;
  if (rulesetComp && rulesetComp.rulesetId === 'dnd35e' && rulesetComp.payload['archetypeId'] !== undefined) {
    return rulesetComp.payload as unknown as DnD35EntityData;
  }

  const fighter = getComponent(state, entityId, ComponentType.Fighter) as FighterComponent | undefined;
  const isPlayer = getComponent(state, entityId, ComponentType.Player) !== undefined;

  const templateComp = getComponent(state, entityId, ComponentType.Template) as TemplateComponent | undefined;
  const entityTemplate = templateComp ? state.campaign.entities[templateComp.templateId] : undefined;
  const explicitArchetypeKey = entityTemplate?.archetypeId ?? (isPlayer ? 'player' : entityTemplate?.id);

  if (explicitArchetypeKey) {
    const resolvedArchetype = getDnD35Archetype(state.campaign.systemContent, explicitArchetypeKey);
    if (resolvedArchetype !== undefined) {
      const baseData = hydrateArchetypeData(
        resolvedArchetype,
        isPlayer ? Math.max(1, fighter?.level ?? 1) : undefined,
        state.campaign.systemContent
      );
      if (entityTemplate?.rulesetData) {
        return {
          ...baseData,
          ...(entityTemplate.rulesetData as Partial<DnD35EntityData>)
        };
      }
      return baseData;
    }
  }

  const identity = getComponent(state, entityId, ComponentType.Identity) as IdentityComponent | undefined;
  const lowerName = identity?.name.toLowerCase() ?? '';
  const systemRaces =
    (state.campaign.systemContent?.['races'] as Record<string, DnD35RaceDefinition> | undefined) ?? {};
  for (const [raceKey, raceDef] of Object.entries(systemRaces)) {
    if (lowerName.includes(raceKey)) {
      return hydrateArchetypeData(raceDef, undefined, state.campaign.systemContent);
    }
  }

  const hd = Math.max(1, fighter?.level ?? 1);
  const strScore = 10 + Math.max(0, (fighter?.attack ?? 2) * 2);
  const natArmor = Math.max(0, fighter?.defense ?? 1);

  return {
    archetypeId: 'creature',
    sizeCategory: 'medium',
    abilityScores: buildAbilityScoresRecord({
      str: strScore,
      dex: 12,
      con: 12,
      int: 8,
      wis: 10,
      cha: 8
    }),
    tracks: [
      {
        trackId: 'creature',
        levels: hd,
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
    armorBonus: 0,
    shieldBonus: 0,
    naturalArmorBonus: natArmor,
    energyResistance: {},
    immunities: [],
    vulnerabilities: [],
    nonlethalDamage: 0,
    tempHp: 0,
    isStable: true,
    conditions: [],
    feats: [],
    skillRanks: {}
  };
}

/**
 * Persists `DnD35EntityData` into the entity's `ComponentType.RulesetData` slice.
 */
export function setDnD35EntityData(state: GameState, entityId: EntityId, data: DnD35EntityData): GameState {
  return addComponent(state, entityId, {
    type: ComponentType.RulesetData,
    rulesetId: 'dnd35e',
    payload: data as unknown as Readonly<Record<string, unknown>>
  });
}

/**
 * Collects equipment modifiers from an entity's equipped items.
 */
export function getEquippedItemBonuses(
  state: GameState,
  entityId: EntityId
): { readonly equipAttackBonus: number; readonly equipArmorBonus: number } {
  const equipment = getComponent(state, entityId, ComponentType.Equipment) as EquipmentComponent | undefined;
  if (!equipment) {
    return { equipAttackBonus: 0, equipArmorBonus: 0 };
  }

  let equipAttackBonus = 0;
  let equipArmorBonus = 0;
  for (const slot of equipment.slots) {
    if (slot.equippedItem === null || slot.suppressed === true) continue;
    const itemComp = getComponent(state, slot.equippedItem, ComponentType.Item) as ItemComponent | undefined;
    const itemDef = itemComp ? state.campaign.items[itemComp.itemId] : undefined;
    if (itemDef?.equippable) {
      equipAttackBonus += itemDef.equippable.attackBonus ?? 0;
      equipArmorBonus += itemDef.equippable.defenseBonus ?? 0;
    }
  }
  return { equipAttackBonus, equipArmorBonus };
}

/**
 * Extracts the primary `DnD35DamageType` from a `DamageInstance`'s tags.
 */
export function resolveDamageTypeFromTags(tags: ReadonlyArray<string>): DnD35DamageType {
  const knownTypes: ReadonlyArray<DnD35DamageType> = [
    'bludgeoning',
    'piercing',
    'slashing',
    'acid',
    'cold',
    'electricity',
    'fire',
    'sonic',
    'force',
    'positive',
    'negative'
  ];
  for (const t of knownTypes) {
    if (tags.includes(t)) return t;
  }
  return tags.includes('physical') ? 'slashing' : 'untyped';
}

/**
 * Resolves an SRD race definition from campaign system content.
 */
export function getDnD35Race(
  systemContent: Record<string, unknown> | undefined,
  raceId: string
): DnD35RaceDefinition | undefined {
  const races = systemContent?.['races'] as Record<string, DnD35RaceDefinition> | undefined;
  return races?.[raceId];
}

/**
 * Resolves an SRD creature template from campaign system content.
 */
export function getDnD35Template(
  systemContent: Record<string, unknown> | undefined,
  templateId: string
): DnD35Template | undefined {
  const templates = systemContent?.['templates'] as Record<string, DnD35Template> | undefined;
  return templates?.[templateId];
}

/**
 * Resolves an SRD creature type engine definition from campaign system content.
 */
export function getDnD35CreatureTypeEngine(
  systemContent: Record<string, unknown> | undefined,
  typeId: string
): DnD35CreatureTypeEngine | undefined {
  const types = systemContent?.['creatureTypes'] as Record<string, DnD35CreatureTypeEngine> | undefined;
  return types?.[typeId];
}

/**
 * Resolves an SRD creature subtype definition from campaign system content.
 */
export function getDnD35Subtype(
  systemContent: Record<string, unknown> | undefined,
  subtypeId: string
): DnD35SubtypeDefinition | undefined {
  const subtypes = systemContent?.['subtypes'] as Record<string, DnD35SubtypeDefinition> | undefined;
  return subtypes?.[subtypeId];
}

/** Default Player Character archetype preset (Human Level 1 Fighter with Heroic Array). */
const DEFAULT_PLAYER_ARCHETYPE: DnD35Archetype = {
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
const DEFAULT_CREATURE_ARCHETYPE: DnD35Archetype = {
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
