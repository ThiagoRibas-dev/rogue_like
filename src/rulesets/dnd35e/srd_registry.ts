import { addComponent, getComponent } from '../../core/ecs.ts';
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
import { buildAbilityScoresRecord, getDnD35Archetype, hydrateArchetypeData } from './archetype_resolver.ts';
import type { DnD35DamageType, DnD35EntityData } from './types/dnd35e.types.ts';
import type {
  DnD35CreatureTypeEngine,
  DnD35RaceDefinition,
  DnD35SubtypeDefinition,
  DnD35Template
} from './types/dnd35e_system.types.ts';

// Re-export extracted single-concern modules for backward compatibility (Rule 15)
export { type EvaluatedEffectBundleResult, isActivationConditionMet, evaluateEffectBundle } from './effect_bundle.ts';

export {
  CONSTRUCT_BONUS_HP_BY_SIZE,
  type SituationalTagContext,
  HEAVY_ARMOR_BONUS_THRESHOLD,
  MEDIUM_ARMOR_BONUS_THRESHOLD,
  DEFAULT_ACROBATIC_SKILL_THRESHOLD_RANKS,
  buildCreatureTypeAndSubtypeModifiers,
  projectDnD35ActorSemanticTags,
  resolveEntitySituationalTagContext
} from './semantic_tags.ts';

export {
  buildAbilityScoresRecord,
  hydrateRaceAsArchetype,
  hydrateArchetypeData,
  DEFAULT_PLAYER_ARCHETYPE,
  DEFAULT_CREATURE_ARCHETYPE,
  getDnD35Archetype
} from './archetype_resolver.ts';

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
