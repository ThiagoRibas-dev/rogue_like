import { type GameState, UIMode } from '../../types/game-state.types.ts';
import { ComponentType } from '../../types/components.types.ts';
import { getComponent } from '../../core/ecs.ts';
import type { RenderableComponent, FighterComponent, MemoryComponent } from '../../types/components.types.ts';

/**
 * Renders the Investigation Board UI panel.
 * Displays known suspects and discovered clues.
 */
export function renderInvestigationBoard(state: GameState): void {
  const overlay = document.getElementById('investigation-overlay');
  const suspectsList = document.getElementById('investigation-suspects');
  const cluesList = document.getElementById('investigation-clues');

  if (!overlay || !suspectsList || !cluesList) return;

  if (state.uiMode !== UIMode.Investigation) {
    overlay.classList.add('hidden');
    return;
  }

  overlay.classList.remove('hidden');
  suspectsList.innerHTML = '';
  cluesList.innerHTML = '';

  const investigation = state.investigation;

  // Find player's memory to get discovered clues
  let playerMemory: MemoryComponent | undefined;
  for (const entityId of state.entities) {
    if (getComponent(state, entityId, ComponentType.Player)) {
      playerMemory = getComponent(state, entityId, ComponentType.Memory) as MemoryComponent | undefined;
      break;
    }
  }
  const discoveredClues = playerMemory?.knowledge ? Object.keys(playerMemory.knowledge) : [];

  // Render Known Suspects
  if (investigation.knownActors.length === 0) {
    suspectsList.innerHTML = '<div class="investigation-empty">No suspects identified yet.</div>';
  } else {
    for (const actorId of investigation.knownActors) {
      const el = document.createElement('div');
      el.className = 'investigation-item suspect-item';

      let name = `Unknown Actor #${actorId}`;
      let isAlive = false;

      const activeComps = state.components.get(actorId);
      if (activeComps) {
        const renderable = activeComps[ComponentType.Renderable] as RenderableComponent | undefined;
        const fighter = activeComps[ComponentType.Fighter] as FighterComponent | undefined;
        if (renderable) {
          name = renderable.glyph === '@' ? 'The Mastermind' : `Suspect (${renderable.glyph})`;
        } else {
          name = 'A Shadowy Figure';
        }
        if (fighter && fighter.hp > 0) isAlive = true;
      } else {
        const pRecord = state.persistentEntities.get(actorId);
        if (pRecord) {
          const pRender = pRecord.components[ComponentType.Renderable] as RenderableComponent | undefined;
          const pFighter = pRecord.components[ComponentType.Fighter] as FighterComponent | undefined;
          if (pRender) {
            name = pRender.glyph === '@' ? 'The Mastermind' : `Suspect (${pRender.glyph})`;
          } else {
            name = 'A Shadowy Figure';
          }
          if (pFighter && pFighter.hp > 0) isAlive = true;
        } else {
          name = `Deceased Suspect`;
        }
      }

      el.innerHTML = `
        <div class="suspect-name">${name}</div>
        <div class="suspect-status ${isAlive ? 'alive' : 'dead'}">${isAlive ? 'At Large' : 'Neutralized'}</div>
      `;
      suspectsList.appendChild(el);
    }
  }

  // Render Clues
  if (discoveredClues.length === 0) {
    cluesList.innerHTML = '<div class="investigation-empty">No clues found yet.</div>';
  } else {
    for (const clueId of discoveredClues) {
      const el = document.createElement('div');
      el.className = 'investigation-item clue-item';

      // We don't have a clue definitions registry yet, so just display the ID
      el.innerHTML = `
        <div class="clue-id">Evidence: ${clueId}</div>
        <div class="clue-desc">Ties a minion to a mastermind...</div>
      `;
      cluesList.appendChild(el);
    }
  }
}
