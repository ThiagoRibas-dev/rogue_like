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

  // Apply relationship axes
  const axes = npcMemory.relationshipAxes ?? {};
  if (intent.verb === 'intimidate') {
    const fear = axes['fear'] ?? 0;
    if (fear > 0) playerPower += fear * 0.5; // High fear boosts intimidation
  } else if (intent.verb === 'persuade') {
    const respect = axes['respect'] ?? 0;
    if (respect > 0) playerPower += respect * 0.5; // High respect boosts persuasion
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

/**
 * Calculates the willingness of an NPC to share rumors/secrets.
 * Under pressure/intimidation or out of loyalty, they share more. Resentment stops them.
 *
 * @param npcMemory The NPC's MemoryComponent.
 * @returns A score representing the willingness to share.
 */
export function getWillingnessToShare(npcMemory: MemoryComponent | undefined): number {
  if (!npcMemory) return 0;
  let score = 50; // Neutral baseline

  if (npcMemory.relationshipAxes) {
    const loyalty = npcMemory.relationshipAxes['loyalty'] ?? 0;
    const fear = npcMemory.relationshipAxes['fear'] ?? 0;
    const resentment = npcMemory.relationshipAxes['resentment'] ?? 0;

    score += loyalty * 0.5;
    score += fear * 0.25; // Fear slightly encourages spilling secrets under pressure
    score -= resentment; // Resentment heavily penalizes willingness to talk
  }
  return score;
}
