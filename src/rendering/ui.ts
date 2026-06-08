import { type GameState, EngineMode } from '../types/game-state.types.ts';
import { UIMode } from '../types/game-state.types.ts';
import { ComponentType } from '../types/components.types.ts';
import { getComponent } from '../core/ecs.ts';

import { getEffectiveCapacity } from '../systems/inventory.system.ts';
import { getEffectiveStats } from '../utils/stats.ts';

import { getHungerState } from '../systems/hunger.system.ts';

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
  // (In a more complex app, we might diff this or use a virtual DOM,
  // but for our MVP, replacing innerHTML is fast enough given the small count)
  messageLog.innerHTML = '';

  // Render messages from oldest to newest (top to bottom)
  for (const msg of state.messages) {
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    if (msg.cssClass) {
      // Allow adding multiple classes separated by spaces if needed
      msg.cssClass.split(' ').forEach((cls) => entry.classList.add(cls));
    }
    entry.textContent = msg.text;
    messageLog.appendChild(entry);
  }

  // Auto-scroll to the bottom so the newest message is always visible
  messageLog.scrollTop = messageLog.scrollHeight;
}

/**
 * Renders or hides the inventory panel overlay based on the current UIMode.
 * When open, lists all items in the player's inventory with slot labels (a-z),
 * colored by item category, and shows current capacity.
 * @param state The current GameState.
 */
export function renderInventoryPanel(state: GameState): void {
  const panel = document.getElementById('inventory-panel');
  if (!panel) return;

  if (state.uiMode !== UIMode.Inventory) {
    panel.classList.remove('visible');
    panel.innerHTML = '';
    return;
  }

  panel.classList.add('visible');
  panel.innerHTML = '';

  // Find player
  const playerEntityId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined);
  if (playerEntityId === undefined) return;

  const inventory = getComponent(state, playerEntityId, ComponentType.Inventory);
  if (!inventory) return;

  const equipment = getComponent(state, playerEntityId, ComponentType.Equipment);
  const effectiveCapacity = getEffectiveCapacity(state, playerEntityId);

  // Header
  const header = document.createElement('div');
  header.className = 'inv-header';
  header.textContent = `Inventory (${inventory.items.length}/${effectiveCapacity})`;
  panel.appendChild(header);

  const hint = document.createElement('div');
  hint.className = 'inv-hint';
  hint.textContent = '[a-z] Use  [Alt+a-z] Equip/Unequip  [Shift+a-z] Drop  [I/Esc] Close';
  panel.appendChild(hint);

  if (inventory.items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'inv-empty';
    empty.textContent = '(empty)';
    panel.appendChild(empty);
    return;
  }

  inventory.items.forEach((itemEntityId, index) => {
    const itemComp = getComponent(state, itemEntityId, ComponentType.Item);
    if (!itemComp) return;

    const def = state.campaign.items[itemComp.itemId];
    const isIdentified = state.identifiedItems.has(itemComp.itemId);
    const displayName = isIdentified
      ? def?.name
      : (state.itemUnidentifiedNames.get(itemComp.itemId) ?? def?.unidentifiedName ?? itemComp.itemId);
    const slotLabel = String.fromCharCode(97 + index);
    const isEquippedWeapon = equipment?.weapon === itemEntityId;
    const isEquippedArmor = equipment?.armor === itemEntityId;
    const isEquipped = isEquippedWeapon || isEquippedArmor;

    const row = document.createElement('div');
    row.className = `inv-slot inv-cat-${def?.category ?? 'consumable'}`;
    if (isEquipped) row.classList.add('inv-equipped');

    const label = document.createElement('span');
    label.className = 'inv-slot-label';
    label.textContent = `${slotLabel})`;

    const name = document.createElement('span');
    name.className = 'inv-slot-name';
    name.textContent = `${displayName}${isEquipped ? ' (equipped)' : ''}`;

    row.appendChild(label);
    row.appendChild(name);
    panel.appendChild(row);
  });
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
      // Optional: Add color styling based on state
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
      // Max level reached
      xpFill.style.width = '100%';
      xpText.textContent = `MAX (${fighter.xp})`;
    }
  }

  // Update Status Effects
  const statusContainer = document.getElementById('status-effects-container');
  if (statusContainer) {
    const statuses = getComponent(state, playerEntityId, ComponentType.StatusEffects);
    statusContainer.innerHTML = ''; // Clear current

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

/**
 * Toggles the visibility of the Main Menu and Game Over overlays based on UIMode.
 * @param state The current GameState.
 * @param hasSave Whether a save game currently exists (enables Continue).
 */
export function renderMenus(state: GameState, hasSave: boolean): void {
  const mainMenu = document.getElementById('main-menu');
  const gameOverScreen = document.getElementById('game-over-screen');
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

  if (gameOverScreen) {
    if (state.uiMode === UIMode.GameOver) {
      gameOverScreen.classList.remove('hidden');
      const deathStats = gameOverScreen.querySelector('.death-stats');
      if (deathStats) {
        const player = state.entities.find((id) => getComponent(state, id, ComponentType.Player));
        const level = player ? (getComponent(state, player, ComponentType.Fighter)?.level ?? 1) : 1;
        deathStats.textContent = `You reached Level ${level} on Floor ${state.currentDepth}.`;
      }
    } else {
      gameOverScreen.classList.add('hidden');
    }
  }
}

/**
 * Updates the Real-Time with Pause (RTwP) UI controls in the sidebar.
 * @param state The current GameState.
 */
export function renderRTwPControls(state: GameState): void {
  const btnMode = document.getElementById('btn-engine-mode');
  const rtwpControls = document.getElementById('rtwp-controls');
  const btnPause = document.getElementById('btn-pause');
  const btnSpeed1 = document.getElementById('btn-speed-1');
  const btnSpeed2 = document.getElementById('btn-speed-2');
  const btnSpeed4 = document.getElementById('btn-speed-4');

  if (btnMode) {
    btnMode.textContent = state.engineMode === EngineMode.TurnBased ? 'Turn-Based Mode' : 'RTwP Mode';
    btnMode.classList.toggle('active', state.engineMode === EngineMode.RTwP);
  }

  if (rtwpControls) {
    rtwpControls.style.display = state.engineMode === EngineMode.RTwP ? 'flex' : 'none';
  }

  if (state.engineMode === EngineMode.RTwP && btnPause) {
    if (state.rtwpState.paused) {
      btnPause.textContent = '▶ Paused';
      btnPause.classList.add('paused');
    } else {
      btnPause.textContent = '⏸ Playing';
      btnPause.classList.remove('paused');
    }
  }

  if (state.engineMode === EngineMode.RTwP) {
    if (btnSpeed1) btnSpeed1.classList.toggle('active', state.rtwpState.speedMultiplier === 1);
    if (btnSpeed2) btnSpeed2.classList.toggle('active', state.rtwpState.speedMultiplier === 2);
    if (btnSpeed4) btnSpeed4.classList.toggle('active', state.rtwpState.speedMultiplier === 4);
  }
}
