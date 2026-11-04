import { z } from 'zod';
import type { EditorController } from '../editor_ui.ts';
import {
  createBooleanField,
  createColorPickerField,
  createMultiSelectField,
  createNumberField,
  createSelectField,
  createStringField
} from './editor_forms.ts';
import { getReferenceOptions } from './ui_utils.ts';

/**
 * Renders a raw JSON textarea editor for arbitrary Record or unknown schema fields.
 */
export function renderRawJsonField(
  controller: EditorController,
  labelStr: string,
  val: unknown,
  path: string,
  container: HTMLElement
): void {
  const group = document.createElement('div');
  group.className = 'form-group';

  const label = document.createElement('label');
  label.className = 'form-label';
  label.textContent = labelStr;
  group.appendChild(label);

  const textarea = document.createElement('textarea');
  textarea.className = 'editor-input';
  textarea.style.fontFamily = 'monospace';
  textarea.style.height = '100px';
  textarea.value = JSON.stringify(val ?? {}, null, 2);

  textarea.addEventListener('blur', () => {
    try {
      const parsed = JSON.parse(textarea.value) as unknown;
      controller.applyOperations([{ op: 'add', path, value: parsed }]);
    } catch {
      alert('Invalid JSON formatting.');
    }
  });

  group.appendChild(textarea);
  container.appendChild(group);
}

/**
 * Renders a string field with automatic color picker or reference select heuristics.
 */
export function renderStringField(
  controller: EditorController,
  key: string,
  label: string,
  val: string,
  path: string,
  container: HTMLElement,
  schema?: z.ZodTypeAny
): void {
  const doc = controller.getDocument();
  const onChange = (newVal: string): void => controller.applyOperations([{ op: 'add', path, value: newVal }], true);

  let onBlur: ((v: string) => string | null | undefined) | undefined;
  if (schema) {
    onBlur = (newVal: string): string | null => {
      const res = schema.safeParse(newVal);
      if (!res.success) return res.error.issues[0]?.message || 'Invalid value';
      return null;
    };
  }

  const lowerKey = key.toLowerCase();
  if (lowerKey.includes('color') || lowerKey.endsWith('fg') || lowerKey.endsWith('bg') || lowerKey === 'background') {
    container.appendChild(createColorPickerField({ label, value: val, onChange }));
    return;
  }

  const selectOptions = getReferenceOptions(key, doc);
  if (selectOptions) {
    if (onBlur) {
      container.appendChild(createSelectField({ label, value: val, options: selectOptions, onChange, onBlur }));
    } else {
      container.appendChild(createSelectField({ label, value: val, options: selectOptions, onChange }));
    }
    return;
  }

  if (onBlur) {
    container.appendChild(createStringField({ label, value: val, onChange, onBlur }));
  } else {
    container.appendChild(createStringField({ label, value: val, onChange }));
  }
}

/**
 * Renders a numeric input field bound to a Zod schema.
 */
export function renderNumberField(
  controller: EditorController,
  label: string,
  val: number,
  path: string,
  container: HTMLElement,
  schema?: z.ZodTypeAny
): void {
  const onChange = (newVal: number): void => controller.applyOperations([{ op: 'add', path, value: newVal }], true);

  let onBlur: ((v: number) => string | null | undefined) | undefined;
  if (schema) {
    onBlur = (newVal: number): string | null => {
      const res = schema.safeParse(newVal);
      if (!res.success) return res.error.issues[0]?.message || 'Invalid value';
      return null;
    };
  }

  if (onBlur) {
    container.appendChild(createNumberField({ label, value: val, onChange, onBlur }));
  } else {
    container.appendChild(createNumberField({ label, value: val, onChange }));
  }
}

/**
 * Renders a boolean checkbox field bound to a Zod schema.
 */
export function renderBooleanField(
  controller: EditorController,
  label: string,
  val: boolean,
  path: string,
  container: HTMLElement
): void {
  const onChange = (newVal: boolean): void => controller.applyOperations([{ op: 'add', path, value: newVal }], true);
  container.appendChild(createBooleanField({ label, value: val, onChange }));
}

/**
 * Renders a multi-select tag field bound to reference options.
 */
export function renderMultiSelectTagsField(
  controller: EditorController,
  key: string,
  label: string,
  val: string[],
  path: string,
  container: HTMLElement
): void {
  const doc = controller.getDocument();
  const options = getReferenceOptions(key, doc);
  if (!options) return;

  const onChange = (newVal: string[]): void =>
    controller.applyOperations([{ op: 'replace', path, value: newVal }], true);
  container.appendChild(createMultiSelectField({ label, value: val, options, onChange }));
}
