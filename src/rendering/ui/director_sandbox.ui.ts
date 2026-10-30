import { rng } from '../../core/rng.ts';
import type { EditorController } from '../editor_ui.ts';
import type { GeneratedArea } from '../../map/generator.ts';
import { updateAreaInfo, runGeneration, handleBakeArea, runAutoSimulation } from './director/director_controls.ts';

export {
  renderMiniMap,
  renderReceipt,
  updateJsonPreview,
  buildBakedStaticArea,
  getTileColor,
  getEntityDisplay,
  lightenColor,
  getDispositionLabel,
  MAP_CELL_SIZE,
  AXIS_COLORS
} from './director/director_telemetry_view.ts';

export {
  updateAreaInfo,
  runGeneration,
  handleBakeArea,
  runAutoSimulation,
  DEFAULT_MAX_SIM_TURNS
} from './director/director_controls.ts';

// ─── Local state for the sandbox ────────────────────────────────────────────
let lastGenerated: GeneratedArea | null = null;

/**
 * Renders the Encounter Director Sandbox panel.
 *
 * @param controller The CampaignEditor controller.
 * @param container  The DOM container to render into.
 */
export function renderDirectorSandbox(controller: EditorController, container: HTMLElement): void {
  const doc = controller.getDocument();
  const areas = doc.areas ?? {};
  const profiles = doc.encounterProfiles ?? {};

  // Collect areas that have encounter profiling configured
  const directorAreas = Object.entries(areas).filter(([, area]) => area.encounterProfileId || area.crBudget);

  const areaOptions = directorAreas.map(([id, area]) => `<option value="${id}">${area.name} (${id})</option>`).join('');
  const profileOptions = Object.entries(profiles)
    .map(([id, p]) => `<option value="${id}">${p.name} (${id})</option>`)
    .join('');

  // Full sandbox layout
  container.innerHTML = `
    <div class="workspace-header">
      <h2 class="workspace-title">🎲 Encounter Director Sandbox</h2>
    </div>
    <div style="padding: 1rem; display: flex; flex-direction: column; gap: 1rem; height: 100%; overflow-y: auto;">

      <!-- Configuration Bar -->
      <div class="sandbox-config-bar" style="display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: end; background: var(--bg-darker); border: 1px solid var(--border-color); border-radius: 4px; padding: 0.75rem;">
        <div>
          <label style="display: block; font-size: 0.75rem; color: var(--text-dim); margin-bottom: 0.2rem;">Area</label>
          <select id="ds-area-select" class="editor-input" style="min-width: 180px;">
            <option value="">— Select an Area —</option>
            ${areaOptions}
          </select>
        </div>
        <div>
          <label style="display: block; font-size: 0.75rem; color: var(--text-dim); margin-bottom: 0.2rem;">Seed</label>
          <div style="display: flex; gap: 4px;">
            <input type="number" id="ds-seed-input" class="editor-input" style="width: 120px;" value="0" />
            <button id="ds-random-seed-btn" class="editor-btn" style="padding: 2px 8px;" title="Randomize seed">🎲</button>
          </div>
        </div>
        <div>
          <label style="display: block; font-size: 0.75rem; color: var(--text-dim); margin-bottom: 0.2rem;">Budget Override</label>
          <input type="number" id="ds-budget-input" class="editor-input" style="width: 100px;" placeholder="(use area default)" />
        </div>
        <div>
          <label style="display: block; font-size: 0.75rem; color: var(--text-dim); margin-bottom: 0.2rem;">Profile Override</label>
          <select id="ds-profile-select" class="editor-input" style="min-width: 160px;">
            <option value="">(use area default)</option>
            ${profileOptions}
          </select>
        </div>
        <div>
          <label style="display: block; font-size: 0.75rem; color: var(--text-dim); margin-bottom: 0.2rem;">Player Level</label>
          <input type="number" id="ds-player-level" class="editor-input" style="width: 70px;" value="1" min="1" max="20" />
        </div>
        <div style="margin-top: 0.25rem; display: flex; gap: 4px; align-items: center;">
          <button id="ds-generate-btn" class="editor-btn playtest-btn">⚙ Generate</button>
          <button id="ds-bake-btn" class="editor-btn playtest-btn" disabled>💾 Bake Static Area</button>
          <button id="ds-auto-sim-btn" class="editor-btn" disabled>🤖 Auto-Simulate</button>
          <button id="ds-play-btn" class="editor-btn playtest-btn" disabled>🎮 Play Encounter</button>
        </div>
      </div>

      <!-- Area info bar (shown after area is selected) -->
      <div id="ds-area-info" style="font-size: 0.8rem; color: var(--text-dim); display: none;"></div>

      <!-- Main Content: Map + Tabbed Receipt/JSON -->
      <div style="display: flex; gap: 1rem; min-height: 400px;">
        <!-- Map Preview (Left) -->
        <div id="ds-map-container" style="flex: 1; background: var(--bg-darker); border: 1px solid var(--border-color); border-radius: 4px; padding: 0.5rem; overflow: auto; display: none;">
          <div style="font-size: 0.8rem; color: var(--text-dim); margin-bottom: 0.25rem;">
            <strong>Map Preview</strong>
            <span id="ds-map-stats" style="margin-left: 1rem;"></span>
          </div>
          <div id="ds-map-grid" style="display: grid; gap: 0; line-height: 1;"></div>
        </div>

        <!-- Tabbed Panel (Right) -->
        <div id="ds-right-panel" style="width: 360px; min-width: 320px; display: flex; flex-direction: column; gap: 0.5rem; display: none;">
          <div style="display: flex; gap: 4px; border-bottom: 1px solid var(--border-color); padding-bottom: 4px;">
            <button id="ds-tab-receipt" class="editor-btn" style="padding: 4px 8px; font-size: 0.75rem; border-color: #6c5ce7;">📋 Receipt</button>
            <button id="ds-tab-json" class="editor-btn" style="padding: 4px 8px; font-size: 0.75rem;">📝 View JSON</button>
          </div>
          
          <!-- Receipt Panel -->
          <div id="ds-receipt-container" style="flex: 1; background: var(--bg-darker); border: 1px solid var(--border-color); border-radius: 4px; padding: 0.5rem; overflow-y: auto;">
            <div id="ds-receipt-content" style="font-size: 0.75rem;"></div>
          </div>

          <!-- JSON Inspector Panel -->
          <div id="ds-json-container" style="flex: 1; background: #0c0c16; border: 1px solid var(--border-color); border-radius: 4px; padding: 0.5rem; overflow-y: auto; display: none;">
            <pre id="ds-json-content" style="font-family: monospace; font-size: 0.7rem; color: #a6e22e; margin: 0; white-space: pre-wrap; word-break: break-all;"></pre>
          </div>
        </div>
      </div>

      <!-- Simulation Results (below) -->
      <div id="ds-sim-results" style="display: none; background: var(--bg-darker); border: 1px solid var(--border-color); border-radius: 4px; padding: 0.75rem;">
        <div style="font-size: 0.8rem; color: var(--text-dim); margin-bottom: 0.25rem;">
          <strong>🤖 Auto-Simulation Results</strong>
          <span id="ds-sim-status" style="margin-left: 1rem; font-style: italic;"></span>
        </div>
        <div id="ds-sim-content"></div>
      </div>
    </div>
  `;

  // ─── Wire up event handlers ──────────────────────────────────────────────

  // Tab switching
  const tabReceipt = container.querySelector('#ds-tab-receipt') as HTMLButtonElement | null;
  const tabJson = container.querySelector('#ds-tab-json') as HTMLButtonElement | null;
  const receiptPanel = container.querySelector('#ds-receipt-container') as HTMLElement | null;
  const jsonPanel = container.querySelector('#ds-json-container') as HTMLElement | null;

  tabReceipt?.addEventListener('click', () => {
    if (receiptPanel) receiptPanel.style.display = 'block';
    if (jsonPanel) jsonPanel.style.display = 'none';
    if (tabReceipt) tabReceipt.style.borderColor = '#6c5ce7';
    if (tabJson) tabJson.style.borderColor = 'rgba(255, 255, 255, 0.1)';
  });

  tabJson?.addEventListener('click', () => {
    if (receiptPanel) receiptPanel.style.display = 'none';
    if (jsonPanel) jsonPanel.style.display = 'block';
    if (tabJson) tabJson.style.borderColor = '#6c5ce7';
    if (tabReceipt) tabReceipt.style.borderColor = 'rgba(255, 255, 255, 0.1)';
  });

  // Randomize seed button
  const randomSeedBtn = container.querySelector('#ds-random-seed-btn');
  randomSeedBtn?.addEventListener('click', () => {
    const seedInput = container.querySelector('#ds-seed-input') as HTMLInputElement | null;
    if (seedInput) {
      seedInput.value = String(Math.floor(rng.getUniform() * 2147483647));
    }
  });

  // Area selection → update info
  const areaSelect = container.querySelector('#ds-area-select') as HTMLSelectElement | null;
  areaSelect?.addEventListener('change', () => {
    if (areaSelect) {
      updateAreaInfo(controller, areaSelect.value);
    }
  });

  // Generate button
  const genBtn = container.querySelector('#ds-generate-btn');
  genBtn?.addEventListener('click', () => {
    runGeneration(controller, container, (generated) => {
      lastGenerated = generated;
    });
  });

  // Bake button
  const bakeBtn = container.querySelector('#ds-bake-btn') as HTMLButtonElement | null;
  bakeBtn?.addEventListener('click', () => {
    const areaId = areaSelect?.value;
    if (!lastGenerated || !areaId) return;
    handleBakeArea(controller, areaId, lastGenerated);
  });

  // Auto-Simulate button
  const simBtn = container.querySelector('#ds-auto-sim-btn');
  simBtn?.addEventListener('click', () => {
    if (lastGenerated) {
      runAutoSimulation(controller, lastGenerated);
    }
  });

  // Play Encounter button
  const playBtn = container.querySelector('#ds-play-btn');
  playBtn?.addEventListener('click', () => {
    if (lastGenerated) {
      window.dispatchEvent(new CustomEvent('PlaySandboxEncounter', { detail: { generatedArea: lastGenerated } }));
    }
  });
}
