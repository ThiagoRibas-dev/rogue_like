import { type GameState, UIMode } from '../../types/game-state.types.ts';
import {
  ComponentType,
  type ChronicleComponent,
  type IdentityComponent,
  type FighterComponent
} from '../../types/components.types.ts';
import { getComponent } from '../../core/ecs.ts';

/**
 * Renders the Dossier UI panel.
 * Displays notable entities and their chronicles.
 */
export function renderDossierUI(state: GameState): void {
  const overlay = document.getElementById('dossier-overlay');
  const entityList = document.getElementById('dossier-entities');

  if (!overlay || !entityList) return;

  if (state.uiMode !== UIMode.Dossier) {
    overlay.classList.add('hidden');
    return;
  }

  overlay.classList.remove('hidden');
  entityList.innerHTML = '';

  const entitiesWithChronicle: {
    id: number;
    identity?: IdentityComponent;
    chronicle: ChronicleComponent;
    isAlive: boolean;
  }[] = [];

  // Active entities
  for (const entityId of state.entities) {
    const chronicle = getComponent(state, entityId, ComponentType.Chronicle) as ChronicleComponent | undefined;
    if (chronicle) {
      const identity = getComponent(state, entityId, ComponentType.Identity) as IdentityComponent | undefined;
      const fighter = getComponent(state, entityId, ComponentType.Fighter) as FighterComponent | undefined;
      const data: (typeof entitiesWithChronicle)[0] = {
        id: entityId,
        chronicle,
        isAlive: fighter ? fighter.hp > 0 : false
      };
      if (identity) data.identity = identity;
      entitiesWithChronicle.push(data);
    }
  }

  // Persistent entities
  for (const [entityId, pRecord] of state.persistentEntities.entries()) {
    const chronicle = pRecord.components[ComponentType.Chronicle] as ChronicleComponent | undefined;
    if (chronicle) {
      const identity = pRecord.components[ComponentType.Identity] as IdentityComponent | undefined;
      const fighter = pRecord.components[ComponentType.Fighter] as FighterComponent | undefined;
      const data: (typeof entitiesWithChronicle)[0] = {
        id: entityId,
        chronicle,
        isAlive: fighter ? fighter.hp > 0 : false
      };
      if (identity) data.identity = identity;
      entitiesWithChronicle.push(data);
    }
  }

  if (entitiesWithChronicle.length === 0) {
    entityList.innerHTML = '<div class="status-empty" style="padding: 16px;">No notable entities recorded yet.</div>';
    return;
  }

  for (const data of entitiesWithChronicle) {
    const el = document.createElement('div');
    el.style.borderBottom = '1px solid var(--border-color)';
    el.style.paddingBottom = '12px';
    el.style.marginBottom = '12px';

    const nameStr = data.identity
      ? `${data.identity.name} ${data.identity.title ?? ''}`.trim()
      : `Unknown Entity #${data.id}`;

    // Format excerpts
    const excerptsHtml = data.chronicle.eventExcerpts
      .map(
        (e) =>
          `<li style="margin-bottom: 4px;"><span style="color: var(--text-dim);">[Turn ${e.turn}]</span> ${e.summary}</li>`
      )
      .join('');

    el.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px;">
        <span style="font-weight: bold; color: ${data.identity?.colorOverride ?? '#f1c40f'}; font-size: 1.1rem;">${nameStr}</span>
        <span style="color: ${data.isAlive ? '#2ecc71' : '#e74c3c'}; font-size: 0.9rem;">${data.isAlive ? 'Alive' : 'Dead'}</span>
      </div>
      <div style="font-size: 0.9rem; margin-bottom: 8px;">
        <span style="color: var(--text-dim);">Player Interaction Score:</span> ${data.chronicle.pis}
      </div>
      <div style="font-size: 0.9rem;">
        <h4 style="margin: 0 0 4px 0; color: var(--text-color);">Chronicle</h4>
        <ul style="margin: 0; padding-left: 20px; color: #ddd;">
          ${excerptsHtml || '<li>No history recorded.</li>'}
        </ul>
      </div>
    `;
    entityList.appendChild(el);
  }
}
