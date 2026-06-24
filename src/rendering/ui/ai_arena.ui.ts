import type { EditorController } from '../editor_ui.ts';
import { runAIArena } from '../../editor/simulation/ai_arena.ts';

/**
 * Renders the AI Arena simulation workspace where the user can pit two templates against each other.
 */
export function renderSimulationLab(controller: EditorController, container: HTMLElement): void {
  const doc = controller.getDocument();
  const actors = Object.values(doc.entities).filter((e) => e.isActor);

  container.innerHTML = `
    <div class="workspace-header">
      <h2 class="workspace-title">Emergent AI Arena</h2>
    </div>
    <div style="padding: 1rem; display: flex; flex-direction: column; gap: 1rem; height: 100%;">
      <div style="display: flex; gap: 1rem; align-items: center;">
        <div>
          <label style="display: block; font-size: 0.8rem; color: var(--text-dim); margin-bottom: 0.25rem;">Combatant A</label>
          <select id="sim-actor-a" class="editor-input" style="width: 200px;">
            ${actors.map((a) => `<option value="${a.id}">${a.name} (${a.id})</option>`).join('')}
          </select>
        </div>
        <div style="font-weight: bold; color: var(--danger-color);">VS</div>
        <div>
          <label style="display: block; font-size: 0.8rem; color: var(--text-dim); margin-bottom: 0.25rem;">Combatant B</label>
          <select id="sim-actor-b" class="editor-input" style="width: 200px;">
            ${actors.map((a) => `<option value="${a.id}">${a.name} (${a.id})</option>`).join('')}
          </select>
        </div>
        <div>
          <label style="display: block; font-size: 0.8rem; color: var(--text-dim); margin-bottom: 0.25rem;">Max Turns</label>
          <input type="number" id="sim-max-turns" class="editor-input" style="width: 80px;" value="100" min="1" max="1000" />
        </div>
        <div style="margin-top: 1.25rem;">
          <button id="btn-sim-run" class="editor-btn">▶ Run Simulation</button>
        </div>
      </div>
      
      <div style="background: var(--bg-darker); border: 1px solid var(--border-color); border-radius: 4px; padding: 1rem; flex-grow: 1; display: flex; flex-direction: column;">
        <h3 style="margin: 0 0 0.5rem 0; font-size: 0.9rem; color: var(--text-dim);">Combat Log</h3>
        <pre id="sim-log-output" style="margin: 0; padding: 0.5rem; background: #111; color: #ddd; overflow-y: auto; flex-grow: 1; height: 400px; font-family: monospace; font-size: 0.85rem; border-radius: 2px; white-space: pre-wrap;">Select combatants and run the simulation.</pre>
      </div>
    </div>
  `;

  const btnRun = container.querySelector('#btn-sim-run');
  btnRun?.addEventListener('click', () => {
    const selA = container.querySelector('#sim-actor-a') as HTMLSelectElement;
    const selB = container.querySelector('#sim-actor-b') as HTMLSelectElement;
    const inpTurns = container.querySelector('#sim-max-turns') as HTMLInputElement;
    const logOut = container.querySelector('#sim-log-output') as HTMLElement;

    if (!selA.value || !selB.value) {
      logOut.textContent = 'Please select both combatants.';
      return;
    }

    logOut.textContent = 'Running simulation...';

    // Defer to allow UI update
    setTimeout(() => {
      try {
        const result = runAIArena(selA.value, selB.value, controller.getDocument(), parseInt(inpTurns.value, 10));
        logOut.textContent = result.logs.join('\\n');
        // Auto scroll to bottom
        logOut.scrollTop = logOut.scrollHeight;
      } catch (err) {
        console.error(err);
        logOut.textContent = `Simulation Error: \${err instanceof Error ? err.message : String(err)}`;
      }
    }, 50);
  });
}
