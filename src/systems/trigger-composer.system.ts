import type { GameState } from '../types/game-state.types.ts';
import { type TriggerDefinition, TriggerDefinitionSchema } from '../types/trigger.types.ts';

/**
 * Compiles a trigger template into a complete TriggerDefinition by replacing variable placeholders.
 *
 * @param templateId The ID of the template in the campaign's triggerTemplates.
 * @param bindings A dictionary of variable bindings, e.g. { "$NEMESIS_ID": "goblin_king" }.
 * @param state The current GameState.
 * @param newTriggerId The unique ID for the newly generated trigger.
 * @returns The fully compiled and validated TriggerDefinition.
 */
export function compileTrigger(
  templateId: string,
  bindings: Record<string, string | number | boolean>,
  state: Readonly<GameState>,
  newTriggerId: string
): TriggerDefinition {
  const template = state.campaign.triggerTemplates[templateId];
  if (!template) {
    throw new Error(`Trigger Template '${templateId}' not found in campaign.`);
  }

  // Serialize to string to perform fast global replacement
  let templateStr = JSON.stringify(template);

  for (const [key, value] of Object.entries(bindings)) {
    if (typeof value === 'number' || typeof value === 'boolean') {
      const quotedKey = `"${key}"`;
      if (templateStr.includes(quotedKey)) {
        templateStr = templateStr.split(quotedKey).join(String(value));
      } else {
        templateStr = templateStr.split(key).join(String(value));
      }
    } else {
      const replacement = typeof value === 'string' ? value : String(value);
      templateStr = templateStr.split(key).join(replacement);
    }
  }

  const rawTrigger = JSON.parse(templateStr);

  // Overwrite the ID with the newly assigned unique ID
  rawTrigger.id = newTriggerId;

  // Validate strict adherence to standard engine schemas to ensure runtime safety
  return TriggerDefinitionSchema.parse(rawTrigger);
}

/**
 * Injects a new dynamic trigger into the game state, safely rebuilding the routing buckets.
 *
 * @param state The current GameState.
 * @param trigger The compiled TriggerDefinition to inject.
 * @returns A new GameState with the trigger active.
 */
export function injectTrigger(state: GameState, trigger: TriggerDefinition): GameState {
  const nextTriggers = { ...state.campaign.triggers, [trigger.id]: trigger };

  // Safely rebuild O(1) routing buckets for purity
  const nextBuckets: Record<string, TriggerDefinition[]> = {};
  for (const t of Object.values(nextTriggers)) {
    if (!nextBuckets[t.eventType]) {
      nextBuckets[t.eventType] = [];
    }
    nextBuckets[t.eventType]!.push(t);
  }

  return {
    ...state,
    campaign: {
      ...state.campaign,
      triggers: nextTriggers,
      triggerBuckets: nextBuckets
    }
  };
}

/**
 * Removes a dynamic trigger from the game state, safely rebuilding the routing buckets.
 *
 * @param state The current GameState.
 * @param triggerId The ID of the trigger to remove.
 * @returns A new GameState with the trigger removed.
 */
export function removeTrigger(state: GameState, triggerId: string): GameState {
  if (!state.campaign.triggers[triggerId]) {
    return state; // Nothing to remove
  }

  const nextTriggers = { ...state.campaign.triggers };
  delete nextTriggers[triggerId];

  // Safely rebuild O(1) routing buckets for purity
  const nextBuckets: Record<string, TriggerDefinition[]> = {};
  for (const t of Object.values(nextTriggers)) {
    if (!nextBuckets[t.eventType]) {
      nextBuckets[t.eventType] = [];
    }
    nextBuckets[t.eventType]!.push(t);
  }

  return {
    ...state,
    campaign: {
      ...state.campaign,
      triggers: nextTriggers,
      triggerBuckets: nextBuckets
    }
  };
}
