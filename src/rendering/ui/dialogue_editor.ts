import { ComponentType } from '@/types/components.types.ts';
import { evaluateCondition } from '../../systems/trigger.system.ts';
import type { DialogueTree } from '../../types/dialogue.types.ts';
import { DialogueOptionSchema } from '../../types/dialogue.types.ts';
import type { GameEvent } from '../../types/events.types.ts';
import { GameEventType } from '../../types/events.types.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';
import type { EditorController } from '../editor_ui.ts';
import { showPromptModal } from './modal.ui.ts';
import { renderFormForZodSchema } from './zod_form_renderer.ts';

/**
 * Renders a specialized tree-first editor for Dialogue Trees.
 * @param controller The campaign editor controller.
 * @param treeData The current state of the dialogue tree.
 * @param basePath The JSON patch base path for this dialogue tree.
 * @param container The DOM container to render into.
 * @returns void
 */
export function renderDialogueTreeEditor(
  controller: EditorController,
  treeData: unknown,
  basePath: string,
  container: HTMLElement
): void {
  const tree = treeData as DialogueTree;

  container.innerHTML = `
    <div style="display:flex; gap: 20px;">
      <div id="dialogue-tree-container" style="flex: 2; display: flex; flex-direction: column; gap: 10px;"></div>
      <div id="dialogue-simulator-container" style="flex: 1; border-left: 1px solid #444; padding-left: 20px;"></div>
    </div>
  `;

  const treeContainer = container.querySelector('#dialogue-tree-container') as HTMLElement;
  const simContainer = container.querySelector('#dialogue-simulator-container') as HTMLElement;

  // Render nodes list
  const header = document.createElement('h3');
  header.textContent = `Dialogue: ${tree.id}`;
  treeContainer.appendChild(header);

  const nodes = tree.nodes || {};
  Object.entries(nodes).forEach(([nodeId, node]) => {
    const nodeEl = document.createElement('div');
    nodeEl.className = 'editor-node-card';
    nodeEl.style.border = '1px solid #555';
    nodeEl.style.padding = '10px';
    nodeEl.style.borderRadius = '4px';

    const nodeTitle = document.createElement('h4');
    nodeTitle.textContent = `Node: ${nodeId} ${nodeId === tree.startNodeId ? '(START)' : ''}`;
    nodeEl.appendChild(nodeTitle);

    const textInput = document.createElement('textarea');
    textInput.value = node.text;
    textInput.style.width = '100%';
    textInput.style.backgroundColor = '#1e1e1e';
    textInput.style.color = '#fff';
    textInput.addEventListener('change', (e) => {
      controller.applyOperations([
        {
          op: 'replace',
          path: `${basePath}/nodes/${nodeId}/text`,
          value: (e.target as HTMLTextAreaElement).value
        }
      ]);
    });
    nodeEl.appendChild(textInput);

    // Options
    const optionsContainer = document.createElement('div');
    optionsContainer.style.marginTop = '10px';
    optionsContainer.style.paddingLeft = '15px';
    optionsContainer.style.borderLeft = '2px solid #555';

    node.options.forEach((opt, optIdx) => {
      const optEl = document.createElement('div');
      optEl.style.marginTop = '5px';
      optEl.style.padding = '5px';
      optEl.style.backgroundColor = '#2a2a2a';
      optEl.style.borderRadius = '3px';
      optEl.innerHTML = `<strong>></strong> ${opt.text} <em style="color:#888;">(-> ${opt.nextNodeId || 'END'})</em>`;
      optionsContainer.appendChild(optEl);

      // Edit button for option
      const btnEdit = document.createElement('button');
      btnEdit.textContent = 'Edit Option Triggers';
      btnEdit.className = 'editor-btn';
      btnEdit.style.marginLeft = '10px';
      btnEdit.style.fontSize = '0.75rem';
      btnEdit.addEventListener('click', () => {
        // Modal for editing just the option schema (conditions/consequences)
        const modal = document.createElement('div');
        modal.style.position = 'fixed';
        modal.style.inset = '10%';
        modal.style.background = '#222';
        modal.style.border = '1px solid #555';
        modal.style.padding = '20px';
        modal.style.zIndex = '1000';
        modal.style.overflow = 'auto';
        modal.style.boxShadow = '0 0 20px rgba(0,0,0,0.8)';

        const closeBtn = document.createElement('button');
        closeBtn.textContent = 'Close';
        closeBtn.className = 'editor-btn';
        closeBtn.style.marginBottom = '20px';
        closeBtn.addEventListener('click', () => modal.remove());
        modal.appendChild(closeBtn);

        const formDiv = document.createElement('div');
        renderFormForZodSchema(
          controller,
          DialogueOptionSchema,
          opt,
          `${basePath}/nodes/${nodeId}/options/${optIdx}`,
          formDiv
        );
        modal.appendChild(formDiv);
        document.body.appendChild(modal);
      });
      optEl.appendChild(btnEdit);
    });

    const btnAddOpt = document.createElement('button');
    btnAddOpt.textContent = '+ Add Option';
    btnAddOpt.className = 'editor-btn';
    btnAddOpt.style.marginTop = '10px';
    btnAddOpt.style.fontSize = '0.75rem';
    btnAddOpt.addEventListener('click', () => {
      showPromptModal({
        title: 'New Option',
        placeholder: 'Enter Option ID',
        validator: (val) =>
          /^[a-z0-9_-]+$/.test(val) ? null : 'ID must be lowercase alphanumeric, dashes, or underscores.',
        onConfirm: (newOptId) => {
          controller.applyOperations([
            {
              op: 'add',
              path: `${basePath}/nodes/${nodeId}/options/-`,
              value: { id: newOptId, text: 'New Option', conditions: [], consequences: [] }
            }
          ]);
        }
      });
    });
    optionsContainer.appendChild(btnAddOpt);
    nodeEl.appendChild(optionsContainer);
    treeContainer.appendChild(nodeEl);
  });

  const btnAddNode = document.createElement('button');
  btnAddNode.textContent = '+ Add Node';
  btnAddNode.className = 'editor-btn';
  btnAddNode.style.marginTop = '10px';
  btnAddNode.addEventListener('click', () => {
    showPromptModal({
      title: 'New Node',
      placeholder: 'Enter Node ID',
      validator: (val) => {
        if (!/^[a-z0-9_-]+$/.test(val)) return 'ID must be lowercase alphanumeric, dashes, or underscores.';
        if (tree.nodes && tree.nodes[val]) return 'A node with that ID already exists.';
        return null;
      },
      onConfirm: (newNodeId) => {
        controller.applyOperations([
          {
            op: 'add',
            path: `${basePath}/nodes/${newNodeId}`,
            value: { id: newNodeId, text: 'New text', options: [] }
          }
        ]);
      }
    });
  });
  treeContainer.appendChild(btnAddNode);

  // Simulator Panel
  simContainer.innerHTML = `
    <h3>Emergent Simulator</h3>
    <p style="font-size:0.8rem; color:#aaa; margin-bottom:15px;">Mock memory values to visually test condition gating.</p>
    <div style="margin-top:10px;">
       <label style="font-size:0.8rem; color:#888;">Facts (comma separated):</label><br/>
       <input type="text" id="sim-facts" value="" style="width:100%; background:#111; color:#fff; border:1px solid #333; padding:4px;" />
    </div>
    <div style="margin-top:10px;">
       <label style="font-size:0.8rem; color:#888;">Faction Standing (JSON):</label><br/>
       <textarea id="sim-factions" style="width:100%; height:60px; background:#111; color:#fff; border:1px solid #333; padding:4px;">{"goblins": 0}</textarea>
    </div>
    <button class="editor-btn" id="sim-test-btn" style="margin-top:15px; width:100%;">Test Validity (Mock)</button>
    <div id="sim-results" style="margin-top:10px; font-size:0.8rem; color:#0f0;">Ready to test.</div>
  `;

  const testBtn = simContainer.querySelector('#sim-test-btn');
  testBtn?.addEventListener('click', () => {
    const results = simContainer.querySelector('#sim-results') as HTMLElement;
    if (!results) return;

    const factsInput = (simContainer.querySelector('#sim-facts') as HTMLInputElement).value;
    const factionsInput = (simContainer.querySelector('#sim-factions') as HTMLTextAreaElement).value;

    let factionsObj: Record<string, number> = {};
    try {
      factionsObj = JSON.parse(factionsInput);
    } catch {
      results.textContent = 'Invalid JSON in Faction Standing.';
      results.style.color = '#e74c3c';
      return;
    }

    const factsArr = factsInput
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    // Build a mock state
    const mockState = {
      campaign: { ...controller.getDocument() },
      components: new Map([
        [1 as EntityId, [{ type: ComponentType.Player }]],
        [
          2 as EntityId,
          [
            {
              type: ComponentType.Memory,
              facts: factsArr,
              factionStanding: factionsObj,
              grudges: []
            }
          ]
        ]
      ])
    } as unknown as GameState;

    const dummyEvent = { type: GameEventType.EntityMoved } as unknown as GameEvent;

    let outputHtml = '';

    Object.entries(tree.nodes || {}).forEach(([nodeId, node]) => {
      outputHtml += `<div style="margin-bottom:10px;"><strong>Node: ${nodeId}</strong><br/>`;
      if (!node.options || node.options.length === 0) {
        outputHtml += `<span style="color:#888;">No options.</span>`;
      } else {
        node.options.forEach((opt, idx) => {
          let allPassed = true;
          for (const cond of opt.conditions || []) {
            const evalCond = {
              ...cond,
              _npcEntityId: 2 as EntityId,
              entityId: 2 as EntityId,
              _playerEntityId: 1 as EntityId
            };
            const passed = evaluateCondition(mockState, dummyEvent, evalCond);
            if (!passed) allPassed = false;
          }
          if (allPassed) {
            outputHtml += `<div style="color:#2ecc71;">[V] Option ${idx}: ${opt.text}</div>`;
          } else {
            outputHtml += `<div style="color:#e74c3c;text-decoration:line-through;">[X] Option ${idx}: ${opt.text}</div>`;
          }
        });
      }
      outputHtml += `</div>`;
    });

    results.innerHTML = outputHtml;
    results.style.color = '#fff';
  });
}
