# Phase 48 Implementation Plan — Ring 2 Parallel Macro-World Simulation & Offline Legends Worldgen

**Milestones Covered:** 184, 185, 186 (`docs/MILESTONES.md` §Phase 48)  
**Baseline Commit:** `efe469d69` (`main`, Phase 47 complete — 457 tests passing across 67 files, 8/8 `./verify.sh` green)

---

## Confirmed Architectural Decisions (from `docs/research_notes.md`)

1. **Phase 48 UI Scope (Option A):** Strictly scoped to M184–M186 (`LegendsModal.tsx` built on Phase 43 shared Preact primitives); interactive Colony/Fortress management HUD modals remain deferred to a follow-up / Phase 44 UI work.
2. **Campaign Opt-In & Worldgen Config (Option A):** Add optional `macroWorld?: MacroWorldConfigSchema` inside `RulesConfigSchema` (`rules.json`). Enable it in `public/data/campaigns/default/rules.json` (showcasing `endless_frontier` + linked sites/ruins), while keeping sibling campaigns (`dnd35e-crypt`, `megacampaign`, `realms-of-shroudgarde`, `shroudgarde`) opt-in with zero unintended startup latency or breaking changes. Async worldgen progress streams to `LoadingOverlay` during `startNewGame`.
3. **Ring 2 Worker Determinism & Turn-Boundary Sync (Option A):** Persistent `world_sim.worker.ts` runs the exact same pure seeded kernel (`advanceMacroWorldTicks` using an isolated Mulberry32 PRNG — **zero mutation of main-thread `ROT.RNG`**) as the headless fallback; dispatched asynchronously at `MACRO_WORLD_TICK_INTERVAL` boundaries, buffered in an ordered queue, and applied strictly at deterministic player turn boundaries (with synchronous catch-up on bulk rest/time-skip and headless `bun test`).
4. **Legends Browser Navigation & Keybind (Option A):** Dedicated `UIMode.Legends`, `IntentType.ToggleLegends`, `panel.legends` bound to `Shift+H` (`{ key: 'h', shift: true }`, collision-free against Vi-key `h`), Command Dock button (`🗺️ Legends`), and cross-links from `LedgerModal` and `NemesisDossierModal`.

---

## 1. SSOT Ownership & Canonical Entry Points (`docs/ssot/ssot_console.json`)

Every Phase 48 responsibility lives in a single canonical Tier 1 Console owner with zero duplicate state or split-brain logic:

| Responsibility | Canonical Owner Module | Canonical Entry Points / Types |
| :--- | :--- | :--- |
| Ring 2 & Legends Pure JSON Data Types | `src/types/macro_world.types.ts` | `MacroWorldState`, `MacroContinentGrid`, `MacroSiteRecord`, `MacroCaravanRecord`, `MacroArmyRecord`, `MacroWeatherFront`, `MacroSiteDelta`, `MacroTickDeltaBatch`, `LegendsArchive`, `HistoricalFigureRecord`, `HistoricalArtifactRecord`, `LegendsEraRecord`, `LegendsEventRecord` |
| Macro-World & Seasonal Constants | `src/constants/macro_world.constants.ts` | `DEFAULT_MACRO_WORLD_WIDTH`, `DEFAULT_MACRO_WORLD_HEIGHT`, `DEFAULT_LEGENDS_HISTORY_YEARS`, `DEFAULT_MACRO_SITE_COUNT`, `DEFAULT_MACRO_TICK_INTERVAL_TURNS`, `DAYS_PER_SEASON`, `SEASONS_PER_YEAR`, `WEATHER_TEMP_DELTA_BY_KIND`, `MACRO_BIOME_GLYPHS`, `MACRO_SITE_STATUS_GLYPHS` |
| Continental Heightmap, Biomes & Sites | `src/map/worldgen_continent.ts` | `generateContinentalMacroWorld`, `mapWorldCoordToContinentCell` |
| Multi-Century Legends Sim & Turn-1 Seeding | `src/systems/macro/legends_simulator.ts` | `simulateWorldLegendsAsync`, `generateLegendsWorldSync`, `seedGameStateFromLegends` |
| Pure Ring 2 Tick Kernel & Turn Sync | `src/systems/macro/macro_world.system.ts` | `createMacroRng`, `advanceMacroWorldTicks`, `applyMacroTickBatchToGameState`, `getActiveOutdoorWeatherAt`, `syncMacroWorldAtTurnBoundary`, `flushMacroWorldSyncForBulkTurns` |
| Seasonal Calendar Projection | `src/systems/world_clock.system.ts` | `readSeasonalCalendar` |
| Persistent Ring 2 Web Worker | `src/worker/world_sim.worker.ts` | Worker message loop (`macro_world_tick`) |
| Offline Legends Worldgen Worker | `src/worker/legends_worldgen.worker.ts` | Worker generator loop (`legends_worldgen` + progress) |
| Thread Bridge & Headless Fallback | `src/worker/worker_bridge.ts` | `dispatchMacroWorldTickOffload`, `consumeReadyMacroTickBatches`, `hasPendingMacroTickJob`, `resetMacroWorldWorker`, `runLegendsWorldgenOffload` |
| Idempotent Ring 0 Site Materializer | `src/systems/map/site_materializer.ts` | `materializeMacroSitesForChunk`, `materializeMacroSitesForArea` |
| Preact Legends Browser UI | `src/rendering/ui/modals/LegendsModal.tsx` | `<LegendsModal />` (5 searchable cross-linked tabs) |

---

## 2. Declarative Purity & Anti-Hardcoding Audit Table (`AGENTS.md` Rule 21)

| Behavior | Rejected Imperative Shortcut | Chosen Declarative Schema / JSON Mechanism | Passes "New Content Mod" Litmus Test? |
| :--- | :--- | :--- | :--- |
| Worldgen Opt-In & Scale | `if (campaignId === 'default') runLegends()` | `RulesConfigSchema.macroWorld?: MacroWorldConfigSchema` (`enabled`, `worldWidth`, `worldHeight`, `historyYears`, `siteCount`, `macroTickIntervalTurns`, `enableWeatherFronts`, `areaSiteBindings`) | **Yes** — any campaign enables or tunes macro-world via `rules.json` alone. |
| Civilizations & Faction Roles | `if (factionId === 'bandits') isRaider = true` | Derive faction temperament & hostility dynamically from `campaign.factions` (`FactionMatrix` hostile relation count) + optional `macroWorld.raiderFactionTags` | **Yes** — any custom faction matrix works automatically without `.ts` edits. |
| Name & Epithet Generation | Hardcoded name lists keyed by `'orc'` / `'goblin'` | Harvest pools generically across all entries in `campaign.identityGeneration` with deterministic syllable synthesis only when empty | **Yes** — new identity JSON pools are picked up automatically. |
| Raided / Burnt Site Tile Mutation | `if (tileId === 'wooden_floor') set('ash')` | Read `TileDefinition.burnedTileId`, `minedTileId`, and semantic tile tags (`'floor'`, `'wall'`, `'burnt'`, `'rubble'`) + `macroWorld.siteTilePalette` | **Yes** — modders define custom tiles and `burnedTileId` cleanly in `tiles.json`. |
| Caravan Goods, Guards, Raiders & Survivors | `spawnEntity('bandit')` / `spawnItem('iron_sword')` | Resolve entity & item templates dynamically by declarative tags (`merchant`, `guard`, `survivor`, `raider`, `valuable`, `artifact_base`, or `macroWorld.roleTags`) with graceful skip if omitted | **Yes** — works with any campaign's entity/item roster. |
| Artifact Relic Forging | `if (kind === 'sword') template = 'longsword'` | Select artifact base templates from `campaign.items` matching `equippable` / `artifactCandidateTags`, naming via `IdentityComponent` + `ChronicleComponent` | **Yes** — custom campaign gear becomes forgeable historical relics automatically. |
| Finite Area <-> Macro Site Linking | `if (areaId === 'outer_crossroads') siteId = 's1'` | Optional `AreaDefinitionSchema.macroSiteId?: string` and `RulesConfigSchema.macroWorld.areaSiteBindings` | **Yes** — any area links declaratively in JSON. |
| Weather Outdoor Thermal Modulation | `if (areaId === 'endless_frontier') ambient -= 10` | Check `area.environmentType === 'outdoors'` / `CHUNK_FLAG_OUTDOOR` and read `WEATHER_TEMP_DELTA_BY_KIND[front.kind]` from active `GameState.macroWorld.weatherFronts` | **Yes** — weather affects every outdoor area uniformly. |

---

## 3. Detailed Step-by-Step Implementation Plan & Code Snippets

### Task Group A — Constants, Pure Types, Zod Schemas & Serialization

#### Task A1: `src/constants/macro_world.constants.ts` *(NEW)*
Define all named simulation, calendar, continent, weather, and archive cap constants (zero magic numbers):

```typescript
import type { MacroBiomeKind, MacroSeason, MacroSiteStatus, MacroWeatherKind } from '../types/macro_world.types.ts';

export const DEFAULT_MACRO_WORLD_WIDTH = 32;
export const DEFAULT_MACRO_WORLD_HEIGHT = 32;
export const DEFAULT_LEGENDS_HISTORY_YEARS = 150;
export const DEFAULT_MACRO_SITE_COUNT = 12;
export const DEFAULT_MACRO_TICK_INTERVAL_TURNS = 100;
export const DEFAULT_WORLDGEN_SEED_OFFSET = 48185;

export const DAYS_PER_SEASON = 30;
export const SEASONS_PER_YEAR = 4;
export const MACRO_SEASONS: ReadonlyArray<MacroSeason> = ['spring', 'summer', 'autumn', 'winter'];

export const MAX_MACRO_CARAVANS = 12;
export const MAX_MACRO_ARMIES = 10;
export const MAX_WEATHER_FRONTS = 4;
export const MAX_MACRO_EVENT_ARCHIVE = 500;
export const MAX_MATERIALIZED_DELTA_IDS = 1000;
export const MAX_SEEDED_LIVING_LEGENDS = 6;
export const MAX_WORLD_HISTORICAL_FIGURES = 48;
export const MAX_WORLD_ARTIFACTS = 18;
export const MAX_SITE_PROSPERITY = 100;
export const MIN_SITE_PROSPERITY = 0;

export const STREAMING_OVERWORLD_SITE_SPAN_CHUNKS = 8;
export const BURNT_SITE_EMBER_TEMP_DELTA_C = 60;
export const WEATHER_FRONT_BASE_RADIUS_CELLS = 5;

export const WEATHER_TEMP_DELTA_BY_KIND: Readonly<Record<MacroWeatherKind, number>> = {
  clear: 0,
  fog: -2,
  rain: -5,
  storm: -8,
  blizzard: -22,
  drought: 10,
  heatwave: 16
};

export const MACRO_BIOME_GLYPHS: Readonly<Record<MacroBiomeKind, { readonly glyph: string; readonly fg: string }>> = {
  ocean: { glyph: '~', fg: '#2b5876' },
  coast: { glyph: ',', fg: '#80a1c1' },
  plains: { glyph: '.', fg: '#7cb342' },
  forest: { glyph: '♣', fg: '#2e7d32' },
  hills: { glyph: 'n', fg: '#a1887f' },
  mountain: { glyph: '^', fg: '#90a4ae' },
  desert: { glyph: '≈', fg: '#d4a373' },
  tundra: { glyph: '*', fg: '#cfd8dc' },
  swamp: { glyph: ';', fg: '#558b2f' }
};

export const MACRO_SITE_STATUS_GLYPHS: Readonly<Record<MacroSiteStatus, string>> = {
  intact: '⌂',
  besieged: '⚔',
  raided: '!',
  burned: '🔥',
  ruined: '×',
  abandoned: '·'
};
```

#### Task A2: `src/types/macro_world.types.ts` *(NEW)*
Pure JSON-serializable TypeScript types (zero `Map` or `Set`, strict `exactOptionalPropertyTypes` compliance):

```typescript
export type MacroSeason = 'spring' | 'summer' | 'autumn' | 'winter';
export type MacroBiomeKind = 'ocean' | 'coast' | 'plains' | 'forest' | 'hills' | 'mountain' | 'desert' | 'tundra' | 'swamp';
export type MacroSiteArchetype = 'capital' | 'town' | 'hamlet' | 'fortress' | 'shrine' | 'ruin';
export type MacroSiteStatus = 'intact' | 'besieged' | 'raided' | 'burned' | 'ruined' | 'abandoned';
export type MacroWeatherKind = 'clear' | 'rain' | 'storm' | 'blizzard' | 'drought' | 'heatwave' | 'fog';
export type MacroSiteDeltaKind =
  | 'site_founded'
  | 'site_prospered'
  | 'site_raided'
  | 'site_burned'
  | 'site_ruined'
  | 'site_rebuilt'
  | 'caravan_arrived'
  | 'army_camped'
  | 'artifact_relocated';

export type LegendsEventKind =
  | 'era_started'
  | 'site_founded'
  | 'war_declared'
  | 'treaty_signed'
  | 'battle_fought'
  | 'site_raided'
  | 'site_burned'
  | 'site_ruined'
  | 'figure_born'
  | 'figure_ascended'
  | 'figure_slain'
  | 'figure_scarred'
  | 'artifact_forged'
  | 'caravan_completed'
  | 'caravan_ambushed';

export interface MacroContinentCell {
  readonly x: number;
  readonly y: number;
  readonly elevation: number;
  readonly rainfall: number;
  readonly baseTempC: number;
  readonly biome: MacroBiomeKind;
  readonly hasRiver: boolean;
  readonly hasRoad: boolean;
  readonly ownerFactionId?: string | undefined;
  readonly siteId?: string | undefined;
}

export interface MacroContinentGrid {
  readonly width: number;
  readonly height: number;
  readonly cells: ReadonlyArray<MacroContinentCell>;
  readonly seaLevel: number;
}

export interface MacroSiteRecord {
  readonly id: string;
  readonly name: string;
  readonly archetype: MacroSiteArchetype;
  readonly status: MacroSiteStatus;
  readonly x: number;
  readonly y: number;
  readonly chunkX: number;
  readonly chunkY: number;
  readonly factionId: string;
  readonly population: number;
  readonly prosperity: number;
  readonly foodStock: number;
  readonly garrison: number;
  readonly isCapital: boolean;
  readonly foundedYear: number;
  readonly connectedSiteIds: ReadonlyArray<string>;
  readonly residentFigureIds: ReadonlyArray<string>;
  readonly artifactIds: ReadonlyArray<string>;
  readonly boundAreaId?: string | undefined;
}

export interface MacroCaravanRecord {
  readonly id: string;
  readonly factionId: string;
  readonly originSiteId: string;
  readonly targetSiteId: string;
  readonly x: number;
  readonly y: number;
  readonly chunkX: number;
  readonly chunkY: number;
  readonly cargoTags: ReadonlyArray<string>;
  readonly escortStrength: number;
  readonly goodsValue: number;
  readonly progressTurns: number;
}

export interface MacroArmyRecord {
  readonly id: string;
  readonly factionId: string;
  readonly commanderFigureId?: string | undefined;
  readonly originSiteId: string;
  readonly targetSiteId: string;
  readonly x: number;
  readonly y: number;
  readonly chunkX: number;
  readonly chunkY: number;
  readonly strength: number;
  readonly mission: 'patrol' | 'raid' | 'siege' | 'escort';
}

export interface MacroWeatherFront {
  readonly id: string;
  readonly kind: MacroWeatherKind;
  readonly x: number;
  readonly y: number;
  readonly radiusCells: number;
  readonly dx: number;
  readonly dy: number;
  readonly remainingTicks: number;
}

export interface MacroSiteDelta {
  readonly id: string;
  readonly tick: number;
  readonly siteId: string;
  readonly kind: MacroSiteDeltaKind;
  readonly factionId?: string | undefined;
  readonly actorTemplateTags?: ReadonlyArray<string> | undefined;
  readonly itemTemplateTags?: ReadonlyArray<string> | undefined;
  readonly scarText?: string | undefined;
  readonly summary: string;
}

export interface MacroRumorPayload {
  readonly id: string;
  readonly factSummary: string;
  readonly siteId?: string | undefined;
  readonly factionId?: string | undefined;
  readonly originTick: number;
}

export interface HistoricalFigureRecord {
  readonly id: string;
  readonly name: string;
  readonly epithet?: string | undefined;
  readonly factionId: string;
  readonly dynastyId: string;
  readonly role: 'ruler' | 'champion' | 'commander' | 'artisan' | 'raider' | 'chronicler';
  readonly birthYear: number;
  readonly deathYear?: number | undefined;
  readonly isAlive: boolean;
  readonly kills: number;
  readonly scars: ReadonlyArray<string>;
  readonly homeSiteId: string;
  readonly currentSiteId: string;
  readonly rivalFigureIds: ReadonlyArray<string>;
  readonly eventIds: ReadonlyArray<string>;
  readonly seededEntityId?: number | undefined;
}

export interface HistoricalArtifactRecord {
  readonly id: string;
  readonly name: string;
  readonly baseItemId?: string | undefined;
  readonly creatorFigureId: string;
  readonly forgedYear: number;
  readonly currentSiteId: string;
  readonly ownerHistoryFigureIds: ReadonlyArray<string>;
  readonly description: string;
  readonly materializedEntityId?: number | undefined;
}

export interface LegendsEraRecord {
  readonly id: string;
  readonly name: string;
  readonly startYear: number;
  readonly endYear: number;
  readonly theme: string;
  readonly summary: string;
}

export interface LegendsEventRecord {
  readonly id: string;
  readonly year: number;
  readonly season: MacroSeason;
  readonly eraId: string;
  readonly kind: LegendsEventKind;
  readonly importance: 'minor' | 'major' | 'epic';
  readonly summary: string;
  readonly siteId?: string | undefined;
  readonly factionId?: string | undefined;
  readonly secondaryFactionId?: string | undefined;
  readonly figureIds: ReadonlyArray<string>;
  readonly artifactId?: string | undefined;
}

export interface LegendsArchive {
  readonly worldName: string;
  readonly simulatedYears: number;
  readonly eras: ReadonlyArray<LegendsEraRecord>;
  readonly figures: Readonly<Record<string, HistoricalFigureRecord>>;
  readonly artifacts: Readonly<Record<string, HistoricalArtifactRecord>>;
  readonly events: ReadonlyArray<LegendsEventRecord>;
}

export interface MacroWorldState {
  readonly worldSeed: number;
  readonly currentTick: number;
  readonly lastDispatchedTick: number;
  readonly tickIntervalTurns: number;
  readonly continent: MacroContinentGrid;
  readonly sites: Readonly<Record<string, MacroSiteRecord>>;
  readonly caravans: Readonly<Record<string, MacroCaravanRecord>>;
  readonly armies: Readonly<Record<string, MacroArmyRecord>>;
  readonly weatherFronts: ReadonlyArray<MacroWeatherFront>;
  readonly pendingSiteDeltas: ReadonlyArray<MacroSiteDelta>;
  readonly materializedDeltaIds: ReadonlyArray<string>;
  readonly legends: LegendsArchive;
}

export interface MacroSimCampaignContext {
  readonly factions: ReadonlyArray<string>;
  readonly hostilePairs: ReadonlyArray<readonly [string, string]>;
  readonly raiderFactionIds: ReadonlyArray<string>;
  readonly enableWeatherFronts: boolean;
  readonly cargoTagPools: ReadonlyArray<ReadonlyArray<string>>;
  readonly scarPool: ReadonlyArray<string>;
  readonly nameFirstPool: ReadonlyArray<string>;
  readonly nameTitlePool: ReadonlyArray<string>;
}

export interface MacroTickDeltaBatch {
  readonly fromTick: number;
  readonly toTick: number;
  readonly nextMacroWorld: MacroWorldState;
  readonly newSiteDeltas: ReadonlyArray<MacroSiteDelta>;
  readonly newLegendsEvents: ReadonlyArray<LegendsEventRecord>;
  readonly newRumors: ReadonlyArray<MacroRumorPayload>;
  readonly areaMutations: ReadonlyArray<{
    readonly areaId: string;
    readonly addedTags: ReadonlyArray<string>;
    readonly budgetModifier: number;
  }>;
}
```

#### Task A3: `src/types/campaign/meta.ts` & `src/types/campaign/world.ts`
Add `MacroWorldConfigSchema` to `src/types/campaign/meta.ts` and `macroSiteId` to `AreaDefinitionSchema` in `src/types/campaign/world.ts`:

```typescript
// src/types/campaign/meta.ts
export const MacroWorldConfigSchema = z.object({
  enabled: z.boolean().default(false),
  worldSeed: z.number().int().optional(),
  worldWidth: z.number().int().min(12).max(64).default(32),
  worldHeight: z.number().int().min(12).max(64).default(32),
  historyYears: z.number().int().min(10).max(500).default(150),
  siteCount: z.number().int().min(4).max(32).default(12),
  macroTickIntervalTurns: z.number().int().min(10).max(1000).default(100),
  enableWeatherFronts: z.boolean().default(true),
  raiderFactionTags: z.array(z.string()).optional(),
  areaSiteBindings: z.record(z.string(), z.string()).optional()
});
export type MacroWorldConfig = z.infer<typeof MacroWorldConfigSchema>;

// On RulesConfigSchema:
  macroWorld: MacroWorldConfigSchema.optional(),
```

```typescript
// src/types/campaign/world.ts (on AreaDefinitionSchema)
  macroSiteId: z.string().optional().describe('Optional linked MacroWorld site ID for Ring 2 mutation materialization'),
```

#### Task A4: `src/types/game-state.types.ts`, `src/types/events.types.ts` & `src/core/save.ts`
- `UIMode`: Add `Legends = 'legends'`.
- `GameState` & `SerializedGameState`: Add `readonly macroWorld?: MacroWorldState | undefined;`.
- `src/core/save.ts`: Persist `...(sanitized.macroWorld !== undefined ? { macroWorld: sanitized.macroWorld } : {})` in `serializeGameState`, and restore `...(sState.macroWorld !== undefined ? { macroWorld: sState.macroWorld } : {})` in `deserializeGameState`.
- `src/types/events/interaction_events.types.ts` & `src/types/events.types.ts`: Add `GameEventType.MacroWorldTickSynced` and `GameEventType.SiteMaterialized`.

---

### Task Group B — Milestone 184: Ring 2 Simulation Kernel, Seasonal Calendar & Persistent Worker

#### Task B1: Seasonal Calendar (`src/systems/world_clock.system.ts`)
```typescript
export interface SeasonalCalendarReading {
  readonly year: number;
  readonly season: MacroSeason;
  readonly seasonIndex: number;
  readonly dayOfSeason: number;
  readonly dayOfYear: number;
}

export function readSeasonalCalendar(state: GameState, turnOffset = 0): SeasonalCalendarReading {
  const clockDay = Math.max(1, readWorldClock(state, turnOffset).day);
  const daysPerYear = DAYS_PER_SEASON * SEASONS_PER_YEAR;
  const zeroBasedDay = clockDay - 1;
  const year = Math.floor(zeroBasedDay / daysPerYear) + 1;
  const dayOfYear = (zeroBasedDay % daysPerYear) + 1;
  const seasonIndex = Math.floor((dayOfYear - 1) / DAYS_PER_SEASON);
  const dayOfSeason = ((dayOfYear - 1) % DAYS_PER_SEASON) + 1;
  const season = MACRO_SEASONS[seasonIndex] ?? 'spring';
  return { year, season, seasonIndex, dayOfSeason, dayOfYear };
}
```

#### Task B2: Pure Ring 2 Kernel (`src/systems/macro/macro_world.system.ts`) *(NEW)*
- `createMacroRng(seed: number, salt: number): () => number` — isolated deterministic Mulberry32 PRNG (zero `ROT.RNG` dependency).
- `buildMacroSimContext(campaign: CampaignData): MacroSimCampaignContext` — collects factions, pairwise hostilities from `campaign.factions`, raider factions (hostile to `>= 2` factions or matching `macroWorld.raiderFactionTags`), name/title pools from `campaign.identityGeneration`, and scar pools from `campaign.nemesisHierarchies`.
- `advanceMacroWorldTicks(macroWorld: MacroWorldState, targetTick: number, context: MacroSimCampaignContext): MacroTickDeltaBatch`:
  1. Iterates `tick = macroWorld.currentTick + 1 .. targetTick`.
  2. Advances settlement economies (recovering food/prosperity when `intact`, slowly rebuilding `raided` -> `intact` or decaying toward `abandoned` if depleted).
  3. Spawns new caravans (up to `MAX_MACRO_CARAVANS`) between friendly `intact` sites; moves active caravans step-by-step toward `targetSiteId`; checks hostile army interception (stealing/raiding cargo -> `caravan_ambushed`) and safe arrival (`prosperity += 6`, emitting `caravan_arrived` delta + rumor).
  4. Spawns raider/faction warbands (up to `MAX_MACRO_ARMIES`) targeting rival/prosperous sites; moves armies toward targets; resolves siege/raid strength vs. `garrison`; emits `site_raided` / `site_burned` / `site_ruined` deltas, `LegendsEventRecord`s, `MacroRumorPayload`s, and `areaMutation` deltas when a target site carries `boundAreaId`.
  5. Moves seasonal `MacroWeatherFront`s across `(width, height)` cells, wrapping coordinates and refreshing seasonal weather types (`blizzard` weighted in `winter`, `drought`/`heatwave` in `summer`, `rain`/`storm` in `spring`/`autumn`).
- `applyMacroTickBatchToGameState(state: GameState, batch: MacroTickDeltaBatch): GameState`:
  - Checks `state.macroWorld && batch.toTick > state.macroWorld.currentTick` for strict monotonic idempotency.
  - Updates `state.macroWorld`, appends `minor`/`major`/`epic` Ring 2 narrative events onto `state.historicalLedger` (`GameEventType.MacroWorldTickSynced`), feeds `batch.newRumors` into `state.pendingRumors` for NPC gossip propagation, and mutates any linked area entity's `DirectorBudgetComponent` & `TagsComponent`.
- `getActiveOutdoorWeatherAt(state: Readonly<GameState>, wx: number, wy: number)`:
  - Maps `(wx, wy)` to `(cx, cy)` and continent cell via `mapWorldCoordToContinentCell`, checks active `weatherFronts` overlapping radius, and returns `{ kind, tempDeltaC: WEATHER_TEMP_DELTA_BY_KIND[kind] }`.

#### Task B3: Persistent Worker & Headless Fallback (`src/worker/world_sim.worker.ts`, `worker.types.ts`, `worker_bridge.ts`)
```typescript
// src/worker/worker.types.ts
export interface MacroWorldTickWorkerRequest {
  readonly id: string;
  readonly type: 'macro_world_tick';
  readonly macroWorld: MacroWorldState;
  readonly targetTick: number;
  readonly context: MacroSimCampaignContext;
}

export interface LegendsWorldgenWorkerRequest {
  readonly id: string;
  readonly type: 'legends_worldgen';
  readonly input: LegendsWorldgenInput;
}
```
- `src/worker/world_sim.worker.ts`: Persistent worker listening on `self.onmessage`, executing `advanceMacroWorldTicks(data.macroWorld, data.targetTick, data.context)`, posting `WorkerSuccessMessage<MacroTickDeltaBatch>`.
- `src/worker/worker_bridge.ts`:
  - `readyMacroTickBatches: MacroTickDeltaBatch[]` queue + `pooledMacroWorker: Worker | null` + `inFlightMacroTickJob: boolean`.
  - `dispatchMacroWorldTickOffload(macroWorld, targetTick, context)`:
    - If `!isWorkerAvailable()`, runs `advanceMacroWorldTicks(...)` synchronously and returns it immediately (or pushes to ready queue so headless turns apply identically at turn boundary).
    - If Worker is available and not already busy, posts to persistent `pooledMacroWorker`, storing returned `MacroTickDeltaBatch` in `readyMacroTickBatches` (sorted monotonically by `toTick`).
  - `consumeReadyMacroTickBatches(currentTick: number)`: drains and clears `readyMacroTickBatches` matching `batch.toTick > currentTick`.
  - `resetMacroWorldWorker()`: terminates/resets worker and drains pending queues on `startNewGame` or campaign switch.

#### Task B4: Cadence, Time Skip & Thermal Weather Hooks
- `src/core/simulation_cadence.ts` (`processTier3GlobalCadence`):
  ```typescript
  nextState = syncMacroWorldAtTurnBoundary(nextState);
  ```
- `src/systems/world_time_skip.ts` (`advanceWorldTimeBulk` & `advanceWorldTimeBulkAsync`):
  ```typescript
  if (advanced > 0) {
    nextState = flushMacroWorldSyncForBulkTurns(nextState);
  }
  ```
- `src/systems/physics/temperature_physics.ts` (`processDirtyTemperatureChunks`):
  - Compute per-region outdoor ambient temperature:
    ```typescript
    const weather = getActiveOutdoorWeatherAt(nextState, wx, wy);
    const cellAmbient = weather && isOutdoorCell ? DEFAULT_AMBIENT_TEMP_C + weather.tempDeltaC : DEFAULT_AMBIENT_TEMP_C;
    ```

---

### Task Group C — Milestone 185: Offline Multi-Century Legends Worldgen Worker

#### Task C1: Continental Worldgen (`src/map/worldgen_continent.ts`) *(NEW)*
- `generateContinentalMacroWorld(params: ContinentWorldgenParams): MacroWorldState`:
  - Synthesizes deterministic `(width × height)` continent with radial falloff + multi-octave noise (`elevation`, `rainfall`, `baseTempC`), classifying 9 biomes (`ocean`, `coast`, `plains`, `forest`, `hills`, `mountain`, `desert`, `tundra`, `swamp`).
  - Carves rivers from high peaks downhill toward `ocean`.
  - Places `siteCount` named sites on habitable land cells (`capital`, `town`, `hamlet`, `fortress`, `shrine`), converting continental `(sx, sy)` offsets around world center into streaming chunk coordinates `(chunkX, chunkY)` (ensuring the primary home region / nearest sites fall within `±STREAMING_OVERWORLD_SITE_SPAN_CHUNKS` of chunk `(0, 0)` in `endless_frontier` so players can walk directly to living or ruined sites!).
  - Builds road links (`connectedSiteIds`, setting `hasRoad` along Bresenham paths between neighboring sites).

#### Task C2: Multi-Century Legends Simulator & Worker (`src/systems/macro/legends_simulator.ts`, `src/worker/legends_worldgen.worker.ts`) *(NEW)*
- `simulateWorldLegendsAsync(input: LegendsWorldgenInput): Generator<WorkerProgressPayload, MacroWorldState, void>`:
  - Creates initial civilizations & founding heroes/rulers per faction using campaign `identityGeneration` + generic name generator fallback.
  - Simulates `year = 1 .. input.historyYears`:
    - Era transitions every ~40–60 years named from dominant activity (`Age of Founding`, `Age of Trade`, `Age of Strife`, `Age of Ash`).
    - Resolves yearly diplomacy (wars/treaties), site founding/growth, bandit/warband raids, sieges, burnings/ruinations, nemesis duels (`kills`, `scars`), and legendary artifact crafting (`HistoricalArtifactRecord`).
    - Yields `{ progress, message }` every 10 simulated years so `LoadingOverlay` smoothly animates during `startNewGame`.
- `seedGameStateFromLegends(state: GameState, macroWorld: MacroWorldState): GameState`:
  - Stores `macroWorld` on `GameState`.
  - Promotes up to `MAX_SEEDED_LIVING_LEGENDS` surviving living `HistoricalFigureRecord`s into `state.persistentEntities` with `IdentityComponent`, `ChronicleComponent` (scars, core memories), `MemoryComponent` (historical grudges/standings), and `NemesisComponent` when matching hierarchy ranks exist.
  - Appends curated epic/major `LegendsEventRecord`s into `state.historicalLedger` and records excerpts on `factionEntityIds` / `areaEntityIds` `ChronicleComponent`s.
  - Binds `macroSiteId` / `areaSiteBindings` sites cleanly (`boundAreaId`).

#### Task C3: Startup Flow (`src/core/bootstrap.ts`, `src/core/session/session_dom.ts`)
- Extend `startNewGame` signature with optional `onProgress?: (progress: WorkerProgressPayload) => void`.
- When `newCampaign.rules.macroWorld?.enabled === true`:
  - Call `resetMacroWorldWorker()`.
  - Call `const generatedMacro = await runLegendsWorldgenOffload(buildLegendsInput(newCampaign, finalSeed), onProgress)`.
  - Invoke `state = seedGameStateFromLegends(state, generatedMacro)`.
- In `src/core/session/session_dom.ts`: Display `LoadingOverlay` (`"Forging World History..."`) during `startNewGame` when `onProgress` fires, hiding it once ready.

---

### Task Group D — Milestone 186: Site Materialization & Preact Legends Browser UI

#### Task D1: Idempotent Chunk & Area Site Materializer (`src/systems/map/site_materializer.ts`) *(NEW)*
- `materializeMacroSitesForChunk(state: GameState, chunk: WorldChunk, areaId: string)`:
  - Short-circuits immediately (`return { state, chunk, materializedCount: 0 }`) when `!state.macroWorld` or `chunk.cz !== 0`.
  - Finds matching `MacroSiteRecord`s (`site.chunkX === chunk.cx && site.chunkY === chunk.cy`) and active `MacroCaravanRecord`s currently at `(chunk.cx, chunk.cy)`.
  - Filters unmaterialized deltas via `state.macroWorld.materializedDeltaIds` and tracks chunk stamp key (`chunk_stamp:${areaId}:${chunk.cx},${chunk.cy}`) so re-entering a previously evicted chunk never duplicates buildings, fires, artifacts, or survivors.
  - Materializes by archetype & status using strictly declarative `TileDefinition` and item/entity tag lookups (`resolveTileIdsForMaterialization`, `findEntityTemplatesByTag`, `findItemsByTag`):
    - **Settlement / Fortress (`intact`):** Carves cleared plaza floor (`floorTile`), builds stone wall perimeter with open entrance doorway (`wallTile`), sets `CHUNK_DIRTY_PERSIST | CHUNK_DIRTY_REGION`, and spawns local guard/townsperson NPCs.
    - **Raided / Burnt Site (`raided` / `burned`):** Applies charred/burnt tiles (`burnedTileId` fallback -> `floorTile`), raises local voxel temperatures (`+BURNT_SITE_EMBER_TEMP_DELTA_C`, flagging `CHUNK_DIRTY_TEMP`), spawns a decaying `smoke` field (`spawnField`), and spawns 1–2 scarred survivors carrying `ChronicleComponent.scars` and M182 trauma thoughts (`addThought` / `recordThought`).
    - **Ruined / Ancient Tomb (`ruined` or `archetype === 'ruin'`):** Stamps broken stone ruin walls + rubble floor, spawns ruin defender if matching template exists, and spawns any resident `HistoricalArtifactRecord` (`spawnItem`) upgraded with custom `IdentityComponent` (artifact name & history) and `ChronicleComponent`.
    - **Passing Caravan:** Spawns merchant (`ShopComponent` populated with items matching `caravan.cargoTags`) + escort guard, seeding `caravan` arrival/raid rumors into merchant `MemoryComponent.knowledge`.
  - Appends materialized keys to `state.macroWorld.materializedDeltaIds` (bounded by `MAX_MATERIALIZED_DELTA_IDS`) and emits `GameEventType.SiteMaterialized`.
- Hook into `src/systems/map/chunk_streaming.ts`: Inside `updateStreamingWorldWindow`, call `materializeMacroSitesForChunk` on newly woken chunks (`!deltaChunk` or newly revealed chunks) before persisting updated chunks.
- Hook into `src/systems/map/map_wake_respawn.ts`: Call `materializeMacroSitesForArea` inside `wakeSavedAreaFloor` when `areaDef.macroSiteId` (or `rules.macroWorld?.areaSiteBindings[targetAreaId]`) binds a finite area to a macro site.

#### Task D2: `UIMode.Legends`, Intents, Command Catalog & Dock Wiring
Exact files touched for full keyboard + HUD + modal integration:
1. `src/types/game-state.types.ts`: `UIMode.Legends = 'legends'`.
2. `src/types/intents/intent.enum.ts`: `ToggleLegends = 'ToggleLegends'`.
3. `src/types/intents/ui.intents.ts` & `intent.union.ts`: `ToggleLegendsIntent`.
4. `src/actions/core.actions.ts`: `createToggleLegendsAction(entityId)`.
5. `src/actions/action.registry.ts`: Handle `IntentType.ToggleLegends` -> `toggleModal(state, UIMode.Legends)`.
6. `src/core/input/command_catalog.ts`: Add `panel.legends` (`defaultBindings: [{ key: 'h', shift: true }]`, `scopes: ['world_gameplay', 'active_modal']`, `category: 'panels'`).
7. `src/core/input/shortcut_input.ts`: Add `{ commandId: 'panel.legends', buildIntent: createToggleLegendsAction }`.
8. `src/core/input/modal_input.ts`: Add optional `commandId?: string` support to `ModalBinding` (checked via `commandRegistry.getEffectiveBindings(binding.commandId, getCommandBindings())`) and register `{ mode: UIMode.Legends, commandId: 'panel.legends', buildToggleIntent: createToggleLegendsAction }`.
9. `src/rendering/ui/hud/HudRoot.tsx`: Include `gameState.uiMode === UIMode.Legends` in `isPlayVisible`.
10. `src/rendering/ui/hud_dock.ui.ts`: Add `{ id: 'dock-btn-legends', label: 'Legends', icon: '🗺️', commandId: 'panel.legends', fallbackBadge: 'Shift+H', activeMode: UIMode.Legends, onTrigger: (_s, pId) => queuePlayerIntent(createToggleLegendsAction(pId)) }`.
11. `src/rendering/ui/core/AppUiRoot.tsx`: Render `<LegendsModal />`.
12. `src/rendering/ui/modals/LedgerModal.tsx` & `NemesisDossierModal.tsx`: Add optional `"World Legends"` footer button when `state.macroWorld !== undefined`.

#### Task D3: `<LegendsModal />` (`src/rendering/ui/modals/LegendsModal.tsx`) *(NEW)*
- Uses shared Preact primitives exclusively (`ModalShell`, `Tabs`, `SplitPane`, `Panel`, `TextInput`, `Badge`, `Button`) + `--ui-*` semantic CSS variables (`parchment`, `retro-crt`, `obsidian-brass` theme-safe).
- 5 tabs (`'map' | 'figures' | 'sites' | 'artifacts' | 'chronicle'`):
  1. **World Map & Eras:** Continental ASCII grid showing biomes, site glyphs, active caravans (`c`), armies (`⚔`), weather fronts summary, and clickable site inspection + Era breakdown.
  2. **Historical Figures:** Searchable `SplitPane` with status badges (`Alive`/`Dead`), dynasty, kill count, scars, rivalries, and linked event chronicle.
  3. **Sites & Civilizations:** Searchable `SplitPane` showing archetype, status (`intact`, `raided`, `burned`, `ruined`, `besieged`), controlling faction, prosperity/population/garrison, chunk coords `(cx, cy)`, linked artifacts, and recent deltas.
  4. **Artifacts & Relics:** Searchable list showing creator, year forged, owner provenance chain, and resting site/tomb link.
  5. **World Chronicle:** Era filter + text search across all multi-century + live Ring 2 `LegendsEventRecord`s with clickable site/figure cross-links that switch tabs directly to the referenced record.

---

### Task Group E — Default Campaign Showcase, Automated Tests, Docs & Verification

#### Task E1: Default Campaign Showcase (`public/data/campaigns/default/`)
- `rules.json`: Add `"macroWorld"` block (`enabled: true`, `worldWidth: 24`, `worldHeight: 24`, `historyYears: 120`, `siteCount: 10`, `macroTickIntervalTurns: 100`, `enableWeatherFronts: true`, `areaSiteBindings: {}`).
- `tag_registry.json` (and `ai-prompt-kit/` sync): Ensure showcase tags referenced by site materialization (`merchant`, `guard`, `survivor`, `raider`, `artifact_base`, `burnt`, `rubble`) are registered cleanly if needed, keeping all 5 campaigns at 0 errors / 0 warnings.

#### Task E2: 4 New Automated Regression Test Suites
1. `tests/macro_world_worker.test.ts` (M184): Seed determinism + zero `ROT.RNG` drift, settlement prosperity/recovery, caravan travel & ambush vs. arrival, faction army raids emitting `MacroSiteDelta`s, seasonal calendar & weather front thermal delta on `temperature_physics`, turn-boundary sync, bulk time-skip catch-up, and `save.ts` round-trip serialization.
2. `tests/legends_worldgen.test.ts` (M185): Continental heightmap/biome/river determinism, cooperative generator `WorkerProgressPayload` yields, dynasty/figure/artifact/ruin generation, Era grouping, and `seedGameStateFromLegends` (`persistentEntities`, `ChronicleComponent`, `historicalLedger`).
3. `tests/site_materializer.test.ts` (M186): Chunk-wake materialization on `updateStreamingWorldWindow` for intact settlements, raided/burnt sites (tile burn, heat embers, `smoke` field, scarred survivor with M182 trauma thought), ancient tomb artifact spawning with custom `IdentityComponent`, passing caravan `ShopComponent` + Ring 2 rumors, finite area binding, and strict idempotency across chunk eviction/re-wake.
4. `tests/legends_modal.test.tsx` (M186): Preact render tests (`preact-render-to-string` / `happy-dom`) verifying empty fallback state, all 5 tabs, text search filtering, cross-tab entity/site selection, and `panel.legends` (`Shift+H`) shortcut dispatch without command conflicts.

#### Task E3: SSOT Registry, Documentation & 8-Stage Verification
- Add all new Tier 1 Console modules to `docs/ssot/ssot_console.json`, run `bun scripts/map-codebase.ts` to regenerate `docs/SSOT_CONSOLE.md`.
- Update `docs/ARCHITECTURE.md` (add §9.35 for Phase 48) and mark Milestones 184–186 Complete in `docs/MILESTONES.md`.
- Execute full `./verify.sh` across all 8 stages (`tsc`, `prettier`, `eslint`, `depcruise`, `knip`, `bun test`, `vite build`, `run-validator.ts`) -> 0 errors, 0 warnings.

---

## 4. Cascading Effects Matrix (`AGENTS.md` Rule 15)

| Change | Upstream | Downstream | Lateral |
| :--- | :--- | :--- | :--- |
| **Constants, Types, Zod Schemas & Save (`macro_world.{constants,types}.ts`, `meta.ts`, `world.ts`, `game-state.types.ts`, `save.ts`)** | `rules.json` / `areas.json` campaign authoring, `bootstrap.ts` | `serializeGameState` / `deserializeGameState` (`save.ts`), all macro & UI consumers | 5 sibling campaigns (strictly optional schema keeps 100% compatibility), `ssot_console.json` |
| **Ring 2 Simulation Kernel & Persistent Worker (`world_sim.worker.ts`, `macro_world.system.ts`, `worker_bridge.ts`)** | `simulation_cadence.ts` (`processTier3GlobalCadence`), `world_time_skip.ts` (`advanceWorldTimeBulk*`), `worker.types.ts` | `historicalLedger`, `pendingRumors`, `DirectorBudgetComponent`, `temperature_physics.ts` (outdoor ambient delta), `world_clock.system.ts` | Headless `bun test` fallback parity (`isWorkerAvailable() === false`), `ROT.RNG` isolation invariant |
| **Offline Legends Worldgen Worker (`legends_worldgen.worker.ts`, `worldgen_continent.ts`, `legends_simulator.ts`)** | `bootstrap.ts` (`startNewGame`), `session_dom.ts` (`LoadingOverlay` progress), `world_entities_bootstrap.ts` | `GameState.macroWorld`, `persistentEntities`, `nemesisSlots`, `historicalLedger`, faction & area `ChronicleComponent`s | `identity_generation.json`, `nemesis_hierarchies.json`, `default/rules.json` |
| **Idempotent Site Materializer (`site_materializer.ts`)** | `chunk_streaming.ts` (`updateStreamingWorldWindow`), `map_wake_respawn.ts` (`wakeSavedAreaFloor`) | `WorldChunk` SoA buffers (`CHUNK_DIRTY_PERSIST \| REGION \| TEMP`), `field.system.ts` (`smoke`), `ecs_spawner.ts`, `needs/thoughts.system.ts`, `save.ts` (`materializedDeltaIds`) | `default/tag_registry.json`, `ai-prompt-kit/`, `TileDefinitionSchema.burnedTileId` |
| **Preact Legends Modal & Keybind Wiring (`LegendsModal.tsx`, `UIMode.Legends`, `panel.legends`)** | `core.actions.ts`, `action.registry.ts`, `command_catalog.ts`, `shortcut_input.ts`, `modal_input.ts`, `hud_dock.ui.ts`, `LedgerModal.tsx`, `NemesisDossierModal.tsx` | `AppUiRoot.tsx`, `HudRoot.tsx`, Phase 43 shared primitives (`ModalShell`, `Tabs`, `SplitPane`, `TextInput`, `Badge`), `HelpModal.tsx` | `tests/input_scope_and_keymap.test.ts`, 3-theme CSS tokens (`parchment`, `retro-crt`, `obsidian-brass`) |

---

## 5. Verification Plan & Pitfalls

### Verification Commands
1. Targeted Phase 48 test runs during implementation:
   - `bun test tests/macro_world_worker.test.ts tests/legends_worldgen.test.ts tests/site_materializer.test.ts tests/legends_modal.test.tsx tests/input_scope_and_keymap.test.ts`
2. SSOT regeneration & full 8-stage pipeline:
   - `bun scripts/map-codebase.ts`
   - `./verify.sh` (`tsc`, `prettier`, `eslint`, `depcruise`, `knip`, `bun test`, `vite build`, `run-validator.ts`)

### Known Pitfalls to Guard Against
1. **Strict `ROT.RNG` Isolation:** Never invoke `ROT.RNG` inside `macro_world.system.ts`, `worldgen_continent.ts`, or `legends_simulator.ts`. Always use `createMacroRng(seed, salt)` so async Web Worker ticks never perturb main-thread combat or loot RNG sequences.
2. **Headless `bun test` Fallback:** Node/Bun test environments have `typeof Worker === 'undefined'`. Every entrypoint in `worker_bridge.ts` must automatically execute the identical pure simulation function without throwing.
3. **Downward Dependency Purity:** Never import `uiStore` inside `src/core/bootstrap.ts`; pass `onProgress?: (progress: WorkerProgressPayload) => void` cleanly from `session_dom.ts`.
4. **Idempotent Chunk Re-Entry:** Evicting a chunk and walking back into it later must never duplicate survivors, ruins, or artifacts — enforce `materializedDeltaIds` and `chunk_stamp:` keys inside `state.macroWorld`, and set `CHUNK_DIRTY_PERSIST | CHUNK_DIRTY_REGION`.
5. **Keymap Test Parity:** Inspect `tests/input_scope_and_keymap.test.ts` when adding `panel.legends` (`Shift+H`) to verify zero chord conflicts or command catalog snapshot mismatches.
6. **Campaign Tag Parity:** Validate all 5 campaigns with `bun run scripts/run-validator.ts` after updating `public/data/campaigns/default/rules.json` and `tag_registry.json` (plus `ai-prompt-kit/`).
