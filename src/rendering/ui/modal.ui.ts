import { dialogService } from './primitives/dialog_service.ts';

/**
 * Properties governing custom dialog overlays for string prompt inputs.
 */
export interface PromptModalOptions {
  readonly title: string;
  readonly defaultValue?: string;
  readonly placeholder?: string;
  readonly validator?: (val: string) => string | null;
  readonly onConfirm: (val: string) => void;
  readonly onCancel?: () => void;
}

/**
 * Delegates prompt requests to the unified Preact `dialogService.prompt` host
 * (retained temporarily for Phase 44 Editor callers until Milestone 166 eviction).
 */
export function showPromptModal(options: PromptModalOptions): void {
  void dialogService
    .prompt({
      title: options.title,
      defaultValue: options.defaultValue,
      placeholder: options.placeholder,
      validator: options.validator
    })
    .then((result) => {
      if (result !== null) {
        options.onConfirm(result);
      } else {
        options.onCancel?.();
      }
    });
}
