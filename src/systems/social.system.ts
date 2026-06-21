import type { GameState } from '../types/game-state.types.ts';
import type { ApplyIntent } from '../types/intents/interaction.intents.ts';
import { getComponent, addComponent } from '../core/ecs.ts';
import { ComponentType } from '../types/components.types.ts';
import type { MemoryComponent, FactionComponent, TraitsComponent } from '../types/components.types.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';
import { applyConsequence } from './trigger.system.ts';
import { GameEventType, type ApplyResolvedEvent, type GameEvent } from '../types/events.types.ts';
import { rng } from '../core/rng.ts';

/**
 * Intercepts 'intimidate' and 'persuade' verbs from ApplyIntent
 * to resolve a personality-weighted social contest.
 */
export function processSocialIntent(
  state: GameState,
  intent: ApplyIntent
): { state: GameState; success: boolean; events?: readonly GameEvent[] } {
  if (intent.target.type !== 'entity') {
    return {
      state: addMessage(state, 'You can only do that to a creature.', MessageLogCategory.System),
      success: false
    };
  }

  const npcId = intent.target.entityId;
  const playerId = intent.entityId;

  const npcMemory = getComponent(state, npcId, ComponentType.Memory) as MemoryComponent | undefined;
  if (!npcMemory) {
    return {
      state: addMessage(state, 'They ignore you.', MessageLogCategory.System),
      success: false
    };
  }

  const playerFaction = getComponent(state, playerId, ComponentType.Faction) as FactionComponent | undefined;
  const playerTraits = getComponent(state, playerId, ComponentType.Traits) as TraitsComponent | undefined;

  // Calculate player "power" in the contest
  let playerPower = 50; // Base score
  if (playerFaction) {
    playerPower += npcMemory.factionStandings[playerFaction.factionId] ?? 0;
  }
  if (playerTraits) {
    if (intent.verb === 'intimidate' && playerTraits.traits.includes('fearsome')) playerPower += 20;
    if (intent.verb === 'persuade' && playerTraits.traits.includes('charismatic')) playerPower += 20;
  }

  // Calculate NPC resistance
  const facets = npcMemory.facets ?? {};
  let npcResistance = 50; // Base neutral facet
  if (intent.verb === 'intimidate') {
    npcResistance = facets['courage'] ?? 50;
  } else if (intent.verb === 'persuade') {
    npcResistance = facets['valor'] ?? 50;
  }

  // Add RNG variance (0-20)
  const roll = rng.getUniform() * 20;

  const success = playerPower + roll >= npcResistance;

  let nextState = state;
  let message = '';

  const newMemory = { ...npcMemory };

  if (success) {
    message =
      intent.verb === 'intimidate'
        ? 'You successfully intimidate them. Prices drop for now.'
        : 'You successfully persuade them. Prices drop for now.';

    // Set favorable session markup modifier (-20%)
    newMemory.sessionMarkupModifier = -0.2;
  } else {
    message =
      intent.verb === 'intimidate'
        ? 'They are not intimidated by you. Prices rise!'
        : 'They are not persuaded by you. Prices rise!';

    // Set unfavorable session markup modifier (+20%)
    newMemory.sessionMarkupModifier = +0.2;
  }

  nextState = addComponent(nextState, npcId, newMemory);
  nextState = addMessage(nextState, message, MessageLogCategory.System);

  // Emit record_interaction
  const dummyEvent: ApplyResolvedEvent = {
    type: GameEventType.ApplyResolved,
    entityId: playerId,
    verb: intent.verb,
    target: intent.target,
    toolEntityId: intent.toolEntityId
  };

  nextState = applyConsequence(nextState, dummyEvent as unknown as GameEvent, {
    type: 'record_interaction',
    interactionType: intent.verb as 'intimidate' | 'persuade',
    _npcEntityId: npcId,
    _playerEntityId: playerId,
    entityId: playerId
  });

  return { state: nextState, success: true, events: [dummyEvent as unknown as GameEvent] };
}
