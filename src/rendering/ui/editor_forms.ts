/**
 * Modular form field generators for the Vanilla TS Campaign Editor.
 */

export interface FieldOptions<T> {
  label: string;
  value: T;
  onChange: (newValue: T) => void;
  onBlur?: (value: T) => string | null | undefined;
  error?: string;
  placeholder?: string;
}

/**
 * Creates a text input form field element bound to a string property.
 */
export function createStringField(opts: FieldOptions<string>): HTMLElement {
  const group = document.createElement('div');
  group.className = 'form-group';

  const label = document.createElement('label');
  label.className = 'form-label';
  label.textContent = opts.label;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'form-input';
  if (opts.error) input.classList.add('invalid');
  input.value = opts.value;
  if (opts.placeholder) input.placeholder = opts.placeholder;

  input.addEventListener('change', () => {
    opts.onChange(input.value);
  });

  const errorDiv = document.createElement('div');
  errorDiv.className = 'form-field-error';
  errorDiv.style.display = opts.error ? 'block' : 'none';
  errorDiv.textContent = opts.error || '';

  input.addEventListener('blur', () => {
    if (opts.onBlur) {
      const err = opts.onBlur(input.value);
      if (err) {
        input.classList.add('invalid');
        errorDiv.textContent = err;
        errorDiv.style.display = 'block';
      } else {
        input.classList.remove('invalid');
        errorDiv.style.display = 'none';
      }
    }
  });

  group.appendChild(label);
  group.appendChild(input);
  group.appendChild(errorDiv);

  return group;
}

/**
 * Creates a numeric input form field element bound to a number property.
 */
export function createNumberField(opts: FieldOptions<number>): HTMLElement {
  const group = document.createElement('div');
  group.className = 'form-group';

  const label = document.createElement('label');
  label.className = 'form-label';
  label.textContent = opts.label;

  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'form-input';
  if (opts.error) input.classList.add('invalid');
  input.value = opts.value.toString();

  input.addEventListener('change', () => {
    const parsed = parseFloat(input.value);
    if (!isNaN(parsed)) {
      opts.onChange(parsed);
    }
  });

  const errorDiv = document.createElement('div');
  errorDiv.className = 'form-field-error';
  errorDiv.style.display = opts.error ? 'block' : 'none';
  errorDiv.textContent = opts.error || '';

  input.addEventListener('blur', () => {
    if (opts.onBlur) {
      const parsed = parseFloat(input.value);
      const err = opts.onBlur(isNaN(parsed) ? 0 : parsed);
      if (err) {
        input.classList.add('invalid');
        errorDiv.textContent = err;
        errorDiv.style.display = 'block';
      } else {
        input.classList.remove('invalid');
        errorDiv.style.display = 'none';
      }
    }
  });

  group.appendChild(label);
  group.appendChild(input);
  group.appendChild(errorDiv);

  return group;
}

/**
 * Creates a checkbox input form field element bound to a boolean property.
 */
export function createBooleanField(opts: FieldOptions<boolean>): HTMLElement {
  const group = document.createElement('div');
  group.className = 'form-group';
  // Use a flex row for checkboxes
  group.style.flexDirection = 'row';
  group.style.alignItems = 'center';
  group.style.gap = '8px';

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = opts.value;

  input.addEventListener('change', () => {
    opts.onChange(input.checked);
  });

  const label = document.createElement('label');
  label.className = 'form-label';
  label.textContent = opts.label;

  group.appendChild(input);
  group.appendChild(label);

  return group;
}

/**
 * Creates a color picker input form field element bound to a hexadecimal color string.
 */
export function createColorPickerField(opts: FieldOptions<string>): HTMLElement {
  const group = document.createElement('div');
  group.className = 'form-group';

  const label = document.createElement('label');
  label.className = 'form-label';
  label.textContent = opts.label;

  const container = document.createElement('div');
  container.className = 'color-picker-container';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'form-input';
  if (opts.error) input.classList.add('invalid');
  input.value = opts.value;
  input.style.flex = '1';

  const swatch = document.createElement('input');
  swatch.type = 'color';
  swatch.className = 'color-swatch';
  // HTML5 color picker only supports 6-hex colors (e.g. #ff0000), not 'transparent'
  swatch.value = opts.value.startsWith('#') && opts.value.length === 7 ? opts.value : '#ffffff';

  input.addEventListener('change', () => {
    opts.onChange(input.value);
    if (input.value.startsWith('#') && input.value.length === 7) {
      swatch.value = input.value;
    }
  });

  swatch.addEventListener('input', () => {
    input.value = swatch.value;
    opts.onChange(swatch.value);
  });

  container.appendChild(input);
  container.appendChild(swatch);

  group.appendChild(label);
  group.appendChild(container);

  if (opts.error) {
    const err = document.createElement('div');
    err.className = 'form-field-error';
    err.textContent = opts.error;
    group.appendChild(err);
  }

  return group;
}

/**
 * Creates a dropdown select form field element bound to a selected key value.
 */
export function createSelectField(
  opts: FieldOptions<string> & { options: { value: string; label: string }[] }
): HTMLElement {
  const group = document.createElement('div');
  group.className = 'form-group';

  const label = document.createElement('label');
  label.className = 'form-label';
  label.textContent = opts.label;

  const select = document.createElement('select');
  select.className = 'form-select';
  if (opts.error) select.classList.add('invalid');

  for (const o of opts.options) {
    const option = document.createElement('option');
    option.value = o.value;
    option.textContent = o.label;
    if (o.value === opts.value) {
      option.selected = true;
    }
    select.appendChild(option);
  }

  select.addEventListener('change', () => {
    opts.onChange(select.value);
  });

  group.addEventListener('dragover', (e: DragEvent) => {
    e.preventDefault();
    select.style.borderColor = '#89b4fa';
    select.style.boxShadow = '0 0 0 2px rgba(137,180,250,0.3)';
  });

  group.addEventListener('dragleave', () => {
    select.style.borderColor = '';
    select.style.boxShadow = '';
  });

  group.addEventListener('drop', (e: DragEvent) => {
    e.preventDefault();
    select.style.borderColor = '';
    select.style.boxShadow = '';
    const refData = e.dataTransfer?.getData('application/x-editor-ref');
    if (!refData) return;
    try {
      const parsed = JSON.parse(refData) as { id: string; category: string };
      // Check if the dropped ID exists in our options
      const optionExists = opts.options.some((o) => o.value === parsed.id);
      if (optionExists) {
        select.value = parsed.id;
        opts.onChange(parsed.id);
      }
    } catch {
      // ignore invalid data
    }
  });

  group.appendChild(label);
  group.appendChild(select);

  if (opts.error) {
    const err = document.createElement('div');
    err.className = 'form-field-error';
    err.textContent = opts.error;
    group.appendChild(err);
  }

  return group;
}

/**
 * Creates a multi-select list checkbox wrapper bound to a string array.
 */
export function createMultiSelectField(
  opts: FieldOptions<string[]> & { options: { value: string; label: string }[] }
): HTMLElement {
  const group = document.createElement('div');
  group.className = 'form-group';

  const label = document.createElement('label');
  label.className = 'form-label';
  label.textContent = opts.label;
  group.appendChild(label);

  const container = document.createElement('div');
  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  container.style.gap = '4px';

  for (const o of opts.options) {
    const checkGroup = document.createElement('label');
    checkGroup.style.display = 'flex';
    checkGroup.style.alignItems = 'center';
    checkGroup.style.gap = '8px';
    checkGroup.style.cursor = 'pointer';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = o.value;
    checkbox.checked = opts.value.includes(o.value);

    checkbox.addEventListener('change', () => {
      const currentSet = new Set(opts.value);
      if (checkbox.checked) {
        currentSet.add(o.value);
      } else {
        currentSet.delete(o.value);
      }
      opts.onChange(Array.from(currentSet));
    });

    const text = document.createElement('span');
    text.textContent = o.label;
    text.style.color = 'var(--text-normal)';

    checkGroup.appendChild(checkbox);
    checkGroup.appendChild(text);
    container.appendChild(checkGroup);
  }

  group.appendChild(container);

  if (opts.error) {
    const err = document.createElement('div');
    err.className = 'form-field-error';
    err.textContent = opts.error;
    group.appendChild(err);
  }

  return group;
}
