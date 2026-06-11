import { type GameState, type EntityId, EngineMode } from '../types/game-state.types.ts';
import { UIMode } from '../types/game-state.types.ts';
import { ComponentType } from '../types/components.types.ts';
import { getComponent } from '../core/ecs.ts';
import type { CampaignRegistryEntry } from '../types/campaign.types.ts';

import { getEffectiveCapacity } from '../systems/inventory.system.ts';
import { getEffectiveStats } from '../utils/stats.ts';
import { getHungerState } from '../systems/hunger.system.ts';
import { UITooltipType, UIStatId } from '../constants/ui.constants.ts';
import { getSettings } from '../core/settings.ts';

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
    entry.textContent = msg.count && msg.count > 1 ? `${msg.text} (x${msg.count})` : msg.text;
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
  const overlay = document.getElementById('inventory-overlay');
  const equipPanel = document.getElementById('equipment-panel');
  const packPanel = document.getElementById('backpack-panel');
  if (!overlay || !equipPanel || !packPanel) return;

  if (state.uiMode !== UIMode.Inventory) {
    overlay.classList.add('hidden');
    equipPanel.innerHTML = '';
    packPanel.innerHTML = '';
    return;
  }

  overlay.classList.remove('hidden');
  equipPanel.innerHTML = '';
  packPanel.innerHTML = '';

  // Find player
  const playerEntityId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined);
  if (playerEntityId === undefined) return;

  const inventory = getComponent(state, playerEntityId, ComponentType.Inventory);
  if (!inventory) return;

  const equipment = getComponent(state, playerEntityId, ComponentType.Equipment);
  const effectiveCapacity = getEffectiveCapacity(state, playerEntityId);

  // Headers
  const equipHeader = document.createElement('div');
  equipHeader.className = 'inv-header';
  equipHeader.textContent = `Equipment`;
  equipPanel.appendChild(equipHeader);

  const packHeader = document.createElement('div');
  packHeader.className = 'inv-header';
  packHeader.textContent = `Backpack (${inventory.items.length}/${effectiveCapacity})`;
  packPanel.appendChild(packHeader);

  const hint = document.createElement('div');
  hint.className = 'inv-hint';
  hint.textContent = '[a-z] Use/Equip  [Shift+a-z] Drop  [I/Esc] Close';
  packPanel.appendChild(hint);

  // --- Equipment Panel (Paperdoll Layout) ---
  const paperdoll = document.createElement('div');
  paperdoll.className = 'paperdoll-layout';

  const renderEquipSlot = (slotName: string, itemEntityId: EntityId | null): HTMLElement => {
    const slotDiv = document.createElement('div');
    slotDiv.className = 'paperdoll-slot';

    const header = document.createElement('div');
    header.className = 'equipment-slot-header';
    header.textContent = slotName;
    slotDiv.appendChild(header);

    if (itemEntityId === null) {
      const empty = document.createElement('div');
      empty.className = 'equipment-slot-empty';
      empty.textContent = '(Empty)';
      slotDiv.appendChild(empty);
    } else {
      const index = inventory.items.indexOf(itemEntityId);
      if (index === -1) return slotDiv;

      const itemComp = getComponent(state, itemEntityId, ComponentType.Item);
      if (!itemComp) return slotDiv;

      const def = state.campaign.items[itemComp.itemId];
      const isIdentified = state.identifiedItems.has(itemComp.itemId);
      const displayName = isIdentified
        ? def?.name
        : (state.itemUnidentifiedNames.get(itemComp.itemId) ?? def?.unidentifiedName ?? itemComp.itemId);
      const slotLabel = String.fromCharCode(97 + index);

      const row = document.createElement('div');
      row.className = `inv-slot inv-cat-${def?.category ?? 'consumable'} inv-equipped`;
      row.dataset.tooltipType = UITooltipType.Item;
      row.dataset.tooltipId = itemEntityId.toString();

      const label = document.createElement('span');
      label.className = 'inv-slot-label';
      label.textContent = `[${slotLabel}]`;

      const name = document.createElement('span');
      name.className = 'inv-slot-name';
      name.textContent = `${displayName}`;

      row.appendChild(label);
      row.appendChild(name);
      slotDiv.appendChild(row);
    }
    return slotDiv;
  };

  const createZone = (zoneName: string, slotTypes: string[]) => {
    const zoneDiv = document.createElement('div');
    zoneDiv.className = `paperdoll-zone zone-${zoneName}`;

    if (equipment) {
      const zoneSlots = equipment.slots.filter((s) => slotTypes.includes(s.slotType));
      if (zoneSlots.length > 0) {
        zoneSlots.forEach((slot) => {
          zoneDiv.appendChild(renderEquipSlot(slot.slotType, slot.equippedItem));
        });
        paperdoll.appendChild(zoneDiv);
      }
    }
  };

  const createSplitZone = (zonePrefix: string, slotTypes: string[]) => {
    if (equipment) {
      const leftSlots: typeof equipment.slots = [];
      const rightSlots: typeof equipment.slots = [];

      slotTypes.forEach((type) => {
        const slotsOfType = equipment.slots.filter((s) => s.slotType === type);
        slotsOfType.forEach((slot, index) => {
          if (index % 2 === 0) leftSlots.push(slot);
          else rightSlots.push(slot);
        });
      });

      if (leftSlots.length > 0) {
        const leftDiv = document.createElement('div');
        leftDiv.className = `paperdoll-zone zone-${zonePrefix}-left`;
        leftSlots.forEach((slot) => {
          leftDiv.appendChild(renderEquipSlot(slot.slotType, slot.equippedItem));
        });
        paperdoll.appendChild(leftDiv);
      }

      if (rightSlots.length > 0) {
        const rightDiv = document.createElement('div');
        rightDiv.className = `paperdoll-zone zone-${zonePrefix}-right`;
        rightSlots.forEach((slot) => {
          rightDiv.appendChild(renderEquipSlot(slot.slotType, slot.equippedItem));
        });
        paperdoll.appendChild(rightDiv);
      }
    }
  };

  createZone('head', ['head', 'neck']);
  createZone('torso', ['torso', 'back']);
  createSplitZone('arms', ['arm', 'hand', 'finger']);
  createZone('legs', ['leg', 'foot']);

  equipPanel.appendChild(paperdoll);

  // --- Backpack Panel (Grid Layout) ---
  const gridContainer = document.createElement('div');
  gridContainer.className = 'inventory-grid';

  for (let i = 0; i < effectiveCapacity; i++) {
    const itemEntityId = inventory.items[i];

    const slotDiv = document.createElement('div');
    slotDiv.className = 'inv-grid-slot';

    // Add label for hotkey
    if (i < 26) {
      const label = document.createElement('span');
      label.className = 'inv-grid-label';
      label.textContent = String.fromCharCode(97 + i);
      slotDiv.appendChild(label);
    }

    if (itemEntityId !== undefined) {
      // It has an item
      const isEquipped = equipment?.slots.some((s) => s.equippedItem === itemEntityId) ?? false;
      if (isEquipped) {
        slotDiv.classList.add('inv-equipped-grid');
      }

      const itemComp = getComponent(state, itemEntityId, ComponentType.Item);
      if (itemComp) {
        const renderable = getComponent(state, itemEntityId, ComponentType.Renderable);
        const icon = document.createElement('span');
        icon.className = 'inv-item-icon';
        icon.textContent = renderable ? renderable.glyph : '?';
        icon.style.color = renderable ? renderable.fg : '#fff';

        slotDiv.appendChild(icon);

        slotDiv.dataset.tooltipType = UITooltipType.Item;
        slotDiv.dataset.tooltipId = itemEntityId.toString();
      }
    } else {
      slotDiv.classList.add('inv-grid-empty');
    }

    gridContainer.appendChild(slotDiv);
  }

  packPanel.appendChild(gridContainer);
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

/**
 * Updates the view controls (Rotation, 3D tilt, and Zoom) and applies the canvas transform.
 * @param state The current GameState.
 */
export function renderViewControls(state: GameState): void {
  const canvasWrapper = document.getElementById('game-canvas-wrapper');
  const btnToggleRotate = document.getElementById('btn-toggle-rotate');
  const btnToggle3D = document.getElementById('btn-toggle-3d');

  if (canvasWrapper) {
    let transformStr = `perspective(1000px)`;

    if (state.is3D) {
      transformStr += ` rotateX(55deg)`;
    }

    if (state.isRotated) {
      transformStr += ` rotateZ(45deg)`;
    }

    transformStr += ` scale(${state.zoomLevel})`;

    canvasWrapper.style.transform = transformStr;

    // Remove shadow if 3D tilted because it looks weird
    if (state.is3D) {
      canvasWrapper.style.boxShadow = 'none';
    } else {
      canvasWrapper.style.boxShadow = ''; // restore CSS default
    }
  }

  if (btnToggleRotate) {
    btnToggleRotate.classList.toggle('active', state.isRotated);
  }
  if (btnToggle3D) {
    btnToggle3D.classList.toggle('active', state.is3D);
  }
}

/**
 * Initializes the global UI tooltip system using event delegation.
 * @param getState Function to retrieve the current GameState.
 */
export function initUITooltips(getState: () => GameState | undefined): void {
  const tooltip = document.getElementById('ui-tooltip');
  if (!tooltip) return;

  const handleMouseMove = (e: MouseEvent) => {
    // Look for a target with data-tooltip-type
    const target = (e.target as HTMLElement).closest('[data-tooltip-type]') as HTMLElement | null;

    if (!target) {
      tooltip.classList.add('hidden');
      return;
    }

    const state = getState();
    if (!state) return;

    const type = target.dataset.tooltipType;
    const id = target.dataset.tooltipId;

    let contentHTML = '';

    if (type === UITooltipType.Item && id) {
      const entityId = parseInt(id, 10) as EntityId;
      const itemComp = getComponent(state, entityId, ComponentType.Item);
      if (itemComp) {
        const itemDef = state.campaign.items[itemComp.itemId];
        const isIdentified = state.identifiedItems.has(itemComp.itemId);
        const name = isIdentified
          ? itemDef?.name
          : (state.itemUnidentifiedNames.get(itemComp.itemId) ?? itemDef?.unidentifiedName ?? itemComp.itemId);

        contentHTML += `<div class="ui-tooltip-header">${name}</div>`;
        if (itemDef?.description && isIdentified) {
          contentHTML += `<div class="ui-tooltip-desc">${itemDef.description}</div>`;
        }
      }
    } else if (type === UITooltipType.Status && id) {
      const def = state.campaign.status[id];
      if (def) {
        contentHTML += `<div class="ui-tooltip-header" style="color: ${def.color ?? 'inherit'}">${def.name}</div>`;
        if (def.description) {
          contentHTML += `<div class="ui-tooltip-desc">${def.description}</div>`;
        }
      }
    } else if (type === UITooltipType.Stat && id) {
      const playerEntityId = state.entities.find((eid) => getComponent(state, eid, ComponentType.Player) !== undefined);
      if (playerEntityId !== undefined) {
        const fighter = getComponent(state, playerEntityId, ComponentType.Fighter);
        const stats = getEffectiveStats(state, playerEntityId);

        if (id === UIStatId.HP && fighter) {
          contentHTML += `<div class="ui-tooltip-header">Health Points</div>`;
          contentHTML += `<div class="ui-tooltip-desc">Current health. If this reaches 0, you die.</div>`;
          contentHTML += `<div class="ui-tooltip-stat"><span>Base Max HP</span><span>${fighter.maxHp}</span></div>`;
          const bonus = stats.maxHp - fighter.maxHp;
          if (bonus !== 0) {
            contentHTML += `<div class="ui-tooltip-stat"><span>Bonus</span><span>${bonus > 0 ? '+' : ''}${bonus}</span></div>`;
          }
        } else if (id === UIStatId.Attack && fighter) {
          contentHTML += `<div class="ui-tooltip-header">Attack Power</div>`;
          contentHTML += `<div class="ui-tooltip-desc">Damage dealt with melee attacks.</div>`;
          contentHTML += `<div class="ui-tooltip-stat"><span>Base Attack</span><span>${fighter.attack}</span></div>`;
          const bonus = stats.attack - fighter.attack;
          if (bonus !== 0) {
            contentHTML += `<div class="ui-tooltip-stat"><span>Bonus</span><span>${bonus > 0 ? '+' : ''}${bonus}</span></div>`;
          }
        } else if (id === UIStatId.Defense && fighter) {
          contentHTML += `<div class="ui-tooltip-header">Defense</div>`;
          contentHTML += `<div class="ui-tooltip-desc">Reduces incoming physical damage.</div>`;
          contentHTML += `<div class="ui-tooltip-stat"><span>Base Defense</span><span>${fighter.defense}</span></div>`;
          const bonus = stats.defense - fighter.defense;
          if (bonus !== 0) {
            contentHTML += `<div class="ui-tooltip-stat"><span>Bonus</span><span>${bonus > 0 ? '+' : ''}${bonus}</span></div>`;
          }
        }
      }
    }

    if (contentHTML) {
      tooltip.innerHTML = contentHTML;
      tooltip.classList.remove('hidden');

      // Position tooltip near cursor, offset to not be under the cursor
      const offset = 15;

      // Calculate position
      let x = e.clientX + offset;
      let y = e.clientY + offset;

      // Keep within bounds
      const rect = tooltip.getBoundingClientRect();
      if (x + rect.width > window.innerWidth) {
        x = e.clientX - rect.width - offset;
      }
      if (y + rect.height > window.innerHeight) {
        y = e.clientY - rect.height - offset;
      }

      tooltip.style.left = `${x}px`;
      tooltip.style.top = `${y}px`;
    } else {
      tooltip.classList.add('hidden');
    }
  };

  document.body.addEventListener('mousemove', handleMouseMove);

  // Hide when mouse leaves
  document.body.addEventListener('mouseleave', () => {
    tooltip.classList.add('hidden');
  });
}

/**
 * Applies the current settings to the DOM (e.g. data attributes for CSS).
 */
export function applySettingsToDOM(): void {
  const settings = getSettings();
  const acc = settings.accessibility;

  if (acc.uiScale) {
    document.body.setAttribute('data-ui-scale', acc.uiScale);
  } else {
    document.body.removeAttribute('data-ui-scale');
  }

  if (acc.highContrast) {
    document.body.setAttribute('data-high-contrast', 'true');
  } else {
    document.body.removeAttribute('data-high-contrast');
  }

  if (acc.disableAnimations) {
    document.body.setAttribute('data-no-animations', 'true');
  } else {
    document.body.removeAttribute('data-no-animations');
  }
}

/**
 * Populates the Settings modal with the current config.
 */
export function renderSettingsMenu(state?: GameState): void {
  const overlay = document.getElementById('settings-overlay');
  if (state && overlay) {
    if (state.uiMode === UIMode.Settings) {
      overlay.classList.remove('hidden');
    } else {
      overlay.classList.add('hidden');
      return; // Skip rendering if hidden
    }
  }

  const settings = getSettings();

  // Render Keybinds
  const keybindsContainer = document.getElementById('keybinds-container');
  if (keybindsContainer) {
    keybindsContainer.innerHTML = '';
    const actions = Object.keys(settings.keybinds) as Array<keyof typeof settings.keybinds>;
    for (const action of actions) {
      const row = document.createElement('div');
      row.className = 'keybind-row';
      row.style.display = 'flex';
      row.style.justifyContent = 'space-between';
      row.style.marginBottom = '8px';

      const label = document.createElement('span');
      label.textContent = action.replace(/_/g, ' ').toUpperCase();

      const btn = document.createElement('button');
      btn.className = 'keybind-btn';
      btn.style.padding = '4px 8px';
      btn.style.minWidth = '80px';
      // Just show the primary key
      btn.textContent = settings.keybinds[action][0] || 'UNBOUND';
      btn.dataset.action = action; // For main.ts to hook into

      row.appendChild(label);
      row.appendChild(btn);
      keybindsContainer.appendChild(row);
    }
  }

  const dmgNumbers = document.getElementById('setting-dmg-numbers') as HTMLInputElement;
  const statusText = document.getElementById('setting-status-text') as HTMLInputElement;
  const dangerTel = document.getElementById('setting-danger-telegraphs') as HTMLInputElement;

  if (dmgNumbers) dmgNumbers.checked = settings.visualFeedback.showDamageNumbers;
  if (statusText) statusText.checked = settings.visualFeedback.showStatusText;
  if (dangerTel) dangerTel.checked = settings.visualFeedback.showDangerTelegraphs;

  const uiScale = document.getElementById('setting-ui-scale') as HTMLSelectElement;
  const highContrast = document.getElementById('setting-high-contrast') as HTMLInputElement;
  const disableAnim = document.getElementById('setting-disable-animations') as HTMLInputElement;

  if (uiScale) uiScale.value = settings.accessibility.uiScale;
  if (highContrast) highContrast.checked = settings.accessibility.highContrast;
  if (disableAnim) disableAnim.checked = settings.accessibility.disableAnimations;
}

/**
 * Populates the Campaign Selection list.
 */
export function populateCampaignList(
  campaigns: CampaignRegistryEntry[],
  onSelect: (campaign: CampaignRegistryEntry) => void
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
    btn.textContent = campaign.name;

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
      const mapSize = document.getElementById('campaign-detail-map');
      const depth = document.getElementById('campaign-detail-depth');
      const startBtn = document.getElementById('btn-campaign-start') as HTMLButtonElement | null;

      if (title) title.textContent = campaign.name;
      if (desc) desc.textContent = campaign.description;
      if (version) version.textContent = campaign.version;
      if (mapSize) mapSize.textContent = campaign.mapSize;
      if (depth) depth.textContent = campaign.startingAreaId;
      if (startBtn) startBtn.disabled = false;

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

/**
 * Renders the Factions overlay showing the player's current reputation.
 */
export function renderFactionsPanel(state: GameState): void {
  const overlay = document.getElementById('factions-overlay');
  if (!overlay) return;

  if (state.uiMode !== UIMode.Factions) {
    overlay.classList.add('hidden');
    return;
  }

  overlay.classList.remove('hidden');

  const listContainer = document.getElementById('factions-list');
  if (!listContainer) return;
  listContainer.innerHTML = '';

  const playerEntityId = state.entities.find((id) => getComponent(state, id, ComponentType.Player));
  if (!playerEntityId) return;

  const memory = getComponent(state, playerEntityId, ComponentType.Memory);
  if (!memory) return;

  const factions = Object.keys(state.campaign.factions);
  if (factions.length === 0) {
    listContainer.innerHTML = '<div style="color: #7f8490; text-align: center;">No known factions.</div>';
    return;
  }

  for (const factionId of factions) {
    const standing = memory.factionStandings[factionId] ?? 0;

    // Determine friendly string based on standing
    let relationColor = '#ecf0f1'; // Normal
    let relationText = 'Neutral';

    if (standing >= 50) {
      relationColor = '#2ecc71';
      relationText = 'Friendly';
    } else if (standing <= -50) {
      relationColor = '#e74c3c';
      relationText = 'Hostile';
    } else if (standing < 0) {
      relationColor = '#e67e22';
      relationText = 'Unfriendly';
    } else if (standing > 0) {
      relationColor = '#3498db';
      relationText = 'Amicable';
    }

    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.justifyContent = 'space-between';
    row.style.padding = '8px';
    row.style.background = 'rgba(255,255,255,0.05)';
    row.style.borderRadius = '4px';

    const nameSpan = document.createElement('span');
    nameSpan.textContent = factionId.charAt(0).toUpperCase() + factionId.slice(1);
    nameSpan.style.fontWeight = 'bold';

    const valSpan = document.createElement('span');
    valSpan.textContent = `${relationText} (${standing})`;
    valSpan.style.color = relationColor;

    row.appendChild(nameSpan);
    row.appendChild(valSpan);
    listContainer.appendChild(row);
  }
}
