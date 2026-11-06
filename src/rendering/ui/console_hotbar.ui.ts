/**
 * Data model representing a bound action inside a Console Hotbar slot.
 */
export interface UIHotbarSlotData {
  readonly slotIndex: number;
  readonly label: string;
  readonly iconUrl?: string;
  readonly keyLabel: string;
  readonly cooldownProgress?: number;
  readonly activeToggle?: boolean;
  readonly isDisabled?: boolean;
  readonly tooltipTitle?: string;
  readonly tooltipDescription?: string;
}

/**
 * Data model representing a stance/mode action inside the Console Stance Dock.
 */
export interface UIStanceActionData {
  readonly id: string;
  readonly label: string;
  readonly iconUrl?: string;
  readonly isActive: boolean;
  readonly tooltipText?: string;
}

export interface ConsoleHotbarCallbacks {
  readonly onExecuteSlot: (slotIndex: number, bankIndex: number) => void;
  readonly onToggleStance: (stanceId: string) => void;
  readonly onChangeBank: (newBankIndex: number) => void;
}

const MAX_HOTBAR_BANKS = 10;
const HOTBAR_SLOTS_PER_BANK = 12;

let activeBankIndex = 1;

/**
 * Renders the unified Console Action Hotbar and Combat Stance Dock UI element into a parent container.
 *
 * @param container Target HTML container element.
 * @param hotbarSlots Array of 12 active `UIHotbarSlotData` objects for current bank.
 * @param stanceActions Array of active `UIStanceActionData` objects.
 * @param callbacks Event handling callbacks.
 * @returns Element reference and update functions.
 */
export function renderConsoleHotbar(
  container: HTMLElement,
  hotbarSlots: ReadonlyArray<UIHotbarSlotData>,
  stanceActions: ReadonlyArray<UIStanceActionData>,
  callbacks: ConsoleHotbarCallbacks
): {
  readonly update: (newSlots: ReadonlyArray<UIHotbarSlotData>, newStances: ReadonlyArray<UIStanceActionData>) => void;
} {
  container.replaceChildren();

  const dock = document.createElement('div');
  dock.className = 'crpg-bottom-dock';
  dock.setAttribute('data-hotbar-root', 'true');

  // 1. NWN2 Combat Modes Strip (Image 4)
  const modesStrip = document.createElement('div');
  modesStrip.className = 'crpg-modes-strip';

  const modesBadge = document.createElement('span');
  modesBadge.className = 'crpg-modes-badge';
  modesBadge.textContent = 'Modes';
  modesStrip.appendChild(modesBadge);

  for (const stance of stanceActions) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = stance.isActive ? 'crpg-stance-btn active' : 'crpg-stance-btn';
    btn.title = stance.tooltipText ?? stance.label;
    btn.textContent = `${stance.isActive ? '◉ ' : '○ '}${stance.label}`;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      callbacks.onToggleStance(stance.id);
    });
    modesStrip.appendChild(btn);
  }

  dock.appendChild(modesStrip);

  // 2. NWN2 12-Slot Action Hotbar Row (Image 5)
  const hotbarRow = document.createElement('div');
  hotbarRow.className = 'crpg-hotbar-row';

  const bankBox = document.createElement('div');
  bankBox.className = 'crpg-bank-switcher';

  const upBtn = document.createElement('button');
  upBtn.type = 'button';
  upBtn.className = 'crpg-bank-arrow';
  upBtn.textContent = '▲';
  upBtn.title = 'Previous Hotbar Bank (Shift+Up)';
  upBtn.addEventListener('click', (e) => {
    e.preventDefault();
    activeBankIndex = activeBankIndex > 1 ? activeBankIndex - 1 : MAX_HOTBAR_BANKS;
    bankNum.textContent = `${activeBankIndex}`;
    callbacks.onChangeBank(activeBankIndex);
  });

  const bankNum = document.createElement('span');
  bankNum.textContent = `${activeBankIndex}`;

  const downBtn = document.createElement('button');
  downBtn.type = 'button';
  downBtn.className = 'crpg-bank-arrow';
  downBtn.textContent = '▼';
  downBtn.title = 'Next Hotbar Bank (Shift+Down)';
  downBtn.addEventListener('click', (e) => {
    e.preventDefault();
    activeBankIndex = activeBankIndex < MAX_HOTBAR_BANKS ? activeBankIndex + 1 : 1;
    bankNum.textContent = `${activeBankIndex}`;
    callbacks.onChangeBank(activeBankIndex);
  });

  bankBox.appendChild(upBtn);
  bankBox.appendChild(bankNum);
  bankBox.appendChild(downBtn);
  hotbarRow.appendChild(bankBox);

  const slotsGrid = document.createElement('div');
  slotsGrid.className = 'crpg-hotbar-slots';

  for (let i = 0; i < HOTBAR_SLOTS_PER_BANK; i++) {
    const slotData = hotbarSlots[i] ?? {
      slotIndex: i,
      label: '',
      keyLabel: i === 9 ? '0' : i === 10 ? '-' : i === 11 ? '=' : `${i + 1}`
    };

    const slotBtn = document.createElement('button');
    slotBtn.type = 'button';
    slotBtn.className = slotData.label ? 'crpg-hotbar-slot populated' : 'crpg-hotbar-slot';

    if (slotData.tooltipTitle) {
      slotBtn.title = `${slotData.tooltipTitle}${slotData.tooltipDescription ? ` — ${slotData.tooltipDescription}` : ''}`;
    }

    slotBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (!slotData.isDisabled) {
        callbacks.onExecuteSlot(i, activeBankIndex);
      }
    });

    const keySpan = document.createElement('span');
    keySpan.className = 'crpg-hotbar-key';
    keySpan.textContent = slotData.keyLabel;
    slotBtn.appendChild(keySpan);

    if (slotData.iconUrl) {
      const iconSpan = document.createElement('span');
      iconSpan.textContent = slotData.iconUrl;
      slotBtn.appendChild(iconSpan);
    }

    if (slotData.label) {
      const labelSpan = document.createElement('span');
      labelSpan.className = 'crpg-hotbar-label';
      labelSpan.textContent = slotData.label;
      slotBtn.appendChild(labelSpan);
    }

    slotsGrid.appendChild(slotBtn);
  }

  hotbarRow.appendChild(slotsGrid);
  dock.appendChild(hotbarRow);
  container.appendChild(dock);

  return {
    update: (newSlots: ReadonlyArray<UIHotbarSlotData>, newStances: ReadonlyArray<UIStanceActionData>) => {
      renderConsoleHotbar(container, newSlots, newStances, callbacks);
    }
  };
}
