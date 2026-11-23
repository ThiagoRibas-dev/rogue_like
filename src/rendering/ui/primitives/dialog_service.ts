import { inputScopeManager } from '../../../core/input/input_scope_manager.ts';
import { type ActiveDialogRequest, type ToastTone, type TooltipState, uiStore } from '../core/ui_store.ts';

/** Options for an in-app blocking Alert dialog. */
export interface AlertDialogOptions {
  readonly title?: string | undefined;
  readonly message: string;
  readonly confirmLabel?: string | undefined;
}

/** Options for an in-app blocking Confirm dialog. */
export interface ConfirmDialogOptions {
  readonly title?: string | undefined;
  readonly message: string;
  readonly confirmLabel?: string | undefined;
  readonly cancelLabel?: string | undefined;
  readonly danger?: boolean | undefined;
}

/** Options for an in-app blocking Prompt dialog with optional live validation. */
export interface PromptDialogOptions {
  readonly title: string;
  readonly message?: string | undefined;
  readonly defaultValue?: string | undefined;
  readonly placeholder?: string | undefined;
  readonly confirmLabel?: string | undefined;
  readonly cancelLabel?: string | undefined;
  readonly validator?: ((value: string) => string | null) | undefined;
}

/** Default toast lifetime in milliseconds. */
const DEFAULT_TOAST_DURATION_MS = 3800;

let dialogCounter = 0;
let toastCounter = 0;

function nextDialogId(): string {
  dialogCounter += 1;
  return `ui-dialog-${dialogCounter}`;
}

function syncSystemDialogInputHook(): void {
  const active = uiStore.getSnapshot().dialogs[0];
  if (!active) {
    inputScopeManager.setSystemDialogHook(null);
    return;
  }

  inputScopeManager.setSystemDialogHook({
    isOpen: () => uiStore.getSnapshot().dialogs.length > 0,
    onEscape: () => {
      dialogService.dismissActive();
    },
    onConfirm:
      active.kind === 'alert'
        ? () => dialogService.resolveAlert()
        : active.kind === 'confirm'
          ? () => dialogService.resolveConfirm(true)
          : undefined
  });
}

/**
 * Asynchronous in-app dialog service replacing native browser `alert()`, `confirm()`, and `prompt()`.
 */
export const dialogService = {
  /** Presents a themed informational alert dialog resolving when dismissed. */
  alert(input: string | AlertDialogOptions): Promise<void> {
    const opts: AlertDialogOptions = typeof input === 'string' ? { message: input } : input;
    return new Promise<void>((resolve) => {
      const request: ActiveDialogRequest = {
        id: nextDialogId(),
        kind: 'alert',
        title: opts.title ?? 'Notice',
        message: opts.message,
        confirmLabel: opts.confirmLabel ?? 'OK',
        resolve: () => {
          uiStore.removeDialog(request.id);
          syncSystemDialogInputHook();
          resolve();
        }
      };
      uiStore.enqueueDialog(request);
      syncSystemDialogInputHook();
    });
  },

  /** Presents a themed Yes/No confirmation dialog resolving to a boolean. */
  confirm(input: string | ConfirmDialogOptions): Promise<boolean> {
    const opts: ConfirmDialogOptions = typeof input === 'string' ? { message: input } : input;
    return new Promise<boolean>((resolve) => {
      const request: ActiveDialogRequest = {
        id: nextDialogId(),
        kind: 'confirm',
        title: opts.title ?? 'Confirm Action',
        message: opts.message,
        confirmLabel: opts.confirmLabel ?? 'Confirm',
        cancelLabel: opts.cancelLabel ?? 'Cancel',
        danger: opts.danger ?? false,
        resolve: (confirmed: boolean) => {
          uiStore.removeDialog(request.id);
          syncSystemDialogInputHook();
          resolve(confirmed);
        }
      };
      uiStore.enqueueDialog(request);
      syncSystemDialogInputHook();
    });
  },

  /** Presents a themed text prompt dialog returning the trimmed value, or `null` if cancelled. */
  prompt(opts: PromptDialogOptions): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      const request: ActiveDialogRequest = {
        id: nextDialogId(),
        kind: 'prompt',
        title: opts.title,
        message: opts.message,
        defaultValue: opts.defaultValue ?? '',
        placeholder: opts.placeholder,
        confirmLabel: opts.confirmLabel ?? 'Confirm',
        cancelLabel: opts.cancelLabel ?? 'Cancel',
        validator: opts.validator,
        resolve: (value: string | null) => {
          uiStore.removeDialog(request.id);
          syncSystemDialogInputHook();
          resolve(value);
        }
      };
      uiStore.enqueueDialog(request);
      syncSystemDialogInputHook();
    });
  },

  /** Resolves the topmost alert dialog if active. */
  resolveAlert(): void {
    const active = uiStore.getSnapshot().dialogs[0];
    if (active?.kind === 'alert') {
      active.resolve();
    }
  },

  /** Resolves the topmost confirm dialog with `accepted`. */
  resolveConfirm(accepted: boolean): void {
    const active = uiStore.getSnapshot().dialogs[0];
    if (active?.kind === 'confirm') {
      active.resolve(accepted);
    }
  },

  /** Resolves the topmost prompt dialog with `value`. */
  resolvePrompt(value: string | null): void {
    const active = uiStore.getSnapshot().dialogs[0];
    if (active?.kind === 'prompt') {
      active.resolve(value);
    }
  },

  /** Dismisses whichever dialog is currently on top (Escape / backdrop cancel). */
  dismissActive(): void {
    const active = uiStore.getSnapshot().dialogs[0];
    if (!active) return;
    if (active.kind === 'alert') {
      active.resolve();
    } else if (active.kind === 'confirm') {
      active.resolve(false);
    } else {
      active.resolve(null);
    }
  }
};

/** Non-blocking toast notification service. */
export const toastService = {
  /** Queues a toast notification and automatically dismisses it after `durationMs`. */
  push(message: string, tone: ToastTone = 'info', durationMs: number = DEFAULT_TOAST_DURATION_MS): string {
    toastCounter += 1;
    const id = `ui-toast-${toastCounter}`;
    uiStore.pushToast({ id, message, tone, createdAt: Date.now() });
    if (durationMs > 0 && typeof setTimeout === 'function') {
      setTimeout(() => {
        uiStore.removeToast(id);
      }, durationMs);
    }
    return id;
  },

  /** Dismisses an active toast notification immediately. */
  dismiss(id: string): void {
    uiStore.removeToast(id);
  }
};

/** Global tooltip display service shared by pointer hover and keyboard inspect (`?`/`Alt+I`). */
export const tooltipService = {
  /** Shows or replaces the active floating tooltip. */
  show(state: TooltipState): void {
    uiStore.setTooltip(state);
  },

  /** Hides any active tooltip (optionally only if its ID matches). */
  hide(id?: string): void {
    const current = uiStore.getSnapshot().tooltip;
    if (!current) return;
    if (id !== undefined && current.id !== id) return;
    uiStore.setTooltip(null);
  }
};
