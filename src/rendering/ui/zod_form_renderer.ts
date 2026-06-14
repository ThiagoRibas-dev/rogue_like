import { z } from 'zod';
import type { EditorController } from '../editor_ui.ts';
import type { ValidationError } from '../../editor/validator/validator.types.ts';

import {
  createStringField,
  createNumberField,
  createBooleanField,
  createColorPickerField,
  createSelectField,
  createMultiSelectField
} from './editor_forms.ts';
import { getReferenceOptions } from './ui_utils.ts';

/**
 * Renders a form dynamically based on a Zod schema.
 */
export function renderFormForZodSchema(
  controller: EditorController,
  schema: z.ZodTypeAny,
  obj: unknown,
  basePath: string,
  container: HTMLElement,
  errors?: ReadonlyArray<ValidationError>
) {
  // Unwrap optional/nullable types
  let isOptional = false;
  let innerSchema = schema;
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    isOptional = true;
    innerSchema = (schema as z.ZodOptional<z.ZodTypeAny>).unwrap();
  } else if (schema instanceof z.ZodDefault) {
    innerSchema = (schema as z.ZodDefault<z.ZodTypeAny>).removeDefault();
  }

  // Determine if value exists
  const hasValue = obj !== undefined && obj !== null;

  // Handle Optionals: If optional and no value exists, show an "Add" button
  if (isOptional && !hasValue) {
    const key = basePath.split('/').pop() || 'Field';
    const addBtn = document.createElement('button');
    addBtn.className = 'editor-btn editor-btn-primary';
    addBtn.style.marginTop = '8px';
    addBtn.style.marginBottom = '8px';
    addBtn.textContent = `+ Add ${key.toUpperCase()}`;
    addBtn.addEventListener('click', () => {
      // Create a default payload
      let defaultVal: unknown = {};
      if (innerSchema instanceof z.ZodArray) defaultVal = [];
      else if (innerSchema instanceof z.ZodString) defaultVal = '';
      else if (innerSchema instanceof z.ZodNumber) defaultVal = 0;
      else if (innerSchema instanceof z.ZodBoolean) defaultVal = false;
      else if (innerSchema instanceof z.ZodEnum) defaultVal = innerSchema.options[0] ?? '';

      controller.applyOperations([{ op: 'add', path: basePath, value: defaultVal }]);
    });
    container.appendChild(addBtn);
    return;
  }

  // Handle Objects
  if (innerSchema instanceof z.ZodObject) {
    renderNestedObjectField(controller, innerSchema, obj, basePath, container, isOptional, errors);
    return;
  }

  // Handle Arrays
  if (innerSchema instanceof z.ZodArray) {
    const key = basePath.split('/').pop() || 'Field';
    if (key.toLowerCase().includes('tag')) {
      const label = innerSchema.description || key;
      renderMultiSelectTagsField(controller, key, label, (obj as string[]) || [], basePath, container);
      return;
    }

    renderArrayField(
      controller,
      innerSchema as z.ZodArray<z.ZodTypeAny>,
      obj as unknown[],
      basePath,
      container,
      isOptional,
      errors
    );
    return;
  }

  // Primitives
  const key = basePath.split('/').pop() || 'Field';
  const val = hasValue ? obj : undefined;
  const label = innerSchema.description || key;

  const wrapper = document.createElement('div');
  wrapper.style.display = 'flex';
  wrapper.style.alignItems = 'center';
  wrapper.style.gap = '8px';
  wrapper.style.width = '100%';

  const fieldContainer = document.createElement('div');
  fieldContainer.style.flexGrow = '1';

  if (innerSchema instanceof z.ZodString) {
    renderStringField(controller, key, label, (val as string) || '', basePath, fieldContainer, innerSchema);
  } else if (innerSchema instanceof z.ZodNumber) {
    renderNumberField(controller, label, (val as number) || 0, basePath, fieldContainer, innerSchema);
  } else if (innerSchema instanceof z.ZodBoolean) {
    renderBooleanField(controller, label, !!val, basePath, fieldContainer);
  } else if (innerSchema instanceof z.ZodEnum) {
    const options = innerSchema.options.map((opt: string | number) => ({ value: String(opt), label: String(opt) }));
    fieldContainer.appendChild(
      createSelectField({
        label: label,
        value: (val as string) || options[0]?.value || '',
        options,
        onChange: (newVal) => controller.applyOperations([{ op: 'replace', path: basePath, value: newVal }], true)
      })
    );
  } else if (innerSchema instanceof z.ZodRecord) {
    // Fallback for Record<string, unknown>
    renderRawJsonField(controller, label, val, basePath, fieldContainer);
  } else {
    // Fallback for custom schemas (e.g. unknown params)
    renderRawJsonField(controller, label, val, basePath, fieldContainer);
  }

  wrapper.appendChild(fieldContainer);

  if (isOptional) {
    const removeBtn = document.createElement('button');
    removeBtn.className = 'editor-btn editor-btn-danger';
    removeBtn.textContent = '✖';
    removeBtn.title = 'Remove Optional Field';
    removeBtn.style.padding = '4px 8px';
    removeBtn.style.marginTop = '24px';
    removeBtn.addEventListener('click', () => {
      controller.applyOperations([{ op: 'remove', path: basePath }]);
    });
    wrapper.appendChild(removeBtn);
  }

  container.appendChild(wrapper);

  // Render Inline Validation Errors
  if (errors) {
    const fieldErrors = errors.filter((e) => e.path === basePath);
    for (const err of fieldErrors) {
      const errEl = document.createElement('div');
      errEl.textContent = `[${err.severity.toUpperCase()}] ${err.message}`;
      errEl.className = 'validation-error-inline';
      errEl.style.color = err.severity === 'error' ? '#f38ba8' : '#f9e2af';
      errEl.style.fontSize = '0.8rem';
      errEl.style.marginTop = '4px';
      errEl.style.marginBottom = '8px';
      errEl.style.marginLeft = '4px';
      container.appendChild(errEl);
    }
  }
}

function renderRawJsonField(
  controller: EditorController,
  labelStr: string,
  val: unknown,
  path: string,
  container: HTMLElement
) {
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
      const parsed = JSON.parse(textarea.value);
      controller.applyOperations([{ op: 'add', path, value: parsed }]);
    } catch {
      alert('Invalid JSON formatting.');
    }
  });

  group.appendChild(textarea);
  container.appendChild(group);
}

function renderStringField(
  controller: EditorController,
  key: string,
  label: string,
  val: string,
  path: string,
  container: HTMLElement,
  schema?: z.ZodTypeAny
) {
  const doc = controller.getDocument();
  const onChange = (newVal: string) => controller.applyOperations([{ op: 'add', path, value: newVal }], true);

  let onBlur: ((v: string) => string | null | undefined) | undefined;
  if (schema) {
    onBlur = (newVal: string) => {
      const res = schema.safeParse(newVal);
      if (!res.success) return res.error.issues[0]?.message || 'Invalid value';
      return null;
    };
  }

  // Heuristics for specialized fields
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

  // Fallback to plain string
  if (onBlur) {
    container.appendChild(createStringField({ label, value: val, onChange, onBlur }));
  } else {
    container.appendChild(createStringField({ label, value: val, onChange }));
  }
}

function renderNumberField(
  controller: EditorController,
  label: string,
  val: number,
  path: string,
  container: HTMLElement,
  schema?: z.ZodTypeAny
) {
  const onChange = (newVal: number) => controller.applyOperations([{ op: 'add', path, value: newVal }], true);

  let onBlur: ((v: number) => string | null | undefined) | undefined;
  if (schema) {
    onBlur = (newVal: number) => {
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

function renderBooleanField(
  controller: EditorController,
  label: string,
  val: boolean,
  path: string,
  container: HTMLElement
) {
  const onChange = (newVal: boolean) => controller.applyOperations([{ op: 'add', path, value: newVal }], true);
  container.appendChild(createBooleanField({ label, value: val, onChange }));
}

function renderMultiSelectTagsField(
  controller: EditorController,
  key: string,
  label: string,
  val: string[],
  path: string,
  container: HTMLElement
) {
  const doc = controller.getDocument();
  const options = getReferenceOptions(key, doc);
  if (!options) return; // Fallback to array rendering if no options found

  const onChange = (newVal: string[]) => controller.applyOperations([{ op: 'replace', path, value: newVal }], true);
  container.appendChild(createMultiSelectField({ label, value: val, options, onChange }));
}

function renderNestedObjectField(
  controller: EditorController,
  schema: z.ZodObject<z.ZodRawShape>,
  obj: unknown,
  basePath: string,
  container: HTMLElement,
  canBeRemoved: boolean,
  errors?: ReadonlyArray<ValidationError>
) {
  const group = document.createElement('fieldset');
  group.className = 'form-group';
  group.style.border = '1px solid rgba(255,255,255,0.1)';
  group.style.padding = '12px';
  group.style.borderRadius = '6px';
  group.style.position = 'relative';

  const legend = document.createElement('legend');
  legend.className = 'form-label';
  const titleText = basePath.split('/').pop()?.toUpperCase() || 'OBJECT';
  legend.textContent = titleText;
  group.appendChild(legend);

  if (canBeRemoved) {
    const removeBtn = document.createElement('button');
    removeBtn.className = 'editor-btn editor-btn-danger';
    removeBtn.textContent = '✖';
    removeBtn.title = 'Remove Object';
    removeBtn.style.position = 'absolute';
    removeBtn.style.top = '-10px';
    removeBtn.style.right = '10px';
    removeBtn.style.padding = '2px 6px';
    removeBtn.addEventListener('click', () => {
      controller.applyOperations([{ op: 'remove', path: basePath }]);
    });
    group.appendChild(removeBtn);
  }

  const safeObj = (obj as Record<string, unknown>) || {};
  const shape = schema.shape;

  // Render all fields defined in the schema
  for (const [key, propSchema] of Object.entries(shape)) {
    const propPath = `${basePath}/${key}`;
    renderFormForZodSchema(controller, propSchema as z.ZodTypeAny, safeObj[key], propPath, group, errors);
  }

  container.appendChild(group);
}

function renderArrayField(
  controller: EditorController,
  schema: z.ZodArray<z.ZodTypeAny>,
  arr: unknown[] | undefined,
  basePath: string,
  container: HTMLElement,
  canBeRemoved: boolean,
  errors?: ReadonlyArray<ValidationError>
) {
  const group = document.createElement('fieldset');
  group.className = 'form-group';
  group.style.border = '1px dashed rgba(255,255,255,0.2)';
  group.style.padding = '12px';
  group.style.borderRadius = '6px';
  group.style.position = 'relative';

  const legend = document.createElement('legend');
  legend.className = 'form-label';
  legend.textContent = (basePath.split('/').pop()?.toUpperCase() || 'LIST') + ' (Array)';
  group.appendChild(legend);

  if (canBeRemoved) {
    const removeObjBtn = document.createElement('button');
    removeObjBtn.className = 'editor-btn editor-btn-danger';
    removeObjBtn.textContent = '✖';
    removeObjBtn.title = 'Remove List';
    removeObjBtn.style.position = 'absolute';
    removeObjBtn.style.top = '-10px';
    removeObjBtn.style.right = '10px';
    removeObjBtn.style.padding = '2px 6px';
    removeObjBtn.addEventListener('click', () => {
      controller.applyOperations([{ op: 'remove', path: basePath }]);
    });
    group.appendChild(removeObjBtn);
  }

  const safeArr = arr || [];

  // Render each existing element
  safeArr.forEach((item, index) => {
    const itemContainer = document.createElement('div');
    itemContainer.style.display = 'flex';
    itemContainer.style.gap = '8px';
    itemContainer.style.alignItems = 'flex-start';
    itemContainer.style.marginBottom = '8px';

    const fieldContainer = document.createElement('div');
    fieldContainer.style.flexGrow = '1';

    // We pass index as the path segment
    renderFormForZodSchema(controller, schema.element, item, `${basePath}/${index}`, fieldContainer, errors);
    itemContainer.appendChild(fieldContainer);

    // Remove item button
    const removeBtn = document.createElement('button');
    removeBtn.className = 'editor-btn editor-btn-danger';
    removeBtn.textContent = '✖';
    removeBtn.style.padding = '4px 8px';
    removeBtn.style.marginTop = '24px';
    removeBtn.addEventListener('click', () => {
      controller.applyOperations([{ op: 'remove', path: `${basePath}/${index}` }]);
    });
    itemContainer.appendChild(removeBtn);

    group.appendChild(itemContainer);
  });

  // Add Item Button
  const addBtn = document.createElement('button');
  addBtn.className = 'editor-btn editor-btn-secondary';
  addBtn.textContent = '+ Add Item';
  addBtn.addEventListener('click', () => {
    let defaultVal: unknown = {};
    const inner = schema.element;
    if (inner instanceof z.ZodString) defaultVal = '';
    else if (inner instanceof z.ZodNumber) defaultVal = 0;
    else if (inner instanceof z.ZodBoolean) defaultVal = false;
    else if (inner instanceof z.ZodEnum) defaultVal = inner.options[0] ?? '';

    controller.applyOperations([{ op: 'add', path: `${basePath}/-`, value: defaultVal }]);
  });

  group.appendChild(addBtn);
  container.appendChild(group);
}
