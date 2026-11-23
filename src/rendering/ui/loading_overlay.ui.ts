import type { GenerationProgress } from '../../map/generator_async.ts';
import { uiStore } from './core/ui_store.ts';

/** Progress data displayable by the loading overlay. */
export interface LoadingProgressInfo {
  readonly progress: number; // 0.0 to 1.0
  readonly message: string;
}

/**
 * Displays the full-screen loading overlay via the reactive Preact UI store.
 *
 * @param title Optional title displayed at the top of the loading modal.
 */
export function showLoadingOverlay(title: string = 'Descending into the Depths...'): void {
  uiStore.setLoadingOverlay({
    visible: true,
    title,
    progress: 0,
    message: ''
  });
}

/**
 * Updates the loading overlay progress bar and status message.
 *
 * @param progress Progress information containing a 0.0-1.0 fraction and readout message.
 */
export function updateLoadingProgress(progress: LoadingProgressInfo | GenerationProgress): void {
  const clamped = Math.max(0, Math.min(1, progress.progress));
  uiStore.setLoadingOverlay({
    progress: clamped,
    message: progress.message
  });
}

/**
 * Smoothly hides the loading overlay.
 */
export function hideLoadingOverlay(): void {
  uiStore.setLoadingOverlay({
    visible: false
  });
}
