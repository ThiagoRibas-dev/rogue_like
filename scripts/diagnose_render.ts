/**
 * Headless render-pipeline diagnostic.
 *
 * Runs the exact map-generation → player-spawn → FOV → viewport-snapshot chain
 * against the real campaign JSONs (no DOM, no canvas) and reports whether the
 * data that feeds the canvas renderer is sane.
 *
 * Usage:
 *   bun scripts/diagnose_render.ts            # default campaign
 *   bun scripts/diagnose_render.ts --all      # all campaigns
 *   bun scripts/diagnose_render.ts megacampaign shroudgarde
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CampaignDataSchema, CampaignCategorySchemas } from '../src/types/campaign.types.ts';
import type { CampaignData } from '../src/types/campaign.types.ts';
import { generateArea } from '../src/map/generator.ts';
import { updateExploredTiles } from '../src/systems/map.system.ts';
import { buildViewportSnapshot } from '../src/rendering/viewport_snapshot.ts';
import { render } from '../src/rendering/renderer.ts';
import { mountDisplayWithFogOverlay } from '../src/rendering/display.ts';
import { initRNG } from '../src/core/rng.ts';
import { spawnEntity, getComponent, queryEntities } from '../src/core/ecs.ts';
import { ComponentType } from '../src/types/components.types.ts';
import { type GameState, UIMode, EngineMode } from '../src/types/game-state.types.ts';
import { DEFAULT_GLOBAL_DRAMA_BUDGET } from '../src/constants/pacing.constants.ts';
import { consumeDirtyDomains, markDirtyFromStateDiff, PresentationDomain } from '../src/core/presentation_queue.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CAMPAIGNS_ROOT = join(ROOT, 'public', 'data', 'campaigns');

function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

const CATEGORY_FILE_OVERRIDES: Partial<Record<keyof CampaignData, string>> = {
  schemeRecipes: 'schemes.json'
};

/** Loads a campaign from disk by assembling its category JSON files (mirrors the runtime loader). */
function loadCampaignFromDisk(id: string): CampaignData {
  const dir = join(CAMPAIGNS_ROOT, id);
  const assembled: Record<string, unknown> = {};
  const missing: string[] = [];

  for (const key of Object.keys(CampaignCategorySchemas) as (keyof CampaignData)[]) {
    if (key === 'triggerBuckets') continue;
    const filename = CATEGORY_FILE_OVERRIDES[key] ?? `${toSnakeCase(key)}.json`;
    const filePath = join(dir, filename);
    if (!existsSync(filePath)) {
      missing.push(filename);
      continue;
    }
    assembled[key] = JSON.parse(readFileSync(filePath, 'utf-8'));
  }

  return CampaignDataSchema.parse(assembled);
}

/**
 * Builds a minimal-but-complete GameState the same way startNewGame does:
 * generate the starting area, spawn the literal 'player' template, then FOV.
 * (No factions/areas/mastermind pre-seeding — those are irrelevant to canvas rendering.)
 */
function buildGameState(campaign: CampaignData): GameState {
  const startingAreaId = campaign.rules.map.startingAreaId;
  const { map, startPos, rooms } = generateArea(campaign, startingAreaId);

  let state: GameState = {
    campaignId: 'diagnostic',
    campaign,
    dynamicQuests: {},
    entities: [],
    components: new Map(),
    map,
    nextEntityId: 1,
    nextItemInstanceId: 1,
    nextQuestId: 1,
    messages: [],
    events: [],
    currentAreaId: startingAreaId,
    areas: new Map(),
    persistentEntities: new Map(),
    spatialIndex: new Map(),
    isGameOver: false,
    uiMode: UIMode.Game,
    identifiedItems: new Set(),
    itemUnidentifiedNames: new Map(),
    engineMode: EngineMode.TurnBased,
    visualEffects: [],
    rtwpState: { paused: false, speedMultiplier: 1 },
    isRotated: false,
    is3D: false,
    zoomLevel: 1.0,
    fovNeedsUpdate: true,
    cachedFov: new Set(),
    playerCommandQueue: [],
    activeRooms: rooms,
    lastSpawnTurn: 0,
    pendingKnowledge: [],
    pendingRumors: [],
    pendingRivalries: [],
    factionEntityIds: {},
    areaEntityIds: {},
    investigation: { knownActors: [], exposedAgreements: [], lastClueTurn: 0 },
    historicalLedger: [],
    nemesisSlots: {},
    vacancyTurns: {},
    globalTurn: 0,
    lastCheatDeathTurn: -9999,
    dramaTracker: {
      globalBudget: DEFAULT_GLOBAL_DRAMA_BUDGET,
      domainBudgets: {},
      activeCooldowns: {},
      lastMajorEventTurn: 0
    },
    telemetry: {
      playerDeaths: 0,
      damageTaken: 0,
      resourcesConsumed: 0,
      questsCompleted: 0
    }
  };

  // Mirror startNewGame: spawn the literal 'player' template.
  state = spawnEntity(state, 'player', startPos.x, startPos.y)[0];
  return state;
}

/** Diagnoses the render-input pipeline for one campaign and returns a summary line. */
function diagnoseCampaign(id: string): void {
  console.log(`\n════════ ${id} ════════`);

  const campaign = loadCampaignFromDisk(id);
  const startingAreaId = campaign.rules.map.startingAreaId;
  console.log(`  startingAreaId: ${startingAreaId}`);
  console.log(`  map rules: ${campaign.rules.map.width}x${campaign.rules.map.height}, fovRadius=${campaign.rules.map.fovRadius}`);
  console.log(`  theme.ui: ${campaign.theme.ui.displayWidth}x${campaign.theme.ui.displayHeight}`);

  const state: GameState = buildGameState(campaign);

  console.log(`  generated map: ${state.map.width}x${state.map.height}, ${state.map.tiles.length} tiles`);
  const wallCount = state.map.tiles.filter((t) => t.tileId === 'stone_wall').length;
  const floorCount = state.map.tiles.length - wallCount;
  console.log(`  tiles: ${floorCount} non-wall, ${wallCount} wall`);

  const players = queryEntities(state, [ComponentType.Player, ComponentType.Position]);
  const playerId = players[0];
  const playerPos = playerId !== undefined ? getComponent(state, playerId, ComponentType.Position) : undefined;
  console.log(`  player: id=${playerId ?? 'MISSING'}, pos=${playerPos ? `${playerPos.x},${playerPos.y}` : 'MISSING'}`);

  const withFov = updateExploredTiles(state);
  const exploredTiles = withFov.map.tiles.filter((t) => t.explored).length;
  console.log(`  FOV: cachedFov.size=${withFov.cachedFov.size}, exploredTiles=${exploredTiles}`);

  const vw = campaign.theme.ui.displayWidth;
  const vh = campaign.theme.ui.displayHeight;
  const snap = buildViewportSnapshot(withFov, vw, vh);

  let exploredCells = 0;
  let visibleCells = 0;
  let drawnGlyphCells = 0;
  let entityCells = 0;
  for (const cell of snap.cells) {
    if (cell.isExplored) exploredCells++;
    if (cell.isVisible) visibleCells++;
    if (cell.glyph !== ' ' && cell.glyph !== '') drawnGlyphCells++;
    if (cell.entities.length > 0) entityCells++;
  }

  console.log(`  snapshot: ${snap.cells.length} cells (${vw}x${vh}), camera=(${snap.cameraX},${snap.cameraY})`);
  console.log(`  explored=${exploredCells}, visible=${visibleCells}, drawnGlyph=${drawnGlyphCells}, entityCells=${entityCells}`);
  console.log(`  isSpriteMode=${snap.isSpriteMode}`);

  // Feed the snapshot through the real renderer against a mock ROT.Display to
  // verify that draw() calls are actually emitted for explored cells.
  const draws: Array<{ x: number; y: number; glyph: string }> = [];
  const mockDisplay = {
    getOptions: () => ({ width: vw, height: vh, tileMap: undefined }),
    clear: () => {},
    draw: (x: number, y: number, glyph: unknown, _fg: unknown, _bg: unknown) => {
      const g = Array.isArray(glyph) ? (glyph[0] as string) : String(glyph);
      draws.push({ x, y, glyph: g });
    }
  };
  render(mockDisplay as never, snap, undefined);
  console.log(`  renderer: emitted ${draws.length} draw() calls (explored cells = ${exploredCells})`);

  const verdict =
    exploredCells === 0 || drawnGlyphCells === 0
      ? '❌ RENDER INPUT BROKEN (no explored/glyph cells)'
      : draws.length === 0
        ? '❌ RENDERER BROKEN (snapshot has cells but render() emitted zero draw calls)'
        : '✅ render pipeline sane';
  console.log(`  → ${verdict}`);
}

/**
 * Simulates the real menu -> new-game transition through the production
 * dirty-domain machinery and, when available, the full presenter path.
 */
async function simulateTransition(campaign: CampaignData): Promise<void> {
  console.log(`\n──────── transition simulation ────────`);

  const gameState: GameState = updateExploredTiles(buildGameState(campaign));
  const menuState: GameState = {
    ...gameState,
    map: { width: campaign.rules.map.width, height: campaign.rules.map.height, tiles: [] },
    entities: [],
    components: new Map(),
    spatialIndex: new Map(),
    cachedFov: new Set(),
    uiMode: UIMode.MainMenu,
    activeRooms: []
  };

  // Frame 1: initial menu load (no previous state).
  markDirtyFromStateDiff(null, menuState);
  const menuDomains = consumeDirtyDomains();
  console.log(`  frame 1 (menu, prev=null): ${menuDomains.size} domains`);

  // Frame 2: user clicked New Game.
  markDirtyFromStateDiff(menuState, gameState);
  const gameDomains = consumeDirtyDomains();
  const hasMap = gameDomains.has(PresentationDomain.Map);
  console.log(`  frame 2 (menu -> game): [${Array.from(gameDomains).join(', ')}]`);
  console.log(`  Map dirty on new-game frame: ${hasMap ? '✅ yes' : '❌ NO — dirty-marking bug'}`);

  // Attempt the full presenter path with a minimal mock DOM.
  const globalAny = globalThis as unknown as Record<string, unknown>;
  const previousDocument = globalAny['document'];
  const previousWindow = globalAny['window'];
  globalAny['document'] = {
    getElementById: () => null,
    querySelector: () => null,
    createElement: () => ({
      style: {},
      classList: { add: () => undefined, remove: () => undefined },
      appendChild: () => undefined,
      removeChild: () => undefined
    }),
    createDocumentFragment: () => ({ appendChild: () => undefined })
  };
  globalAny['window'] = { location: { search: '' } };
  globalAny['localStorage'] = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
    clear: () => undefined
  };

  try {
    const { renderPresenterFrame } = await import('../src/rendering/presenter.ts');
    const { getRenderDebugMetrics, recordPresenterFrame } = await import('../src/rendering/render_debug.ts');

    const mockDisplay = {
      getOptions: () => ({ width: campaign.theme.ui.displayWidth, height: campaign.theme.ui.displayHeight }),
      clear: () => undefined,
      draw: () => undefined,
      getContainer: () => null
    };

    // Exercise the canvas path in isolation (the Map domain is the one under
    // investigation; the other domains are DOM-only and irrelevant headlessly).
    const mapOnly = new Set([PresentationDomain.Map]);
    recordPresenterFrame(gameDomains, gameState.uiMode);
    const before = getRenderDebugMetrics().mapRenderCount;
    renderPresenterFrame(mockDisplay as never, gameState, {} as never, mapOnly);
    const m = getRenderDebugMetrics();
    const rendered = m.mapRenderCount > before;
    console.log(`  presenter: mapRenderCount ${before} -> ${m.mapRenderCount}, drawCalls=${m.lastDrawCalls}, explored=${m.lastExploredCells}`);
    console.log(`  → presenter path: ${rendered && m.lastDrawCalls > 0 ? '✅ renders' : '❌ did not render'}`);
  } catch (err) {
    console.log(`  (presenter not headless-importable: ${(err as Error).message})`);
  } finally {
    globalAny['document'] = previousDocument;
    globalAny['window'] = previousWindow;
    delete globalAny['localStorage'];
  }
}

interface FakeCanvas {
  id: string;
  style: Record<string, string>;
  classList: { add(): void; remove(): void };
  parentElement: FakeContainer | null;
  remove(): void;
}

interface FakeContainer {
  id: string;
  style: Record<string, string>;
  children: FakeCanvas[];
  appendChild(el: FakeCanvas): void;
  insertBefore(el: FakeCanvas, ref: FakeCanvas): void;
  querySelectorAll(): FakeCanvas[];
}

function makeFakeCanvas(id: string): FakeCanvas {
  return {
    id,
    style: {},
    classList: { add: () => undefined, remove: () => undefined },
    parentElement: null,
    remove(): void {
      const parent = this.parentElement;
      if (!parent) return;
      const index = parent.children.indexOf(this);
      if (index >= 0) parent.children.splice(index, 1);
      this.parentElement = null;
    }
  };
}

function makeFakeContainer(): FakeContainer {
  const container: FakeContainer = {
    id: 'game-canvas-wrapper',
    style: {},
    children: [],
    appendChild(el: FakeCanvas): void {
      el.parentElement = container;
      container.children.push(el);
    },
    insertBefore(el: FakeCanvas, ref: FakeCanvas): void {
      el.parentElement = container;
      const index = container.children.indexOf(ref);
      if (index >= 0) container.children.splice(index, 0, el);
      else container.children.push(el);
    },
    querySelectorAll(): FakeCanvas[] {
      return container.children.slice();
    }
  };
  return container;
}

/**
 * Regression test: ROT re-allocates the canvas on layout changes, so the mount
 * helper must swap the stale canvas out of the DOM (otherwise the game draws to
 * a detached node and the visible viewport stays blank).
 */
function testCanvasRemount(campaign: CampaignData): void {
  console.log(`\n──────── canvas re-mount regression test ────────`);

  const container = makeFakeContainer();
  const canvasA = makeFakeCanvas('canvas-A');
  const canvasB = makeFakeCanvas('canvas-B');
  let current = canvasA;

  const display = { getContainer: (): FakeCanvas => current };

  const globalAny = globalThis as unknown as Record<string, unknown>;
  const previousDocument = globalAny['document'];
  globalAny['document'] = {
    getElementById: (id: string) => (id === 'game-canvas-wrapper' ? container : null),
    querySelector: () => null,
    createElement: () => makeFakeCanvas('fog-overlay')
  };

  try {
    mountDisplayWithFogOverlay(display as never, campaign);
    const firstOk = container.children.length === 1 && container.children[0] === canvasA;

    // Simulate configureDisplayForCampaign creating a fresh backend canvas.
    current = canvasB;
    mountDisplayWithFogOverlay(display as never, campaign);
    const secondOk = container.children.length === 1 && container.children[0] === canvasB;
    const staleRemoved = !container.children.includes(canvasA);

    console.log(`  first mount:            ${firstOk ? '✅ canvas mounted' : '❌ failed'}`);
    console.log(`  re-mount after layout:  ${secondOk && staleRemoved ? '✅ new canvas mounted, stale removed' : '❌ stale canvas retained (blank viewport bug)'}`);
  } finally {
    globalAny['document'] = previousDocument;
  }
}

const args = process.argv.slice(2);

initRNG(123456789);

const campaignsToRun = args.includes('--all') ? ['default', 'megacampaign', 'shroudgarde'] : args.length > 0 ? args : ['default'];

for (const id of campaignsToRun) {
  diagnoseCampaign(id);
}

const transitionCampaign = loadCampaignFromDisk(campaignsToRun[0] ?? 'default');
await simulateTransition(transitionCampaign);

const remountCampaign = loadCampaignFromDisk('megacampaign');
testCanvasRemount(remountCampaign);


