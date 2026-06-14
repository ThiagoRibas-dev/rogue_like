import type { PatchOperation } from '@/utils/json-patch.ts';
import type { EditorController } from '../editor_ui.ts';
import { FactionRelationEnum } from '../../types/campaign.types.ts';
import { showPromptModal } from './modal.ui.ts';

const RELATION_COLORS: Readonly<Record<string, string>> = {
  hostile: '#e74c3c',
  neutral: '#95a5a6',
  friendly: '#2ecc71'
} as const;

/**
 * Renders a specialized 2D data-grid for the Faction Matrix instead of a nested Zod form.
 */
export function renderFactionMatrixEditor(
  controller: EditorController,
  basePath: string,
  container: HTMLElement
): void {
  const doc = controller.getDocument();
  const factionIds = Object.keys(doc.factions);

  container.innerHTML = `
    <div style="margin-bottom: 20px; display: flex; align-items: center; justify-content: space-between;">
      <h2>Faction Relations Matrix</h2>
      <button id="btn-add-faction" class="editor-btn editor-btn-primary">➕ Add Faction</button>
    </div>
    <div style="overflow-x: auto; background: #1a1a1a; padding: 16px; border-radius: 8px; border: 1px solid #333;">
      <table id="faction-matrix-table" style="border-collapse: collapse; width: 100%; text-align: left;">
        <thead>
          <tr id="faction-matrix-header">
            <th style="padding: 8px; border-bottom: 1px solid #444;"></th>
          </tr>
        </thead>
        <tbody id="faction-matrix-body">
        </tbody>
      </table>
    </div>
  `;

  const headerRow = container.querySelector('#faction-matrix-header') as HTMLTableRowElement;
  const tbody = container.querySelector('#faction-matrix-body') as HTMLTableSectionElement;
  const btnAdd = container.querySelector('#btn-add-faction') as HTMLButtonElement;

  if (factionIds.length === 0) {
    tbody.innerHTML = '<tr><td style="padding: 16px; color: #888;">No factions defined.</td></tr>';
  } else {
    // 1. Build Header
    for (const id of factionIds) {
      const th = document.createElement('th');
      th.style.padding = '8px';
      th.style.borderBottom = '1px solid #444';
      th.style.fontWeight = 'bold';
      th.style.color = '#cdd6f4';
      th.textContent = id;
      headerRow.appendChild(th);
    }

    // 2. Build Rows
    for (const rowId of factionIds) {
      const tr = document.createElement('tr');

      // Row Header
      const th = document.createElement('th');
      th.style.padding = '8px';
      th.style.borderRight = '1px solid #444';
      th.style.borderBottom = '1px solid #222';
      th.style.fontWeight = 'bold';
      th.style.color = '#cdd6f4';
      th.style.display = 'flex';
      th.style.alignItems = 'center';
      th.style.justifyContent = 'space-between';

      const titleSpan = document.createElement('span');
      titleSpan.textContent = rowId;
      th.appendChild(titleSpan);

      const btnRemove = document.createElement('button');
      btnRemove.textContent = '✖';
      btnRemove.title = `Remove ${rowId}`;
      btnRemove.className = 'editor-btn editor-btn-danger';
      btnRemove.style.padding = '2px 6px';
      btnRemove.style.fontSize = '0.75rem';
      btnRemove.addEventListener('click', () => {
        if (confirm(`Are you sure you want to completely remove faction '${rowId}'?`)) {
          const ops: PatchOperation[] = [];
          // 1. Remove its row
          ops.push({ op: 'remove', path: `${basePath}/${rowId}` });
          // 2. Remove its column from all other rows
          for (const otherId of factionIds) {
            if (otherId !== rowId) {
              ops.push({ op: 'remove', path: `${basePath}/${otherId}/${rowId}` });
            }
          }
          controller.applyOperations(ops);
        }
      });
      th.appendChild(btnRemove);
      tr.appendChild(th);

      // Data Cells
      for (const colId of factionIds) {
        const td = document.createElement('td');
        td.style.padding = '8px';
        td.style.borderBottom = '1px solid #222';

        if (rowId === colId) {
          // Diagonal (Self-relation)
          td.innerHTML = '<span style="color:#555; display:block; text-align:center;">—</span>';
        } else {
          // Cross-relation
          const currentRelation = doc.factions[rowId]?.[colId] || 'neutral';

          const select = document.createElement('select');
          select.className = 'form-input';
          select.style.width = '100%';
          select.style.padding = '4px';
          select.style.backgroundColor = RELATION_COLORS[currentRelation] || '#222';
          select.style.color = currentRelation === 'neutral' ? '#000' : '#fff';
          select.style.border = '1px solid #444';
          select.style.fontWeight = 'bold';

          const options = FactionRelationEnum.options;
          for (const opt of options) {
            const option = document.createElement('option');
            option.value = opt;
            option.textContent = opt.toUpperCase();
            if (opt === currentRelation) option.selected = true;
            select.appendChild(option);
          }

          select.addEventListener('change', () => {
            controller.applyOperations([
              {
                op: 'replace',
                path: `${basePath}/${rowId}/${colId}`,
                value: select.value
              }
            ]);
          });

          td.appendChild(select);
        }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
  }

  // 3. Wire up Add Faction
  btnAdd.addEventListener('click', () => {
    showPromptModal({
      title: 'New Faction',
      placeholder: 'Enter a unique faction ID',
      validator: (val: string) => {
        if (!/^[a-z0-9_-]+$/.test(val)) return 'ID must be lowercase alphanumeric, dashes, or underscores.';
        if (factionIds.includes(val)) return 'A faction with that ID already exists.';
        return null;
      },
      onConfirm: (newId: string) => {
        const ops: PatchOperation[] = [];
        // Add the new faction's row (with defaults for all existing factions + itself)
        const newRow: Record<string, string> = {};
        for (const existingId of factionIds) {
          newRow[existingId] = 'neutral';
        }
        newRow[newId] = 'friendly'; // self
        ops.push({ op: 'add', path: `${basePath}/${newId}`, value: newRow });

        // Add a column in every existing faction's row
        for (const existingId of factionIds) {
          ops.push({ op: 'add', path: `${basePath}/${existingId}/${newId}`, value: 'neutral' });
        }
        controller.applyOperations(ops);
      }
    });
  });
}
