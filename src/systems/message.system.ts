import { type GameState } from '../types/game-state.types.ts';

/** The maximum number of messages to keep in the GameState history. */
export const MAX_MESSAGE_LOG_LENGTH = 100;

export const enum MessageLogCategory {
  System = 'system',
  CombatHit = 'combat-hit',
  CombatDeath = 'combat-death',
  CombatMiss = 'combat-miss'
}

/**
 * Pure function that appends a message to the GameState.
 * It maintains a maximum length by trimming the oldest messages if necessary.
 *
 * @param state The current GameState.
 * @param text The message text to display.
 * @param cssClass Optional CSS class for styling (e.g., 'combat-hit', 'system').
 * @returns A new GameState with the updated message log.
 */
export function addMessage(state: GameState, text: string, cssClass?: MessageLogCategory): GameState {
  const newMessage = cssClass !== undefined ? { text, cssClass } : { text };

  // Create a new array, appending the new message
  let newMessages = [...state.messages, newMessage];

  // Trim the log if it exceeds the maximum length
  if (newMessages.length > MAX_MESSAGE_LOG_LENGTH) {
    newMessages = newMessages.slice(newMessages.length - MAX_MESSAGE_LOG_LENGTH);
  }

  return {
    ...state,
    messages: newMessages
  };
}
