import type { Verb } from '../constants/verbs.constants.ts';
import { addComponent, getComponent } from '../core/ecs.ts';
import type { DialogueTree } from '../types/dialogue.types.ts';
import {
  ComponentType,
  type CompanionStance,
  type ControllerLinkComponent,
  type IdentityComponent,
  type TemplateComponent
} from '../types/components.types.ts';
import { GameEventType, type ApplyResolvedEvent, type GameEvent } from '../types/events.types.ts';
import type { EntityId, GameState } from '../types/game-state.types.ts';
import type { ApplyIntent, ApplyIntentTarget } from '../types/intents/interaction.intents.ts';
import { isHostile } from '../utils/faction.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';

/** Synthetic dialogue tree ID used to present tactical companion command options. */
export const COMPANION_ORDERS_DIALOGUE_ID = '__companion_orders__';

/**
 * Verbs handled by the Console companion command pipeline.
 */
export const COMPANION_VERBS: ReadonlySet<Verb> = new Set<Verb>([
  'command',
  'order_attack',
  'order_defend',
  'order_follow',
  'order_hold',
  'order_target'
]);

const STANCE_LABELS: Readonly<Record<CompanionStance, string>> = {
  aggressive: 'Aggressive (Attack Proactively)',
  defensive: 'Defensive (Guard Master)',
  passive: 'Passive (Follow Only)',
  hold: 'Hold Position'
};

/**
 * Resolves a human-readable companion or target name for logs and command dialogue headers.
 */
function resolveCompanionOrTargetName(state: GameState, entityId: EntityId): string {
  const identity = getComponent(state, entityId, ComponentType.Identity) as IdentityComponent | undefined;
  if (identity) {
    return `${identity.name} ${identity.title ?? ''}`.trim();
  }
  const template = getComponent(state, entityId, ComponentType.Template) as TemplateComponent | undefined;
  if (template) {
    const def = state.campaign.entities[template.templateId];
    if (def?.name) return def.name;
  }
  return 'Companion';
}

/**
 * Checks whether `targetId` is an active companion controlled by `controllerId`.
 * @param state Current GameState.
 * @param controllerId Controller entity ID (usually the player).
 * @param targetId Candidate companion entity ID.
 * @returns True if `targetId` has a `ControllerLinkComponent` pointing to `controllerId` and is alive/non-hostile.
 */
export function isPlayerControlledCompanion(state: GameState, controllerId: EntityId, targetId: EntityId): boolean {
  if (targetId === controllerId) return false;
  const link = getComponent(state, targetId, ComponentType.ControllerLink) as ControllerLinkComponent | undefined;
  if (!link || link.controllerEntityId !== controllerId) return false;
  if (isHostile(state, targetId, controllerId)) return false;
  const fighter = getComponent(state, targetId, ComponentType.Fighter);
  if (fighter && fighter.hp <= 0) return false;
  return true;
}

/**
 * Returns all active companions on the current floor controlled by `controllerId`.
 * @param state Current GameState.
 * @param controllerId Controller entity ID.
 * @returns Array of controlled companion EntityIds.
 */
export function getPlayerCompanions(state: GameState, controllerId: EntityId): ReadonlyArray<EntityId> {
  const result: EntityId[] = [];
  for (const entityId of state.entities) {
    if (isPlayerControlledCompanion(state, controllerId, entityId)) {
      result.push(entityId);
    }
  }
  return result;
}

/**
 * Updates a companion's tactical AI stance (`aggressive`, `defensive`, `passive`, `hold`)
 * and logs a confirmation message. Switching to `'passive'` also clears any pending focus target.
 * @param state Current GameState.
 * @param companionId Controlled companion EntityId.
 * @param stance Target tactical stance.
 * @returns Updated GameState.
 */
export function setCompanionStance(state: GameState, companionId: EntityId, stance: CompanionStance): GameState {
  const link = getComponent(state, companionId, ComponentType.ControllerLink) as ControllerLinkComponent | undefined;
  if (!link) return state;

  const nextLink: ControllerLinkComponent = {
    type: ComponentType.ControllerLink,
    controllerEntityId: link.controllerEntityId,
    tags: link.tags,
    ...(link.shareInitiative !== undefined ? { shareInitiative: link.shareInitiative } : {}),
    ...(link.expirationTurn !== undefined ? { expirationTurn: link.expirationTurn } : {}),
    stance,
    ...(stance !== 'passive' && link.commandTargetId !== undefined ? { commandTargetId: link.commandTargetId } : {}),
    ...(link.followDistance !== undefined ? { followDistance: link.followDistance } : {}),
    ...(link.leashRadius !== undefined ? { leashRadius: link.leashRadius } : {})
  };

  let nextState = addComponent(state, companionId, nextLink);
  const companionName = resolveCompanionOrTargetName(nextState, companionId);
  nextState = addMessage(
    nextState,
    `${companionName} switches to ${STANCE_LABELS[stance]} stance.`,
    MessageLogCategory.System
  );
  return nextState;
}

/**
 * Assigns a focus-fire target (`commandTargetId`) to one specific companion or all active companions
 * controlled by `controllerId`. Automatically promotes `'passive'` companions to `'defensive'`
 * so they can execute the attack order.
 * @param state Current GameState.
 * @param controllerId Controller entity ID (player).
 * @param targetEnemyId Hostile EntityId to focus-fire.
 * @param specificCompanionId Optional specific companion EntityId; when omitted, orders all active companions.
 * @returns Updated GameState and success boolean.
 */
export function assignCompanionCommandTarget(
  state: GameState,
  controllerId: EntityId,
  targetEnemyId: EntityId,
  specificCompanionId?: EntityId
): { readonly state: GameState; readonly success: boolean } {
  if (!state.entities.includes(targetEnemyId) || !isHostile(state, controllerId, targetEnemyId)) {
    return {
      state: addMessage(state, 'There is no hostile target there for your companions.', MessageLogCategory.System),
      success: false
    };
  }

  const targetIds =
    specificCompanionId !== undefined
      ? isPlayerControlledCompanion(state, controllerId, specificCompanionId)
        ? [specificCompanionId]
        : []
      : getPlayerCompanions(state, controllerId);

  if (targetIds.length === 0) {
    return {
      state: addMessage(state, 'You have no active companions to command.', MessageLogCategory.System),
      success: false
    };
  }

  let nextState = state;
  const targetName = resolveCompanionOrTargetName(nextState, targetEnemyId);

  for (const companionId of targetIds) {
    const link = getComponent(nextState, companionId, ComponentType.ControllerLink) as
      ControllerLinkComponent | undefined;
    if (!link) continue;

    const currentStance = link.stance ?? 'defensive';
    const resolvedStance: CompanionStance = currentStance === 'passive' ? 'defensive' : currentStance;

    const nextLink: ControllerLinkComponent = {
      type: ComponentType.ControllerLink,
      controllerEntityId: link.controllerEntityId,
      tags: link.tags,
      ...(link.shareInitiative !== undefined ? { shareInitiative: link.shareInitiative } : {}),
      ...(link.expirationTurn !== undefined ? { expirationTurn: link.expirationTurn } : {}),
      stance: resolvedStance,
      commandTargetId: targetEnemyId,
      ...(link.followDistance !== undefined ? { followDistance: link.followDistance } : {}),
      ...(link.leashRadius !== undefined ? { leashRadius: link.leashRadius } : {})
    };
    nextState = addComponent(nextState, companionId, nextLink);
  }

  const orderIssuerText =
    specificCompanionId !== undefined
      ? resolveCompanionOrTargetName(nextState, specificCompanionId)
      : 'your companions';
  nextState = addMessage(
    nextState,
    `You order ${orderIssuerText} to focus attacks on ${targetName}!`,
    MessageLogCategory.System
  );

  return { state: nextState, success: true };
}

/**
 * Dynamically constructs the built-in tactical command dialogue tree (`__companion_orders__`)
 * reflecting the companion's current stance and focus-target assignment.
 * @param state Current GameState.
 * @param companionId Controlled companion EntityId.
 * @returns Synthesized DialogueTree compatible with Dialogue UI and consequences.
 */
export function buildCompanionOrdersDialogueTree(state: GameState, companionId: EntityId): DialogueTree {
  const link = getComponent(state, companionId, ComponentType.ControllerLink) as ControllerLinkComponent | undefined;
  const companionName = resolveCompanionOrTargetName(state, companionId);
  const currentStance: CompanionStance = link?.stance ?? 'defensive';
  const targetSummary =
    link?.commandTargetId !== undefined
      ? ` Focus Target: ${resolveCompanionOrTargetName(state, link.commandTargetId)}.`
      : '';

  return {
    id: COMPANION_ORDERS_DIALOGUE_ID,
    startNodeId: 'root',
    nodes: {
      root: {
        id: 'root',
        text: `${companionName} awaits your orders. Current stance: ${STANCE_LABELS[currentStance]}.${targetSummary}`,
        options: [
          {
            id: 'opt_aggressive',
            text: 'Attack Proactively (Aggressive — hunt nearby enemies)',
            consequences: [{ type: 'set_companion_stance', stance: 'aggressive', targetId: String(companionId) }]
          },
          {
            id: 'opt_defensive',
            text: 'Defend Me (Defensive — protect me and guard nearby)',
            consequences: [{ type: 'set_companion_stance', stance: 'defensive', targetId: String(companionId) }]
          },
          {
            id: 'opt_passive',
            text: 'Follow Only (Passive — do not initiate combat)',
            consequences: [{ type: 'set_companion_stance', stance: 'passive', targetId: String(companionId) }]
          },
          {
            id: 'opt_hold',
            text: 'Hold Position (Stand ground here and strike adjacent foes)',
            consequences: [{ type: 'set_companion_stance', stance: 'hold', targetId: String(companionId) }]
          },
          {
            id: 'opt_focus_target',
            text: 'Focus Target... (Designate a specific enemy to attack)',
            consequences: [{ type: 'order_companion_target', targetId: String(companionId) }]
          },
          {
            id: 'opt_dismiss',
            text: 'Carry on. (Close)'
          }
        ]
      }
    }
  };
}

/**
 * Returns valid Console companion command verbs for the context menu on a given target.
 * - On a controlled companion: returns `'command'`, `'order_attack'`, `'order_defend'`, `'order_follow'`, `'order_hold'`, and `'order_target'`.
 * - On a hostile target when the controller has at least one active companion: returns `'order_target'`.
 * @param state Current GameState.
 * @param sourceEntityId Controller EntityId (player).
 * @param target Context menu target.
 * @returns Array of valid companion command verbs.
 */
export function getValidCompanionVerbsForTarget(
  state: GameState,
  sourceEntityId: EntityId,
  target: ApplyIntentTarget
): ReadonlyArray<Verb> {
  if (target.type !== 'entity') {
    return [];
  }

  if (isPlayerControlledCompanion(state, sourceEntityId, target.entityId)) {
    return ['command', 'order_attack', 'order_defend', 'order_follow', 'order_hold', 'order_target'];
  }

  if (isHostile(state, sourceEntityId, target.entityId) && getPlayerCompanions(state, sourceEntityId).length > 0) {
    return ['order_target'];
  }

  return [];
}

/**
 * Opens targeting mode specifically to select a focus target for a companion.
 * @param state Current GameState.
 * @param controllerId Controller EntityId.
 * @param companionId Optional specific companion EntityId.
 * @returns Updated GameState in aiming/targeting mode.
 */
export function beginCompanionTargetSelection(
  state: GameState,
  controllerId: EntityId,
  companionId?: EntityId
): GameState {
  const pos = getComponent(state, controllerId, ComponentType.Position);
  if (!pos) return state;

  const companionLabel =
    companionId !== undefined ? resolveCompanionOrTargetName(state, companionId) : 'your companions';

  return addMessage(
    {
      ...state,
      targetingMode: {
        active: true,
        x: pos.x,
        y: pos.y,
        context: {
          verb: 'order_target',
          ...(companionId !== undefined ? { companionEntityId: companionId } : {})
        }
      }
    },
    `Select a hostile enemy for ${companionLabel} to focus on (click or press Space/Enter).`,
    MessageLogCategory.System
  );
}

/**
 * Resolves quick stance & focus-target verbs (`order_attack`, `order_defend`, `order_follow`,
 * `order_hold`, `order_target`). The `'command'` dialogue verb is handled by `apply.system.ts`.
 * @param state Current GameState.
 * @param intent ApplyIntent carrying a companion verb.
 * @returns Outcome object if the verb is a companion command verb, or `null` otherwise.
 */
export function processCompanionVerbIntent(
  state: GameState,
  intent: ApplyIntent
): { state: GameState; success: boolean; events?: readonly GameEvent[] } | null {
  if (!COMPANION_VERBS.has(intent.verb) || intent.verb === 'command') {
    return null;
  }

  if (intent.target.type !== 'entity') {
    return {
      state: addMessage(state, 'Select a companion or enemy target.', MessageLogCategory.System),
      success: false
    };
  }

  const targetId = intent.target.entityId;
  const resolvedEvent: ApplyResolvedEvent = {
    type: GameEventType.ApplyResolved,
    entityId: intent.entityId,
    verb: intent.verb,
    target: intent.target,
    toolEntityId: intent.toolEntityId
  };

  if (intent.verb === 'order_target') {
    if (isPlayerControlledCompanion(state, intent.entityId, targetId)) {
      return {
        state: beginCompanionTargetSelection(state, intent.entityId, targetId),
        success: false
      };
    }
    if (isHostile(state, intent.entityId, targetId)) {
      const assigned = assignCompanionCommandTarget(state, intent.entityId, targetId);
      return {
        state: assigned.state,
        success: false,
        ...(assigned.success ? { events: [resolvedEvent] } : {})
      };
    }
    return {
      state: addMessage(state, 'Cannot order companions to attack that target.', MessageLogCategory.System),
      success: false
    };
  }

  if (!isPlayerControlledCompanion(state, intent.entityId, targetId)) {
    return {
      state: addMessage(state, 'You can only issue stance orders to your companions.', MessageLogCategory.System),
      success: false
    };
  }

  const stanceByVerb: Readonly<
    Record<'order_attack' | 'order_defend' | 'order_follow' | 'order_hold', CompanionStance>
  > = {
    order_attack: 'aggressive',
    order_defend: 'defensive',
    order_follow: 'passive',
    order_hold: 'hold'
  };

  const stance = stanceByVerb[intent.verb as keyof typeof stanceByVerb];
  if (!stance) return null;

  const nextState = setCompanionStance(state, targetId, stance);
  return {
    state: nextState,
    success: false,
    events: [resolvedEvent]
  };
}
