import { type GameState } from '../../types/game-state.types.ts';
import { ComponentType } from '../../types/components.types.ts';
import { getComponent } from '../../core/ecs.ts';
import { getEffectiveStats } from '../../utils/stats.ts';
import { getHungerState } from '../../systems/hunger.system.ts';
import { UITooltipType, UIStatId } from '../../constants/ui.constants.ts';

/**
 * Renders the GameState's messages to the DOM.
 * @param state The current GameState containing the messages array.
 */
export function renderMessageLog(state: GameState): void {
  const messageLog = document.getElementById('message-log');

  if (!messageLog) {
    return; // Fast fail if DOM element doesn't exist
  }

  // Clear existing messages
  messageLog.innerHTML = '';

  // Render messages from oldest to newest (top to bottom)
  for (const msg of state.messages) {
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
}

/**
 * Renders the player's stats (HP, Level, XP) to the DOM.
 * @param state The current GameState.
 */
export function renderPlayerStats(state: GameState): void {
  const playerEntityId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined);
  if (playerEntityId === undefined) return;

  const fighter = getComponent(state, playerEntityId, ComponentType.Fighter);
  if (!fighter) return;

  const effectiveStats = getEffectiveStats(state, playerEntityId);

  // Update Health
  const hpFill = document.getElementById('health-bar-fill');
  const hpText = document.getElementById('health-bar-text');
  if (hpFill && hpText) {
    const hpPercent = Math.max(0, Math.min(100, (fighter.hp / effectiveStats.maxHp) * 100));
    hpFill.style.width = `${hpPercent}%`;
    hpText.textContent = `${fighter.hp} / ${effectiveStats.maxHp}`;

    const hpRow = hpFill.closest('.stat-row') as HTMLElement;
    if (hpRow) {
      hpRow.dataset.tooltipType = UITooltipType.Stat;
      hpRow.dataset.tooltipId = UIStatId.HP;
    }
  }

  // Update ATK/DEF
  const atkText = document.getElementById('atk-text');
  if (atkText) {
    atkText.textContent = effectiveStats.attack.toString();
    const atkRow = atkText.closest('.stat-row') as HTMLElement;
    if (atkRow) {
      atkRow.dataset.tooltipType = UITooltipType.Stat;
      atkRow.dataset.tooltipId = UIStatId.Attack;
    }
  }

  const defText = document.getElementById('def-text');
  if (defText) {
    defText.textContent = effectiveStats.defense.toString();
    const defRow = defText.closest('.stat-row') as HTMLElement;
    if (defRow) {
      defRow.dataset.tooltipType = UITooltipType.Stat;
      defRow.dataset.tooltipId = UIStatId.Defense;
    }
  }

  // Update Level
  const levelText = document.getElementById('player-level-text');
  if (levelText) {
    levelText.textContent = fighter.level.toString();
  }

  // Update Hunger
  const hungerText = document.getElementById('hunger-text');
  if (hungerText) {
    const hunger = getComponent(state, playerEntityId, ComponentType.Hunger);
    if (hunger) {
      const stateLabel = getHungerState(state, hunger.satiation);
      hungerText.textContent = stateLabel;
      hungerText.style.color = stateLabel === 'Starving' ? '#e74c3c' : stateLabel === 'Hungry' ? '#f39c12' : '#ecf0f1';
    }
  }

  // Update XP
  const xpFill = document.getElementById('xp-bar-fill');
  const xpText = document.getElementById('xp-bar-text');
  if (xpFill && xpText) {
    const currentAdvancement = state.campaign.advancement.find((a) => a.level === fighter.level);
    const nextAdvancement = state.campaign.advancement.find((a) => a.level === fighter.level + 1);

    const baseLevelXp = currentAdvancement ? currentAdvancement.requiredXp : 0;
    const currentXpInLevel = Math.max(0, fighter.xp - baseLevelXp);

    if (nextAdvancement) {
      const xpNeededForNextLevel = nextAdvancement.requiredXp - baseLevelXp;
      const xpPercent = Math.max(0, Math.min(100, (currentXpInLevel / xpNeededForNextLevel) * 100));
      xpFill.style.width = `${xpPercent}%`;
      xpText.textContent = `${fighter.xp} / ${nextAdvancement.requiredXp}`;
    } else {
      xpFill.style.width = '100%';
      xpText.textContent = `MAX (${fighter.xp})`;
    }
  }

  // Update Status Effects
  const statusContainer = document.getElementById('status-effects-container');
  if (statusContainer) {
    const statuses = getComponent(state, playerEntityId, ComponentType.StatusEffects);
    statusContainer.innerHTML = '';

    if (!statuses || statuses.activeEffects.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'status-empty';
      empty.textContent = 'Normal';
      statusContainer.appendChild(empty);
    } else {
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
        duration.textContent = `(${active.duration}t)`;

        effectDiv.appendChild(label);
        effectDiv.appendChild(duration);
        statusContainer.appendChild(effectDiv);
      }
    }
  }
}
