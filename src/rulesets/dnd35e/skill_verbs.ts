import type { Verb } from '../../constants/verbs.constants.ts';
import { getComponent, queryEntities } from '../../core/ecs.ts';
import { addMessage, MessageLogCategory } from '../../systems/message.system.ts';
import { ComponentType } from '../../types/components.types.ts';
import type { GameEvent } from '../../types/events.types.ts';
import { type EntityId, type GameState, UIMode } from '../../types/game-state.types.ts';
import type { ApplyIntent, ApplyIntentTarget } from '../../types/intents/interaction.intents.ts';
import { aggregateProgressionChassis } from './progression.ts';
import { resolveMonsterLoreCheck, TAKE_10_VALUE, UMD_ACTIVATE_WAND_DC } from './skills.ts';
import { resolveDungeonSkillVerb } from './skills/dungeon_skill_verbs.ts';
import {
  CREATURE_TYPE_TO_KNOWLEDGE_SKILL,
  evaluateActorSkillCheck,
  findTargetEntityWithComponent,
  resolveEntityDnD35Data
} from './skills/skill_verb_helpers.ts';
import { resolveSocialCombatSkillVerb } from './skills/social_combat_skill_verbs.ts';

export * from './skills/skill_verb_helpers.ts';
export * from './skills/dungeon_skill_verbs.ts';
export * from './skills/social_combat_skill_verbs.ts';

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
 * Resolves D&D 3.5e active dungeon and combat skill verbs (`search`, `unlock`, `disarm`, `heal`, `persuade`, `intimidate`, `feint`).
 */
export function resolveDnD35eSkillVerb(
  state: GameState,
  intent: ApplyIntent
): { state: GameState; success: boolean; events?: readonly GameEvent[] } | null {
  return resolveDungeonSkillVerb(state, intent) ?? resolveSocialCombatSkillVerb(state, intent);
}

/**
 * Returns context-valid D&D 3.5e verbs for a target tile or entity.
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
 * Projects Monster Lore tooltip lines for an inspected creature in D&D 3.5e.
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
