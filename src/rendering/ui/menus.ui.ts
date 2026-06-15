import { type GameState, UIMode } from '../../types/game-state.types.ts';
import { ComponentType } from '../../types/components.types.ts';
import { getComponent } from '../../core/ecs.ts';
import type { CampaignRegistryEntry } from '../../types/campaign.types.ts';

/**
 * Toggles the visibility of the Main Menu and Game Over overlays based on UIMode.
 * @param state The current GameState.
 * @param hasSave Whether a save game currently exists (enables Continue).
 */
export function renderMenus(state: GameState, hasSave: boolean): void {
  const mainMenu = document.getElementById('main-menu');
  const gameOverScreen = document.getElementById('game-over-screen');
  const campaignSelectionOverlay = document.getElementById('campaign-selection-overlay');
  const btnContinue = document.getElementById('btn-continue') as HTMLButtonElement | null;
  const btnExport = document.getElementById('btn-export-save') as HTMLButtonElement | null;

  if (mainMenu) {
    if (state.uiMode === UIMode.MainMenu) {
      mainMenu.classList.remove('hidden');
      if (btnContinue) btnContinue.disabled = !hasSave;
      if (btnExport) btnExport.disabled = !hasSave;
    } else {
      mainMenu.classList.add('hidden');
    }
  }

  if (campaignSelectionOverlay) {
    if (state.uiMode === UIMode.CampaignSelect) {
      campaignSelectionOverlay.classList.remove('hidden');
    } else {
      campaignSelectionOverlay.classList.add('hidden');
    }
  }

  if (gameOverScreen) {
    if (state.uiMode === UIMode.GameOver) {
      gameOverScreen.classList.remove('hidden');
      const deathStats = gameOverScreen.querySelector('.death-stats');
      if (deathStats) {
        const player = state.entities.find((id) => getComponent(state, id, ComponentType.Player));
        const level = player ? (getComponent(state, player, ComponentType.Fighter)?.level ?? 1) : 1;
        const areaName = state.campaign.areas[state.currentAreaId]?.name ?? state.currentAreaId;
        deathStats.textContent = `You reached Level ${level} in ${areaName}.`;
      }

      const deathLog = document.getElementById('death-message-log');
      if (deathLog) {
        deathLog.innerHTML = '';
        // Show the last 5 messages so the player knows what killed them
        const lastMessages = state.messages.slice(-5);
        for (const msg of lastMessages) {
          const entry = document.createElement('div');
          entry.className = 'log-entry';
          if (msg.cssClass) {
            msg.cssClass.split(' ').forEach((cls) => entry.classList.add(cls));
          }
          entry.textContent = msg.text;
          deathLog.appendChild(entry);
        }
        deathLog.scrollTop = deathLog.scrollHeight;
      }
    } else {
      gameOverScreen.classList.add('hidden');
    }
  }
}

/**
 * Populates the Campaign Selection list.
 */
export function populateCampaignList(
  campaigns: CampaignRegistryEntry[],
  onSelect: (campaign: CampaignRegistryEntry) => void,
  onUninstall?: (campaignId: string) => void
): void {
  const list = document.getElementById('campaign-list');
  if (!list) return;
  list.innerHTML = '';

  for (const campaign of campaigns) {
    const btn = document.createElement('button');
    btn.className = 'campaign-list-item modal-btn';
    btn.style.padding = '12px';
    btn.style.textAlign = 'left';
    btn.style.background = 'rgba(0,0,0,0.3)';
    btn.style.border = '1px solid var(--border-color)';
    btn.style.color = 'var(--text-color)';
    btn.style.cursor = 'pointer';
    btn.style.width = '100%';
    const sourceBadge = campaign.source === 'installed' ? ' 📦' : campaign.source === 'editor' ? ' 🛠️' : ' 🏛️';
    btn.innerHTML = `<strong>${campaign.name}</strong><span style="float:right; opacity:0.7">${sourceBadge}</span>`;

    btn.addEventListener('click', () => {
      // Highlight selection
      Array.from(list.children).forEach((c) => {
        (c as HTMLElement).style.background = 'rgba(0,0,0,0.3)';
        (c as HTMLElement).style.borderColor = 'var(--border-color)';
      });
      btn.style.background = 'rgba(255, 255, 255, 0.1)';
      btn.style.borderColor = '#f1c40f'; // Highlight color

      // Update details
      const title = document.getElementById('campaign-detail-title');
      const desc = document.getElementById('campaign-detail-desc');
      const version = document.getElementById('campaign-detail-version');
      const author = document.getElementById('campaign-detail-author');
      const mapSize = document.getElementById('campaign-detail-map');
      const depth = document.getElementById('campaign-detail-depth');
      const startBtn = document.getElementById('btn-campaign-start') as HTMLButtonElement | null;
      const actions = document.getElementById('campaign-actions');

      if (title) title.textContent = campaign.name;
      if (desc) desc.textContent = campaign.description;
      if (version) version.textContent = campaign.version;
      if (author) author.textContent = campaign.author;
      if (mapSize) mapSize.textContent = campaign.mapSize;
      if (depth) depth.textContent = campaign.startingAreaId;
      if (startBtn) startBtn.disabled = false;

      if (actions) {
        actions.innerHTML = '';
        if (campaign.source === 'installed' && onUninstall) {
          const btnUninstall = document.createElement('button');
          btnUninstall.className = 'modal-btn';
          btnUninstall.style.padding = '4px 8px';
          btnUninstall.style.fontSize = '0.8rem';
          btnUninstall.style.background = '#c0392b';
          btnUninstall.textContent = '🗑️ Uninstall';
          btnUninstall.onclick = () => onUninstall(campaign.id);
          actions.appendChild(btnUninstall);
        }
      }

      onSelect(campaign);
    });

    // Hover effects
    btn.addEventListener('mouseenter', () => {
      if (btn.style.borderColor !== 'rgb(241, 196, 15)') {
        btn.style.background = 'rgba(255, 255, 255, 0.05)';
      }
    });
    btn.addEventListener('mouseleave', () => {
      if (btn.style.borderColor !== 'rgb(241, 196, 15)') {
        btn.style.background = 'rgba(0,0,0,0.3)';
      }
    });

    list.appendChild(btn);
  }
}
