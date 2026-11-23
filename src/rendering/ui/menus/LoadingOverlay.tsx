import type { JSX } from 'preact';
import { useUiSelector } from '../core/ui_store.ts';

/**
 * Full-screen Loading & Dungeon Generation Progress Overlay driven reactively by `uiStore.loadingOverlay`.
 */
export function LoadingOverlay(): JSX.Element | null {
  const loading = useUiSelector((s) => s.loadingOverlay);
  if (!loading.visible) {
    return null;
  }

  const pct = Math.max(0, Math.min(100, Math.round(loading.progress * 100)));

  return (
    <div className="ui-loading-backdrop" role="status" aria-live="polite" aria-label={loading.title}>
      <div className="ui-loading-card">
        <h2 className="ui-selection-detail-title">{loading.title}</h2>
        <div
          className="ui-loading-bar-track"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
        >
          <div className="ui-loading-bar-fill" style={{ width: `${pct}%` }} />
        </div>
        <p className="ui-selection-detail-desc">{loading.message || `${pct}%`}</p>
      </div>
    </div>
  );
}
