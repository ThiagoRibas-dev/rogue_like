import type { JSX } from 'preact';
import { useUiSelector } from '../core/ui_store.ts';
import { IconButton } from './Button.tsx';
import { toastService } from './dialog_service.ts';

/**
 * Global non-blocking toast stack rendered in the bottom-right corner.
 */
export function ToastHost(): JSX.Element | null {
  const toasts = useUiSelector((snap) => snap.toasts);
  if (toasts.length === 0) return null;

  return (
    <div className="ui-toast-stack" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`ui-toast ui-toast--${toast.tone}`}>
          <span>{toast.message}</span>
          <IconButton ariaLabel="Dismiss notification" variant="ghost" onClick={() => toastService.dismiss(toast.id)}>
            ✕
          </IconButton>
        </div>
      ))}
    </div>
  );
}
