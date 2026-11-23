import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { type ActiveDialogRequest, useUiSelector } from '../core/ui_store.ts';
import { Button } from './Button.tsx';
import { dialogService } from './dialog_service.ts';
import { FormField, TextInput } from './FormControls.tsx';
import { ModalShell } from './ModalShell.tsx';

function PromptDialogBody({
  request
}: {
  readonly request: Extract<ActiveDialogRequest, { readonly kind: 'prompt' }>;
}): JSX.Element {
  const [value, setValue] = useState<string>(request.defaultValue);
  const trimmed = value.trim();
  const validationError = !trimmed ? 'Input cannot be empty.' : request.validator ? request.validator(trimmed) : null;

  useEffect(() => {
    setValue(request.defaultValue);
  }, [request.id, request.defaultValue]);

  const submitPrompt = (): void => {
    if (validationError === null) {
      dialogService.resolvePrompt(trimmed);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submitPrompt();
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ui-space-3)' }}>
        {request.message ? <p style={{ margin: 0 }}>{request.message}</p> : null}
        <FormField label="Value" htmlFor={`prompt-${request.id}`} error={validationError}>
          <TextInput id={`prompt-${request.id}`} value={value} placeholder={request.placeholder} onInput={setValue} />
        </FormField>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--ui-space-2)' }}>
          <Button variant="secondary" onClick={() => dialogService.resolvePrompt(null)}>
            {request.cancelLabel}
          </Button>
          <Button variant="primary" type="submit" disabled={validationError !== null}>
            {request.confirmLabel}
          </Button>
        </div>
      </div>
    </form>
  );
}

/**
 * Global Preact host rendering queued in-app `alert`, `confirm`, and `prompt` dialogs
 * above all overlays via `--ui-z-dialog`.
 */
export function DialogHost(): JSX.Element | null {
  const active = useUiSelector((snap) => snap.dialogs[0] ?? null);
  if (!active) return null;

  return (
    <ModalShell
      key={active.id}
      title={active.title}
      size="sm"
      layer="dialog"
      showHelpHint={false}
      onClose={() => dialogService.dismissActive()}
      footer={
        active.kind === 'alert' ? (
          <Button variant="primary" onClick={() => dialogService.resolveAlert()}>
            {active.confirmLabel}
          </Button>
        ) : active.kind === 'confirm' ? (
          <>
            <Button variant="secondary" onClick={() => dialogService.resolveConfirm(false)}>
              {active.cancelLabel}
            </Button>
            <Button variant={active.danger ? 'danger' : 'primary'} onClick={() => dialogService.resolveConfirm(true)}>
              {active.confirmLabel}
            </Button>
          </>
        ) : undefined
      }
    >
      {active.kind === 'prompt' ? (
        <PromptDialogBody request={active} />
      ) : (
        <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{active.message}</p>
      )}
    </ModalShell>
  );
}
