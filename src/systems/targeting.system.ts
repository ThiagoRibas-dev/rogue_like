import { getComponent, getEntitiesAtPosition, resolveEntityDisplayName } from '../core/ecs.ts';
import { getRuleset } from '../rulesets/registry.ts';
import { ComponentType, type FighterComponent } from '../types/components.types.ts';
import { type GameState } from '../types/game-state.types.ts';
import {
  type FireAimedIntent,
  type MoveTargetIntent,
  type ToggleTargetingIntent
} from '../types/intents/combat.intents.ts';
import { IntentType } from '../types/intents/intent.enum.ts';
import { isHostile, provokeActorHostility } from '../utils/faction.ts';
import { isInMapBounds } from '../map/map_accessor.ts';
import { computeInteractionTargetDistanceTiles, resolveActorInteractionReachTiles } from './apply.system.ts';
import { processMeleeAttackIntent } from './combat.system.ts';
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
          ...((pos.z ?? 0) !== 0 ? { z: pos.z } : {}),
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
  const newZ = (state.targetingMode.z ?? 0) + (intent.dz ?? 0);

  // Clamp to map boundaries
  if (!isInMapBounds(state.map, newX, newY, newZ)) {
    return { state, success: false };
  }

  const { z: _oldZ, ...restTargeting } = state.targetingMode;
  return {
    state: {
      ...state,
      targetingMode: {
        ...restTargeting,
        x: newX,
        y: newY,
        ...(newZ !== 0 ? { z: newZ } : {})
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
  const targetZ = state.targetingMode.z ?? 0;
  const context = state.targetingMode.context;

  if (context?.verb === 'order_target') {
    const entitiesAtTile = getEntitiesAtPosition(state, targetX, targetY, targetZ);
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

  const entitiesAtTarget = getEntitiesAtPosition(state, targetX, targetY, targetZ);
  const livingTargets = entitiesAtTarget.filter((id) => {
    if (id === intent.entityId) return false;
    const f = getComponent(state, id, ComponentType.Fighter) as FighterComponent | undefined;
    return f !== undefined && f.hp > 0;
  });
  const chosenTargetId = livingTargets.find((id) => isHostile(state, intent.entityId, id)) ?? livingTargets[0];

  if (chosenTargetId !== undefined) {
    const { targetingMode: _targetingMode, ...restState } = state;
    const cleanState = restState as GameState;
    const dist = computeInteractionTargetDistanceTiles(cleanState, intent.entityId, {
      type: 'entity',
      entityId: chosenTargetId
    });
    const reach = resolveActorInteractionReachTiles(cleanState, intent.entityId, 'attack');
    if (dist !== null && dist > reach) {
      const targetName = resolveEntityDisplayName(cleanState, chosenTargetId, 'Target');
      return {
        state: addMessage(cleanState, `${targetName} is out of melee reach.`, MessageLogCategory.System),
        success: false
      };
    }
    const provokedState = provokeActorHostility(cleanState, chosenTargetId, intent.entityId);
    return processMeleeAttackIntent(provokedState, {
      type: IntentType.MeleeAttack,
      entityId: intent.entityId,
      defenderId: chosenTargetId
    });
  }

  const stateWithMsg = addMessage(state, `There is no target at (${targetX}, ${targetY}).`, MessageLogCategory.System);

  // Turn off targeting without consuming a turn
  const { targetingMode: _targetingMode, ...restState } = stateWithMsg;
  return { state: restState as GameState, success: false };
}
