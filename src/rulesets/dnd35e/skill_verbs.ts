import type { Verb } from '../../constants/verbs.constants.ts';
import { addComponent, getComponent, queryEntities, removeComponent } from '../../core/ecs.ts';
import { addMessage, MessageLogCategory } from '../../systems/message.system.ts';
import {
  type AttitudeComponent,
  type AttitudeTier,
  ComponentType,
  type LockComponent,
  type MemoryComponent,
  type PositionComponent,
  type RulesetDataComponent,
  type TrapComponent
} from '../../types/components.types.ts';
import {
  type ApplyFailedEvent,
  type ApplyResolvedEvent,
  type GameEvent,
  GameEventType
} from '../../types/events.types.ts';
import { type EntityId, type GameState, UIMode } from '../../types/game-state.types.ts';
import type { ApplyIntent, ApplyIntentTarget } from '../../types/intents/interaction.intents.ts';
import { summarizeConditionEffects } from './combat/maneuvers_conditions.ts';
import { evaluateDnD35ActorStatDAG } from './modifiers.ts';
import { aggregateProgressionChassis } from './progression.ts';
import {
  DIPLOMACY_INDIFFERENT_TO_FRIENDLY_DC,
  FEINT_ANIMAL_INTELLIGENCE_PENALTY,
  FEINT_NON_HUMANOID_PENALTY,
  HEAL_SKILL_STANDARD_DC,
  OPEN_LOCK_DEFAULT_SIMPLE_DC,
  resolveDemoralizeCheck,
  resolveDiplomacyCheck,
  resolveDisableTrapCheck,
  resolveFeintCheck,
  resolveHealSkillCheck,
  resolveMonsterLoreCheck,
  resolveOpenLockCheck,
  resolveSkillCheck,
  resolveTrapSearchCheck,
  type SkillCheckDefinition,
  type SkillCheckResult,
  TAKE_10_VALUE,
  UMD_ACTIVATE_WAND_DC
} from './skills.ts';
import { getDnD35EntityData } from './srd_registry.ts';
import { projectDnD35ActorSemanticTags, resolveEntitySituationalTagContext } from './semantic_tags.ts';
import type { AbilityId, DnD35ConditionId, DnD35EntityData, StatModifier } from './types/dnd35e.types.ts';
import { getDnD35SystemContent } from './types/dnd35e_system.types.ts';

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

/** Class track IDs that natively grant arcane or divine Spell Trigger wand activation without a UMD check. */
const SPELL_TRIGGER_CLASS_TRACK_IDS: ReadonlyArray<string> = [
  'wizard',
  'sorcerer',
  'cleric',
  'druid',
  'bard',
  'paladin',
  'ranger',
  'archmage',
  'loremaster',
  'eldritch_knight',
  'arcane_trickster',
  'mystic_theurge',
  'thaumaturgist',
  'hierophant'
];

/**
 * Resolves `DnD35EntityData` for an entity, supporting both canonical `RulesetDataComponent.payload`
 * and legacy `rulesetState` test fixtures before falling back to `getDnD35EntityData`.
 *
 * @param state The current GameState.
 * @param entityId The target entity ID.
 * @returns Hydrated `DnD35EntityData`.
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
 * Evaluates a D&D 3.5e skill check for an actor in `GameState` using the full 4-Stage Stat DAG
 * (incorporating effective ability scores, synergies, ACP, typed `StatModifier` bonuses, and condition penalties).
 *
 * @param state The current GameState.
 * @param actorId The acting entity ID.
 * @param skillId The skill identifier (e.g. `'open_lock'`, `'diplomacy'`, `'use_magic_device'`).
 * @param dc Target Difficulty Class.
 * @param takeMode Optional roll mode (`'roll' | 'take10' | 'take20'`).
 * @returns Resolved `SkillCheckResult` and hydrated `DnD35EntityData`.
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
 *
 * @param state The current GameState.
 * @param entityId The target entity ID.
 * @param updatedData The updated `DnD35EntityData`.
 * @returns Updated GameState.
 */
function saveEntityDnD35Data(state: GameState, entityId: EntityId, updatedData: DnD35EntityData): GameState {
  return addComponent(state, entityId, {
    type: ComponentType.RulesetData,
    rulesetId: 'dnd35e',
    payload: updatedData as unknown as Readonly<Record<string, unknown>>
  });
}

/**
 * Finds the first entity at a target coordinate or entity reference that possesses a given component type.
 *
 * @param state The current GameState.
 * @param target The `ApplyIntentTarget`.
 * @param compType The `ComponentType` to search for.
 * @returns Matching `EntityId` or `undefined`.
 */
function findTargetEntityWithComponent(
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

/**
 * Resolves D&D 3.5e active dungeon and combat skill verbs (`search`, `unlock`, `disarm`, `heal`, `persuade`, `intimidate`, `feint`).
 *
 * @param state The current GameState.
 * @param intent The `ApplyIntent` being executed.
 * @returns `{ state, success, events }` if handled by D&D 3.5e skill verbs, or `null` to fall through.
 */
export function resolveDnD35eSkillVerb(
  state: GameState,
  intent: ApplyIntent
): { state: GameState; success: boolean; events?: readonly GameEvent[] } | null {
  switch (intent.verb) {
    case 'search': {
      const { check, dndData } = evaluateActorSkillCheck(state, intent.entityId, 'search', DEFAULT_TRAP_SEARCH_DC);
      const hasTrapfinding = (dndData.activeClassFeatures ?? []).includes('trapfinding');

      const centerPos: { readonly x: number; readonly y: number } | undefined =
        intent.target.type === 'tile'
          ? { x: intent.target.x, y: intent.target.y }
          : intent.target.type === 'entity'
            ? (getComponent(state, intent.target.entityId, ComponentType.Position) as PositionComponent | undefined)
            : (getComponent(state, intent.entityId, ComponentType.Position) as PositionComponent | undefined);

      let spottedTraps = 0;
      if (centerPos) {
        for (let dy = -SEARCH_SCAN_RADIUS_TILES; dy <= SEARCH_SCAN_RADIUS_TILES; dy++) {
          for (let dx = -SEARCH_SCAN_RADIUS_TILES; dx <= SEARCH_SCAN_RADIUS_TILES; dx++) {
            const entitiesAt = state.spatialIndex.get(`${centerPos.x + dx},${centerPos.y + dy}`) ?? [];
            for (const eid of entitiesAt) {
              const trap = getComponent(state, eid, ComponentType.Trap) as TrapComponent | undefined;
              if (trap && !trap.triggered) {
                if (resolveTrapSearchCheck(check.totalRoll, DEFAULT_TRAP_SEARCH_DC, hasTrapfinding)) {
                  spottedTraps++;
                }
              }
            }
          }
        }
      }

      const msg =
        spottedTraps > 0
          ? `You search carefully (Search roll: ${check.totalRoll}) and spot ${spottedTraps} hidden trap mechanism(s)!`
          : `You search carefully (Search roll: ${check.totalRoll}). Nothing hidden found nearby.`;

      const event: ApplyResolvedEvent = {
        type: GameEventType.ApplyResolved,
        entityId: intent.entityId,
        verb: intent.verb,
        target: intent.target,
        toolEntityId: intent.toolEntityId
      };
      return {
        state: addMessage(state, msg, MessageLogCategory.System),
        success: true,
        events: [event]
      };
    }

    case 'unlock': {
      const lockEntityId = findTargetEntityWithComponent(state, intent.target, ComponentType.Lock);
      const lockComp =
        lockEntityId !== undefined
          ? (getComponent(state, lockEntityId, ComponentType.Lock) as LockComponent | undefined)
          : undefined;
      const lockDc = lockComp && lockComp.difficulty > 0 ? lockComp.difficulty : OPEN_LOCK_DEFAULT_SIMPLE_DC;

      const { check } = evaluateActorSkillCheck(state, intent.entityId, 'open_lock', lockDc);
      if (!check.allowed) {
        return {
          state: addMessage(state, 'You cannot pick locks without training in Open Lock.', MessageLogCategory.System),
          success: false
        };
      }

      if (lockComp?.jammed === true) {
        return {
          state: addMessage(state, 'The lock mechanism is jammed and cannot be picked.', MessageLogCategory.System),
          success: false
        };
      }

      const success = resolveOpenLockCheck(check.totalRoll, lockDc);
      let nextState = state;
      if (success && lockEntityId !== undefined && lockComp !== undefined) {
        nextState = addComponent(nextState, lockEntityId, {
          ...lockComp,
          locked: false
        });
      }

      const event: ApplyResolvedEvent | ApplyFailedEvent = success
        ? {
            type: GameEventType.ApplyResolved,
            entityId: intent.entityId,
            verb: intent.verb,
            target: intent.target,
            toolEntityId: intent.toolEntityId
          }
        : {
            type: GameEventType.ApplyFailed,
            entityId: intent.entityId,
            verb: intent.verb,
            target: intent.target,
            toolEntityId: intent.toolEntityId,
            reason: 'Open Lock check failed'
          };

      return {
        state: addMessage(
          nextState,
          success
            ? `You successfully pick the lock (roll: ${check.totalRoll} vs DC ${lockDc})!`
            : `You fail to pick the lock (roll: ${check.totalRoll} vs DC ${lockDc}).`,
          MessageLogCategory.System
        ),
        success,
        events: [event]
      };
    }

    case 'disarm': {
      const trapEntityId = findTargetEntityWithComponent(state, intent.target, ComponentType.Trap);
      const trapComp =
        trapEntityId !== undefined
          ? (getComponent(state, trapEntityId, ComponentType.Trap) as TrapComponent | undefined)
          : undefined;
      const trapDc = DEFAULT_TRAP_DISABLE_DC;

      const { check, dndData } = evaluateActorSkillCheck(state, intent.entityId, 'disable_device', trapDc);
      if (!check.allowed) {
        return {
          state: addMessage(
            state,
            'You cannot disarm mechanisms without training in Disable Device.',
            MessageLogCategory.System
          ),
          success: false
        };
      }

      const hasTrapfinding = (dndData.activeClassFeatures ?? []).includes('trapfinding');
      const isMagicTrap = trapComp?.triggerId.includes('magic') === true;
      const disarmOutcome = resolveDisableTrapCheck(check.totalRoll, trapDc, isMagicTrap, hasTrapfinding);

      let nextState = state;
      if (disarmOutcome.success && trapEntityId !== undefined && trapComp !== undefined) {
        nextState = removeComponent(nextState, trapEntityId, ComponentType.Trap);
      } else if (disarmOutcome.triggeredTrap && trapEntityId !== undefined && trapComp !== undefined) {
        nextState = addComponent(nextState, trapEntityId, {
          ...trapComp,
          triggered: true
        });
      }

      const event: ApplyResolvedEvent | ApplyFailedEvent = disarmOutcome.success
        ? {
            type: GameEventType.ApplyResolved,
            entityId: intent.entityId,
            verb: intent.verb,
            target: intent.target,
            toolEntityId: intent.toolEntityId
          }
        : {
            type: GameEventType.ApplyFailed,
            entityId: intent.entityId,
            verb: intent.verb,
            target: intent.target,
            toolEntityId: intent.toolEntityId,
            reason: disarmOutcome.triggeredTrap
              ? 'Disable Device failed by 5+ and sprung trap'
              : 'Disable Device check failed'
          };

      const msg = disarmOutcome.success
        ? `You successfully disarm the mechanism (roll: ${check.totalRoll} vs DC ${trapDc})!`
        : disarmOutcome.triggeredTrap
          ? `Your Disable Device attempt goes awry (roll: ${check.totalRoll} vs DC ${trapDc}) and springs the trap!`
          : `You fail to disarm the mechanism (roll: ${check.totalRoll} vs DC ${trapDc}).`;

      return {
        state: addMessage(nextState, msg, MessageLogCategory.System),
        success: disarmOutcome.success,
        events: [event]
      };
    }

    case 'heal': {
      const { check } = evaluateActorSkillCheck(state, intent.entityId, 'heal', HEAL_SKILL_STANDARD_DC);
      const success = resolveHealSkillCheck(check.totalRoll, HEAL_SKILL_STANDARD_DC);

      let nextState = state;
      if (success && intent.target.type === 'entity') {
        const patientId = intent.target.entityId;
        const patientDnd = resolveEntityDnD35Data(nextState, patientId);
        const updatedPatient: DnD35EntityData = {
          ...patientDnd,
          isStable: true
        };
        nextState = saveEntityDnD35Data(nextState, patientId, updatedPatient);
      }

      const event: ApplyResolvedEvent | ApplyFailedEvent = success
        ? {
            type: GameEventType.ApplyResolved,
            entityId: intent.entityId,
            verb: intent.verb,
            target: intent.target,
            toolEntityId: intent.toolEntityId
          }
        : {
            type: GameEventType.ApplyFailed,
            entityId: intent.entityId,
            verb: intent.verb,
            target: intent.target,
            toolEntityId: intent.toolEntityId,
            reason: 'Heal check failed'
          };

      return {
        state: addMessage(
          nextState,
          success
            ? `You administer First Aid (Heal check: ${check.totalRoll} vs DC ${HEAL_SKILL_STANDARD_DC}). The patient is stabilized.`
            : `Your First Aid attempt fails (Heal check: ${check.totalRoll} vs DC ${HEAL_SKILL_STANDARD_DC}).`,
          MessageLogCategory.System
        ),
        success,
        events: [event]
      };
    }

    case 'persuade': {
      if (intent.target.type !== 'entity') {
        return {
          state: addMessage(state, 'You can only do that to a creature.', MessageLogCategory.System),
          success: false
        };
      }
      const npcId = intent.target.entityId;
      const { check } = evaluateActorSkillCheck(
        state,
        intent.entityId,
        'diplomacy',
        DIPLOMACY_INDIFFERENT_TO_FRIENDLY_DC
      );
      const currentAttitude: AttitudeTier =
        (getComponent(state, npcId, ComponentType.Attitude) as AttitudeComponent | undefined)?.attitude ??
        'indifferent';
      const diplomacyResult = resolveDiplomacyCheck(currentAttitude, check.totalRoll);
      const isFavorable =
        diplomacyResult.changed ||
        diplomacyResult.newAttitude === 'friendly' ||
        diplomacyResult.newAttitude === 'helpful';

      let nextState = addComponent(state, npcId, {
        type: ComponentType.Attitude,
        attitude: diplomacyResult.newAttitude
      });

      const npcMemory = getComponent(nextState, npcId, ComponentType.Memory) as MemoryComponent | undefined;
      if (npcMemory) {
        nextState = addComponent(nextState, npcId, {
          ...npcMemory,
          sessionMarkupModifier: isFavorable ? FAVORABLE_SOCIAL_MARKUP_MODIFIER : UNFAVORABLE_SOCIAL_MARKUP_MODIFIER
        });
      }

      nextState = addMessage(
        nextState,
        isFavorable
          ? `You persuade them with Diplomacy (roll: ${check.totalRoll}, attitude: ${diplomacyResult.newAttitude}). Prices improve.`
          : `Your Diplomacy fails to convince them (roll: ${check.totalRoll}, attitude: ${diplomacyResult.newAttitude}). Prices worsen.`,
        MessageLogCategory.System
      );

      const event: ApplyResolvedEvent = {
        type: GameEventType.ApplyResolved,
        entityId: intent.entityId,
        verb: intent.verb,
        target: intent.target,
        toolEntityId: intent.toolEntityId
      };
      return { state: nextState, success: isFavorable, events: [event] };
    }

    case 'intimidate': {
      if (intent.target.type !== 'entity') {
        return {
          state: addMessage(state, 'You can only do that to a creature.', MessageLogCategory.System),
          success: false
        };
      }
      const npcId = intent.target.entityId;
      const { check } = evaluateActorSkillCheck(state, intent.entityId, 'intimidate', DEMORALIZE_BASE_DC);
      const { check: targetSenseCheck, dndData: npcDnd } = evaluateActorSkillCheck(
        state,
        npcId,
        'sense_motive',
        0,
        'take10'
      );
      const npcChassis = aggregateProgressionChassis(npcDnd.tracks, 0);
      const npcWisMod = targetSenseCheck.totalModifier - targetSenseCheck.wholeRanks - targetSenseCheck.synergyBonus;

      const success = resolveDemoralizeCheck(check.totalRoll, Math.max(1, npcChassis.totalHD), npcWisMod);
      let nextState = state;

      if (success) {
        const updatedConditions: ReadonlyArray<DnD35ConditionId> = npcDnd.conditions.includes('shaken')
          ? npcDnd.conditions
          : [...npcDnd.conditions, 'shaken'];
        nextState = saveEntityDnD35Data(nextState, npcId, {
          ...npcDnd,
          conditions: updatedConditions
        });
      }

      const npcMemory = getComponent(nextState, npcId, ComponentType.Memory) as MemoryComponent | undefined;
      if (npcMemory) {
        nextState = addComponent(nextState, npcId, {
          ...npcMemory,
          sessionMarkupModifier: success ? FAVORABLE_SOCIAL_MARKUP_MODIFIER : UNFAVORABLE_SOCIAL_MARKUP_MODIFIER
        });
      }

      nextState = addMessage(
        nextState,
        success
          ? `You demoralize them with Intimidate (roll: ${check.totalRoll})! Target is Shaken.`
          : `They resist your intimidation (roll: ${check.totalRoll}).`,
        MessageLogCategory.System
      );

      const event: ApplyResolvedEvent = {
        type: GameEventType.ApplyResolved,
        entityId: intent.entityId,
        verb: intent.verb,
        target: intent.target,
        toolEntityId: intent.toolEntityId
      };
      return { state: nextState, success, events: [event] };
    }

    case 'feint': {
      if (intent.target.type !== 'entity') {
        return {
          state: addMessage(state, 'You can only do that to a creature.', MessageLogCategory.System),
          success: false
        };
      }
      const npcId = intent.target.entityId;
      const { check: bluffCheck } = evaluateActorSkillCheck(state, intent.entityId, 'bluff', 0);
      const { check: npcSenseCheck, dndData: npcDnd } = evaluateActorSkillCheck(
        state,
        npcId,
        'sense_motive',
        0,
        'take10'
      );

      const npcIntScore = npcDnd.abilityScores.int.base;
      let morphologyPenalty = 0;
      if (npcIntScore !== null && npcIntScore <= ANIMAL_INTELLIGENCE_MAX_SCORE) {
        morphologyPenalty = FEINT_ANIMAL_INTELLIGENCE_PENALTY;
      } else if (npcDnd.creatureType !== undefined && npcDnd.creatureType !== 'humanoid') {
        morphologyPenalty = FEINT_NON_HUMANOID_PENALTY;
      }

      const feintTotal = bluffCheck.totalRoll + morphologyPenalty;
      const npcChassis = aggregateProgressionChassis(npcDnd.tracks, 0);
      const npcWisMod = npcSenseCheck.totalModifier - npcSenseCheck.wholeRanks - npcSenseCheck.synergyBonus;

      const success = resolveFeintCheck(feintTotal, npcSenseCheck.totalModifier, npcChassis.totalBab, npcWisMod);
      let nextState = state;

      if (success) {
        const updatedConditions: ReadonlyArray<DnD35ConditionId> = npcDnd.conditions.includes('flat_footed')
          ? npcDnd.conditions
          : [...npcDnd.conditions, 'flat_footed'];
        nextState = saveEntityDnD35Data(nextState, npcId, {
          ...npcDnd,
          conditions: updatedConditions
        });
      }

      nextState = addMessage(
        nextState,
        success
          ? `You successfully feint them (Bluff: ${feintTotal})! They are denied Dex to AC.`
          : `Your feint fails (Bluff: ${feintTotal}).`,
        MessageLogCategory.System
      );

      const event: ApplyResolvedEvent = {
        type: GameEventType.ApplyResolved,
        entityId: intent.entityId,
        verb: intent.verb,
        target: intent.target,
        toolEntityId: intent.toolEntityId
      };
      return { state: nextState, success, events: [event] };
    }

    default:
      return null;
  }
}

/**
 * Returns context-valid D&D 3.5e verbs for a target tile or entity.
 *
 * @param state The current GameState.
 * @param _sourceEntityId The acting entity ID.
 * @param target The `ApplyIntentTarget`.
 * @returns Array of valid `Verb`s.
 */
export function getDnD35eValidVerbsForTarget(
  state: GameState,
  _sourceEntityId: EntityId,
  target: ApplyIntentTarget
): ReadonlyArray<Verb> {
  const verbs = new Set<Verb>();

  if (target.type === 'tile') {
    verbs.add('search');
    if (findTargetEntityWithComponent(state, target, ComponentType.Lock) !== undefined) {
      verbs.add('unlock');
    }
    if (findTargetEntityWithComponent(state, target, ComponentType.Trap) !== undefined) {
      verbs.add('disarm');
    }
  } else if (target.type === 'entity') {
    if (getComponent(state, target.entityId, ComponentType.Lock) !== undefined) {
      verbs.add('unlock');
    }
    if (getComponent(state, target.entityId, ComponentType.Trap) !== undefined) {
      verbs.add('disarm');
    }
    if (
      getComponent(state, target.entityId, ComponentType.Fighter) !== undefined ||
      getComponent(state, target.entityId, ComponentType.Actor) !== undefined ||
      getComponent(state, target.entityId, ComponentType.Memory) !== undefined
    ) {
      verbs.add('persuade');
      verbs.add('intimidate');
      verbs.add('feint');
      verbs.add('heal');
    }
  }

  return Array.from(verbs);
}

/**
 * Validates whether an actor can activate a wand in D&D 3.5e (either via a Spell Trigger class track
 * or a DC 20 Use Magic Device check where Take 10 is prohibited).
 *
 * @param state The current GameState.
 * @param entityId The acting entity ID.
 * @returns `{ allowed: boolean; state: GameState }`.
 */
export function validateDnD35eWandActivation(
  state: GameState,
  entityId: EntityId
): { allowed: boolean; state: GameState } {
  const dndData = resolveEntityDnD35Data(state, entityId);
  const hasSpellTriggerClass = dndData.tracks.some(
    (t) => t.levels > 0 && SPELL_TRIGGER_CLASS_TRACK_IDS.includes(t.trackId)
  );
  if (hasSpellTriggerClass) {
    return { allowed: true, state };
  }

  const { check } = evaluateActorSkillCheck(state, entityId, 'use_magic_device', UMD_ACTIVATE_WAND_DC, 'roll');
  if (!check.allowed) {
    return {
      allowed: false,
      state: addMessage(
        state,
        'You cannot activate this wand (untrained in Use Magic Device).',
        MessageLogCategory.System
      )
    };
  }

  if (!check.success) {
    return {
      allowed: false,
      state: addMessage(
        state,
        `Use Magic Device check failed (${check.totalRoll} vs DC ${UMD_ACTIVATE_WAND_DC}). The wand fails to activate.`,
        MessageLogCategory.System
      )
    };
  }

  return { allowed: true, state };
}

/**
 * Projects Monster Lore tooltip lines for an inspected creature in D&D 3.5e, gating creature type,
 * subtypes, Damage Reduction, and Spell Resistance behind a passive (Take 10) Knowledge check
 * matching the creature's type (`DC = 10 + HD`), or revealing all in Debug UI mode.
 *
 * @param state The current GameState.
 * @param targetEntityId The inspected entity ID.
 * @returns Array of `{ value: string; color: string }` tooltip description lines.
 */
export function projectDnD35eInspectLoreLines(
  state: GameState,
  targetEntityId: EntityId
): ReadonlyArray<{ readonly value: string; readonly color: string }> {
  const targetRulesetComp = getComponent(state, targetEntityId, ComponentType.RulesetData);
  const targetTemplateComp = getComponent(state, targetEntityId, ComponentType.Template);
  if (!targetRulesetComp && !targetTemplateComp) {
    return [];
  }

  const targetDnd = resolveEntityDnD35Data(state, targetEntityId);
  if (!targetDnd.creatureType) {
    return [];
  }

  const typeStr =
    targetDnd.subtypes && targetDnd.subtypes.length > 0
      ? `${targetDnd.creatureType} (${targetDnd.subtypes.join(', ')})`
      : targetDnd.creatureType;

  const extraTraits: Array<{ readonly value: string; readonly color: string }> = [];
  if (targetDnd.damageReduction && targetDnd.damageReduction.amount > 0) {
    const bypassLabel =
      targetDnd.damageReduction.bypassTags.length > 0 ? targetDnd.damageReduction.bypassTags.join(', ') : '-';
    extraTraits.push({
      value: `DR: ${targetDnd.damageReduction.amount}/${bypassLabel}`,
      color: '#e67e22'
    });
  }
  if (targetDnd.spellResistance && targetDnd.spellResistance > 0) {
    extraTraits.push({
      value: `SR: ${targetDnd.spellResistance}`,
      color: '#9b59b6'
    });
  }

  const playerEntityId = queryEntities(state, [ComponentType.Player])[0];
  if (state.uiMode === UIMode.Debug || playerEntityId === undefined) {
    return [{ value: `Type: ${typeStr}`, color: '#3498db' }, ...extraTraits];
  }

  const knowledgeSkillId = CREATURE_TYPE_TO_KNOWLEDGE_SKILL[targetDnd.creatureType] ?? 'knowledge_local';
  const targetChassis = aggregateProgressionChassis(targetDnd.tracks, 0);
  const { check } = evaluateActorSkillCheck(state, playerEntityId, knowledgeSkillId, 0, 'take10');
  const isTrained = check.wholeRanks >= 1;
  const passiveTotal = TAKE_10_VALUE + check.totalModifier;

  const loreResult = resolveMonsterLoreCheck(
    Math.max(1, targetChassis.totalHD),
    passiveTotal,
    isTrained,
    extraTraits.map((t) => t.value)
  );

  if (!loreResult.success) {
    return [];
  }

  const lines: Array<{ readonly value: string; readonly color: string }> = [
    { value: `Type: ${typeStr}`, color: '#3498db' }
  ];
  for (let i = 0; i < Math.min(extraTraits.length, loreResult.piecesOfUsefulInfo); i++) {
    const entry = extraTraits[i];
    if (entry) {
      lines.push(entry);
    }
  }
  return lines;
}
