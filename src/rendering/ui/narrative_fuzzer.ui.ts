import type { EditorController } from '../editor_ui.ts';
import { runFuzzerBatch } from '../../editor/simulation/narrative_fuzzer.ts';

/**
 * Renders the Narrative Fuzzer simulation tab in the Simulation Lab.
 */
export function renderNarrativeFuzzer(controller: EditorController, container: HTMLElement): void {
  container.innerHTML = `
    <div class="workspace-header">
      <h2 class="workspace-title">Emergent Narrative Fuzzer</h2>
    </div>
    <div style="padding: 1rem; display: flex; flex-direction: column; gap: 1rem; height: 100%;">
      <!-- Controls -->
      <div style="display: flex; gap: 1rem; align-items: center; flex-wrap: wrap; background: var(--bg-darker); border: 1px solid var(--border-color); padding: 1rem; border-radius: 4px;">
        <div>
          <label style="display: block; font-size: 0.8rem; color: var(--text-dim); margin-bottom: 0.25rem;">Batch Runs</label>
          <input type="number" id="fuzzer-runs" class="editor-input" style="width: 80px;" value="10" min="1" max="200" />
        </div>
        <div>
          <label style="display: block; font-size: 0.8rem; color: var(--text-dim); margin-bottom: 0.25rem;">Max Turns / Run</label>
          <input type="number" id="fuzzer-max-turns" class="editor-input" style="width: 100px;" value="500" min="50" max="5000" />
        </div>
        <div>
          <label style="display: block; font-size: 0.8rem; color: var(--text-dim); margin-bottom: 0.25rem;">Seed Override (Optional)</label>
          <input type="text" id="fuzzer-seed" class="editor-input" style="width: 150px;" placeholder="Random" />
        </div>
        <div style="display: flex; align-items: center; margin-top: 1.25rem;">
          <input type="checkbox" id="fuzzer-stop-error" style="margin-right: 0.5rem;" checked />
          <label for="fuzzer-stop-error" style="font-size: 0.8rem; color: var(--text-dim); cursor: pointer;">Stop on first error</label>
        </div>
        <div style="margin-top: 1.25rem; margin-left: auto;">
          <button id="btn-fuzzer-run" class="editor-btn" style="padding: 0.5rem 1.25rem;">▶ Run Fuzzer</button>
        </div>
      </div>

      <!-- Results View -->
      <div id="fuzzer-output-container" style="display: none; flex-direction: column; gap: 1rem; flex-grow: 1;">
        <!-- Metrics Cards -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem;">
          <div class="metrics-card" style="background: var(--bg-darker); border: 1px solid var(--border-color); border-radius: 4px; padding: 0.75rem; text-align: center;">
            <div style="font-size: 0.8rem; color: var(--text-dim);">Passed / Failed</div>
            <div id="fuzzer-metric-passfail" style="font-size: 1.2rem; font-weight: bold; margin-top: 0.25rem;">-</div>
          </div>
          <div class="metrics-card" style="background: var(--bg-darker); border: 1px solid var(--border-color); border-radius: 4px; padding: 0.75rem; text-align: center;">
            <div style="font-size: 0.8rem; color: var(--text-dim);">Avg Turns Elapsed</div>
            <div id="fuzzer-metric-turns" style="font-size: 1.2rem; font-weight: bold; margin-top: 0.25rem;">-</div>
          </div>
          <div class="metrics-card" style="background: var(--bg-darker); border: 1px solid var(--border-color); border-radius: 4px; padding: 0.75rem; text-align: center;">
            <div style="font-size: 0.8rem; color: var(--text-dim);">Drama Events / kTurns</div>
            <div id="fuzzer-metric-drama" style="font-size: 1.2rem; font-weight: bold; margin-top: 0.25rem;">-</div>
          </div>
          <div class="metrics-card" style="background: var(--bg-darker); border: 1px solid var(--border-color); border-radius: 4px; padding: 0.75rem; text-align: center;">
            <div style="font-size: 0.8rem; color: var(--text-dim);">Clue-to-Event Ratio</div>
            <div id="fuzzer-metric-clueratio" style="font-size: 1.2rem; font-weight: bold; margin-top: 0.25rem;">-</div>
          </div>
          <div class="metrics-card" style="background: var(--bg-darker); border: 1px solid var(--border-color); border-radius: 4px; padding: 0.75rem; text-align: center;">
            <div style="font-size: 0.8rem; color: var(--text-dim);">Avg Save Size</div>
            <div id="fuzzer-metric-savesize" style="font-size: 1.2rem; font-weight: bold; margin-top: 0.25rem;">-</div>
          </div>
        </div>

        <!-- Timeline of Runs -->
        <div style="background: var(--bg-darker); border: 1px solid var(--border-color); border-radius: 4px; padding: 1rem; display: flex; flex-direction: column; height: 350px;">
          <h3 style="margin: 0 0 0.5rem 0; font-size: 0.9rem; color: var(--text-dim);">Simulated Runs List</h3>
          <div id="fuzzer-runs-list" style="overflow-y: auto; flex-grow: 1; display: flex; flex-direction: column; gap: 0.5rem; padding-right: 0.5rem;">
            <!-- Seed list will populate here -->
          </div>
        </div>
      </div>

      <div id="fuzzer-placeholder" style="flex-grow: 1; display: flex; align-items: center; justify-content: center; background: var(--bg-darker); border: 1px solid var(--border-color); border-radius: 4px; color: var(--text-dim); font-style: italic;">
        Click "Run Fuzzer" to start batch testing.
      </div>
    </div>
  `;

  const btnRun = container.querySelector('#btn-fuzzer-run') as HTMLButtonElement | null;
  const runsInp = container.querySelector('#fuzzer-runs') as HTMLInputElement | null;
  const turnsInp = container.querySelector('#fuzzer-max-turns') as HTMLInputElement | null;
  const seedInp = container.querySelector('#fuzzer-seed') as HTMLInputElement | null;
  const stopChk = container.querySelector('#fuzzer-stop-error') as HTMLInputElement | null;

  const placeholder = container.querySelector('#fuzzer-placeholder') as HTMLElement | null;
  const outputContainer = container.querySelector('#fuzzer-output-container') as HTMLElement | null;
  const runsList = container.querySelector('#fuzzer-runs-list') as HTMLElement | null;

  const metricPassFail = container.querySelector('#fuzzer-metric-passfail') as HTMLElement | null;
  const metricTurns = container.querySelector('#fuzzer-metric-turns') as HTMLElement | null;
  const metricDrama = container.querySelector('#fuzzer-metric-drama') as HTMLElement | null;
  const metricClueRatio = container.querySelector('#fuzzer-metric-clueratio') as HTMLElement | null;
  const metricSaveSize = container.querySelector('#fuzzer-metric-savesize') as HTMLElement | null;

  btnRun?.addEventListener('click', () => {
    if (!runsInp || !turnsInp || !seedInp) return;

    if (btnRun) {
      btnRun.disabled = true;
      btnRun.textContent = '⏳ Running...';
    }

    if (placeholder) placeholder.style.display = 'none';
    if (outputContainer) outputContainer.style.display = 'flex';
    if (runsList)
      runsList.innerHTML =
        '<div style="color: var(--text-dim); font-style: italic;">Running headless simulations...</div>';

    setTimeout(() => {
      try {
        const runs = parseInt(runsInp.value, 10);
        const maxTurns = parseInt(turnsInp.value, 10);
        const seedOverride = seedInp.value.trim() || undefined;
        const stopOnFirstError = stopChk ? stopChk.checked : false;

        const report = runFuzzerBatch(controller.getDocument(), {
          runs,
          maxTurns,
          seedOverride,
          stopOnFirstError
        });

        // Set metrics
        if (metricPassFail) {
          const pass = report.aggregate.successfulRuns;
          const fail = report.aggregate.failedRuns;
          metricPassFail.innerHTML = `<span style="color: var(--success-color, #2ecc71);">${pass}</span> / <span style="color: var(--danger-color, #e74c3c);">${fail}</span>`;
        }
        if (metricTurns) {
          metricTurns.textContent = report.aggregate.avgTurns.toFixed(0);
        }
        if (metricDrama) {
          metricDrama.textContent = report.aggregate.avgDramaEventsPerHour.toFixed(1);
        }
        if (metricClueRatio) {
          metricClueRatio.textContent = report.aggregate.clueToEventRatio.toFixed(2);
        }
        if (metricSaveSize) {
          const kb = report.aggregate.avgSaveSize / 1024;
          metricSaveSize.textContent = `${kb.toFixed(1)} KB`;
        }

        // Render runs list
        if (runsList) {
          runsList.innerHTML = '';
          report.results.forEach((run, idx) => {
            const runDiv = document.createElement('div');
            runDiv.style.cssText =
              'border: 1px solid var(--border-color); border-radius: 4px; padding: 0.5rem; background: rgba(255,255,255,0.02); display: flex; flex-direction: column; gap: 0.25rem;';

            const header = document.createElement('div');
            header.style.cssText = 'display: flex; justify-content: space-between; align-items: center;';

            const status = run.error
              ? `<span style="color: var(--danger-color, #e74c3c); font-weight: bold;">[FAIL: ${run.error.type.toUpperCase()}]</span>`
              : `<span style="color: var(--success-color, #2ecc71); font-weight: bold;">[PASS]</span>`;

            header.innerHTML = `
              <div>
                ${status} <strong>Run #${idx + 1}</strong> <span style="color: var(--text-dim); font-size: 0.8rem; margin-left: 0.5rem;">Seed: ${run.seed}</span>
              </div>
              <div style="display: flex; gap: 0.5rem;">
                <button class="editor-btn btn-toggle-timeline" style="padding: 2px 6px; font-size: 0.75rem;">📜 Timeline (${run.events.length})</button>
                <button class="editor-btn playtest-btn btn-replay-visual" data-seed="${run.seed}" style="padding: 2px 6px; font-size: 0.75rem;">▶ Replay Visually</button>
              </div>
            `;

            const timelineDiv = document.createElement('pre');
            timelineDiv.style.cssText =
              'display: none; margin: 0.5rem 0 0 0; padding: 0.5rem; background: #111; color: #ddd; max-height: 150px; overflow-y: auto; font-family: monospace; font-size: 0.75rem; border-radius: 2px; white-space: pre-wrap;';
            if (run.events.length > 0) {
              timelineDiv.textContent = run.events.join('\n');
            } else {
              timelineDiv.textContent = 'No narrative events recorded.';
            }

            if (run.error) {
              const errDiv = document.createElement('div');
              errDiv.style.cssText =
                'color: var(--danger-color, #e74c3c); font-size: 0.8rem; font-family: monospace; margin-top: 0.25rem;';
              errDiv.textContent = `Error at Turn ${run.error.turn}: ${run.error.message}`;
              runDiv.appendChild(errDiv);
            }

            runDiv.appendChild(header);
            runDiv.appendChild(timelineDiv);
            runsList.appendChild(runDiv);

            // Toggle timeline action
            header.querySelector('.btn-toggle-timeline')?.addEventListener('click', () => {
              const isHidden = timelineDiv.style.display === 'none';
              timelineDiv.style.display = isHidden ? 'block' : 'none';
            });

            // Replay visually action
            header.querySelector('.btn-replay-visual')?.addEventListener('click', () => {
              if (confirm(`Save current workspace and visually playtest with Seed: ${run.seed}?`)) {
                // Setup playtest session storage variables
                sessionStorage.setItem('editor_active_document', JSON.stringify(controller.getDocument()));
                sessionStorage.setItem('editor_playtest', 'true');
                sessionStorage.setItem('editor_playtest_seed', run.seed);
                window.location.reload();
              }
            });
          });
        }
      } catch (err) {
        console.error(err);
        if (runsList) {
          runsList.innerHTML = `<div style="color: var(--danger-color, #e74c3c);">Fuzzer Crash: ${(err as Error).message}</div>`;
        }
      } finally {
        if (btnRun) {
          btnRun.disabled = false;
          btnRun.textContent = '▶ Run Fuzzer';
        }
      }
    }, 50);
  });
}
