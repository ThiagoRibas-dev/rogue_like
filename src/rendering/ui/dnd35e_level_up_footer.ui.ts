/**
 * Renders the validation gate banner and Previous / Next / Confirm footer bar for the Level-Up modal.
 */
export function renderLevelUpFooter(
  content: HTMLElement,
  currentTabCheck: { readonly valid: boolean; readonly reason?: string },
  activeTabIndex: number,
  totalTabs: number,
  allTabsValid: boolean,
  onCancel: () => void,
  onNavigateDelta: (delta: -1 | 1) => void,
  onConfirm: () => void
): void {
  if (!currentTabCheck.valid && currentTabCheck.reason) {
    const gateBanner = document.createElement('div');
    gateBanner.style.cssText =
      'padding: 5px 10px; font-size: 0.78rem; color: var(--crpg-warning, #f39c12); border: 1px solid var(--crpg-warning, #e67e22); background: rgba(230, 126, 34, 0.12);';
    gateBanner.textContent = `⚠ Required before proceeding: ${currentTabCheck.reason}`;
    content.appendChild(gateBanner);
  }

  const footer = document.createElement('div');
  footer.style.cssText =
    'display: flex; justify-content: space-between; padding-top: 6px; border-top: 1px solid var(--crpg-border-subtle, #333947);';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'modal-btn';
  cancelBtn.textContent = 'Later (Esc)';
  cancelBtn.addEventListener('click', onCancel);

  const navRight = document.createElement('div');
  navRight.style.cssText = 'display: flex; gap: 8px;';

  if (activeTabIndex > 0) {
    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'modal-btn';
    prevBtn.textContent = '← Previous';
    prevBtn.addEventListener('click', () => onNavigateDelta(-1));
    navRight.appendChild(prevBtn);
  }

  if (activeTabIndex < totalTabs - 1) {
    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'modal-btn';
    nextBtn.textContent = 'Next Step →';
    nextBtn.disabled = !currentTabCheck.valid;
    nextBtn.addEventListener('click', () => {
      if (currentTabCheck.valid) onNavigateDelta(1);
    });
    navRight.appendChild(nextBtn);
  }

  const confirmBtn = document.createElement('button');
  confirmBtn.type = 'button';
  confirmBtn.className = 'modal-btn';
  confirmBtn.style.borderColor = allTabsValid ? 'var(--crpg-success, #2ecc71)' : 'var(--border-color)';
  confirmBtn.textContent = '✔ Confirm Level Up';
  confirmBtn.disabled = !allTabsValid;
  confirmBtn.addEventListener('click', () => {
    if (allTabsValid) onConfirm();
  });
  navRight.appendChild(confirmBtn);

  footer.appendChild(cancelBtn);
  footer.appendChild(navRight);
  content.appendChild(footer);
}
