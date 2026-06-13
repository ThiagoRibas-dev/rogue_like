import { type GameState, UIMode } from '../../types/game-state.types.ts';
import { ComponentType } from '../../types/components.types.ts';
import { getComponent } from '../../core/ecs.ts';

/**
 * Renders the Factions overlay showing the player's current reputation.
 */
export function renderFactionsPanel(state: GameState): void {
  const overlay = document.getElementById('factions-overlay');
  if (!overlay) return;

  if (state.uiMode !== UIMode.Factions) {
    overlay.classList.add('hidden');
    return;
  }

  overlay.classList.remove('hidden');

  const listContainer = document.getElementById('factions-list');
  if (!listContainer) return;
  listContainer.innerHTML = '';

  const playerEntityId = state.entities.find((id) => getComponent(state, id, ComponentType.Player));
  if (!playerEntityId) return;

  const memory = getComponent(state, playerEntityId, ComponentType.Memory);
  if (!memory) return;

  const factions = Object.keys(state.campaign.factions);
  if (factions.length === 0) {
    listContainer.innerHTML = '<div style="color: #7f8490; text-align: center;">No known factions.</div>';
    return;
  }

  for (const factionId of factions) {
    const standing = memory.factionStandings[factionId] ?? 0;

    // Determine friendly string based on standing
    let relationColor = '#ecf0f1'; // Normal
    let relationText = 'Neutral';

    if (standing >= 50) {
      relationColor = '#2ecc71';
      relationText = 'Friendly';
    } else if (standing <= -50) {
      relationColor = '#e74c3c';
      relationText = 'Hostile';
    } else if (standing < 0) {
      relationColor = '#e67e22';
      relationText = 'Unfriendly';
    } else if (standing > 0) {
      relationColor = '#3498db';
      relationText = 'Amicable';
    }

    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.justifyContent = 'space-between';
    row.style.padding = '8px';
    row.style.background = 'rgba(255,255,255,0.05)';
    row.style.borderRadius = '4px';

    const nameSpan = document.createElement('span');
    nameSpan.textContent = factionId.charAt(0).toUpperCase() + factionId.slice(1);
    nameSpan.style.fontWeight = 'bold';

    const valSpan = document.createElement('span');
    valSpan.textContent = `${relationText} (${standing})`;
    valSpan.style.color = relationColor;

    row.appendChild(nameSpan);
    row.appendChild(valSpan);
    listContainer.appendChild(row);
  }
}
