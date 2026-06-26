import { type GameState, UIMode } from '../../types/game-state.types.ts';
import {
  ComponentType,
  type ChronicleComponent,
  type IdentityComponent,
  type FighterComponent,
  type MemoryComponent,
  type NemesisComponent
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
    if (getComponent(state, entityId, ComponentType.Player) !== undefined) {
      continue;
    }
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

  // 1. Render Faction Hierarchies
  const nemesisHierarchies = state.campaign.nemesisHierarchies || {};
  const hasHierarchies = Object.keys(nemesisHierarchies).length > 0;

  if (hasHierarchies) {
    const hierarchySectionHeader = document.createElement('h2');
    hierarchySectionHeader.style.color = '#fff';
    hierarchySectionHeader.style.fontSize = '1.3rem';
    hierarchySectionHeader.style.borderBottom = '2px solid #555';
    hierarchySectionHeader.style.paddingBottom = '6px';
    hierarchySectionHeader.style.marginTop = '8px';
    hierarchySectionHeader.style.marginBottom = '16px';
    hierarchySectionHeader.textContent = 'Nemesis Hierarchies';
    entityList.appendChild(hierarchySectionHeader);
    for (const [hierarchyId, hierarchy] of Object.entries(nemesisHierarchies)) {
      const factionName = hierarchy.factionId.charAt(0).toUpperCase() + hierarchy.factionId.slice(1);
      const hierarchyTitle = document.createElement('h3');
      hierarchyTitle.style.color = '#f1c40f';
      hierarchyTitle.style.fontSize = '1.1rem';
      hierarchyTitle.style.marginTop = '16px';
      hierarchyTitle.style.marginBottom = '12px';
      hierarchyTitle.textContent = `${factionName} Hierarchy`;
      entityList.appendChild(hierarchyTitle);

      const hierarchyContainer = document.createElement('div');
      hierarchyContainer.style.display = 'flex';
      hierarchyContainer.style.flexDirection = 'column';
      hierarchyContainer.style.gap = '12px';
      hierarchyContainer.style.marginBottom = '24px';

      const sortedRanks = [...hierarchy.ranks].sort((a, b) => b.tier - a.tier);

      for (const rank of sortedRanks) {
        const rankRow = document.createElement('div');
        rankRow.style.display = 'flex';
        rankRow.style.flexDirection = 'column';
        rankRow.style.background = 'rgba(0, 0, 0, 0.3)';
        rankRow.style.border = '1px solid #444';
        rankRow.style.borderRadius = '6px';
        rankRow.style.padding = '8px 12px';

        const rankHeader = document.createElement('div');
        rankHeader.style.fontWeight = 'bold';
        rankHeader.style.color = '#bbb';
        rankHeader.style.fontSize = '0.9rem';
        rankHeader.style.marginBottom = '6px';
        rankHeader.textContent = `${rank.displayName} (Tier ${rank.tier})`;
        rankRow.appendChild(rankHeader);

        const slotsGrid = document.createElement('div');
        slotsGrid.style.display = 'grid';
        slotsGrid.style.gridTemplateColumns = `repeat(auto-fit, minmax(160px, 1fr))`;
        slotsGrid.style.gap = '8px';

        const occupants = state.nemesisSlots[`${hierarchyId}:${rank.rankId}`] || [];

        for (let i = 0; i < rank.maxSlots; i++) {
          const slotEl = document.createElement('div');
          slotEl.style.border = '1px dashed #555';
          slotEl.style.borderRadius = '4px';
          slotEl.style.padding = '8px';
          slotEl.style.background = 'rgba(255, 255, 255, 0.01)';
          slotEl.style.fontSize = '0.85rem';

          const occupantId = occupants[i];
          if (occupantId !== undefined) {
            let isAlive = false;
            let inLimbo = false;
            let identity: IdentityComponent | undefined;
            let chronicle: ChronicleComponent | undefined;

            // Active check
            const activeComps = state.components.get(occupantId);
            if (activeComps) {
              identity = activeComps[ComponentType.Identity] as IdentityComponent | undefined;
              chronicle = activeComps[ComponentType.Chronicle] as ChronicleComponent | undefined;
              const fighter = activeComps[ComponentType.Fighter] as FighterComponent | undefined;
              isAlive = fighter ? fighter.hp > 0 : false;
            } else {
              // Persistent check
              const record = state.persistentEntities.get(occupantId);
              if (record) {
                identity = record.components[ComponentType.Identity] as IdentityComponent | undefined;
                chronicle = record.components[ComponentType.Chronicle] as ChronicleComponent | undefined;
                const fighter = record.components[ComponentType.Fighter] as FighterComponent | undefined;
                const nemesis = record.components[ComponentType.Nemesis] as NemesisComponent | undefined;
                isAlive = fighter ? fighter.hp > 0 : false;
                inLimbo = nemesis !== undefined && nemesis.returnDelay !== undefined && nemesis.returnDelay > 0;
              }
            }

            const name = identity ? `${identity.name} ${identity.title || ''}`.trim() : `Nemesis #${occupantId}`;
            const color = identity?.colorOverride || '#f1c40f';
            const statusText = inLimbo ? 'Missing' : isAlive ? 'Active' : 'Dead';
            const statusColor = inLimbo ? '#f39c12' : isAlive ? '#2ecc71' : '#e74c3c';

            slotEl.style.border = `1px solid ${statusColor}`;
            slotEl.style.background = 'rgba(0, 0, 0, 0.5)';
            slotEl.innerHTML = `
              <div style="font-weight: bold; color: ${color}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${name}</div>
              <div style="display: flex; justify-content: space-between; font-size: 0.75rem; margin-top: 4px;">
                <span style="color: ${statusColor}; font-weight: bold;">${statusText}</span>
                <span style="color: var(--text-dim);">PIS: ${chronicle ? chronicle.pis : 0}</span>
              </div>
              ${
                chronicle && chronicle.scars.length > 0
                  ? `
                <div style="font-size: 0.7rem; color: #f1c40f; margin-top: 4px; font-style: italic; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                  Scars: ${chronicle.scars.join(', ')}
                </div>
              `
                  : ''
              }
            `;
          } else {
            slotEl.innerHTML = `
              <div style="color: #555; font-style: italic;">[Vacant Slot]</div>
              <div style="font-size: 0.75rem; color: #444; margin-top: 4px;">???</div>
            `;
          }
          slotsGrid.appendChild(slotEl);
        }
        rankRow.appendChild(slotsGrid);
        hierarchyContainer.appendChild(rankRow);
      }
      entityList.appendChild(hierarchyContainer);
    }
  }

  // Render Player's Chronicle Timeline
  const playerEntityId = state.entities.find((e) => getComponent(state, e, ComponentType.Player) !== undefined);
  if (playerEntityId !== undefined) {
    const playerChronicle = getComponent(state, playerEntityId, ComponentType.Chronicle) as
      | ChronicleComponent
      | undefined;
    if (playerChronicle && playerChronicle.eventExcerpts.length > 0) {
      const playerHeader = document.createElement('h2');
      playerHeader.style.color = '#fff';
      playerHeader.style.fontSize = '1.3rem';
      playerHeader.style.borderBottom = '2px solid #555';
      playerHeader.style.paddingBottom = '6px';
      playerHeader.style.marginTop = '32px';
      playerHeader.style.marginBottom = '16px';
      playerHeader.textContent = 'Your Chronicle (Timeline)';
      entityList.appendChild(playerHeader);

      const timelineContainer = document.createElement('div');
      timelineContainer.style.display = 'flex';
      timelineContainer.style.flexDirection = 'column';
      timelineContainer.style.gap = '8px';
      timelineContainer.style.background = 'rgba(0, 0, 0, 0.2)';
      timelineContainer.style.border = '1px solid #333';
      timelineContainer.style.borderRadius = '6px';
      timelineContainer.style.padding = '12px';
      timelineContainer.style.marginBottom = '24px';

      for (const eventId of playerChronicle.eventExcerpts) {
        const event = state.historicalLedger.find((le) => le.id === eventId);
        if (!event) continue;
        const turn = event.id ? event.id.split('_')[1] : '?';

        const itemEl = document.createElement('div');
        itemEl.style.display = 'flex';
        itemEl.style.gap = '12px';
        itemEl.style.fontSize = '0.9rem';
        itemEl.style.borderLeft = '2px solid #3498db';
        itemEl.style.paddingLeft = '8px';
        itemEl.style.marginLeft = '4px';

        const turnEl = document.createElement('span');
        turnEl.style.color = '#3498db';
        turnEl.style.fontWeight = 'bold';
        turnEl.style.minWidth = '60px';
        turnEl.textContent = `Turn ${turn}`;

        const summaryEl = document.createElement('span');
        summaryEl.style.color = '#ddd';
        summaryEl.textContent = event.summary ?? 'Unknown event.';

        itemEl.appendChild(turnEl);
        itemEl.appendChild(summaryEl);
        timelineContainer.appendChild(itemEl);
      }
      entityList.appendChild(timelineContainer);
    }
  }

  // 2. Render Chronicle Dossiers flat list at the bottom
  const dossiersHeader = document.createElement('h2');
  dossiersHeader.style.color = '#fff';
  dossiersHeader.style.fontSize = '1.3rem';
  dossiersHeader.style.borderBottom = '2px solid #555';
  dossiersHeader.style.paddingBottom = '6px';
  dossiersHeader.style.marginTop = '32px';
  dossiersHeader.style.marginBottom = '16px';
  dossiersHeader.textContent = 'Notable Chronicles';
  entityList.appendChild(dossiersHeader);

  if (entitiesWithChronicle.length === 0) {
    const emptyEl = document.createElement('div');
    emptyEl.className = 'status-empty';
    emptyEl.style.padding = '16px';
    emptyEl.textContent = 'No notable entities recorded yet.';
    entityList.appendChild(emptyEl);
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

    const excerptsHtml = data.chronicle.eventExcerpts
      .map((eventId) => {
        const e = state.historicalLedger.find((le) => le.id === eventId);
        if (!e) return '';
        const turn = e.id ? e.id.split('_')[1] : '?';
        return `<li style="margin-bottom: 4px;"><span style="color: var(--text-dim);">[Turn ${turn}]</span> ${e.summary}</li>`;
      })
      .join('');

    const stress = data.memory?.stress ?? 0;
    let stressColor = '#2ecc71';
    if (stress >= 80) {
      stressColor = '#e74c3c';
    } else if (stress >= 40) {
      stressColor = '#f39c12';
    }

    const thoughtsHtml =
      data.memory?.thoughts && data.memory.thoughts.length > 0
        ? data.memory.thoughts
            .map(
              (t) =>
                `<li style="margin-bottom: 4px; color: var(--text-dim);"><span style="color: var(--text-dim);">[Turn ${t.turn}]</span> ${t.eventSummary} <span style="color: ${t.stressDelta >= 0 ? '#e74c3c' : '#2ecc71'}; font-weight: 500;">(${t.stressDelta >= 0 ? '+' : ''}${t.stressDelta} Stress)</span></li>`
            )
            .join('')
        : '<li style="color: var(--text-dim); font-style: italic;">No transient thoughts.</li>';

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
