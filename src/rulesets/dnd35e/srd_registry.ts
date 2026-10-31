import { addComponent, getComponent } from '../../core/ecs.ts';
import type { DnD35Archetype } from './types/dnd35e_system.types.ts';
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
import { createAbilityScoreState } from './abilities.ts';
import type { AbilityScoresRecord, DnD35DamageType, DnD35EntityData } from './types/dnd35e.types.ts';

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

  return {
    archetypeId: archetype.archetypeId,
    sizeCategory: archetype.sizeCategory,
    abilityScores: buildAbilityScoresRecord(archetype.abilityScores),
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
    skillRanks: archetype.skillRanks
  };
}

/**
 * Retrieves or deterministically hydrates `DnD35EntityData` for an entity from:
 * 1. Its live `ComponentType.RulesetData` slice (`rulesetId === 'dnd35e'`),
 * 2. Its campaign `EntityTemplate` (`archetypeId` / `id` + optional `rulesetData` override)
 *    looked up in `state.campaign.systemContent?.archetypes` (`public/data/rulesets/dnd35e/archetypes.json`),
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

  if (explicitArchetypeKey && systemArchetypes[explicitArchetypeKey] !== undefined) {
    const baseData = hydrateArchetypeData(
      systemArchetypes[explicitArchetypeKey]!,
      isPlayer ? Math.max(1, fighter?.level ?? 1) : undefined
    );
    if (entityTemplate?.rulesetData) {
      return {
        ...baseData,
        ...(entityTemplate.rulesetData as Partial<DnD35EntityData>)
      };
    }
    return baseData;
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
    if (slot.equippedItem === null) continue;
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
