import { type GameState, UIMode } from '../../types/game-state.types.ts';
import {
  ComponentType,
  type ChronicleComponent,
  type IdentityComponent,
  type FighterComponent,
  type MemoryComponent
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
    identity?: IdentityComponent | undefined;
    chronicle: ChronicleComponent;
    memory?: MemoryComponent | undefined;
    isAlive: boolean;
  }[] = [];

  // Active entities
  for (const entityId of state.entities) {
    const chronicle = getComponent(state, entityId, ComponentType.Chronicle) as ChronicleComponent | undefined;
    if (chronicle) {
      const identity = getComponent(state, entityId, ComponentType.Identity) as IdentityComponent | undefined;
      const fighter = getComponent(state, entityId, ComponentType.Fighter) as FighterComponent | undefined;
      const memory = getComponent(state, entityId, ComponentType.Memory) as MemoryComponent | undefined;
      const data: (typeof entitiesWithChronicle)[0] = {
        id: entityId,
        chronicle,
        memory,
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
      const memory = pRecord.components[ComponentType.Memory] as MemoryComponent | undefined;
      const data: (typeof entitiesWithChronicle)[0] = {
        id: entityId,
        chronicle,
        memory,
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

    // Stress calculation and colors
    const stress = data.memory?.stress ?? 0;
    let stressColor = '#2ecc71'; // Green
    if (stress >= 80) {
      stressColor = '#e74c3c'; // Red
    } else if (stress >= 40) {
      stressColor = '#f39c12'; // Orange
    }

    // Recent Thoughts
    const thoughtsHtml =
      data.memory?.thoughts && data.memory.thoughts.length > 0
        ? data.memory.thoughts
            .map(
              (t) =>
                `<li style="margin-bottom: 4px; color: var(--text-dim);"><span style="color: var(--text-dim);">[Turn ${t.turn}]</span> ${t.eventSummary} <span style="color: ${t.stressDelta >= 0 ? '#e74c3c' : '#2ecc71'}; font-weight: 500;">(${t.stressDelta >= 0 ? '+' : ''}${t.stressDelta} Stress)</span></li>`
            )
            .join('')
        : '<li style="color: var(--text-dim); font-style: italic;">No transient thoughts.</li>';

    // Core Memories
    const coreMemoriesHtml =
      data.chronicle.coreMemories && data.chronicle.coreMemories.length > 0
        ? data.chronicle.coreMemories
            .map((m) => `<li style="margin-bottom: 4px; color: #f1c40f; font-style: italic;">"${m}"</li>`)
            .join('')
        : '';

    el.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px;">
        <span style="font-weight: bold; color: ${data.identity?.colorOverride ?? '#f1c40f'}; font-size: 1.1rem;">${nameStr}</span>
        <span style="color: ${data.isAlive ? '#2ecc71' : '#e74c3c'}; font-size: 0.9rem;">${data.isAlive ? 'Alive' : 'Dead'}</span>
      </div>
      <div style="font-size: 0.9rem; margin-bottom: 8px; display: flex; align-items: center; gap: 8px;">
        <span style="color: var(--text-dim);">Stress:</span>
        <div style="flex: 1; height: 8px; background: #222; border-radius: 4px; overflow: hidden; border: 1px solid #444; max-width: 120px;">
          <div style="width: ${Math.min(100, Math.max(0, stress))}%; height: 100%; background: ${stressColor}; transition: width 0.3s ease;"></div>
        </div>
        <span style="color: ${stressColor}; font-weight: 500;">${stress} / 100</span>
      </div>
      <div style="font-size: 0.9rem; margin-bottom: 8px;">
        <span style="color: var(--text-dim);">Player Interaction Score:</span> ${data.chronicle.pis}
      </div>
      ${
        coreMemoriesHtml
          ? `
      <div style="font-size: 0.9rem; margin-bottom: 8px; background: rgba(241, 196, 15, 0.05); border-left: 2px solid #f1c40f; padding: 6px 10px;">
        <h4 style="margin: 0 0 4px 0; color: #f1c40f; font-size: 0.95rem;">Core Memories</h4>
        <ul style="margin: 0; padding-left: 16px; list-style-type: square; color: #fff;">
          ${coreMemoriesHtml}
        </ul>
      </div>
      `
          : ''
      }
      <div style="font-size: 0.9rem; margin-bottom: 8px;">
        <h4 style="margin: 0 0 4px 0; color: var(--text-color);">Recent Thoughts</h4>
        <ul style="margin: 0; padding-left: 20px;">
          ${thoughtsHtml}
        </ul>
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
