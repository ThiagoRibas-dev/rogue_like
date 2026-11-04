import { addComponent, getComponent } from '../../../core/ecs.ts';
import { addMessage, MessageLogCategory } from '../../../systems/message.system.ts';
import {
  type AttitudeComponent,
  type AttitudeTier,
  ComponentType,
  type MemoryComponent
} from '../../../types/components.types.ts';
import { type ApplyResolvedEvent, type GameEvent, GameEventType } from '../../../types/events.types.ts';
import type { GameState } from '../../../types/game-state.types.ts';
import type { ApplyIntent } from '../../../types/intents/interaction.intents.ts';
import { aggregateProgressionChassis } from '../progression.ts';
import {
  DIPLOMACY_INDIFFERENT_TO_FRIENDLY_DC,
  FEINT_ANIMAL_INTELLIGENCE_PENALTY,
  FEINT_NON_HUMANOID_PENALTY,
  resolveDemoralizeCheck,
  resolveDiplomacyCheck,
  resolveFeintCheck
} from '../skills.ts';
import type { DnD35ConditionId } from '../types/dnd35e.types.ts';
import {
  ANIMAL_INTELLIGENCE_MAX_SCORE,
  DEMORALIZE_BASE_DC,
  evaluateActorSkillCheck,
  FAVORABLE_SOCIAL_MARKUP_MODIFIER,
  saveEntityDnD35Data,
  UNFAVORABLE_SOCIAL_MARKUP_MODIFIER
} from './skill_verb_helpers.ts';

/**
 * Resolves social and combat maneuver skill verbs (`persuade`, `intimidate`, `feint`).
 */
export function resolveSocialCombatSkillVerb(
  state: GameState,
  intent: ApplyIntent
): { state: GameState; success: boolean; events?: readonly GameEvent[] } | null {
  switch (intent.verb) {
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
