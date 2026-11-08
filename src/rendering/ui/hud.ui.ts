import { type GameState } from '../../types/game-state.types.ts';
import { ComponentType } from '../../types/components.types.ts';
import { getComponent } from '../../core/ecs.ts';
import { markDomainDirty, PresentationDomain } from '../../core/presentation_queue.ts';
import { getActiveRuleset } from '../../rulesets/registry.ts';
import { LOG_FILTER_TABS, type LogFilterCategory, UITooltipType, UIStatId } from '../../constants/ui.constants.ts';

let activeLogFilter: LogFilterCategory = 'all';

/**
 * Classifies a message log entry into a filter tab category based on its cssClass and text.
 */
function matchesLogCategory(
  msg: { readonly text: string; readonly cssClass?: string | undefined },
  filter: LogFilterCategory
): boolean {
  if (filter === 'all') return true;
  const cls = msg.cssClass ?? 'system';
  const isCombat = cls.startsWith('combat');
  const isSpeech = cls === 'flavor' || msg.text.startsWith('"');
  if (filter === 'combat') return isCombat;
  if (filter === 'speech') return isSpeech;
  return !isCombat && !isSpeech;
}

/**
 * Renders the filter tab toolbar above the message log.
 */
function renderLogFilterTabs(): void {
  const tabsContainer = document.getElementById('message-log-tabs');
  if (!tabsContainer) return;

  tabsContainer.replaceChildren();
  for (const tab of LOG_FILTER_TABS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = tab.id === activeLogFilter ? 'log-tab-btn active' : 'log-tab-btn';
    btn.textContent = tab.label;
    btn.addEventListener('click', () => {
      activeLogFilter = tab.id;
      markDomainDirty(PresentationDomain.Log);
    });
    tabsContainer.appendChild(btn);
  }
}

/**
 * Renders the GameState's messages to the DOM, filtered by the active log category tab.
 * @param state The current GameState containing the messages array.
 */
export function renderMessageLog(state: GameState): void {
  renderLogFilterTabs();

  const messageLog = document.getElementById('message-log');

  if (!messageLog) {
    return; // Fast fail if DOM element doesn't exist
  }

  // Clear existing messages
  messageLog.replaceChildren();

  // Render messages from oldest to newest (top to bottom)
  for (const msg of state.messages) {
    if (!matchesLogCategory(msg, activeLogFilter)) continue;

    const entry = document.createElement('div');
    entry.className = 'log-entry';
    if (msg.cssClass) {
      msg.cssClass.split(' ').forEach((cls) => entry.classList.add(cls));
    }
    entry.textContent = msg.count && msg.count > 1 ? `${msg.text} (x${msg.count})` : msg.text;
    messageLog.appendChild(entry);
  }

  // Auto-scroll to the bottom so the newest message is always visible
  messageLog.scrollTop = messageLog.scrollHeight;

  const logBadge = document.getElementById('edge-badge-log');
  if (logBadge) {
    logBadge.textContent = state.messages.length > 0 ? String(state.messages.length) : 'LOG';
  }
}

/**
 * Renders the player's stats (HP, Level, XP, and ruleset-projected primary/secondary stat sockets) to the DOM.
 * @param state The current GameState.
 */
export function renderPlayerStats(state: GameState): void {
  const playerEntityId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined);
  if (playerEntityId === undefined) return;

  const vitals = getActiveRuleset(state).projectHudVitals(state, playerEntityId);
  if (!vitals) return;

  // Update Health
  const hpFill = document.getElementById('health-bar-fill');
  const hpText = document.getElementById('health-bar-text');
  const hpPercent = vitals.hpPercent;
  const vitalsBadge = document.getElementById('edge-badge-vitals');
  if (vitalsBadge) {
    vitalsBadge.textContent = `${Math.round(hpPercent)}%`;
  }
  if (hpFill && hpText) {
    hpFill.style.width = `${hpPercent}%`;
    hpText.textContent = `${vitals.hpCurrent} / ${vitals.hpMax}`;

    const hpRow = hpFill.closest('.stat-row') as HTMLElement;
    if (hpRow) {
      hpRow.dataset.tooltipType = UITooltipType.Stat;
      hpRow.dataset.tooltipId = UIStatId.HP;
    }
  }

  // Update Primary / Secondary Stat Sockets (e.g., ATK/DEF in classic, BAB/AC in dnd35e)
  const atkText = document.getElementById('atk-text');
  if (atkText) {
    atkText.textContent = vitals.primaryStat.value;
    const prevEl = atkText.previousElementSibling;
    if (prevEl && prevEl.classList.contains('stat-label-inline')) {
      prevEl.textContent = vitals.primaryStat.label;
    }
    const atkRow = atkText.closest('.stat-row') as HTMLElement;
    if (atkRow) {
      atkRow.dataset.tooltipType = UITooltipType.Stat;
      atkRow.dataset.tooltipId = UIStatId.Attack;
    }
  }

  const defText = document.getElementById('def-text');
  if (defText) {
    defText.textContent = vitals.secondaryStat.value;
    const prevEl = defText.previousElementSibling;
    if (prevEl && prevEl.classList.contains('stat-label-inline')) {
      prevEl.textContent = vitals.secondaryStat.label;
    }
    const defRow = defText.closest('.stat-row') as HTMLElement;
    if (defRow) {
      defRow.dataset.tooltipType = UITooltipType.Stat;
      defRow.dataset.tooltipId = UIStatId.Defense;
    }
  }

  // Update Level Socket
  const levelText = document.getElementById('player-level-text');
  if (levelText) {
    levelText.textContent = vitals.levelLabel.replace(/^ECL\s+/i, '');
  }

  // Update XP
  const xpFill = document.getElementById('xp-bar-fill');
  const xpText = document.getElementById('xp-bar-text');
  if (xpFill && xpText) {
    xpFill.style.width = `${vitals.xpPercent}%`;
    xpText.textContent = vitals.xpText;
  }

  // Update Status Effects (inline inside Vitals plate; collapses when empty)
  const statusContainer = document.getElementById('status-effects-container');
  const statuses = getComponent(state, playerEntityId, ComponentType.StatusEffects);
  const statusBadge = document.getElementById('edge-badge-status');
  if (statusBadge) {
    const count = statuses?.activeEffects.length ?? 0;
    statusBadge.textContent = count > 0 ? `${count}` : 'OK';
  }
  if (statusContainer) {
    statusContainer.replaceChildren();

    if (statuses && statuses.activeEffects.length > 0) {
      for (const active of statuses.activeEffects) {
        const def = state.campaign.status[active.effectId];
        const effectDiv = document.createElement('div');
        effectDiv.className = 'status-row';
        effectDiv.dataset.tooltipType = UITooltipType.Status;
        effectDiv.dataset.tooltipId = active.effectId;

        const label = document.createElement('span');
        label.className = 'status-label';
        label.textContent = def?.name ?? active.effectId;
        if (def?.color) {
          label.style.color = def.color;
        }

        const duration = document.createElement('span');
        duration.className = 'status-duration';
        duration.textContent = `${active.duration}t`;

        effectDiv.appendChild(label);
        effectDiv.appendChild(duration);
        statusContainer.appendChild(effectDiv);
      }
    }
  }
}

/**
 * Updates the HUD elements (health bar, depth indicator, player coordinates) based on current GameState.
 * @param s The current GameState.
 */
export function updateHUD(s: GameState): void {
  const currentArea = s.campaign.areas[s.currentAreaId];
  const areaName = currentArea?.name ?? s.currentAreaId;

  const depthElement = document.getElementById('dungeon-depth');
  if (depthElement !== null) {
    depthElement.textContent = areaName;
  }

  const areaDepthTag = document.getElementById('area-depth-tag');
  if (areaDepthTag !== null) {
    const danger = currentArea?.dangerRating;
    areaDepthTag.textContent = typeof danger === 'number' && danger > 0 ? `DANGER ${danger}` : 'SANCTUARY';
  }

  const playerEntityId = s.entities.find((id) => getComponent(s, id, ComponentType.Player) !== undefined);
  if (playerEntityId !== undefined) {
    const pos = getComponent(s, playerEntityId, ComponentType.Position);
    const coordsText = document.getElementById('player-coords-text');
    if (coordsText !== null && pos !== undefined) {
      coordsText.textContent = `X: ${pos.x}, Y: ${pos.y}`;
    }
  }

  const hpBarFill = document.querySelector('.health-bar') as HTMLElement | null;
  const hpBarText = document.querySelector('.health-bar + .bar-text') as HTMLElement | null;

  if (playerEntityId !== undefined) {
    const fighter = getComponent(s, playerEntityId, ComponentType.Fighter);
    if (fighter) {
      if (hpBarFill) {
        const percent = Math.max(0, Math.min(100, Math.round((fighter.hp / fighter.maxHp) * 100)));
        hpBarFill.style.width = `${percent}%`;
      }
      if (hpBarText) {
        hpBarText.textContent = `${fighter.hp} / ${fighter.maxHp}`;
      }
    }
  }
}
