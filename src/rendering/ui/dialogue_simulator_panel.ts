import { ComponentType } from '@/types/components.types.ts';
import { evaluateCondition } from '../../systems/trigger.system.ts';
import type { DialogueTree } from '../../types/dialogue.types.ts';
import type { GameEvent } from '../../types/events.types.ts';
import { GameEventType } from '../../types/events.types.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';
import type { EditorController } from '../editor_ui.ts';

/**
 * Renders the emergent dialogue simulator panel and validation errors.
 *
 * @param controller The active EditorController instance.
 * @param tree The DialogueTree being edited.
 * @param basePath The JSON pointer base path.
 * @param simContainer The DOM container for the simulator panel.
 * @param rootContainer The root container for validation errors.
 * @param errors Optional array of validation errors.
 */
export function renderDialogueSimulatorPanel(
  controller: EditorController,
  tree: DialogueTree,
  basePath: string,
  simContainer: HTMLElement,
  rootContainer: HTMLElement,
  errors?: ReadonlyArray<{ path: string; message: string; severity?: string }>
): void {
  simContainer.innerHTML = `
    <h3>Emergent Simulator</h3>
    <p style="font-size:0.8rem; color:#aaa; margin-bottom:15px;">Mock memory values to visually test condition gating.</p>
    <div style="margin-top:10px;">
       <label style="font-size:0.8rem; color:#888;">Facts (comma separated):</label><br/>
       <input type="text" id="sim-facts" value="" style="width:100%; background:#111; color:#fff; border:1px solid #333; padding:4px;" />
    </div>
    <div style="margin-top:10px;">
       <label style="font-size:0.8rem; color:#888;">Knowledge IDs (comma separated):</label><br/>
       <input type="text" id="sim-knowledge" value="" style="width:100%; background:#111; color:#fff; border:1px solid #333; padding:4px;" />
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
    const knowledgeInput = (simContainer.querySelector('#sim-knowledge') as HTMLInputElement).value;

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

    const knowledgeArr = knowledgeInput
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const knowledgeDict: Record<string, { id: string; type: 'secret'; description: string; tags: string[] }> = {};
    knowledgeArr.forEach((k) => {
      knowledgeDict[k] = { id: k, type: 'secret', description: '', tags: [] };
    });

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
              factionStandings: factionsObj,
              grudges: [],
              knowledge: knowledgeDict
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

  if (errors && errors.length > 0) {
    const errBlock = document.createElement('div');
    errBlock.className = 'dialogue-editor-errors';
    errBlock.style.marginTop = '12px';
    errBlock.style.padding = '8px';
    errBlock.style.background = 'rgba(231, 76, 60, 0.1)';
    errBlock.style.border = '1px solid #e74c3c';
    errBlock.style.borderRadius = '4px';
    const errTitle = document.createElement('strong');
    errTitle.textContent = `Validation Errors (${errors.length})`;
    errTitle.style.color = '#e74c3c';
    errBlock.appendChild(errTitle);
    for (const err of errors) {
      if (err.path && err.path.startsWith(basePath)) {
        const row = document.createElement('div');
        row.textContent = `${err.path.split('/').pop() || err.path}: ${err.message}`;
        row.style.color = '#e74c3c';
        row.style.fontSize = '0.8rem';
        row.style.marginTop = '2px';
        errBlock.appendChild(row);
      }
    }
    rootContainer.appendChild(errBlock);
  }
}
