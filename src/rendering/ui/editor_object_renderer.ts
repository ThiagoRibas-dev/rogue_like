import type { EditorController } from '../editor_ui.ts';
import type { CampaignData } from '../../types/campaign.types.ts';
import {
  createStringField,
  createNumberField,
  createBooleanField,
  createColorPickerField,
  createSelectField
} from './editor_forms.ts';

/**
 * A basic recursive form renderer for objects.
 */
export function renderFormForObject(
  controller: EditorController,
  obj: unknown,
  basePath: string,
  container: HTMLElement
) {
  if (!obj || typeof obj !== 'object') return;

  for (const [key, val] of Object.entries(obj)) {
    const path = `${basePath}/${key}`;
    renderField(controller, key, val, path, container);
  }
}

function renderField(controller: EditorController, key: string, val: unknown, path: string, container: HTMLElement) {
  if (val === null) return;

  if (typeof val === 'string') {
    renderStringField(controller, key, val, path, container);
    return;
  }

  if (typeof val === 'number') {
    renderNumberField(controller, key, val, path, container);
    return;
  }

  if (typeof val === 'boolean') {
    renderBooleanField(controller, key, val, path, container);
    return;
  }

  if (Array.isArray(val)) {
    renderArrayField(controller, key, val, path, container);
    return;
  }

  if (typeof val === 'object') {
    renderNestedObjectField(controller, key, val, path, container);
    return;
  }
}

function renderStringField(
  controller: EditorController,
  key: string,
  val: string,
  path: string,
  container: HTMLElement
) {
  const doc = controller.getDocument();
  const onChange = (newVal: string) => controller.applyOperations([{ op: 'replace', path, value: newVal }], true);

  // Heuristics for specialized fields
  if (key.toLowerCase().includes('color') || key === 'fg' || key === 'bg') {
    container.appendChild(createColorPickerField({ label: key, value: val, onChange }));
    return;
  }

  const selectOptions = getReferenceOptions(key, doc);
  if (selectOptions) {
    container.appendChild(createSelectField({ label: key, value: val, options: selectOptions, onChange }));
    return;
  }

  // Fallback to plain string
  container.appendChild(createStringField({ label: key, value: val, onChange }));
}

function getReferenceOptions(key: string, doc: CampaignData): { value: string; label: string }[] | null {
  if (key === 'faction' || key.toLowerCase().includes('factionid')) {
    return Object.keys(doc.factions).map((k) => ({ value: k, label: k }));
  }
  if (key === 'startingAreaId' || key === 'targetArea') {
    return Object.keys(doc.areas).map((k) => ({ value: k, label: doc.areas[k]?.name || k }));
  }
  if (key === 'effectId') {
    return Object.keys(doc.effects).map((k) => ({ value: k, label: k }));
  }
  if (key === 'profileId') {
    return Object.keys(doc.ai).map((k) => ({ value: k, label: k }));
  }
  return null;
}

function renderNumberField(
  controller: EditorController,
  key: string,
  val: number,
  path: string,
  container: HTMLElement
) {
  const onChange = (newVal: number) => controller.applyOperations([{ op: 'replace', path, value: newVal }], true);
  container.appendChild(createNumberField({ label: key, value: val, onChange }));
}

function renderBooleanField(
  controller: EditorController,
  key: string,
  val: boolean,
  path: string,
  container: HTMLElement
) {
  const onChange = (newVal: boolean) => controller.applyOperations([{ op: 'replace', path, value: newVal }], true);
  container.appendChild(createBooleanField({ label: key, value: val, onChange }));
}

function renderNestedObjectField(
  controller: EditorController,
  key: string,
  val: unknown,
  path: string,
  container: HTMLElement
) {
  const group = document.createElement('fieldset');
  group.className = 'form-group';
  group.style.border = '1px solid rgba(255,255,255,0.1)';
  group.style.padding = '12px';
  group.style.borderRadius = '6px';

  const legend = document.createElement('legend');
  legend.className = 'form-label';
  legend.textContent = key.toUpperCase();
  group.appendChild(legend);

  renderFormForObject(controller, val, path, group);
  container.appendChild(group);
}

function renderArrayField(
  controller: EditorController,
  key: string,
  arr: unknown[],
  path: string,
  container: HTMLElement
) {
  const group = document.createElement('fieldset');
  group.className = 'form-group';
  group.style.border = '1px solid rgba(255,255,255,0.1)';
  group.style.padding = '12px';
  group.style.borderRadius = '6px';

  const legend = document.createElement('legend');
  legend.className = 'form-label';
  legend.textContent = key.toUpperCase() + ` [Array of ${arr.length} items]`;
  group.appendChild(legend);

  for (let i = 0; i < arr.length; i++) {
    renderArrayItem(controller, i, arr[i], path, group);
  }

  const btnAdd = document.createElement('button');
  btnAdd.className = 'editor-btn';
  btnAdd.textContent = '➕ Add Item';
  btnAdd.addEventListener('click', () => {
    const template = getArrayTemplate(arr);
    controller.applyOperations([{ op: 'add', path: `${path}/-`, value: template }], false);
  });
  group.appendChild(btnAdd);

  container.appendChild(group);
}

function renderArrayItem(
  controller: EditorController,
  index: number,
  itemVal: unknown,
  parentPath: string,
  parentGroup: HTMLElement
) {
  const itemPath = `${parentPath}/${index}`;
  const itemGroup = document.createElement('div');
  itemGroup.style.borderLeft = '2px solid #6c5ce7';
  itemGroup.style.paddingLeft = '12px';
  itemGroup.style.marginBottom = '12px';

  const header = document.createElement('div');
  header.style.display = 'flex';
  header.style.justifyContent = 'space-between';
  header.style.marginBottom = '8px';
  header.innerHTML = `<span style="font-size:0.8rem;color:var(--text-dim);">Item ${index}</span>`;

  const btnRemove = document.createElement('button');
  btnRemove.className = 'editor-btn editor-btn-danger';
  btnRemove.textContent = '✖';
  btnRemove.style.padding = '2px 6px';
  btnRemove.addEventListener('click', () => {
    if (confirm('Delete this item?')) {
      controller.applyOperations([{ op: 'remove', path: itemPath }], false);
    }
  });
  header.appendChild(btnRemove);
  itemGroup.appendChild(header);

  if (itemVal !== null && typeof itemVal === 'object') {
    renderFormForObject(controller, itemVal, itemPath, itemGroup);
  } else {
    // Primitive array item
    itemGroup.appendChild(
      createStringField({
        label: `Value`,
        value: String(itemVal),
        onChange: (newVal) => {
          const parsed = parseFloat(newVal);
          const finalVal = !isNaN(parsed) && newVal !== '' ? parsed : newVal;
          controller.applyOperations([{ op: 'replace', path: itemPath, value: finalVal }], true);
        }
      })
    );
  }
  parentGroup.appendChild(itemGroup);
}

function getArrayTemplate(arr: unknown[]): unknown {
  if (arr.length === 0) return '';
  const first = arr[0];
  if (typeof first === 'object' && first !== null) {
    return Array.isArray(first) ? [] : {};
  }
  if (typeof first === 'number') return 0;
  if (typeof first === 'boolean') return false;
  return '';
}
