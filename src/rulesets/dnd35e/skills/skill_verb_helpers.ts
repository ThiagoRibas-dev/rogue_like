import { addComponent, getComponent } from '../../../core/ecs.ts';
import { ComponentType, type PositionComponent, type RulesetDataComponent } from '../../../types/components.types.ts';
import type { EntityId, GameState } from '../../../types/game-state.types.ts';
import type { ApplyIntentTarget } from '../../../types/intents/interaction.intents.ts';
import { summarizeConditionEffects } from '../combat/maneuvers_conditions.ts';
import { evaluateDnD35ActorStatDAG } from '../modifiers.ts';
import { projectDnD35ActorSemanticTags, resolveEntitySituationalTagContext } from '../semantic_tags.ts';
import { resolveSkillCheck, type SkillCheckDefinition, type SkillCheckResult } from '../skills.ts';
import { getDnD35EntityData } from '../srd_registry.ts';
import type { AbilityId, DnD35EntityData, StatModifier } from '../types/dnd35e.types.ts';
import { getDnD35SystemContent } from '../types/dnd35e_system.types.ts';

/** Default Search DC (`20`) for hidden dungeon traps when not overridden on the entity. */
export const DEFAULT_TRAP_SEARCH_DC = 20;

/** Default Disable Device DC (`20`) for dungeon traps when not overridden on the entity. */
export const DEFAULT_TRAP_DISABLE_DC = 20;

/** Tile radius (`1` square = 5 ft) scanned around the target point during an active `search` verb. */
export const SEARCH_SCAN_RADIUS_TILES = 1;

/** Penalty (`-2`) applied to skill checks while suffering from the `shaken` or `frightened` condition. */
export const FEAR_SKILL_CHECK_PENALTY = -2;

/** Merchant session price markup modifier (`-0.2`) granted on a favorable social skill outcome. */
export const FAVORABLE_SOCIAL_MARKUP_MODIFIER = -0.2;

/** Merchant session price markup modifier (`+0.2`) applied on an unfavorable social skill outcome. */
export const UNFAVORABLE_SOCIAL_MARKUP_MODIFIER = 0.2;

/** Maximum Intelligence score (`2`) classified as Animal Intelligence for Feint penalties (PHB p. 68). */
export const ANIMAL_INTELLIGENCE_MAX_SCORE = 2;

/** Base Demoralize DC (`10`) before adding target HD and Wisdom modifier. */
export const DEMORALIZE_BASE_DC = 10;

/** Canonical mapping from D&D 3.5e Creature Type IDs to their Monster Lore Knowledge skill ID (PHB p. 78). */
export const CREATURE_TYPE_TO_KNOWLEDGE_SKILL: Readonly<Record<string, string>> = {
  aberration: 'knowledge_dungeoneering',
  animal: 'knowledge_nature',
  construct: 'knowledge_arcana',
  dragon: 'knowledge_arcana',
  elemental: 'knowledge_planes',
  fey: 'knowledge_nature',
  giant: 'knowledge_nature',
  humanoid: 'knowledge_local',
  magical_beast: 'knowledge_arcana',
  monstrous_humanoid: 'knowledge_nature',
  ooze: 'knowledge_dungeoneering',
  outsider: 'knowledge_planes',
  plant: 'knowledge_nature',
  undead: 'knowledge_religion',
  vermin: 'knowledge_nature'
};

/** Fallback core skill definitions when campaign `systemContent` is not loaded in minimal test fixtures. */
const FALLBACK_SKILL_DEFINITIONS: Readonly<Record<string, SkillCheckDefinition>> = {
  search: {
    skillId: 'search',
    keyAbility: 'int',
    trainedOnly: false,
    acpMultiplier: 0,
    synergyFromSkills: ['knowledge_architecture']
  },
  open_lock: {
    skillId: 'open_lock',
    keyAbility: 'dex',
    trainedOnly: true,
    acpMultiplier: 0,
    synergyFromSkills: []
  },
  disable_device: {
    skillId: 'disable_device',
    keyAbility: 'int',
    trainedOnly: true,
    acpMultiplier: 0,
    synergyFromSkills: []
  },
  heal: {
    skillId: 'heal',
    keyAbility: 'wis',
    trainedOnly: false,
    acpMultiplier: 0,
    synergyFromSkills: []
  },
  diplomacy: {
    skillId: 'diplomacy',
    keyAbility: 'cha',
    trainedOnly: false,
    acpMultiplier: 0,
    synergyFromSkills: ['bluff', 'knowledge_nobility', 'sense_motive']
  },
  intimidate: {
    skillId: 'intimidate',
    keyAbility: 'cha',
    trainedOnly: false,
    acpMultiplier: 0,
    synergyFromSkills: ['bluff']
  },
  bluff: {
    skillId: 'bluff',
    keyAbility: 'cha',
    trainedOnly: false,
    acpMultiplier: 0,
    synergyFromSkills: []
  },
  sense_motive: {
    skillId: 'sense_motive',
    keyAbility: 'wis',
    trainedOnly: false,
    acpMultiplier: 0,
    synergyFromSkills: []
  },
  use_magic_device: {
    skillId: 'use_magic_device',
    keyAbility: 'cha',
    trainedOnly: true,
    acpMultiplier: 0,
    synergyFromSkills: ['decipher_script', 'spellcraft'],
    take10Allowed: false,
    take20Allowed: false
  }
};

/**
 * Resolves `DnD35EntityData` for an entity, supporting both canonical `RulesetDataComponent.payload`
 * and legacy `rulesetState` test fixtures before falling back to `getDnD35EntityData`.
 */
export function resolveEntityDnD35Data(state: GameState, entityId: EntityId): DnD35EntityData {
  const base = getDnD35EntityData(state, entityId);
  const rulesetComp = getComponent(state, entityId, ComponentType.RulesetData) as
    (RulesetDataComponent & { readonly rulesetState?: Readonly<Record<string, unknown>> }) | undefined;
  const legacyState = rulesetComp?.rulesetState;
  if (!legacyState) {
    return base;
  }
  return {
    ...base,
    ...(legacyState as Partial<DnD35EntityData>),
    abilityScores: {
      ...base.abilityScores,
      ...((legacyState['abilityScores'] as Partial<DnD35EntityData['abilityScores']> | undefined) ?? {})
    },
    skillRanks: {
      ...base.skillRanks,
      ...((legacyState['skillRanks'] as Readonly<Record<string, number>> | undefined) ?? {})
    }
  };
}

/**
 * Evaluates a D&D 3.5e skill check for an actor in `GameState` using the full 4-Stage Stat DAG.
 */
export function evaluateActorSkillCheck(
  state: GameState,
  actorId: EntityId,
  skillId: string,
  dc: number,
  takeMode: 'roll' | 'take10' | 'take20' = 'roll'
): { readonly check: SkillCheckResult; readonly dndData: DnD35EntityData } {
  const dndData = resolveEntityDnD35Data(state, actorId);
  const sys = getDnD35SystemContent(state.campaign);
  const sysSkillDef = sys?.skills[skillId];

  const definition: SkillCheckDefinition = sysSkillDef
    ? {
        skillId: sysSkillDef.id,
        keyAbility: sysSkillDef.keyAbility,
        trainedOnly: sysSkillDef.trainedOnly,
        acpMultiplier: sysSkillDef.acpMultiplier,
        synergyFromSkills: sysSkillDef.synergyFromSkills,
        take10Allowed: sysSkillDef.take10Allowed,
        take20Allowed: sysSkillDef.take20Allowed
      }
    : (FALLBACK_SKILL_DEFINITIONS[skillId] ?? {
        skillId,
        keyAbility: 'int',
        trainedOnly: skillId.startsWith('knowledge_'),
        acpMultiplier: 0,
        synergyFromSkills: []
      });

  const condSummary = summarizeConditionEffects(dndData.conditions);
  const situationalContext = resolveEntitySituationalTagContext(state, actorId, dndData);
  const selfTags = projectDnD35ActorSemanticTags(dndData, [], situationalContext, sys?.classes, sys?.skills);

  const dagResult = evaluateDnD35ActorStatDAG({
    baseSize: dndData.sizeCategory,
    rawAbilities: {
      str: {
        ...dndData.abilityScores.str,
        tempPenalty: (dndData.abilityScores.str?.tempPenalty ?? 0) + condSummary.strPenalty
      },
      dex: {
        ...dndData.abilityScores.dex,
        tempPenalty: (dndData.abilityScores.dex?.tempPenalty ?? 0) + condSummary.dexPenalty
      },
      con: dndData.abilityScores.con,
      int: dndData.abilityScores.int,
      wis: dndData.abilityScores.wis,
      cha: dndData.abilityScores.cha
    },
    tracks: dndData.tracks,
    baseNaturalArmor: dndData.naturalArmorBonus,
    armorBonus: dndData.armorBonus,
    shieldBonus: dndData.shieldBonus,
    statModifiers: dndData.statModifiers ?? [],
    context: { selfTags }
  });

  const keyAbility: AbilityId = definition.keyAbility;
  const keyAbilityModifier = dagResult.effectiveAbilityModifiers[keyAbility];

  const skillModifiers: StatModifier[] = (dndData.statModifiers ?? []).filter(
    (m) => m.targetStat === `skill:${skillId}` || m.targetStat === 'skills'
  );
  if (
    dndData.conditions.includes('shaken') ||
    dndData.conditions.includes('frightened') ||
    dndData.conditions.includes('panicked')
  ) {
    skillModifiers.push({
      targetStat: `skill:${skillId}`,
      value: FEAR_SKILL_CHECK_PENALTY,
      bonusType: 'untyped',
      sourceId: 'condition_fear',
      sourcePath: 'condition:fear/skill_penalty',
      origin: 'ex'
    });
  }

  const check = resolveSkillCheck({
    definition,
    rawRanks: dndData.skillRanks[skillId] ?? 0,
    allSkillRanks: dndData.skillRanks,
    keyAbilityModifier,
    armorCheckPenalty: 0,
    modifiers: skillModifiers,
    dc,
    takeMode
  });

  return { check, dndData };
}

/**
 * Persists an updated `DnD35EntityData` snapshot onto an entity's `RulesetDataComponent`.
 */
export function saveEntityDnD35Data(state: GameState, entityId: EntityId, updatedData: DnD35EntityData): GameState {
  return addComponent(state, entityId, {
    type: ComponentType.RulesetData,
    rulesetId: 'dnd35e',
    payload: updatedData as unknown as Readonly<Record<string, unknown>>
  });
}

/**
 * Finds the first entity at a target coordinate or entity reference that possesses a given component type.
 */
export function findTargetEntityWithComponent(
  state: GameState,
  target: ApplyIntentTarget,
  compType: ComponentType
): EntityId | undefined {
  if (target.type === 'entity') {
    if (getComponent(state, target.entityId, compType) !== undefined) {
      return target.entityId;
    }
    const pos = getComponent(state, target.entityId, ComponentType.Position) as PositionComponent | undefined;
    if (pos) {
      const entitiesAt = state.spatialIndex.get(`${pos.x},${pos.y}`) ?? [];
      return entitiesAt.find((id) => getComponent(state, id, compType) !== undefined);
    }
    return undefined;
  }
  if (target.type === 'tile') {
    const entitiesAt = state.spatialIndex.get(`${target.x},${target.y}`) ?? [];
    return entitiesAt.find((id) => getComponent(state, id, compType) !== undefined);
  }
  return undefined;
}
