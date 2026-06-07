import { type GameState } from '../types/game-state.types.ts';

/**
 * Renders the GameState's messages to the DOM.
 * @param state The current GameState containing the messages array.
 */
export function renderMessageLog(state: GameState): void {
  const messageLog = document.getElementById('message-log');

  if (!messageLog) {
    return; // Fast fail if DOM element doesn't exist
  }

  // Clear existing messages
  // (In a more complex app, we might diff this or use a virtual DOM,
  // but for our MVP, replacing innerHTML is fast enough given the small count)
  messageLog.innerHTML = '';

  // Render messages from oldest to newest (top to bottom)
  for (const msg of state.messages) {
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    if (msg.cssClass) {
      // Allow adding multiple classes separated by spaces if needed
      msg.cssClass.split(' ').forEach((cls) => entry.classList.add(cls));
    }
    entry.textContent = msg.text;
    messageLog.appendChild(entry);
  }

  // Auto-scroll to the bottom so the newest message is always visible
  messageLog.scrollTop = messageLog.scrollHeight;
}
