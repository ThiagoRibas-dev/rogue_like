import type { UIInspectData } from '../../types/ui_adapter.types.ts';
import { getConsoleThemeMode } from './console_theme.ts';

const POPOVER_WIDTH_PX = 330;
const POPOVER_HEIGHT_PX = 290;
const CURSOR_OFFSET_PX = 16;
const VIEWPORT_MARGIN_PX = 16;

let activePopoverEl: HTMLElement | null = null;

/**
 * Shows a floating Item Examine Popover card (NWN2 Image 3) anchored near mouse coordinates.
 *
 * @param inspectData Detailed item inspection data model.
 * @param event Mouse event specifying cursor position.
 */
export function showConsoleItemInspectCard(inspectData: UIInspectData, event: MouseEvent): void {
  hideConsoleItemInspectCard();

  const card = document.createElement('div');
  card.className = 'crpg-examine-popover';
  card.setAttribute('data-console-theme', getConsoleThemeMode());

  const mouseX = event.clientX;
  const mouseY = event.clientY;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let leftPos = mouseX + CURSOR_OFFSET_PX;
  let topPos = mouseY + CURSOR_OFFSET_PX;

  if (leftPos + POPOVER_WIDTH_PX > viewportWidth - VIEWPORT_MARGIN_PX) {
    leftPos = Math.max(VIEWPORT_MARGIN_PX, mouseX - POPOVER_WIDTH_PX - CURSOR_OFFSET_PX);
  }
  if (topPos + POPOVER_HEIGHT_PX > viewportHeight - VIEWPORT_MARGIN_PX) {
    topPos = Math.max(VIEWPORT_MARGIN_PX, mouseY - POPOVER_HEIGHT_PX - CURSOR_OFFSET_PX);
  }

  card.style.left = `${leftPos}px`;
  card.style.top = `${topPos}px`;

  // NWN2 Top Dark Stone Banner ("EXAMINE")
  const banner = document.createElement('div');
  banner.className = 'crpg-examine-banner';
  const eyeIcon = document.createElement('span');
  eyeIcon.textContent = '👁';
  const bannerLabel = document.createElement('span');
  bannerLabel.textContent = 'Examine';
  banner.appendChild(eyeIcon);
  banner.appendChild(bannerLabel);
  card.appendChild(banner);

  const body = document.createElement('div');
  body.className = 'crpg-examine-body';

  // Item Title
  const title = document.createElement('h4');
  title.className = 'crpg-examine-title';
  title.textContent = inspectData.title;
  body.appendChild(title);

  // Lore Description
  if (inspectData.loreText) {
    const lore = document.createElement('p');
    lore.className = 'crpg-examine-lore';
    lore.textContent = inspectData.loreText;
    body.appendChild(lore);
  }

  // Base Metrics Block
  if (inspectData.baseMetrics.length > 0) {
    const metricsBox = document.createElement('div');
    metricsBox.className = 'crpg-examine-metrics';

    for (const metric of inspectData.baseMetrics) {
      const row = document.createElement('div');
      row.textContent = `${metric.label}: ${metric.value}`;
      metricsBox.appendChild(row);
    }

    body.appendChild(metricsBox);
  }

  // Special Properties Block (NWN2 Green Header)
  if (inspectData.specialProperties.length > 0) {
    const propsTitle = document.createElement('div');
    propsTitle.className = 'crpg-examine-props-title';
    propsTitle.textContent = 'Special Properties';
    body.appendChild(propsTitle);

    const propsList = document.createElement('ul');
    propsList.className = 'crpg-examine-props-list';

    for (const prop of inspectData.specialProperties) {
      const li = document.createElement('li');
      li.textContent = prop.text;
      propsList.appendChild(li);
    }

    body.appendChild(propsList);
  }

  card.appendChild(body);
  document.body.appendChild(card);
  activePopoverEl = card;
}

/**
 * Hides any currently active Item Examine Popover card.
 */
export function hideConsoleItemInspectCard(): void {
  if (activePopoverEl && activePopoverEl.parentNode) {
    activePopoverEl.parentNode.removeChild(activePopoverEl);
  }
  activePopoverEl = null;
}
