/**
 * Modular form field generators for the Vanilla TS Campaign Editor.
 */

export interface FieldOptions<T> {
  label: string;
  value: T;
  onChange: (newValue: T) => void;
  error?: string;
  placeholder?: string;
}

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

  group.appendChild(label);
  group.appendChild(input);

  if (opts.error) {
    const err = document.createElement('div');
    err.className = 'form-field-error';
    err.textContent = opts.error;
    group.appendChild(err);
  }

  return group;
}

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

  group.appendChild(label);
  group.appendChild(input);

  if (opts.error) {
    const err = document.createElement('div');
    err.className = 'form-field-error';
    err.textContent = opts.error;
    group.appendChild(err);
  }

  return group;
}

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
