import { type GameState, UIMode } from '../../types/game-state.types.ts';
import { ComponentType } from '../../types/components.types.ts';
import { getComponent } from '../../core/ecs.ts';
import type { CampaignRegistryEntry } from '../../types/campaign.types.ts';
import type { RulesetContract, RulesetId } from '../../types/ruleset.types.ts';

/**
 * Toggles the visibility of the Main Menu, Ruleset Selection, Campaign Selection, and Game Over overlays based on UIMode.
 * @param state The current GameState.
 * @param hasSave Whether a save game currently exists (enables Continue).
 */
export function renderMenus(state: GameState, hasSave: boolean): void {
  const mainMenu = document.getElementById('main-menu');
  const rulesetSelectionOverlay = document.getElementById('ruleset-selection-overlay');
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

  if (rulesetSelectionOverlay) {
    if (state.uiMode === UIMode.RulesetSelect) {
      rulesetSelectionOverlay.classList.remove('hidden');
    } else {
      rulesetSelectionOverlay.classList.add('hidden');
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
        deathLog.replaceChildren();
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
 * Updates the Ruleset details pane for the currently selected ruleset.
 *
 * @param ruleset The selected RulesetContract.
 */
function renderRulesetDetails(ruleset: RulesetContract): void {
  const title = document.getElementById('ruleset-detail-title');
  const desc = document.getElementById('ruleset-detail-desc');
  const version = document.getElementById('ruleset-detail-version');
  const features = document.getElementById('ruleset-detail-features');

  if (title) title.textContent = `${ruleset.metadata.badgeIcon} ${ruleset.metadata.name}`;
  if (desc) desc.textContent = ruleset.metadata.description;
  if (version) version.textContent = ruleset.metadata.version;
  if (features) {
    features.replaceChildren();
    for (const bullet of ruleset.metadata.features) {
      const li = document.createElement('li');
      li.textContent = bullet;
      features.appendChild(li);
    }
  }
}

/**
 * Populates the Ruleset Selection modal list using pure DOM creation (`document.createElement`).
 *
 * @param rulesets Registered ruleset cartridges.
 * @param selectedId Currently selected RulesetId.
 * @param onSelect Callback invoked when the user selects a ruleset.
 */
export function populateRulesetList(
  rulesets: ReadonlyArray<RulesetContract>,
  selectedId: RulesetId,
  onSelect: (rulesetId: RulesetId) => void
): void {
  const list = document.getElementById('ruleset-list');
  if (!list) return;
  list.replaceChildren();

  for (const ruleset of rulesets) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ruleset-list-item modal-btn';
    btn.style.padding = '12px';
    btn.style.textAlign = 'left';
    const isSelected = ruleset.metadata.id === selectedId;
    btn.style.background = isSelected ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0,0,0,0.3)';
    btn.style.border = `1px solid ${isSelected ? '#f1c40f' : 'var(--border-color)'}`;
    btn.style.color = 'var(--text-color)';
    btn.style.cursor = 'pointer';
    btn.style.width = '100%';

    const strong = document.createElement('strong');
    strong.textContent = `${ruleset.metadata.badgeIcon} ${ruleset.metadata.name}`;
    const shortSpan = document.createElement('span');
    shortSpan.style.float = 'right';
    shortSpan.style.opacity = '0.7';
    shortSpan.textContent = ruleset.metadata.shortLabel;
    btn.appendChild(strong);
    btn.appendChild(shortSpan);

    if (isSelected) {
      renderRulesetDetails(ruleset);
    }

    btn.addEventListener('click', () => {
      Array.from(list.children).forEach((c) => {
        (c as HTMLElement).style.background = 'rgba(0,0,0,0.3)';
        (c as HTMLElement).style.borderColor = 'var(--border-color)';
      });
      btn.style.background = 'rgba(255, 255, 255, 0.1)';
      btn.style.borderColor = '#f1c40f';
      renderRulesetDetails(ruleset);
      onSelect(ruleset.metadata.id);
    });

    list.appendChild(btn);
  }
}

/**
 * Populates the Campaign Selection list using pure DOM creation (`document.createElement`).
 *
 * @param campaigns Filtered campaigns for the active ruleset.
 * @param onSelect Callback invoked when a campaign is selected.
 * @param onUninstall Optional callback for uninstalling user-installed campaigns.
 */
export function populateCampaignList(
  campaigns: CampaignRegistryEntry[],
  onSelect: (campaign: CampaignRegistryEntry) => void,
  onUninstall?: (campaignId: string) => void
): void {
  const list = document.getElementById('campaign-list');
  if (!list) return;
  list.replaceChildren();

  const title = document.getElementById('campaign-detail-title');
  const desc = document.getElementById('campaign-detail-desc');
  const version = document.getElementById('campaign-detail-version');
  const author = document.getElementById('campaign-detail-author');
  const mapSize = document.getElementById('campaign-detail-map');
  const depth = document.getElementById('campaign-detail-depth');
  const startBtn = document.getElementById('btn-campaign-start') as HTMLButtonElement | null;
  const actions = document.getElementById('campaign-actions');

  if (title) title.textContent = 'Select a Campaign';
  if (desc) {
    desc.textContent =
      campaigns.length === 0 ? 'No campaigns are currently installed for this ruleset.' : 'No campaign selected.';
  }
  if (version) version.textContent = '-';
  if (author) author.textContent = '-';
  if (mapSize) mapSize.textContent = '-';
  if (depth) depth.textContent = '-';
  if (startBtn) startBtn.disabled = true;
  if (actions) actions.replaceChildren();

  if (campaigns.length === 0) {
    const emptyMsg = document.createElement('div');
    emptyMsg.style.padding = '12px';
    emptyMsg.style.color = 'var(--text-dim)';
    emptyMsg.style.fontSize = '0.85rem';
    emptyMsg.textContent = 'No campaigns available for this ruleset yet.';
    list.appendChild(emptyMsg);
    return;
  }

  for (const campaign of campaigns) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'campaign-list-item modal-btn';
    btn.style.padding = '12px';
    btn.style.textAlign = 'left';
    btn.style.background = 'rgba(0,0,0,0.3)';
    btn.style.border = '1px solid var(--border-color)';
    btn.style.color = 'var(--text-color)';
    btn.style.cursor = 'pointer';
    btn.style.width = '100%';
    const sourceBadge = campaign.source === 'installed' ? ' 📦' : campaign.source === 'editor' ? ' 🛠️' : ' 🏛️';

    const strong = document.createElement('strong');
    strong.textContent = campaign.name;
    const badgeSpan = document.createElement('span');
    badgeSpan.style.float = 'right';
    badgeSpan.style.opacity = '0.7';
    badgeSpan.textContent = sourceBadge;
    btn.appendChild(strong);
    btn.appendChild(badgeSpan);

    btn.addEventListener('click', () => {
      // Highlight selection
      Array.from(list.children).forEach((c) => {
        (c as HTMLElement).style.background = 'rgba(0,0,0,0.3)';
        (c as HTMLElement).style.borderColor = 'var(--border-color)';
      });
      btn.style.background = 'rgba(255, 255, 255, 0.1)';
      btn.style.borderColor = '#f1c40f'; // Highlight color

      if (title) title.textContent = campaign.name;
      if (desc) desc.textContent = campaign.description;
      if (version) version.textContent = campaign.version;
      if (author) author.textContent = campaign.author;
      if (mapSize) mapSize.textContent = campaign.mapSize;
      if (depth) depth.textContent = campaign.startingAreaId;
      if (startBtn) startBtn.disabled = false;

      if (actions) {
        actions.replaceChildren();
        if (campaign.source === 'installed' && onUninstall) {
          const btnUninstall = document.createElement('button');
          btnUninstall.type = 'button';
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
