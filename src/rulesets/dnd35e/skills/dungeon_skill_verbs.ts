import { addComponent, getComponent, removeComponent } from '../../../core/ecs.ts';
import { addMessage, MessageLogCategory } from '../../../systems/message.system.ts';
import {
  ComponentType,
  type LockComponent,
  type PositionComponent,
  type TrapComponent
} from '../../../types/components.types.ts';
import {
  type ApplyFailedEvent,
  type ApplyResolvedEvent,
  type GameEvent,
  GameEventType
} from '../../../types/events.types.ts';
import type { GameState } from '../../../types/game-state.types.ts';
import type { ApplyIntent } from '../../../types/intents/interaction.intents.ts';
import {
  HEAL_SKILL_STANDARD_DC,
  OPEN_LOCK_DEFAULT_SIMPLE_DC,
  resolveDisableTrapCheck,
  resolveHealSkillCheck,
  resolveOpenLockCheck,
  resolveTrapSearchCheck
} from '../skills.ts';
import type { DnD35EntityData } from '../types/dnd35e.types.ts';
import {
  DEFAULT_TRAP_DISABLE_DC,
  DEFAULT_TRAP_SEARCH_DC,
  evaluateActorSkillCheck,
  findTargetEntityWithComponent,
  resolveEntityDnD35Data,
  saveEntityDnD35Data,
  SEARCH_SCAN_RADIUS_TILES
} from './skill_verb_helpers.ts';

/**
 * Resolves dungeon exploration and first-aid skill verbs (`search`, `unlock`, `disarm`, `heal`).
 */
export function resolveDungeonSkillVerb(
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

    default:
      return null;
  }
}
