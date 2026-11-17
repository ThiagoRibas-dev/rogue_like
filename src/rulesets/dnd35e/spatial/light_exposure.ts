import { getComponent } from '../../../core/ecs.ts';
import { addMessage, MessageLogCategory } from '../../../systems/message.system.ts';
import {
  ComponentType,
  type IdentityComponent,
  type PositionComponent,
  type TagsComponent
} from '../../../types/components.types.ts';
import type { EntityId, GameState } from '../../../types/game-state.types.ts';
import { resolveEntitySituationalTagContext } from '../semantic_tags_context.ts';
import { projectDnD35ActorSemanticTags } from '../semantic_tags.ts';
import { getDnD35EntityData, setDnD35EntityData } from '../srd_registry.ts';
import { getDnD35SystemContent } from '../types/dnd35e_system.types.ts';

/**
 * Evaluates SRD Light Blindness (`trait:light_blindness`) exposure at an actor's current tile:
 * - Abrupt exposure to bright light (`light:bright`) inflicts `blinded` for 1 round and marks `lightExposure: 'blinded'`.
 * - At the actor's next `'turn_start'` in bright light, `blinded` expires to `lightExposure: 'acclimated'`
 *   (while ongoing `dazzled` `-1` Attack/Spot/Search persists declaratively via Horizon 3 semantic tags).
 * - Moving out of bright light (`shadowy` or `darkness`) clears `lightExposure` (and light-induced `blinded`).
 *
 * Reads strictly from semantic tags (`trait:light_blindness`), never branching on race IDs.
 */
export function evaluateActorLightExposure(
  state: GameState,
  entityId: EntityId,
  phase: 'turn_start' | 'move_or_field'
): GameState {
  const pos = getComponent(state, entityId, ComponentType.Position) as PositionComponent | undefined;
  if (!pos) return state;

  const dndData = getDnD35EntityData(state, entityId);
  const existingTags = (getComponent(state, entityId, ComponentType.Tags) as TagsComponent | undefined)?.tags ?? [];
  const situationalContext = resolveEntitySituationalTagContext(state, entityId, dndData);
  const sysContent = getDnD35SystemContent(state.campaign);
  const selfTags = projectDnD35ActorSemanticTags(
    dndData,
    existingTags,
    situationalContext,
    sysContent?.classes,
    sysContent?.skills,
    sysContent?.domains,
    sysContent?.feats,
    sysContent?.conditionEffects
  );

  if (!selfTags.includes('trait:light_blindness')) {
    return state;
  }

  const inBrightLight = situationalContext.lightReading?.isBright === true;
  const currentExposure = dndData.lightExposure;

  if (!inBrightLight) {
    if (currentExposure === undefined) return state;
    const { lightExposure: _cleared, ...restDnd } = dndData;
    const nextConditions =
      currentExposure === 'blinded' ? dndData.conditions.filter((c) => c !== 'blinded') : dndData.conditions;
    return setDnD35EntityData(state, entityId, {
      ...restDnd,
      conditions: nextConditions
    });
  }

  if (currentExposure === undefined) {
    const nextConditions = dndData.conditions.includes('blinded')
      ? dndData.conditions
      : ([...dndData.conditions, 'blinded'] as const);
    const nextState = setDnD35EntityData(state, entityId, {
      ...dndData,
      conditions: nextConditions,
      lightExposure: 'blinded'
    });
    const identity = getComponent(nextState, entityId, ComponentType.Identity) as IdentityComponent | undefined;
    const actorName = identity?.name ?? `Actor #${entityId}`;
    return addMessage(
      nextState,
      `${actorName} is blinded for 1 round by abrupt exposure to bright light!`,
      MessageLogCategory.System
    );
  }

  if (currentExposure === 'blinded' && phase === 'turn_start') {
    const nextConditions = dndData.conditions.filter((c) => c !== 'blinded');
    return setDnD35EntityData(state, entityId, {
      ...dndData,
      conditions: nextConditions,
      lightExposure: 'acclimated'
    });
  }

  return state;
}
