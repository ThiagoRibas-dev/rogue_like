import * as ROT from 'rot-js';
import type { EditorController } from '../editor_ui.ts';
import { runEncounterDirector, type DirectorReceipt } from '../../map/encounter_director.ts';
import { generateArea, type GeneratedArea } from '../../map/generator.ts';
import { runEncounterArena } from '../../editor/simulation/ai_arena.ts';
import type { CampaignData } from '../../types/campaign.types.ts';

// ─── Constants ──────────────────────────────────────────────────────────────
const MAP_CELL_SIZE = 6; // px per tile in the DOM mini-map
const AXIS_COLORS: Record<string, string> = {
  protein: '#e74c3c',
  appetizer: '#2ecc71',
  side: '#f39c12',
  dessert: '#9b59b6'
};
const DEFAULT_MAX_SIM_TURNS = 100;

// ─── Local state for the sandbox ────────────────────────────────────────────
let lastGenerated: GeneratedArea | null = null;

/**
 * Resolves tile color from campaign data for mini-map rendering.
 */
function getTileColor(campaign: CampaignData, tileId: string): string {
  const tileDef = campaign.tiles[tileId];
  if (tileDef?.bg) return tileDef.bg;
  if (tileId.includes('wall') || tileId === 'empty_space') return '#333';
  if (tileId.includes('water')) return '#2980b9';
  return '#555'; // default floor
}

/**
 * Resolves entity glyph/color from campaign data.
 */
function getEntityDisplay(campaign: CampaignData, templateId: string): { glyph: string; fg: string; bg: string } {
  const def = campaign.entities[templateId];
  return {
    glyph: def?.glyph ?? '?',
    fg: def?.fg ?? '#fff',
    bg: def?.bg ?? 'transparent'
  };
}

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
        <div style="margin-top: 0.25rem;">
          <button id="ds-generate-btn" class="editor-btn playtest-btn">⚙ Generate</button>
          <button id="ds-auto-sim-btn" class="editor-btn" style="margin-left: 4px;" disabled>🤖 Auto-Simulate</button>
          <button id="ds-play-btn" class="editor-btn playtest-btn" style="margin-left: 4px;" disabled>🎮 Play Encounter</button>
        </div>
      </div>

      <!-- Area info bar (shown after area is selected) -->
      <div id="ds-area-info" style="font-size: 0.8rem; color: var(--text-dim); display: none;"></div>

      <!-- Main Content: Map + Receipt -->
      <div style="display: flex; gap: 1rem; min-height: 400px;">
        <!-- Map Preview (Left) -->
        <div id="ds-map-container" style="flex: 1; background: var(--bg-darker); border: 1px solid var(--border-color); border-radius: 4px; padding: 0.5rem; overflow: auto; display: none;">
          <div style="font-size: 0.8rem; color: var(--text-dim); margin-bottom: 0.25rem;">
            <strong>Map Preview</strong>
            <span id="ds-map-stats" style="margin-left: 1rem;"></span>
          </div>
          <div id="ds-map-grid" style="display: grid; gap: 0; line-height: 1;"></div>
        </div>

        <!-- Receipt Panel (Right) -->
        <div id="ds-receipt-container" style="width: 360px; min-width: 320px; background: var(--bg-darker); border: 1px solid var(--border-color); border-radius: 4px; padding: 0.5rem; overflow-y: auto; display: none;">
          <div style="font-size: 0.8rem; color: var(--text-dim); margin-bottom: 0.25rem;">
            <strong>📋 Director Receipt</strong>
          </div>
          <div id="ds-receipt-content" style="font-size: 0.75rem;"></div>
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

  // Randomize seed button
  const randomSeedBtn = container.querySelector('#ds-random-seed-btn');
  randomSeedBtn?.addEventListener('click', () => {
    const seedInput = container.querySelector('#ds-seed-input') as HTMLInputElement;
    if (seedInput) {
      seedInput.value = String(Math.floor(Math.random() * 2147483647));
    }
  });

  // Area selection → update info
  const areaSelect = container.querySelector('#ds-area-select') as HTMLSelectElement;
  areaSelect?.addEventListener('change', () => {
    updateAreaInfo(controller, areaSelect.value);
  });

  // Generate button
  const genBtn = container.querySelector('#ds-generate-btn');
  genBtn?.addEventListener('click', () => {
    runGeneration(controller, container);
  });

  // Auto-Simulate button
  const simBtn = container.querySelector('#ds-auto-sim-btn');
  simBtn?.addEventListener('click', () => {
    runAutoSimulation(controller, container);
  });

  // Play Encounter button
  const playBtn = container.querySelector('#ds-play-btn');
  playBtn?.addEventListener('click', () => {
    if (lastGenerated) {
      window.dispatchEvent(new CustomEvent('PlaySandboxEncounter', { detail: { generatedArea: lastGenerated } }));
    }
  });
}

/**
 * Updates the area info bar when an area is selected.
 */
function updateAreaInfo(controller: EditorController, areaId: string): void {
  const infoBar = document.getElementById('ds-area-info');
  const mapContainer = document.getElementById('ds-map-container');
  const receiptContainer = document.getElementById('ds-receipt-container');
  const generateBtn = document.getElementById('ds-generate-btn') as HTMLButtonElement;

  if (!areaId) {
    if (infoBar) infoBar.style.display = 'none';
    if (mapContainer) mapContainer.style.display = 'none';
    if (receiptContainer) receiptContainer.style.display = 'none';
    if (generateBtn) generateBtn.disabled = true;
    return;
  }

  const doc = controller.getDocument();
  const area = doc.areas[areaId];
  if (!area || !infoBar) return;

  if (generateBtn) generateBtn.disabled = false;

  const tags = (area.tags ?? []).join(', ') || 'none';
  const subBiomes = area.subBiomes
    ? Object.entries(area.subBiomes)
        .map(([tag, prob]) => `${tag} (${(prob * 100).toFixed(0)}%)`)
        .join(', ')
    : 'none';
  const budgetText = area.budgetScaling
    ? `${area.budgetScaling.baseBudget} + ${area.budgetScaling.scalingFactor} × level`
    : String(area.crBudget ?? 0);

  infoBar.style.display = 'block';
  infoBar.innerHTML = `
    <strong>${area.name}</strong>
    &nbsp;|&nbsp; Budget: <code>${budgetText}</code>
    &nbsp;|&nbsp; Profile: <code>${area.encounterProfileId ?? '(none)'}</code>
    &nbsp;|&nbsp; Tags: <code>${tags}</code>
    &nbsp;|&nbsp; Sub-biomes: <code>${subBiomes}</code>
    &nbsp;|&nbsp; Generator: <code>${area.generatorType}</code>
  `;
}

/**
 * Runs the Encounter Director generation and renders the result.
 */
function runGeneration(controller: EditorController, container: HTMLElement): void {
  const areaSelect = container.querySelector('#ds-area-select') as HTMLSelectElement;
  const seedInput = container.querySelector('#ds-seed-input') as HTMLInputElement;
  const budgetInput = container.querySelector('#ds-budget-input') as HTMLInputElement;
  const profileSelect = container.querySelector('#ds-profile-select') as HTMLSelectElement;
  const playerLevelInput = container.querySelector('#ds-player-level') as HTMLInputElement;
  const simBtn = container.querySelector('#ds-auto-sim-btn') as HTMLButtonElement;

  const areaId = areaSelect.value;
  if (!areaId) return;

  const doc = controller.getDocument();
  const areaDef = doc.areas[areaId];
  if (!areaDef) return;

  const seed = parseInt(seedInput.value, 10) || Math.floor(Math.random() * 2147483647);
  const playerLevel = parseInt(playerLevelInput.value, 10) || 1;

  // Build a mutated area definition copy if overrides provided
  let effectiveAreaDef = areaDef;
  const budgetOverride = budgetInput.value ? parseInt(budgetInput.value, 10) : null;
  const profileOverride = profileSelect.value || null;

  if (budgetOverride !== null || profileOverride !== null) {
    effectiveAreaDef = {
      ...areaDef,
      ...(budgetOverride !== null ? { crBudget: budgetOverride } : {}),
      ...(profileOverride !== null ? { encounterProfileId: profileOverride } : {})
    };
  }

  // Save RNG state, set seed, generate, restore
  const savedState = ROT.RNG.getState();
  try {
    ROT.RNG.setSeed(seed);

    const context = { playerLevel, tokenPool: new Set<string>() };
    lastGenerated = generateArea(doc, areaId, context);

    // If overrides were used, re-run the encounter director with the overridden area def
    // (generateArea will use the area def from doc, not our mutated copy)
    if (budgetOverride !== null || profileOverride !== null) {
      const generatedMap = lastGenerated.map;
      const rooms = lastGenerated.rooms.map((r) => ({
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
        centerX: r.centerX,
        centerY: r.centerY
      }));

      const directorResult = runEncounterDirector(doc, effectiveAreaDef, generatedMap, rooms, [], context);
      lastGenerated = {
        ...lastGenerated,
        placedEntities: directorResult.newEntities,
        directorReceipt: directorResult.receipt
      };
    }
  } finally {
    ROT.RNG.setState(savedState);
  }

  // Render map
  renderMiniMap(container, controller.getDocument(), lastGenerated);
  // Render receipt
  if (lastGenerated.directorReceipt) {
    renderReceipt(container, controller.getDocument(), lastGenerated.directorReceipt);
  }

  // Enable simulate and play buttons
  const playBtn = document.getElementById('ds-play-btn') as HTMLButtonElement;
  if (simBtn && lastGenerated.placedEntities && lastGenerated.placedEntities.length > 0) {
    simBtn.disabled = false;
    if (playBtn) playBtn.disabled = false;
  } else {
    if (simBtn) simBtn.disabled = true;
    if (playBtn) playBtn.disabled = true;
  }

  // Show containers
  const mapContainer = document.getElementById('ds-map-container');
  const receiptContainer = document.getElementById('ds-receipt-container');
  if (mapContainer) mapContainer.style.display = 'block';
  if (receiptContainer) receiptContainer.style.display = 'block';

  // Hide previous sim results
  const simResults = document.getElementById('ds-sim-results');
  if (simResults) simResults.style.display = 'none';
}

/**
 * Renders the generated map as a DOM grid.
 */
function renderMiniMap(container: HTMLElement, campaign: CampaignData, result: GeneratedArea): void {
  const mapGrid = container.querySelector('#ds-map-grid') as HTMLElement;
  const mapStats = container.querySelector('#ds-map-stats');
  if (!mapGrid) return;

  const { map, rooms, portals, placedEntities, startPos, directorReceipt } = result;
  const entityPositions = new Map<string, string>(); // "x,y" → templateId
  if (placedEntities) {
    for (const e of placedEntities) {
      entityPositions.set(`${e.x},${e.y}`, e.templateId);
    }
  }

  // Mark start position
  const startKey = `${startPos.x},${startPos.y}`;

  // Portal positions
  const portalKeys = new Set<string>();
  for (const p of portals) {
    portalKeys.add(`${p.x},${p.y}`);
  }

  // Room region tracking for highlighting
  const roomKeys = new Set<string>();
  for (const r of rooms) {
    for (let y = r.top; y <= r.bottom; y++) {
      for (let x = r.left; x <= r.right; x++) {
        roomKeys.add(`${x},${y}`);
      }
    }
  }

  // Build grid
  mapGrid.style.gridTemplateColumns = `repeat(${map.width}, ${MAP_CELL_SIZE}px)`;
  mapGrid.innerHTML = '';

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const idx = y * map.width + x;
      const tile = map.tiles[idx];
      const cell = document.createElement('div');
      cell.style.width = `${MAP_CELL_SIZE}px`;
      cell.style.height = `${MAP_CELL_SIZE}px`;
      cell.style.fontSize = `${MAP_CELL_SIZE - 1}px`;
      cell.style.lineHeight = `${MAP_CELL_SIZE}px`;
      cell.style.textAlign = 'center';
      cell.style.boxSizing = 'border-box';

      // Tile background color
      if (tile) {
        cell.style.backgroundColor = getTileColor(campaign, tile.tileId);
      } else {
        cell.style.backgroundColor = '#111';
      }

      // Room highlight (subtle)
      const key = `${x},${y}`;
      if (roomKeys.has(key) && !tile?.tileId.includes('wall')) {
        cell.style.backgroundColor = lightenColor(cell.style.backgroundColor, 10);
      }

      // Entity overlay
      const entityId = entityPositions.get(key);
      if (entityId) {
        const display = getEntityDisplay(campaign, entityId);
        cell.textContent = display.glyph;
        cell.style.color = display.fg;
        cell.style.fontWeight = 'bold';
        cell.title = entityId;

        // Check for dynamic traits
        const placedEntity = placedEntities?.find((e) => e.x === x && e.y === y);
        if (placedEntity?.dynamicTraits && placedEntity.dynamicTraits.length > 0) {
          cell.style.outline = '1px solid #f1c40f';
          cell.title += ` [${placedEntity.dynamicTraits.join(', ')}]`;
        }
      }

      // Portal overlay (glyph takes precedence)
      if (portalKeys.has(key)) {
        cell.textContent = '🌀';
        cell.title = 'Portal / Transition';
      }

      // Start position marker
      if (key === startKey) {
        if (!entityId) {
          cell.textContent = '@';
          cell.style.color = '#2ecc71';
          cell.title = 'Player Start';
        }
        cell.style.outline = '1px solid #2ecc71';
      }

      mapGrid.appendChild(cell);
    }
  }

  // Update stats
  if (mapStats) {
    const entityCount = placedEntities?.length ?? 0;
    const totalBudget = directorReceipt?.effectiveBudget ?? 0;
    const totalSpent = Object.values(directorReceipt?.axisResults ?? {}).reduce((s, a) => s + a.spent, 0);
    const totalRooms = rooms.length;
    mapStats.textContent = `🗺 ${map.width}×${map.height} | 🚪 ${totalRooms} rooms | 👾 ${entityCount} entities | 💰 ${totalSpent}/${totalBudget} CR spent`;
  }
}

/**
 * Renders the Director Receipt panel with candidate explanations.
 */
function renderReceipt(_container: HTMLElement, campaign: CampaignData, receipt: DirectorReceipt): void {
  const content = document.getElementById('ds-receipt-content');
  if (!content) return;

  const { axisResults, effectiveBudget, preAllocated, traitUpgrades } = receipt;

  // Build HTML
  const parts: string[] = [];

  // Budget summary
  const totalSpent = Object.values(axisResults).reduce((s, a) => s + a.spent, 0);
  parts.push(`
    <div style="margin-bottom: 0.5rem; padding: 0.25rem 0.5rem; background: rgba(255,255,255,0.05); border-radius: 3px;">
      <strong>Budget Summary</strong><br/>
      Total: <code>${effectiveBudget}</code> CR
      &nbsp;|&nbsp; Spent: <code>${totalSpent}</code> CR
      &nbsp;|&nbsp; Pre-allocated: <code>${preAllocated}</code> CR
      &nbsp;|&nbsp; Remaining: <code style="color: ${effectiveBudget - totalSpent > 0 ? '#f39c12' : '#888'}">${effectiveBudget - totalSpent}</code>
    </div>
  `);

  // Per-axis breakdown
  for (const axis of ['protein', 'appetizer', 'side', 'dessert'] as const) {
    const result = axisResults[axis];
    const color = AXIS_COLORS[axis] ?? '#888';
    const pct = result.budget > 0 ? Math.round((result.spent / result.budget) * 100) : 0;

    parts.push(`
      <div style="margin-bottom: 0.5rem; border-left: 3px solid ${color}; padding-left: 0.5rem;">
        <div style="display: flex; justify-content: space-between; font-weight: bold;">
          <span style="text-transform: capitalize;">${axis}</span>
          <span style="color: ${color};">${result.spent} / ${result.budget} CR (${pct}%)</span>
        </div>
        <div style="background: #333; height: 6px; border-radius: 3px; margin: 2px 0 4px 0;">
          <div style="background: ${color}; width: ${Math.min(pct, 100)}%; height: 100%; border-radius: 3px;"></div>
        </div>
    `);

    // Spawned entities
    if (result.candidates.filter((c) => c.disposition === 'spawned').length > 0) {
      parts.push(`<div style="font-size: 0.7rem; color: #2ecc71; margin-bottom: 2px;">✓ Spawned:</div>`);
      for (const c of result.candidates) {
        if (c.disposition !== 'spawned') continue;
        const def = campaign.entities[c.templateId];
        const name = def?.name ?? c.templateId;
        parts.push(
          `<div style="font-size: 0.65rem; padding-left: 0.5rem; color: #ccc;"> &bull; ${name} (${c.cost} CR) ${c.reasonDetail ?? ''}</div>`
        );
      }
    }

    // Rejected candidates
    const rejected = result.candidates.filter((c) => c.disposition !== 'spawned');
    if (rejected.length > 0) {
      parts.push(
        `<div style="font-size: 0.7rem; color: #e74c3c; margin-top: 2px; margin-bottom: 2px;">✗ Rejected (${rejected.length}):</div>`
      );
      for (const c of rejected) {
        const def = campaign.entities[c.templateId];
        const name = def?.name ?? c.templateId;
        const reasonLabel = getDispositionLabel(c.disposition);
        parts.push(
          `<div style="font-size: 0.65rem; padding-left: 0.5rem; color: #999;"> &bull; ${name} (${c.cost} CR) &mdash; <span style="color: #e74c3c;">${reasonLabel}</span></div>`
        );
      }
    }

    parts.push(`</div>`);
  }

  // Trait upgrades
  if (traitUpgrades.length > 0) {
    parts.push(`
      <div style="margin-bottom: 0.5rem; padding: 0.25rem 0.5rem; background: rgba(241, 196, 15, 0.1); border-radius: 3px;">
        <strong style="color: #f1c40f;">✦ Budget Padding — Dynamic Traits</strong><br/>
        ${traitUpgrades.map((t) => `<span style="font-size: 0.7rem;">• ${t}</span>`).join('<br/>')}
      </div>
    `);
  }

  content.innerHTML = parts.join('\n');
}

/**
 * Gets a human-readable label for a candidate disposition.
 */
function getDispositionLabel(disposition: string): string {
  switch (disposition) {
    case 'too_expensive':
      return 'Too expensive for remaining budget';
    case 'token_exhausted':
      return 'Unique/token limit reached';
    case 'no_space':
      return 'No available floor tile in room';
    case 'pool_filtered':
      return 'Pool conditions did not match';
    default:
      return disposition;
  }
}

/**
 * Runs the auto-simulation of the generated encounter.
 */
function runAutoSimulation(controller: EditorController, _container: HTMLElement): void {
  if (!lastGenerated || !lastGenerated.placedEntities || lastGenerated.placedEntities.length === 0) {
    return;
  }

  const simResults = document.getElementById('ds-sim-results');
  const simContent = document.getElementById('ds-sim-content');
  const simStatus = document.getElementById('ds-sim-status');
  if (!simResults || !simContent || !simStatus) return;

  simResults.style.display = 'block';
  simStatus.textContent = '⏳ Running simulations...';
  simContent.innerHTML = '';

  const doc = controller.getDocument();
  const map = lastGenerated.map;

  // Find the player entity template (first actor without roleTags or with "player" tag)
  const playerTemplateId =
    Object.entries(doc.entities).find(([, e]) => e.tags?.includes('actor') && e.roleTags?.includes('protein'))?.[0] ??
    'goblin'; // fallback

  const startPos = lastGenerated.startPos;

  // Defer to allow UI update
  setTimeout(() => {
    try {
      const result = runEncounterArena(
        playerTemplateId,
        lastGenerated!.placedEntities!.map((e) => ({ templateId: e.templateId, x: e.x, y: e.y })),
        doc,
        { width: map.width, height: map.height, tiles: map.tiles },
        startPos,
        DEFAULT_MAX_SIM_TURNS
      );

      simStatus.textContent = '';
      const agg = result.aggregate;

      simContent.innerHTML = `
        <div style="display: flex; gap: 1rem; flex-wrap: wrap;">
          <div style="background: rgba(255,255,255,0.05); padding: 0.75rem; border-radius: 4px; min-width: 120px; text-align: center;">
            <div style="font-size: 1.2rem; font-weight: bold; color: ${agg.playerWins > agg.enemyWins ? '#2ecc71' : '#e74c3c'};">${agg.playerWins}</div>
            <div style="font-size: 0.7rem; color: var(--text-dim);">Player Wins</div>
          </div>
          <div style="background: rgba(255,255,255,0.05); padding: 0.75rem; border-radius: 4px; min-width: 120px; text-align: center;">
            <div style="font-size: 1.2rem; font-weight: bold; color: #e74c3c;">${agg.enemyWins}</div>
            <div style="font-size: 0.7rem; color: var(--text-dim);">Enemy Wins</div>
          </div>
          <div style="background: rgba(255,255,255,0.05); padding: 0.75rem; border-radius: 4px; min-width: 120px; text-align: center;">
            <div style="font-size: 1.2rem; font-weight: bold;">${agg.draws}</div>
            <div style="font-size: 0.7rem; color: var(--text-dim);">Draws</div>
          </div>
          <div style="background: rgba(255,255,255,0.05); padding: 0.75rem; border-radius: 4px; min-width: 120px; text-align: center;">
            <div style="font-size: 1.2rem; font-weight: bold;">${agg.avgTurns.toFixed(1)}</div>
            <div style="font-size: 0.7rem; color: var(--text-dim);">Avg Turns</div>
          </div>
          <div style="background: rgba(255,255,255,0.05); padding: 0.75rem; border-radius: 4px; min-width: 120px; text-align: center;">
            <div style="font-size: 1.2rem; font-weight: bold; color: #2ecc71;">${agg.avgPlayerHpRemaining.toFixed(1)}</div>
            <div style="font-size: 0.7rem; color: var(--text-dim);">Avg Player HP Remaining</div>
          </div>
        </div>
        <div style="margin-top: 0.75rem; font-size: 0.7rem; color: var(--text-dim);">
          Simulated ${result.results.length} engagements vs. spawned entities (max ${DEFAULT_MAX_SIM_TURNS} turns each).
        </div>
      `;
    } catch (err) {
      console.error(err);
      simContent.innerHTML = `<div style="color: #e74c3c;">Simulation Error: ${(err as Error).message}</div>`;
    } finally {
      simStatus.textContent = '';
    }
  }, 50);
}

/**
 * Lightens a CSS color string by a percentage.
 */
function lightenColor(color: string, percent: number): string {
  const hex = color.replace('#', '');
  if (hex.length < 6) return color;
  const num = parseInt(hex, 16);
  const r = Math.min(255, ((num >> 16) & 0xff) + percent);
  const g = Math.min(255, ((num >> 8) & 0xff) + percent);
  const b = Math.min(255, (num & 0xff) + percent);
  return `rgb(${r},${g},${b})`;
}
