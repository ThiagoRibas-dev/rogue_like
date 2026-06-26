import type { EditorController } from '../editor_ui.ts';
import { compileTrigger } from '../../systems/trigger-composer.system.ts';
import type { GameState } from '../../types/game-state.types.ts';
import type { TriggerDefinition } from '../../types/trigger.types.ts';
import { ALL_COMPOSER_PLACEHOLDERS } from '../../constants/trigger.constants.ts';
import { z } from 'zod';

/**
 * Extracts all unique placeholder variables (e.g., $NEMESIS_ID) from a template.
 * Looks at expectedVariables first, and falls back to scanning the JSON representation.
 */
function getTemplateVariables(template: unknown): string[] {
  const vars = new Set<string>();
  if (template && typeof template === 'object' && 'expectedVariables' in template) {
    const expectedVars = (template as Record<string, unknown>).expectedVariables;
    if (Array.isArray(expectedVars)) {
      expectedVars.forEach((v: unknown) => {
        if (v && typeof v === 'string') {
          vars.add(v);
        }
      });
    }
  }

  // Scan JSON string representation to find any remaining $VARIABLE placeholders
  if (template) {
    const serialized = JSON.stringify(template);
    const regex = /\$[A-Z0-9_]+/g;
    let match;
    while ((match = regex.exec(serialized)) !== null) {
      vars.add(match[0]);
    }
  }
  return Array.from(vars);
}

/**
 * Renders the Trigger Composer panel.
 *
 * @param controller The CampaignEditor controller.
 * @param container  The DOM container to render into.
 */
export function renderTriggerComposer(controller: EditorController, container: HTMLElement): void {
  const doc = controller.getDocument();
  const templates = doc.triggerTemplates ?? {};

  const templateIds = Object.keys(templates);
  if (templateIds.length === 0) {
    container.innerHTML = `
      <div class="workspace-header">
        <h2 class="workspace-title">⚡ Trigger Composer</h2>
      </div>
      <div style="padding: 2rem; text-align: center; color: var(--text-dim);">
        <p>No Trigger Templates found in the campaign data.</p>
        <p style="font-size: 0.85rem; margin-top: 0.5rem;">Add templates to <code>trigger_templates.json</code> to enable composer primitives.</p>
      </div>
    `;
    return;
  }

  // Local component state
  let selectedTemplateId = templateIds[0]!;
  const bindingsState: Record<string, string> = {};

  // Initialize default bindings for the first template
  const initialVars = getTemplateVariables(templates[selectedTemplateId]);
  initialVars.forEach((v) => {
    bindingsState[v] = '';
  });

  let customId = `trigger_baked_${selectedTemplateId}_${Date.now().toString().slice(-4)}`;

  // Main UI Frame
  container.innerHTML = `
    <div class="workspace-header">
      <h2 class="workspace-title">⚡ Trigger Composer</h2>
    </div>
    <div style="padding: 1rem; display: flex; flex-direction: column; gap: 1rem; height: calc(100% - 60px); overflow: hidden;">
      
      <div style="display: flex; gap: 1.5rem; height: 100%; min-height: 0;">
        
        <!-- Controls Pane (Left) -->
        <div style="flex: 1; display: flex; flex-direction: column; gap: 1rem; overflow-y: auto; padding-right: 0.5rem; min-width: 320px;">
          
          <div class="form-section" style="background: var(--bg-darker); border: 1px solid var(--border-color); border-radius: 4px; padding: 1rem; display: flex; flex-direction: column; gap: 0.75rem;">
            <h3 style="margin: 0 0 0.25rem 0; font-size: 0.9rem; color: var(--text-bright);">1. Choose a Template</h3>
            <div>
              <label style="display: block; font-size: 0.75rem; color: var(--text-dim); margin-bottom: 0.25rem;">Trigger Template</label>
              <select id="composer-template-select" class="editor-input" style="width: 100%;">
                ${templateIds.map((id) => `<option value="${id}">${id}</option>`).join('')}
              </select>
            </div>
            <details style="margin-top: 0.25rem; background: rgba(255,255,255,0.03); border: 1px dashed var(--border-color); border-radius: 4px; padding: 0.5rem; font-size: 0.7rem; color: var(--text-dim);">
              <summary style="cursor: pointer; font-weight: bold; color: var(--text-bright);">💡 Standard System Placeholders</summary>
              <ul style="margin: 0.25rem 0 0 0; padding-left: 1.2rem; display: flex; flex-direction: column; gap: 0.15rem; font-family: monospace;">
                ${ALL_COMPOSER_PLACEHOLDERS.map((p) => `<li>${p}</li>`).join('')}
              </ul>
            </details>
          </div>

          <div class="form-section" style="background: var(--bg-darker); border: 1px solid var(--border-color); border-radius: 4px; padding: 1rem; display: flex; flex-direction: column; gap: 0.75rem;">
            <h3 style="margin: 0 0 0.25rem 0; font-size: 0.9rem; color: var(--text-bright);">2. Variables & Bindings</h3>
            <div id="composer-variables-container" style="display: flex; flex-direction: column; gap: 0.75rem;">
              <!-- Dynamic input fields go here -->
            </div>
          </div>

          <div class="form-section" style="background: var(--bg-darker); border: 1px solid var(--border-color); border-radius: 4px; padding: 1rem; display: flex; flex-direction: column; gap: 0.75rem;">
            <h3 style="margin: 0 0 0.25rem 0; font-size: 0.9rem; color: var(--text-bright);">3. Output Config</h3>
            <div>
              <label style="display: block; font-size: 0.75rem; color: var(--text-dim); margin-bottom: 0.25rem;">Target Trigger ID</label>
              <input type="text" id="composer-trigger-id" class="editor-input" style="width: 100%; font-family: monospace;" value="${customId}" />
              <span style="font-size: 0.65rem; color: var(--text-dim); margin-top: 0.25rem; display: block;">Must be a unique lowercase alphanumeric ID.</span>
            </div>
            
            <button id="composer-bake-btn" class="editor-btn playtest-btn" style="margin-top: 0.5rem; padding: 0.5rem; font-size: 0.85rem; font-weight: bold; width: 100%;">
              💾 Bake Trigger to Campaign
            </button>
          </div>

        </div>

        <!-- Preview Pane (Right) -->
        <div style="flex: 1.2; display: flex; flex-direction: column; gap: 1rem; min-width: 360px; height: 100%;">
          
          <!-- Status Banner -->
          <div id="composer-status-banner" style="padding: 0.75rem; border-radius: 4px; font-weight: bold; font-size: 0.8rem; display: flex; align-items: center; justify-content: space-between;">
            <!-- Dynamic validation status -->
          </div>

          <!-- Preview JSON Code Block -->
          <div style="flex: 1; display: flex; flex-direction: column; background: #0c0c16; border: 1px solid var(--border-color); border-radius: 4px; padding: 0.75rem; min-height: 0;">
            <div style="font-size: 0.8rem; color: var(--text-dim); margin-bottom: 0.5rem; display: flex; justify-content: space-between;">
              <span>📝 Live Generated JSON</span>
              <span style="font-size: 0.7rem; font-family: monospace; color: #888;">TriggerDefinition</span>
            </div>
            <pre id="composer-json-preview" style="flex: 1; margin: 0; padding: 0.5rem; background: #05050a; border: 1px solid #1a1a2e; border-radius: 3px; font-family: monospace; font-size: 0.75rem; color: #a6e22e; overflow: auto; white-space: pre-wrap; word-break: break-all;"></pre>
          </div>

        </div>

      </div>

    </div>
  `;

  // Get DOM handles
  const templateSelect = container.querySelector('#composer-template-select') as HTMLSelectElement;
  const variablesContainer = container.querySelector('#composer-variables-container') as HTMLElement;
  const triggerIdInput = container.querySelector('#composer-trigger-id') as HTMLInputElement;
  const statusBanner = container.querySelector('#composer-status-banner') as HTMLElement;
  const jsonPreview = container.querySelector('#composer-json-preview') as HTMLElement;
  const bakeBtn = container.querySelector('#composer-bake-btn') as HTMLButtonElement;

  // Render inputs for current variables
  function rebuildVariableInputs(): void {
    const template = templates[selectedTemplateId];
    const vars = getTemplateVariables(template);

    variablesContainer.innerHTML = '';

    if (vars.length === 0) {
      variablesContainer.innerHTML = `
        <div style="font-size: 0.75rem; color: var(--text-dim); font-style: italic;">
          No variables found in this template. It will compile directly as-is.
        </div>
      `;
      return;
    }

    vars.forEach((v) => {
      // Retain existing state if present, otherwise set empty
      if (bindingsState[v] === undefined) {
        bindingsState[v] = '';
      }

      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.flexDirection = 'column';
      row.style.gap = '0.25rem';

      row.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <label style="font-family: monospace; font-size: 0.75rem; color: #3498db;">${v}</label>
          <span style="font-size: 0.65rem; color: var(--text-dim); opacity: 0.7;" id="type-label-${v}">String</span>
        </div>
        <input type="text" class="editor-input composer-var-input" data-var="${v}" style="width: 100%; font-family: monospace;" value="${bindingsState[v]}" placeholder="e.g. value..." />
      `;

      variablesContainer.appendChild(row);
    });

    // Add listeners to input elements
    variablesContainer.querySelectorAll('.composer-var-input').forEach((input) => {
      input.addEventListener('input', (e) => {
        const target = e.target as HTMLInputElement;
        const v = target.dataset.var!;
        bindingsState[v] = target.value;

        // Auto-detect type label for user friendliness
        const typeLabel = variablesContainer.querySelector(`#type-label-${v}`);
        if (typeLabel) {
          const val = target.value;
          if (val === 'true' || val === 'false') {
            typeLabel.textContent = 'Boolean';
          } else if (!isNaN(Number(val)) && val.trim() !== '') {
            typeLabel.textContent = 'Number';
          } else {
            typeLabel.textContent = 'String';
          }
        }

        updateCompilationPreview();
      });
    });
  }

  // Compile and update preview panel
  function updateCompilationPreview(): { compiled: TriggerDefinition | null; id: string } {
    const template = templates[selectedTemplateId];
    const vars = getTemplateVariables(template);
    const targetId = triggerIdInput.value.trim();

    // Map input fields to bindingsState
    const bindings: Record<string, string | number | boolean> = {};
    vars.forEach((v) => {
      const rawVal = bindingsState[v] || '';

      // Attempt typing conversion
      let typedVal: string | number | boolean = rawVal;
      if (rawVal === 'true') {
        typedVal = true;
      } else if (rawVal === 'false') {
        typedVal = false;
      } else if (!isNaN(Number(rawVal)) && rawVal.trim() !== '') {
        typedVal = Number(rawVal);
      }
      bindings[v] = typedVal;
    });

    let compiled: TriggerDefinition | null = null;
    try {
      if (!targetId) {
        throw new Error('Target Trigger ID cannot be empty.');
      }
      if (!/^[a-z0-9_-]+$/.test(targetId)) {
        throw new Error('Trigger ID must be lowercase alphanumeric, dashes, or underscores.');
      }

      const dummyState = {
        campaign: {
          triggerTemplates: templates
        }
      } as unknown as GameState;

      compiled = compileTrigger(selectedTemplateId, bindings, dummyState, targetId);

      // Render valid status
      statusBanner.style.backgroundColor = 'rgba(46, 204, 113, 0.15)';
      statusBanner.style.border = '1px solid #2ecc71';
      statusBanner.style.color = '#2ecc71';
      statusBanner.innerHTML = `
        <span>🟢 VALID TRIGGER</span>
        <span style="font-size: 0.7rem; font-weight: normal; opacity: 0.8;">Adheres perfectly to TriggerDefinitionSchema</span>
      `;

      jsonPreview.textContent = JSON.stringify(compiled, null, 2);
      jsonPreview.style.color = '#a6e22e'; // green monospace
      bakeBtn.disabled = false;
    } catch (err: unknown) {
      statusBanner.style.backgroundColor = 'rgba(231, 76, 60, 0.15)';
      statusBanner.style.border = '1px solid #e74c3c';
      statusBanner.style.color = '#e74c3c';

      let errorMsg = err instanceof Error ? err.message : String(err);
      if (err instanceof z.ZodError) {
        errorMsg = err.issues.map((issue) => `• [${issue.path.join('.')}] ${issue.message}`).join('\n');
      }

      statusBanner.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 0.25rem; width: 100%;">
          <span style="font-weight: bold;">🔴 INVALID TRIGGER</span>
          <pre style="margin: 0; font-family: monospace; font-size: 0.7rem; white-space: pre-wrap; font-weight: normal;">${errorMsg}</pre>
        </div>
      `;

      jsonPreview.textContent = 'Compilation failed. See error banner above.';
      jsonPreview.style.color = '#e74c3c'; // red text
      bakeBtn.disabled = true;
    }

    return { compiled, id: targetId };
  }

  // Handlers
  templateSelect.addEventListener('change', () => {
    selectedTemplateId = templateSelect.value;
    customId = `trigger_baked_${selectedTemplateId}_${Date.now().toString().slice(-4)}`;
    triggerIdInput.value = customId;

    rebuildVariableInputs();
    updateCompilationPreview();
  });

  triggerIdInput.addEventListener('input', () => {
    updateCompilationPreview();
  });

  bakeBtn.addEventListener('click', () => {
    const { compiled, id } = updateCompilationPreview();
    if (!compiled || !id) return;

    // Check if target trigger already exists
    const existing = doc.triggers?.[id];
    if (existing && !confirm(`A trigger with ID '${id}' already exists. Overwrite?`)) {
      return;
    }

    // Apply JSON Patch operation to save the baked trigger into the workspace document
    controller.applyOperations([
      {
        op: 'add',
        path: `/triggers/${id}`,
        value: compiled
      }
    ]);

    // Force reload UI views and select the new trigger in the main trigger list
    // This allows the designer to see and inspect the baked trigger immediately in the editor.
    alert(`Trigger '${id}' successfully baked and added to the campaign triggers list!`);

    // We set active category to triggers and navigate to the baked trigger
    // Let's dispatch a custom navigation change if editor supports it, or simply update global state variables
    const triggersBtn = document.querySelector('[data-target="triggers"]') as HTMLButtonElement | null;
    if (triggersBtn) {
      sessionStorage.setItem('editor_active_category', 'triggers');
      sessionStorage.setItem('editor_active_item', id);
      // Click navigation tab programmatically
      triggersBtn.click();
    }
  });

  // Initial runs
  rebuildVariableInputs();
  updateCompilationPreview();
}
