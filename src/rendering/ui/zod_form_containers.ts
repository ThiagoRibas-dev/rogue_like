import { z } from 'zod';
import { isPathExpanded, togglePath } from '../../editor/validation_navigator.ts';
import type { ValidationError } from '../../editor/validator/validator.types.ts';
import type { EditorController } from '../editor_ui.ts';
import { renderFormForZodSchema } from './zod_form_renderer.ts';

/**
 * Renders a collapsible nested object accordion with optional glyph preview and error badge.
 */
export function renderNestedObjectField(
  controller: EditorController,
  schema: z.ZodObject<z.ZodRawShape>,
  obj: unknown,
  basePath: string,
  container: HTMLElement,
  canBeRemoved: boolean,
  errors?: ReadonlyArray<ValidationError>
): void {
  const isFirstLevel = basePath.split('/').filter((s) => s !== '').length <= 2;
  const detailsOpen = isFirstLevel ? true : isPathExpanded(basePath);

  const details = document.createElement('details');
  details.className = 'form-group-accordion';
  details.open = detailsOpen;
  details.dataset.fieldPath = basePath;
  details.style.border = '1px solid rgba(255,255,255,0.1)';
  details.style.padding = '12px';
  details.style.borderRadius = '6px';
  details.style.position = 'relative';
  details.style.marginBottom = '8px';

  const summary = document.createElement('summary');
  summary.className = 'form-label';
  summary.style.cursor = 'pointer';
  summary.style.fontWeight = 'bold';
  summary.style.userSelect = 'none';
  const titleText = basePath.split('/').pop()?.toUpperCase() || 'OBJECT';

  let descendantErrors = 0;
  if (errors) {
    descendantErrors = errors.filter((e) => {
      const ePath = e.path || '';
      return ePath.startsWith(basePath + '/') && ePath !== basePath;
    }).length;
  }
  const badgeText = descendantErrors > 0 ? ` (${descendantErrors})` : '';
  summary.textContent = titleText + badgeText;
  details.appendChild(summary);

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
    details.appendChild(removeBtn);
  }

  details.addEventListener('toggle', () => {
    togglePath(basePath);
  });

  const safeObj = (obj as Record<string, unknown>) || {};
  const shape = schema.shape;

  if ('glyph' in shape && 'fg' in shape && 'bg' in shape) {
    const previewRow = document.createElement('div');
    previewRow.style.display = 'flex';
    previewRow.style.alignItems = 'center';
    previewRow.style.gap = '12px';
    previewRow.style.marginBottom = '12px';

    const swatch = document.createElement('div');
    swatch.className = 'glyph-preview-swatch';
    swatch.textContent = (safeObj.glyph as string) || '?';
    swatch.style.color = (safeObj.fg as string) || '#fff';
    swatch.style.backgroundColor = (safeObj.bg as string) || '#000';
    swatch.style.fontSize = '2.5rem';
    swatch.style.width = '56px';
    swatch.style.height = '56px';
    swatch.style.display = 'flex';
    swatch.style.alignItems = 'center';
    swatch.style.justifyContent = 'center';
    swatch.style.borderRadius = '6px';
    swatch.style.border = '1px solid rgba(255,255,255,0.2)';
    swatch.style.fontFamily = 'monospace';
    swatch.style.flexShrink = '0';

    const nameLabel = document.createElement('span');
    nameLabel.style.fontSize = '1.1rem';
    nameLabel.style.color = '#cdd6f4';
    nameLabel.textContent = (safeObj.name as string) || (safeObj.id as string) || '';

    previewRow.appendChild(swatch);
    previewRow.appendChild(nameLabel);
    details.appendChild(previewRow);
  }

  for (const [key, propSchema] of Object.entries(shape)) {
    const propPath = `${basePath}/${key}`;
    renderFormForZodSchema(controller, propSchema as z.ZodTypeAny, safeObj[key], propPath, details, errors);
  }

  container.appendChild(details);
}

/**
 * Renders a drag-and-drop reorderable array fieldset.
 */
export function renderArrayField(
  controller: EditorController,
  schema: z.ZodArray<z.ZodTypeAny>,
  arr: unknown[] | undefined,
  basePath: string,
  container: HTMLElement,
  canBeRemoved: boolean,
  errors?: ReadonlyArray<ValidationError>
): void {
  const group = document.createElement('fieldset');
  group.className = 'form-group';
  group.dataset.fieldPath = basePath;
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

  safeArr.forEach((item, index) => {
    const itemContainer = document.createElement('div');
    itemContainer.draggable = true;
    itemContainer.dataset.index = String(index);
    itemContainer.dataset.fieldPath = `${basePath}/${index}`;
    itemContainer.style.display = 'flex';
    itemContainer.style.gap = '8px';
    itemContainer.style.alignItems = 'flex-start';
    itemContainer.style.marginBottom = '8px';
    itemContainer.style.cursor = 'grab';
    itemContainer.style.transition = 'border-color 0.15s ease';

    const dragHandle = document.createElement('span');
    dragHandle.textContent = '⠿';
    dragHandle.style.cursor = 'grab';
    dragHandle.style.color = 'rgba(255,255,255,0.3)';
    dragHandle.style.fontSize = '1.2rem';
    dragHandle.style.padding = '4px';
    dragHandle.style.marginTop = '24px';
    itemContainer.appendChild(dragHandle);

    const fieldContainer = document.createElement('div');
    fieldContainer.style.flexGrow = '1';

    renderFormForZodSchema(controller, schema.element, item, `${basePath}/${index}`, fieldContainer, errors);
    itemContainer.appendChild(fieldContainer);

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

  let dragSourceIndex: number | null = null;

  group.addEventListener('dragstart', (e: DragEvent) => {
    const target = (e.target as HTMLElement).closest('[data-index]') as HTMLElement | null;
    if (!target) return;
    dragSourceIndex = parseInt(target.dataset.index ?? '-1', 10);
    e.dataTransfer?.setData('text/plain', String(dragSourceIndex));
    target.style.opacity = '0.4';
  });

  group.addEventListener('dragend', (e: DragEvent) => {
    const target = (e.target as HTMLElement).closest('[data-index]') as HTMLElement | null;
    if (target) target.style.opacity = '1';
    dragSourceIndex = null;
  });

  group.addEventListener('dragover', (e: DragEvent) => {
    e.preventDefault();
    const target = (e.target as HTMLElement).closest('[data-index]') as HTMLElement | null;
    if (target) {
      target.style.borderTop = '2px solid #89b4fa';
    }
  });

  group.addEventListener('dragleave', (e: DragEvent) => {
    const target = (e.target as HTMLElement).closest('[data-index]') as HTMLElement | null;
    if (target) {
      target.style.borderTop = '';
    }
  });

  group.addEventListener('drop', (e: DragEvent) => {
    e.preventDefault();
    const target = (e.target as HTMLElement).closest('[data-index]') as HTMLElement | null;
    if (!target || dragSourceIndex === null) return;
    target.style.borderTop = '';

    const dropIndex = parseInt(target.dataset.index ?? '-1', 10);
    if (dropIndex === dragSourceIndex || dropIndex < 0) return;

    const movedItem = safeArr[dragSourceIndex];
    controller.applyOperations([
      { op: 'remove', path: `${basePath}/${dragSourceIndex}` },
      { op: 'add', path: `${basePath}/${dropIndex}`, value: movedItem }
    ]);
  });

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
