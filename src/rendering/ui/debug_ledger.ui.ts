import { type GameState, UIMode } from '../../types/game-state.types.ts';
import { getHighImportanceEvents } from '../../systems/ledger_queries.ts';

/**
 * Renders the Debug Ledger UI panel.
 * Displays all high-importance events from the historical ledger.
 */
export function renderDebugLedgerUI(state: GameState): void {
  const overlay = document.getElementById('ledger-overlay');
  const eventsList = document.getElementById('ledger-events');

  if (!overlay || !eventsList) return;

  if (state.uiMode !== UIMode.Ledger) {
    overlay.classList.add('hidden');
    return;
  }

  overlay.classList.remove('hidden');
  eventsList.innerHTML = '';

  const highEvents = getHighImportanceEvents(state);

  if (highEvents.length === 0) {
    eventsList.innerHTML =
      '<div class="ledger-empty" style="color: #888; padding: 16px;">No high importance events recorded yet.</div>';
    return;
  }

  // Render events in reverse chronological order (newest first)
  const sortedEvents = [...highEvents].reverse();

  for (const event of sortedEvents) {
    const el = document.createElement('div');
    el.className = 'ledger-item';
    el.style.borderLeft = '4px solid #f1c40f';
    el.style.marginBottom = '8px';
    el.style.background = 'rgba(0, 0, 0, 0.4)';
    el.style.padding = '8px 12px';
    el.style.borderRadius = '0 4px 4px 0';

    // Parse turn from id (evt_{turn}_{type}_{hash})
    const turn = event.id ? event.id.split('_')[1] : '?';

    el.innerHTML = `
      <div style="color: #3498db; font-weight: bold; font-size: 0.85rem; margin-bottom: 4px;">Turn ${turn}</div>
      <div style="color: #eee; font-size: 0.95rem; margin-bottom: 4px;">${event.summary || event.type}</div>
      <div style="color: #666; font-size: 0.75rem; font-family: monospace;">ID: ${event.id}</div>
    `;

    eventsList.appendChild(el);
  }
}
