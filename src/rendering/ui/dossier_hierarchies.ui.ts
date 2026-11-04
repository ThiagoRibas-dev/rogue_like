import { type GameState } from '../../types/game-state.types.ts';
import {
  ComponentType,
  type ChronicleComponent,
  type FighterComponent,
  type IdentityComponent,
  type NemesisComponent
} from '../../types/components.types.ts';
import { getComponent } from '../../core/ecs.ts';

/**
 * Renders the Nemesis Hierarchies grid and Player Chronicle Timeline into the Dossier UI.
 */
export function renderDossierHierarchiesAndTimeline(state: GameState, entityList: HTMLElement): void {
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

            const activeComps = state.components.get(occupantId);
            if (activeComps) {
              identity = activeComps[ComponentType.Identity] as IdentityComponent | undefined;
              chronicle = activeComps[ComponentType.Chronicle] as ChronicleComponent | undefined;
              const fighter = activeComps[ComponentType.Fighter] as FighterComponent | undefined;
              isAlive = fighter ? fighter.hp > 0 : false;
            } else {
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

  const playerEntityId = state.entities.find((e) => getComponent(state, e, ComponentType.Player) !== undefined);
  if (playerEntityId !== undefined) {
    const playerChronicle = getComponent(state, playerEntityId, ComponentType.Chronicle) as
      ChronicleComponent | undefined;
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
}
