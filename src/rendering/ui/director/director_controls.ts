import * as ROT from 'rot-js';
import { rng } from '../../../core/rng.ts';
import type { EditorController } from '../../editor_ui.ts';
import { runEncounterDirector } from '../../../map/encounter_director.ts';
import { generateArea, type GeneratedArea } from '../../../map/generator.ts';
import { runEncounterArena } from '../../../editor/simulation/ai_arena.ts';
import { renderMiniMap, renderReceipt, updateJsonPreview, buildBakedStaticArea } from './director_telemetry_view.ts';

export const DEFAULT_MAX_SIM_TURNS = 100;

/**
 * Updates the area info bar when an area is selected.
 */
export function updateAreaInfo(controller: EditorController, areaId: string): void {
  const infoBar = document.getElementById('ds-area-info');
  const mapContainer = document.getElementById('ds-map-container');
  const receiptContainer = document.getElementById('ds-receipt-container');
  const generateBtn = document.getElementById('ds-generate-btn') as HTMLButtonElement | null;

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
export function runGeneration(
  controller: EditorController,
  container: HTMLElement,
  onGenerated: (area: GeneratedArea) => void
): GeneratedArea | null {
  const areaSelect = container.querySelector('#ds-area-select') as HTMLSelectElement | null;
  const seedInput = container.querySelector('#ds-seed-input') as HTMLInputElement | null;
  const budgetInput = container.querySelector('#ds-budget-input') as HTMLInputElement | null;
  const profileSelect = container.querySelector('#ds-profile-select') as HTMLSelectElement | null;
  const playerLevelInput = container.querySelector('#ds-player-level') as HTMLInputElement | null;
  const simBtn = container.querySelector('#ds-auto-sim-btn') as HTMLButtonElement | null;

  const areaId = areaSelect?.value;
  if (!areaId) return null;

  const doc = controller.getDocument();
  const areaDef = doc.areas[areaId];
  if (!areaDef) return null;

  const seed = (seedInput ? parseInt(seedInput.value, 10) : 0) || Math.floor(rng.getUniform() * 2147483647);
  const playerLevel = (playerLevelInput ? parseInt(playerLevelInput.value, 10) : 1) || 1;

  // Build a mutated area definition copy if overrides provided
  let effectiveAreaDef = areaDef;
  const budgetOverride = budgetInput?.value ? parseInt(budgetInput.value, 10) : null;
  const profileOverride = profileSelect?.value || null;

  if (budgetOverride !== null || profileOverride !== null) {
    effectiveAreaDef = {
      ...areaDef,
      ...(budgetOverride !== null ? { crBudget: budgetOverride } : {}),
      ...(profileOverride !== null ? { encounterProfileId: profileOverride } : {})
    };
  }

  // Save RNG state, set seed, generate, restore
  let generated: GeneratedArea;
  const savedState = ROT.RNG.getState();
  try {
    ROT.RNG.setSeed(seed);

    const context = { playerLevel, tokenPool: new Set<string>() };
    generated = generateArea(doc, areaId, context);

    // If overrides were used, re-run the encounter director with the overridden area def
    if (budgetOverride !== null || profileOverride !== null) {
      const generatedMap = generated.map;
      const rooms = generated.rooms.map((r) => ({
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
        centerX: r.centerX,
        centerY: r.centerY
      }));

      const directorResult = runEncounterDirector(doc, effectiveAreaDef, generatedMap, rooms, [], context);
      generated = {
        ...generated,
        placedEntities: directorResult.newEntities,
        directorReceipt: directorResult.receipt
      };
    }
  } finally {
    ROT.RNG.setState(savedState);
  }

  // Render map
  renderMiniMap(container, doc, generated);

  // Render receipt
  if (generated.directorReceipt) {
    renderReceipt(container, doc, generated.directorReceipt);
  }

  // Update JSON Preview
  updateJsonPreview(container, areaId, areaDef, generated);

  // Enable simulate, play, and bake buttons
  const playBtn = document.getElementById('ds-play-btn') as HTMLButtonElement | null;
  const bakeBtn = document.getElementById('ds-bake-btn') as HTMLButtonElement | null;
  if (bakeBtn) bakeBtn.disabled = false;
  if (simBtn && generated.placedEntities && generated.placedEntities.length > 0) {
    simBtn.disabled = false;
    if (playBtn) playBtn.disabled = false;
  }

  // Show containers
  const mapContainer = document.getElementById('ds-map-container');
  const rightPanel = document.getElementById('ds-right-panel');
  if (mapContainer) mapContainer.style.display = 'block';
  if (rightPanel) rightPanel.style.display = 'flex';

  // Hide previous sim results
  const simResults = document.getElementById('ds-sim-results');
  if (simResults) simResults.style.display = 'none';

  onGenerated(generated);
  return generated;
}

/**
 * Bakes the currently generated area into the campaign as a static area.
 */
export function handleBakeArea(controller: EditorController, areaId: string, generated: GeneratedArea): void {
  const doc = controller.getDocument();
  const areaDef = doc.areas[areaId];
  if (!areaDef) return;

  const newId = prompt('Enter a unique ID for the baked static area:', `${areaId}_baked`);
  if (!newId) return;
  if (!/^[a-z0-9_-]+$/.test(newId)) {
    alert('ID must be lowercase alphanumeric, dashes, or underscores.');
    return;
  }
  if (doc.areas[newId] && !confirm(`An area with ID '${newId}' already exists. Overwrite?`)) {
    return;
  }

  const staticArea = buildBakedStaticArea(newId, areaDef, generated);

  controller.applyOperations([
    {
      op: 'add',
      path: `/areas/${newId}`,
      value: staticArea
    }
  ]);

  alert(`Area '${newId}' successfully baked into the campaign as a static map!`);

  // Navigate to the new area in the editor
  const areasBtn = document.querySelector('[data-target="areas"]') as HTMLButtonElement | null;
  if (areasBtn) {
    sessionStorage.setItem('editor_active_category', 'areas');
    sessionStorage.setItem('editor_active_item', newId);
    areasBtn.click();
  }
}

/**
 * Runs the auto-simulation of the generated encounter.
 */
export function runAutoSimulation(controller: EditorController, generated: GeneratedArea): void {
  if (!generated.placedEntities || generated.placedEntities.length === 0) {
    return;
  }

  const simResults = document.getElementById('ds-sim-results');
  const simContent = document.getElementById('ds-sim-content');
  const simStatus = document.getElementById('ds-sim-status');
  if (!simResults || !simContent || !simStatus) return;

  simResults.style.display = 'block';
  simStatus.textContent = '⏳ Running simulations...';
  simContent.replaceChildren();

  const doc = controller.getDocument();
  const map = generated.map;

  // Find the player entity template (first actor without roleTags or with "player" tag)
  const playerTemplateId =
    Object.entries(doc.entities).find(([, e]) => e.tags?.includes('actor') && e.roleTags?.includes('protein'))?.[0] ??
    'goblin'; // fallback

  const startPos = generated.startPos;

  // Defer to allow UI update
  setTimeout(() => {
    try {
      const result = runEncounterArena(
        playerTemplateId,
        generated.placedEntities!.map((e) => ({ templateId: e.templateId, x: e.x, y: e.y })),
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
