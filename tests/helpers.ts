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
import { getRuleset } from '../src/rulesets/registry.ts';
import type { RulesetId } from '../src/types/ruleset.types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CAMPAIGNS_ROOT = join(ROOT, 'public', 'data', 'campaigns');
const RULESETS_ROOT = join(ROOT, 'public', 'data', 'rulesets');

initRNG(42);

function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

const CATEGORY_FILE_OVERRIDES: Partial<Record<keyof CampaignData, string>> = {
  schemeRecipes: 'schemes.json'
};

const CAMPAIGN_CACHE = new Map<string, CampaignData>();

/** Loads a campaign from disk the same way the runtime loader maps files, including parent ruleset System Content. */
export function loadCampaignFromDisk(id: string): CampaignData {
  const cached = CAMPAIGN_CACHE.get(id);
  if (cached) {
    return structuredClone(cached);
  }
  const dir = join(CAMPAIGNS_ROOT, id);
  const defaultDir = join(CAMPAIGNS_ROOT, 'default');
  const assembled: Record<string, unknown> = {};
  for (const key of Object.keys(CampaignCategorySchemas) as (keyof CampaignData)[]) {
    if (key === 'triggerBuckets' || key === 'systemContent') continue;
    const filename = CATEGORY_FILE_OVERRIDES[key] ?? `${toSnakeCase(key)}.json`;
    let filePath = join(dir, filename);
    if (!existsSync(filePath) && id !== 'default') {
      filePath = join(defaultDir, filename);
    }
    if (!existsSync(filePath)) continue;
    assembled[key] = JSON.parse(readFileSync(filePath, 'utf-8'));
  }

  const manifest = assembled['manifest'] as Record<string, unknown> | undefined;
  const rulesetId = typeof manifest?.['rulesetId'] === 'string' ? (manifest['rulesetId'] as RulesetId) : 'classic';
  const ruleset = getRuleset(rulesetId);
  const rulesetDir = join(RULESETS_ROOT, ruleset.id);
  const readRulesetJson = (filename: string): Record<string, unknown> => {
    const p = join(rulesetDir, filename);
    return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf-8')) as Record<string, unknown>) : {};
  };

  for (const sharedKey of ['items', 'entities', 'status', 'effects'] as const) {
    const baseRecord = readRulesetJson(`${sharedKey}.json`);
    if (Object.keys(baseRecord).length > 0) {
      assembled[sharedKey] = {
        ...baseRecord,
        ...((assembled[sharedKey] as Record<string, unknown> | undefined) ?? {})
      };
    }
  }

  const systemDescriptors = ruleset.getSystemContentFiles?.() ?? [];
  const rawSystemContent: Record<string, Record<string, unknown>> = {};
  for (const desc of systemDescriptors) {
    const incoming = readRulesetJson(desc.filename);
    const normalizedIncoming =
      typeof incoming['id'] === 'string' && typeof incoming['name'] === 'string'
        ? { [incoming['id']]: incoming }
        : incoming;
    const existing = rawSystemContent[desc.key];
    rawSystemContent[desc.key] = existing !== undefined ? { ...existing, ...normalizedIncoming } : normalizedIncoming;
  }
  const parsedSys = ruleset.parseSystemContent ? ruleset.parseSystemContent(rawSystemContent) : rawSystemContent;
  assembled['systemContent'] = parsedSys;

  const sysItems = (parsedSys as Record<string, unknown> | undefined)?.['items'] as Record<string, unknown> | undefined;
  if (sysItems && Object.keys(sysItems).length > 0) {
    assembled['items'] = {
      ...sysItems,
      ...((assembled['items'] as Record<string, unknown> | undefined) ?? {})
    };
  }

  const parsed = CampaignDataSchema.parse(assembled);
  CAMPAIGN_CACHE.set(id, parsed);
  return structuredClone(parsed);
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
export function makeRecordingDisplay(
  width = 50,
  height = 25
): {
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

/**
 * Recursively freezes all plain objects, arrays, Maps, and Sets inside a GameState
 * so any in-place mutation throws a TypeError immediately during tests.
 *
 * @param value The value or GameState to deep-freeze in place.
 * @param seen WeakSet tracking visited object references.
 * @returns The frozen value.
 */
export function deepFreezeGameState<T>(value: T, seen: WeakSet<object> = new WeakSet()): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  const obj = value as object;
  if (seen.has(obj)) {
    return value;
  }
  seen.add(obj);

  if (obj instanceof Map) {
    for (const [k, v] of obj.entries()) {
      deepFreezeGameState(k, seen);
      deepFreezeGameState(v, seen);
    }
    const throwMutate = (): never => {
      throw new TypeError('Attempted to mutate a frozen Map in GameState');
    };
    Object.defineProperty(obj, 'set', { value: throwMutate });
    Object.defineProperty(obj, 'delete', { value: throwMutate });
    Object.defineProperty(obj, 'clear', { value: throwMutate });
    return value;
  }

  if (obj instanceof Set) {
    for (const v of obj.values()) {
      deepFreezeGameState(v, seen);
    }
    const throwMutate = (): never => {
      throw new TypeError('Attempted to mutate a frozen Set in GameState');
    };
    Object.defineProperty(obj, 'add', { value: throwMutate });
    Object.defineProperty(obj, 'delete', { value: throwMutate });
    Object.defineProperty(obj, 'clear', { value: throwMutate });
    return value;
  }

  if (Array.isArray(obj)) {
    for (const item of obj) {
      deepFreezeGameState(item, seen);
    }
    Object.freeze(obj);
    return value;
  }

  for (const key of Object.keys(obj)) {
    const prop = (obj as Record<string, unknown>)[key];
    deepFreezeGameState(prop, seen);
  }
  Object.freeze(obj);
  return value;
}
