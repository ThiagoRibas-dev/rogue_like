export interface PromptModalOptions {
  title: string;
  defaultValue?: string;
  placeholder?: string;
  validator?: (val: string) => string | null;
  onConfirm: (val: string) => void;
  onCancel?: () => void;
}

/**
 * Renders a custom modal overlay to replace native window.prompt(),
 * complete with live validation.
 */
export function showPromptModal(options: PromptModalOptions): void {
  // Create overlay container
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.style.position = 'fixed';
  overlay.style.top = '0';
  overlay.style.left = '0';
  overlay.style.width = '100vw';
  overlay.style.height = '100vh';
  overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
  overlay.style.display = 'flex';
  overlay.style.justifyContent = 'center';
  overlay.style.alignItems = 'center';
  overlay.style.zIndex = '9999';
  overlay.style.backdropFilter = 'blur(4px)';

  // Create modal container
  const modal = document.createElement('div');
  modal.className = 'modal-container';
  modal.style.backgroundColor = '#1e1e2e';
  modal.style.border = '1px solid #45475a';
  modal.style.borderRadius = '8px';
  modal.style.padding = '24px';
  modal.style.width = '100%';
  modal.style.maxWidth = '400px';
  modal.style.boxShadow = '0 10px 25px rgba(0,0,0,0.5)';
  modal.style.display = 'flex';
  modal.style.flexDirection = 'column';
  modal.style.gap = '16px';

  // Title
  const title = document.createElement('h2');
  title.textContent = options.title;
  title.style.margin = '0';
  title.style.color = '#cdd6f4';
  title.style.fontSize = '1.2rem';
  modal.appendChild(title);

  // Input
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'form-input';
  if (options.defaultValue) input.value = options.defaultValue;
  if (options.placeholder) input.placeholder = options.placeholder;
  input.style.width = '100%';
  input.style.padding = '8px 12px';
  input.style.backgroundColor = '#11111b';
  input.style.border = '1px solid #45475a';
  input.style.borderRadius = '4px';
  input.style.color = '#cdd6f4';
  input.style.fontSize = '1rem';
  modal.appendChild(input);

  // Error Message
  const errorMsg = document.createElement('div');
  errorMsg.style.color = '#f38ba8';
  errorMsg.style.fontSize = '0.85rem';
  errorMsg.style.minHeight = '1.2em';
  modal.appendChild(errorMsg);

  // Buttons container
  const btnContainer = document.createElement('div');
  btnContainer.style.display = 'flex';
  btnContainer.style.justifyContent = 'flex-end';
  btnContainer.style.gap = '12px';
  btnContainer.style.marginTop = '8px';

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.className = 'btn btn-secondary';
  cancelBtn.style.padding = '8px 16px';
  cancelBtn.style.backgroundColor = '#313244';
  cancelBtn.style.color = '#cdd6f4';
  cancelBtn.style.border = '1px solid #45475a';
  cancelBtn.style.borderRadius = '4px';
  cancelBtn.style.cursor = 'pointer';

  const confirmBtn = document.createElement('button');
  confirmBtn.textContent = 'Confirm';
  confirmBtn.className = 'btn btn-primary';
  confirmBtn.style.padding = '8px 16px';
  confirmBtn.style.backgroundColor = '#89b4fa';
  confirmBtn.style.color = '#11111b';
  confirmBtn.style.border = 'none';
  confirmBtn.style.borderRadius = '4px';
  confirmBtn.style.cursor = 'pointer';
  confirmBtn.style.fontWeight = 'bold';

  btnContainer.appendChild(cancelBtn);
  btnContainer.appendChild(confirmBtn);
  modal.appendChild(btnContainer);
  overlay.appendChild(modal);

  // Validation logic
  const validate = () => {
    const val = input.value.trim();
    if (!val) {
      errorMsg.textContent = 'Input cannot be empty.';
      confirmBtn.disabled = true;
      confirmBtn.style.opacity = '0.5';
      return false;
    }
    if (options.validator) {
      const err = options.validator(val);
      if (err) {
        errorMsg.textContent = err;
        confirmBtn.disabled = true;
        confirmBtn.style.opacity = '0.5';
        return false;
      }
    }
    errorMsg.textContent = '';
    confirmBtn.disabled = false;
    confirmBtn.style.opacity = '1';
    return true;
  };

  const close = () => {
    if (overlay.parentNode) {
      overlay.parentNode.removeChild(overlay);
    }
  };

  input.addEventListener('input', validate);

  cancelBtn.addEventListener('click', () => {
    close();
    if (options.onCancel) options.onCancel();
  });

  confirmBtn.addEventListener('click', () => {
    if (validate()) {
      close();
      options.onConfirm(input.value.trim());
    }
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && validate()) {
      close();
      options.onConfirm(input.value.trim());
    }
    if (e.key === 'Escape') {
      close();
      if (options.onCancel) options.onCancel();
    }
  });

  // Render and focus
  document.body.appendChild(overlay);
  validate();
  // Using setTimeout ensures focus is applied after DOM insertion paints
  setTimeout(() => input.focus(), 10);
}
