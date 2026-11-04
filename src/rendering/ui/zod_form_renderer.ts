import { z } from 'zod';
import { loadRulesetSystemContent } from '../../core/loader.ts';
import type { ValidationError } from '../../editor/validator/validator.types.ts';
import type { RulesetId } from '../../types/ruleset.types.ts';
import type { EditorController } from '../editor_ui.ts';
import { createSelectField } from './editor_forms.ts';
import { renderArrayField, renderNestedObjectField } from './zod_form_containers.ts';
import {
  renderBooleanField,
  renderMultiSelectTagsField,
  renderNumberField,
  renderRawJsonField,
  renderStringField
} from './zod_form_primitives.ts';

export * from './zod_form_containers.ts';
export * from './zod_form_primitives.ts';

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
): void {
  let isOptional = false;
  let innerSchema = schema;
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    isOptional = true;
    innerSchema = (schema as z.ZodOptional<z.ZodTypeAny>).unwrap();
  } else if (schema instanceof z.ZodDefault) {
    innerSchema = (schema as z.ZodDefault<z.ZodTypeAny>).removeDefault();
  }

  const hasValue = obj !== undefined && obj !== null;

  if (isOptional && !hasValue) {
    const key = basePath.split('/').pop() || 'Field';
    const addBtn = document.createElement('button');
    addBtn.className = 'editor-btn editor-btn-primary';
    addBtn.style.marginTop = '8px';
    addBtn.style.marginBottom = '8px';
    addBtn.textContent = `+ Add ${key.toUpperCase()}`;
    addBtn.addEventListener('click', () => {
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

  if (innerSchema instanceof z.ZodObject) {
    renderNestedObjectField(controller, innerSchema, obj, basePath, container, isOptional, errors);
    return;
  }

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

  const key = basePath.split('/').pop() || 'Field';
  const val = hasValue ? obj : undefined;
  const label = innerSchema.description || key;

  const wrapper = document.createElement('div');
  wrapper.style.display = 'flex';
  wrapper.style.alignItems = 'center';
  wrapper.style.gap = '8px';
  wrapper.style.width = '100%';
  wrapper.dataset.fieldPath = basePath;

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
        onChange: (newVal) => {
          controller.applyOperations([{ op: 'replace', path: basePath, value: newVal }], true);
          if (basePath.endsWith('rulesetId')) {
            loadRulesetSystemContent(newVal as RulesetId)
              .then((sysContent) => {
                if (Object.keys(sysContent).length > 0) {
                  controller.applyOperations([{ op: 'add', path: '/systemContent', value: sysContent }]);
                }
              })
              .catch(console.error);
          }
        }
      })
    );
  } else if (innerSchema instanceof z.ZodRecord) {
    renderRawJsonField(controller, label, val, basePath, fieldContainer);
  } else {
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

  if (errors) {
    const fieldErrors = errors.filter((e) => e.path === basePath);
    for (const err of fieldErrors) {
      const errEl = document.createElement('div');
      errEl.textContent = `[${err.severity.toUpperCase()}] ${err.message}`;
      errEl.className = 'validation-error-inline';
      errEl.style.color = err.severity === 'error' ? '#f38ba8' : '#f9e2af';
      errEl.style.fontSize = '0.8rem';
      errEl.style.marginTop = '4px';
      errEl.style.marginBottom = err.fixSuggestion ? '2px' : '8px';
      errEl.style.marginLeft = '4px';
      container.appendChild(errEl);

      if (err.fixSuggestion) {
        const fixEl = document.createElement('div');
        fixEl.textContent = `💡 Fix: ${err.fixSuggestion}`;
        fixEl.className = 'validation-fix-inline';
        fixEl.style.color = '#a6e3a1';
        fixEl.style.fontSize = '0.8rem';
        fixEl.style.marginTop = '2px';
        fixEl.style.marginBottom = '8px';
        fixEl.style.marginLeft = '4px';
        container.appendChild(fixEl);
      }
    }
  }
}
