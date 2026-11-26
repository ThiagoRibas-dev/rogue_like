import type { ComponentChildren, JSX, TargetedMouseEvent } from 'preact';
import { useRef } from 'preact/hooks';
import { uiStore } from '../core/ui_store.ts';
import { Button, IconButton } from './Button.tsx';
import { useFocusTrap } from './focus_hooks.ts';
import { Keycap } from './Keycap.tsx';

/** Modal width preset. */
export type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

/** Z-layer preset for ModalShell (`modal`, `help`, or `dialog`). */
export type ModalLayer = 'modal' | 'help' | 'dialog';

/** Scroll container mode for ModalShell body (`body` = default single scroller; `panes` = fixed body with independent child pane scrollbars). */
export type ModalScrollMode = 'body' | 'panes';

/** Props for accessible `<ModalShell />`. */
export interface ModalShellProps {
  readonly title: string;
  readonly subtitle?: string | undefined;
  readonly isOpen?: boolean | undefined;
  readonly size?: ModalSize | undefined;
  readonly fullHeight?: boolean | undefined;
  readonly scrollMode?: ModalScrollMode | undefined;
  readonly layer?: ModalLayer | undefined;
  readonly showCloseButton?: boolean | undefined;
  readonly showHelpHint?: boolean | undefined;
  readonly closeOnBackdrop?: boolean | undefined;
  readonly onClose?: (() => void) | undefined;
  readonly headerActions?: ComponentChildren | undefined;
  readonly footer?: ComponentChildren | undefined;
  readonly className?: string | undefined;
  readonly children: ComponentChildren;
  readonly ariaDescribedBy?: string | undefined;
}

/**
 * Accessible modal dialog frame with semantic backdrop, live DOM `useFocusTrap`,
 * Escape/Close control, and optional contextual `[F1] Help` footer trigger.
 */
export function ModalShell({
  title,
  subtitle,
  isOpen = true,
  size = 'md',
  fullHeight = false,
  scrollMode = 'body',
  layer = 'modal',
  showCloseButton = true,
  showHelpHint = true,
  closeOnBackdrop = true,
  onClose,
  headerActions,
  footer,
  className,
  children,
  ariaDescribedBy
}: ModalShellProps): JSX.Element | null {
  const modalRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(modalRef, isOpen, { restoreFocus: true });

  if (!isOpen) return null;

  const isPaneScroll = scrollMode === 'panes';
  const effectiveFullHeight = fullHeight || isPaneScroll;

  const backdropClasses = [
    'ui-modal-backdrop',
    layer === 'dialog' ? 'ui-modal-backdrop--dialog' : layer === 'help' ? 'ui-modal-backdrop--help' : ''
  ]
    .filter(Boolean)
    .join(' ');

  const modalClasses = [
    'ui-modal',
    size !== 'md' ? `ui-modal--${size}` : '',
    effectiveFullHeight ? 'ui-modal--full-height' : '',
    className ?? ''
  ]
    .filter(Boolean)
    .join(' ');

  const bodyClasses = isPaneScroll ? 'ui-modal__body ui-modal__body--panes' : 'ui-modal__body';

  const handleBackdropMouseDown = (event: TargetedMouseEvent<HTMLDivElement>): void => {
    if (closeOnBackdrop && onClose && event.target === event.currentTarget) {
      onClose();
    }
  };

  return (
    <div className={backdropClasses} onMouseDown={handleBackdropMouseDown}>
      <div
        ref={modalRef}
        className={modalClasses}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-describedby={ariaDescribedBy}
        tabIndex={-1}
      >
        <header className="ui-modal__header">
          <div>
            <h2 className="ui-modal__title">{title}</h2>
            {subtitle ? <p className="ui-modal__subtitle">{subtitle}</p> : null}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ui-space-2)' }}>
            {headerActions}
            {showCloseButton && onClose ? (
              <IconButton ariaLabel="Close dialog" title="Close (Esc)" onClick={onClose}>
                ✕
              </IconButton>
            ) : null}
          </div>
        </header>

        <div className={bodyClasses}>{children}</div>

        {(footer || showHelpHint) && (
          <footer className="ui-modal__footer">
            <div>
              {showHelpHint && layer !== 'help' ? (
                <Button
                  variant="ghost"
                  size="sm"
                  title="Open Contextual Help (F1)"
                  onClick={() => uiStore.setHelpOpen(true)}
                >
                  <Keycap commandId="system.toggle_help" fallbackLabel="F1" />
                  <span>Help</span>
                </Button>
              ) : null}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ui-space-2)' }}>{footer}</div>
          </footer>
        )}
      </div>
    </div>
  );
}
