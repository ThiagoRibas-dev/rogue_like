import type { GenerationProgress } from '../../map/generator_async.ts';

/** Progress data displayable by the loading overlay. */
export interface LoadingProgressInfo {
  readonly progress: number; // 0.0 to 1.0
  readonly message: string;
}

/**
 * Creates and displays the full-screen loading overlay.
 * Uses native DOM element construction adhering to View layer guidelines.
 *
 * @param title Optional title displayed at the top of the loading modal.
 */
export function showLoadingOverlay(title: string = 'Descending into the Depths...'): void {
  let overlay = document.getElementById('loading-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'loading-overlay';
    overlay.className = 'loading-overlay';

    const modal = document.createElement('div');
    modal.className = 'loading-modal';

    const titleEl = document.createElement('h2');
    titleEl.id = 'loading-title';

    const barContainer = document.createElement('div');
    barContainer.className = 'loading-progress-bar';

    const fillEl = document.createElement('div');
    fillEl.id = 'loading-progress-fill';
    fillEl.className = 'loading-progress-fill';
    barContainer.appendChild(fillEl);

    const statusEl = document.createElement('p');
    statusEl.id = 'loading-status';
    statusEl.className = 'loading-status';

    modal.appendChild(titleEl);
    modal.appendChild(barContainer);
    modal.appendChild(statusEl);
    overlay.appendChild(modal);

    document.body.appendChild(overlay);
  }

  const titleEl = document.getElementById('loading-title');
  if (titleEl) {
    titleEl.textContent = title;
  }

  overlay.style.display = 'flex';
  // Trigger reflow for transition
  void overlay.offsetHeight;
  overlay.style.opacity = '1';
}

/**
 * Updates the loading overlay progress bar and status message.
 *
 * @param progress Progress information containing a 0.0-1.0 fraction and readout message.
 */
export function updateLoadingProgress(progress: LoadingProgressInfo | GenerationProgress): void {
  const fillEl = document.getElementById('loading-progress-fill');
  const statusEl = document.getElementById('loading-status');
  if (fillEl) {
    const clamped = Math.max(0, Math.min(100, Math.round(progress.progress * 100)));
    fillEl.style.width = `${clamped}%`;
  }
  if (statusEl) {
    statusEl.textContent = progress.message;
  }
}

/**
 * Smoothly fades and hides the loading overlay.
 */
export function hideLoadingOverlay(): void {
  const overlay = document.getElementById('loading-overlay');
  if (overlay) {
    overlay.style.opacity = '0';
    setTimeout(() => {
      overlay.style.display = 'none';
    }, 200);
  }
}
