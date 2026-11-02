import { addComponent, getComponent } from '../../core/ecs.ts';
import type {
  DnD35Archetype,
  DnD35CreatureTypeEngine,
  DnD35DragonFamiliesData,
  DnD35RaceDefinition,
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
import { synthesizeElementalArchetype, synthesizeTrueDragonArchetype } from './family_synthesizer.ts';
import { appendSourcePath } from './modifiers.ts';
import type {
  AbilityScoresRecord,
  CreatureSizeCategory,
  DnD35DamageType,
  DnD35EntityData,
  StatModifier
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

/**
 * Emits declarative `StatModifier` entries for an actor's Creature Type (`type:construct` bonus HP by size)
 * and Subtypes (`subtype:incorporeal` Charisma deflection AC bonus, min +1), tagging each modifier with its
 * hierarchical `sourcePath` lineage.
 *
 * @param creatureType Optional creature type ID (`'construct'`, `'undead'`, etc.).
 * @param subtypes Optional array of creature subtypes (`'incorporeal'`, etc.).
 * @param chaModifier Resolved Charisma modifier of the actor.
 * @param parentSourcePath Optional parent provenance path (e.g. `'template:ghost'` or `'archetype:iron_golem'`).
 * @returns Array of declarative `StatModifier` entries.
 */
export function buildCreatureTypeAndSubtypeModifiers(
  creatureType: string | undefined,
  subtypes: ReadonlyArray<string> | undefined,
  chaModifier = 0,
  parentSourcePath?: string
): ReadonlyArray<StatModifier> {
  const mods: StatModifier[] = [];

  if (creatureType === 'construct') {
    const typePath = appendSourcePath(parentSourcePath, 'type:construct/trait:construct_bonus_hp');
    for (const [sizeKey, bonusHp] of Object.entries(CONSTRUCT_BONUS_HP_BY_SIZE)) {
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
 * Hydrates a runtime `DnD35EntityData` instance from a declarative `SystemArchetype`
 * loaded from `public/data/rulesets/dnd35e/archetypes.json`.
 *
 * @param archetype Declarative `SystemArchetype` JSON definition.
 * @param levelOverride Optional character/monster level override from `FighterComponent`.
 * @returns Runtime `DnD35EntityData`.
 */
export function hydrateArchetypeData(archetype: DnD35Archetype, levelOverride?: number): DnD35EntityData {
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
    `archetype:${archetype.archetypeId}`
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
 * Retrieves or deterministically hydrates `DnD35EntityData` for an entity from:
 * 1. Its live `ComponentType.RulesetData` slice (`rulesetId === 'dnd35e'`),
 * 2. Its campaign `EntityTemplate` (`archetypeId` / `id` + optional `rulesetData` override)
 *    looked up via `getDnD35Archetype` (supporting both `archetypes.json` and synthesized Dragons/Elementals),
 * 3. Its `IdentityComponent` name matching a registered system archetype key, or
 * 4. Dynamic derivation from its `FighterComponent`.
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

  const systemArchetypes =
    (state.campaign.systemContent?.['archetypes'] as Record<string, DnD35Archetype> | undefined) ?? {};
  const fighter = getComponent(state, entityId, ComponentType.Fighter) as FighterComponent | undefined;
  const isPlayer = getComponent(state, entityId, ComponentType.Player) !== undefined;

  const templateComp = getComponent(state, entityId, ComponentType.Template) as TemplateComponent | undefined;
  const entityTemplate = templateComp ? state.campaign.entities[templateComp.templateId] : undefined;
  const explicitArchetypeKey = entityTemplate?.archetypeId ?? (isPlayer ? 'player' : entityTemplate?.id);

  if (explicitArchetypeKey) {
    const resolvedArchetype = getDnD35Archetype(state.campaign.systemContent, explicitArchetypeKey);
    if (resolvedArchetype !== undefined) {
      const baseData = hydrateArchetypeData(resolvedArchetype, isPlayer ? Math.max(1, fighter?.level ?? 1) : undefined);
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
  for (const [archKey, archDef] of Object.entries(systemArchetypes)) {
    if (archKey !== 'default_creature' && lowerName.includes(archKey)) {
      return hydrateArchetypeData(archDef);
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
        skillPointsPerLevel: 2
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
 *
 * @param state Current GameState.
 * @param entityId Target entity ID.
 * @param data Updated `DnD35EntityData`.
 * @returns Updated GameState.
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
 *
 * @param state Current GameState.
 * @param entityId Target entity ID.
 * @returns `{ equipAttackBonus: number, equipArmorBonus: number }`.
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
 *
 * @param tags Array of string tags on the `DamageInstance`.
 * @returns Resolved `DnD35DamageType`.
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
 * Resolves a DnD35Archetype by ID, automatically synthesizing True Dragons
 * (`dragon_<variety>_<age>`) or Elementals (`elemental_<element>_<step>`) if not explicitly pre-authored.
 */
export function getDnD35Archetype(
  systemContent: Record<string, unknown> | undefined,
  archetypeId: string
): DnD35Archetype | undefined {
  const archetypes = systemContent?.['archetypes'] as Record<string, DnD35Archetype> | undefined;
  if (archetypes?.[archetypeId]) {
    return archetypes[archetypeId];
  }

  const dragonFamilies = systemContent?.['dragonFamilies'] as DnD35DragonFamiliesData | undefined;

  if (dragonFamilies) {
    if (archetypeId.startsWith('dragon_')) {
      const parts = archetypeId.split('_');
      // Format: dragon_<variety>_<age...>
      if (parts.length >= 3) {
        const varietyId = parts[1]!;
        const ageCategoryId = parts.slice(2).join('_');
        if (dragonFamilies.varieties[varietyId] && dragonFamilies.ageCategories[ageCategoryId]) {
          return synthesizeTrueDragonArchetype(dragonFamilies, varietyId, ageCategoryId);
        }
      }
    }

    if (archetypeId.startsWith('elemental_')) {
      const parts = archetypeId.split('_');
      // Format: elemental_<element>_<step>
      if (parts.length >= 3) {
        const elementId = parts[1] as 'air' | 'earth' | 'fire' | 'water';
        const stepId = parts.slice(2).join('_');
        if (dragonFamilies.elementalSteps[stepId]) {
          return synthesizeElementalArchetype(dragonFamilies, elementId, stepId);
        }
      }
    }
  }

  return undefined;
}
