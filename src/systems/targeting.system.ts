import { getComponent } from '../core/ecs.ts';
import { getRuleset } from '../rulesets/registry.ts';
import { ComponentType } from '../types/components.types.ts';
import { type GameState } from '../types/game-state.types.ts';
import {
  type FireAimedIntent,
  type MoveTargetIntent,
  type ToggleTargetingIntent
} from '../types/intents/combat.intents.ts';
import { isHostile } from '../utils/faction.ts';
import { assignCompanionCommandTarget } from './companion_commands.system.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';

/**
 * Toggles targeting mode on or off.
 */
export function processToggleTargetingIntent(
  state: GameState,
  intent: ToggleTargetingIntent
): { state: GameState; success: boolean } {
  const isAlreadyActive = state.targetingMode?.active === true;
  if (isAlreadyActive && intent.context === undefined) {
    // Turn off targeting mode
    const { targetingMode: _targetingMode, ...restState } = state;
    return {
      state: addMessage(restState as GameState, 'Targeting cancelled.', MessageLogCategory.System),
      success: false
    };
  }

  // Turn on targeting mode (or switch active targeting context), defaulting cursor to the entity's current position
  const pos = getComponent(state, intent.entityId, ComponentType.Position);
  if (!pos) return { state, success: false };

  const spellLabel =
    (intent.context?.convertedSpellId ?? intent.context?.spellId)
      ? ` for ${(intent.context.convertedSpellId ?? intent.context.spellId ?? '').replace(/_/g, ' ')}`
      : '';

  return {
    state: addMessage(
      {
        ...state,
        targetingMode: {
          active: true,
          x: pos.x,
          y: pos.y,
          ...(intent.radius !== undefined ? { radius: intent.radius } : {}),
          ...(intent.maxRangeTiles !== undefined ? { maxRangeTiles: intent.maxRangeTiles } : {}),
          context: intent.context
        }
      },
      `Targeting mode active${spellLabel}. Move cursor or click to aim.`,
      MessageLogCategory.System
    ),
    success: false
  };
}

/**
 * Moves the targeting crosshair.
 */
export function processMoveTargetIntent(
  state: GameState,
  intent: MoveTargetIntent
): { state: GameState; success: boolean } {
  if (!state.targetingMode?.active) return { state, success: false };

  const newX = state.targetingMode.x + intent.dx;
  const newY = state.targetingMode.y + intent.dy;

  // Clamp to map boundaries
  if (newX < 0 || newX >= state.map.width || newY < 0 || newY >= state.map.height) {
    return { state, success: false };
  }

  return {
    state: {
      ...state,
      targetingMode: {
        ...state.targetingMode,
        x: newX,
        y: newY
      }
    },
    success: false
  };
}

/**
 * Fires the aimed action at the targeted tile and turns off targeting mode.
 */
export function processFireAimedIntent(
  state: GameState,
  intent: FireAimedIntent
): { state: GameState; success: boolean } {
  if (!state.targetingMode?.active) return { state, success: false };

  const targetX = state.targetingMode.x;
  const targetY = state.targetingMode.y;
  const context = state.targetingMode.context;

  if (context?.verb === 'order_target') {
    const entitiesAtTile = state.spatialIndex.get(`${targetX},${targetY}`) ?? [];
    const hostileTargetId = entitiesAtTile.find(
      (id) =>
        id !== intent.entityId &&
        getComponent(state, id, ComponentType.Fighter) !== undefined &&
        isHostile(state, intent.entityId, id)
    );

    const assigned =
      hostileTargetId !== undefined
        ? assignCompanionCommandTarget(state, intent.entityId, hostileTargetId, context.companionEntityId)
        : {
            state: addMessage(
              state,
              'There is no hostile target there for your companions.',
              MessageLogCategory.System
            ),
            success: false
          };

    const { targetingMode: _targetingMode, ...restState } = assigned.state;
    return { state: restState as GameState, success: false };
  }

  const ruleset = getRuleset(state.campaign?.manifest?.rulesetId);
  if (context && ruleset.resolveAimedAction) {
    const { targetingMode: _targetingMode, ...restState } = state;
    return ruleset.resolveAimedAction(restState as GameState, intent.entityId, { x: targetX, y: targetY }, context);
  }

  const stateWithMsg = addMessage(
    state,
    `You target the tile at ${targetX}, ${targetY}.`,
    MessageLogCategory.CombatHit
  );

  // Turn off targeting
  const { targetingMode: _targetingMode, ...restState } = stateWithMsg;
  return { state: restState as GameState, success: true };
}
