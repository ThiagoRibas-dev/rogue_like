/**
 * @file Shared fixtures for headless regression tests.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CampaignDataSchema, CampaignCategorySchemas } from '../src/types/campaign.types.ts';
import type { CampaignData } from '../src/types/campaign.types.ts';
import { generateArea } from '../src/map/generator.ts';
import { spawnEntity } from '../src/core/ecs.ts';
import { initRNG } from '../src/core/rng.ts';
import { type GameState, UIMode, EngineMode } from '../src/types/game-state.types.ts';
import { DEFAULT_GLOBAL_DRAMA_BUDGET } from '../src/constants/pacing.constants.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CAMPAIGNS_ROOT = join(ROOT, 'public', 'data', 'campaigns');

initRNG(42);

function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

const CATEGORY_FILE_OVERRIDES: Partial<Record<keyof CampaignData, string>> = {
  schemeRecipes: 'schemes.json'
};

/** Loads a campaign from disk the same way the runtime loader maps files. */
export function loadCampaignFromDisk(id: string): CampaignData {
  const dir = join(CAMPAIGNS_ROOT, id);
  const assembled: Record<string, unknown> = {};
  for (const key of Object.keys(CampaignCategorySchemas) as (keyof CampaignData)[]) {
    if (key === 'triggerBuckets') continue;
    const filename = CATEGORY_FILE_OVERRIDES[key] ?? `${toSnakeCase(key)}.json`;
    const filePath = join(dir, filename);
    if (!existsSync(filePath)) continue;
    assembled[key] = JSON.parse(readFileSync(filePath, 'utf-8'));
  }
  return CampaignDataSchema.parse(assembled);
}

/**
 * Builds a complete GameState the way `startNewGame` does: generate the starting
 * area and spawn the literal `player` template (no FOV yet).
 */
export function buildGameState(campaign: CampaignData): GameState {
  const startingAreaId = campaign.rules.map.startingAreaId;
  const { map, startPos, rooms } = generateArea(campaign, startingAreaId);

  let state: GameState = {
    campaignId: 'test',
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

  state = spawnEntity(state, 'player', startPos.x, startPos.y)[0];
  return state;
}

/** A single `display.draw` invocation captured by {@link makeRecordingDisplay}. */
export interface RecordedDraw {
  readonly x: number;
  readonly y: number;
  readonly chars: unknown;
  readonly fg: unknown;
  readonly bg: unknown;
}

/**
 * Builds a ROT-like display stub that records every `draw` call and counts clears.
 *
 * @param width Viewport width returned by `getOptions()`.
 * @param height Viewport height returned by `getOptions()`.
 */
export function makeRecordingDisplay(width = 50, height = 25): {
  readonly display: Record<string, unknown>;
  readonly draws: RecordedDraw[];
  readonly clearCount: () => number;
} {
  const draws: RecordedDraw[] = [];
  let clears = 0;
  const display: Record<string, unknown> = {
    getOptions: () => ({ width, height, tileMap: {} }),
    clear: () => {
      clears++;
    },
    draw: (x: number, y: number, ch: unknown, fg: unknown, bg: unknown) => {
      draws.push({ x, y, chars: ch, fg, bg });
    },
    getContainer: () => null
  };
  return { display, draws, clearCount: () => clears };
}
