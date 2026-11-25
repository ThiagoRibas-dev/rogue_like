import {
  CONTINENT_COAST_MAX_ELEV,
  CONTINENT_HILL_MIN_ELEV,
  CONTINENT_MOUNTAIN_MIN_ELEV,
  CONTINENT_PEAK_RIVER_COUNT,
  CONTINENT_SEA_LEVEL,
  DEFAULT_WORLDGEN_SEED_OFFSET,
  SITE_INITIAL_FOOD_STOCK,
  SITE_MIN_SEPARATION_CELLS,
  STREAMING_OVERWORLD_SITE_SPAN_CHUNKS,
  WEATHER_FRONT_BASE_RADIUS_CELLS,
  WEATHER_INITIAL_DURATION_TICKS
} from '../constants/macro_world.constants.ts';
import type {
  LegendsWorldgenInput,
  MacroBiomeKind,
  MacroContinentCell,
  MacroContinentGrid,
  MacroSiteArchetype,
  MacroSiteRecord,
  MacroWeatherFront,
  MacroWorldState
} from '../types/macro_world.types.ts';
import { worldToChunkCoord } from '../utils/grid.ts';

function hash2D(seed: number, x: number, y: number): number {
  let h = (seed ^ Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263)) | 0;
  h ^= h >>> 13;
  h = Math.imul(h, 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function valueNoise2D(seed: number, x: number, y: number, scale: number): number {
  const gx = Math.floor(x / scale);
  const gy = Math.floor(y / scale);
  const tx = smoothstep((x - gx * scale) / scale);
  const ty = smoothstep((y - gy * scale) / scale);

  const v00 = hash2D(seed, gx, gy);
  const v10 = hash2D(seed, gx + 1, gy);
  const v01 = hash2D(seed, gx, gy + 1);
  const v11 = hash2D(seed, gx + 1, gy + 1);

  const nx0 = v00 + (v10 - v00) * tx;
  const nx1 = v01 + (v11 - v01) * tx;
  return nx0 + (nx1 - nx0) * ty;
}

function fractalNoise(seed: number, x: number, y: number): number {
  const n1 = valueNoise2D(seed, x, y, 10) * 0.58;
  const n2 = valueNoise2D(seed ^ 0x9e3779b9, x, y, 5) * 0.28;
  const n3 = valueNoise2D(seed ^ 0x85ebca6b, x, y, 2.5) * 0.14;
  return n1 + n2 + n3;
}

function classifyBiome(elevation: number, rainfall: number, baseTempC: number): MacroBiomeKind {
  if (elevation < CONTINENT_SEA_LEVEL) return 'ocean';
  if (elevation < CONTINENT_COAST_MAX_ELEV) return 'coast';
  if (elevation >= CONTINENT_MOUNTAIN_MIN_ELEV) return 'mountain';
  if (elevation >= CONTINENT_HILL_MIN_ELEV) return 'hills';
  if (baseTempC <= 0) return 'tundra';
  if (rainfall < 0.28 && baseTempC >= 18) return 'desert';
  if (rainfall > 0.7 && elevation < 0.5) return 'swamp';
  if (rainfall > 0.52) return 'forest';
  return 'plains';
}

/**
 * Isolated deterministic Mulberry32 PRNG keyed strictly by `(seed, salt)`.
 * Never reads or mutates the global `ROT.RNG` singleton, guaranteeing identical outputs
 * across main-thread execution, continental worldgen, and Ring 2 Web Workers.
 *
 * @param seed Base world seed.
 * @param salt Per-tick or per-domain salt.
 * @returns Pure pseudo-random number generator yielding floats in `[0, 1)`.
 */
export function createMacroRng(seed: number, salt = 0): () => number {
  let state = (seed ^ Math.imul(salt | 0, 0x9e3779b1)) | 0;
  return (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildSiteName(rngFn: () => number, firstPool: ReadonlyArray<string>, archetype: MacroSiteArchetype): string {
  const roots =
    firstPool.length > 0
      ? firstPool
      : ['Ash', 'Stone', 'Iron', 'Oak', 'Silver', 'High', 'Raven', 'Dawn', 'Frost', 'Gold', 'Dusk', 'Red'];
  const suffixesByArchetype: Readonly<Record<MacroSiteArchetype, ReadonlyArray<string>>> = {
    capital: ['hold', 'haven', 'stead', 'gard'],
    town: ['ford', 'bridge', 'burg', 'cross'],
    hamlet: ['wick', 'meadow', 'dale', 'brook'],
    fortress: ['keep', 'watch', 'bastion', 'citadel'],
    shrine: ['sanctum', 'spire', 'grove', 'altar'],
    ruin: ['vault', 'crypt', 'barrow', 'hollow']
  };
  const rootRaw = roots[Math.floor(rngFn() * roots.length) % roots.length] ?? 'Stone';
  const root = rootRaw.replace(/[^A-Za-z]/g, '').slice(0, 7) || 'Stone';
  const suffixes = suffixesByArchetype[archetype];
  const suffix = suffixes[Math.floor(rngFn() * suffixes.length) % suffixes.length] ?? 'stead';
  return `${root.charAt(0).toUpperCase()}${root.slice(1).toLowerCase()}${suffix}`;
}

function traceBresenhamLine(x0: number, y0: number, x1: number, y1: number): Array<readonly [number, number]> {
  const points: Array<readonly [number, number]> = [];
  let cx = x0;
  let cy = y0;
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  const maxSteps = dx + dy + 1;
  for (let step = 0; step <= maxSteps; step++) {
    points.push([cx, cy]);
    if (cx === x1 && cy === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      cx += sx;
    }
    if (e2 < dx) {
      err += dx;
      cy += sy;
    }
  }
  return points;
}

/**
 * Resolves the coarse continental cell underlying a world coordinate `(wx, wy)` inside `chunkSize` chunks.
 * Maps world chunk `(0, 0)` cleanly to the center of the continent grid (`floor(width/2), floor(height/2)`).
 *
 * @param continent Generated continent grid.
 * @param wx World X coordinate.
 * @param wy World Y coordinate.
 * @param chunkSize Active streaming chunk dimension.
 * @returns Matching `MacroContinentCell` clamped cleanly to continental edges.
 */
export function mapWorldCoordToContinentCell(
  continent: Readonly<MacroContinentGrid>,
  wx: number,
  wy: number,
  chunkSize: number
): MacroContinentCell | undefined {
  if (continent.width <= 0 || continent.height <= 0) return undefined;
  const cx = worldToChunkCoord(wx, chunkSize);
  const cy = worldToChunkCoord(wy, chunkSize);
  const centerX = Math.floor(continent.width / 2);
  const centerY = Math.floor(continent.height / 2);
  const cellX = Math.max(0, Math.min(continent.width - 1, centerX + cx));
  const cellY = Math.max(0, Math.min(continent.height - 1, centerY + cy));
  return continent.cells[cellY * continent.width + cellX];
}

/**
 * Deterministically synthesizes the base continental heightmap, rainfall/temperature climate,
 * biomes, downhill rivers, overland road network, initial settlements, and weather fronts
 * without touching the global `ROT.RNG` state.
 *
 * @param input Continent generation dimensions, seed, and campaign metadata.
 * @returns Initial `MacroWorldState` ready for multi-century Legends simulation.
 */
export function generateContinentalMacroWorld(input: LegendsWorldgenInput): MacroWorldState {
  const width = Math.max(12, Math.min(64, input.width));
  const height = Math.max(12, Math.min(64, input.height));
  const seed = (input.worldSeed ^ DEFAULT_WORLDGEN_SEED_OFFSET) | 0;
  const rngFn = createMacroRng(seed, 0);

  const centerX = Math.floor(width / 2);
  const centerY = Math.floor(height / 2);
  const maxRadius = Math.max(1, Math.min(centerX, centerY));

  const cells: MacroContinentCell[] = [];
  for (let y = 0; y < height; y++) {
    const latDist = Math.abs(y - centerY) / Math.max(1, centerY);
    for (let x = 0; x < width; x++) {
      const dx = (x - centerX) / maxRadius;
      const dy = (y - centerY) / maxRadius;
      const radialFalloff = Math.min(1, Math.hypot(dx, dy) * 0.72);
      const rawElev = fractalNoise(seed, x, y);
      const elevation = Math.max(0, Math.min(1, rawElev * 1.15 + 0.16 - radialFalloff * 0.55));
      const rainfall = Math.max(0, Math.min(1, fractalNoise(seed ^ 0x517cc1b7, x + 17, y + 31)));
      const baseTempC = Math.round(28 - latDist * 26 - Math.max(0, elevation - CONTINENT_SEA_LEVEL) * 18);
      const biome = classifyBiome(elevation, rainfall, baseTempC);
      cells.push({
        x,
        y,
        elevation,
        rainfall,
        baseTempC,
        biome,
        hasRiver: false,
        hasRoad: false
      });
    }
  }

  // Carve deterministic rivers from high mountain/hill peaks toward sea level
  const peaks = cells
    .filter((c) => c.elevation >= CONTINENT_HILL_MIN_ELEV)
    .sort((a, b) => b.elevation - a.elevation)
    .slice(0, CONTINENT_PEAK_RIVER_COUNT);
  const riverIndices = new Set<number>();
  for (const peak of peaks) {
    let cur = peak;
    for (let step = 0; step < width + height; step++) {
      riverIndices.add(cur.y * width + cur.x);
      if (cur.biome === 'ocean' || cur.biome === 'coast') break;
      let lowest = cur;
      for (const [ox, oy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1]
      ] as const) {
        const nx = cur.x + ox;
        const ny = cur.y + oy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const cand = cells[ny * width + nx]!;
        if (cand.elevation < lowest.elevation) lowest = cand;
      }
      if (lowest === cur) break;
      cur = lowest;
    }
  }

  // Place named sites across habitable cells, anchoring showcase sites near world chunk center (0, 0)
  const factions = input.context.factions.length > 0 ? input.context.factions : ['town'];
  const habitable = cells.filter((c) => c.elevation >= CONTINENT_COAST_MAX_ELEV && c.biome !== 'mountain');
  const nearCenter = habitable.filter(
    (c) =>
      Math.max(Math.abs(c.x - centerX), Math.abs(c.y - centerY)) >= 2 &&
      Math.max(Math.abs(c.x - centerX), Math.abs(c.y - centerY)) <= STREAMING_OVERWORLD_SITE_SPAN_CHUNKS
  );

  const chosenCoords: Array<MacroContinentCell> = [];
  const isFarEnough = (c: MacroContinentCell, minSep: number): boolean =>
    chosenCoords.every((other) => Math.max(Math.abs(c.x - other.x), Math.abs(c.y - other.y)) >= minSep);

  // First guarantee at least 2 nearby sites within streaming distance of (0,0)
  for (const cand of nearCenter) {
    if (chosenCoords.length >= Math.min(2, input.siteCount)) break;
    if (isFarEnough(cand, SITE_MIN_SEPARATION_CELLS)) {
      chosenCoords.push(cand);
    }
  }

  // Fill remaining sites spread cleanly across the continent
  const shuffledPool = [...habitable].sort((a, b) => hash2D(seed, a.x, a.y) - hash2D(seed, b.x, b.y));
  for (const cand of shuffledPool) {
    if (chosenCoords.length >= input.siteCount) break;
    if (isFarEnough(cand, SITE_MIN_SEPARATION_CELLS)) {
      chosenCoords.push(cand);
    }
  }
  for (const cand of shuffledPool) {
    if (chosenCoords.length >= input.siteCount) break;
    if (!chosenCoords.some((o) => o.x === cand.x && o.y === cand.y)) {
      chosenCoords.push(cand);
    }
  }

  const archetypes: ReadonlyArray<MacroSiteArchetype> = ['capital', 'town', 'fortress', 'hamlet', 'shrine', 'town'];
  const sitesRecord: Record<string, MacroSiteRecord> = {};
  const siteList: MacroSiteRecord[] = [];
  const boundEntries = Object.entries(input.areaSiteBindings);
  const usedNames = new Set<string>();

  for (let i = 0; i < chosenCoords.length; i++) {
    const cell = chosenCoords[i]!;
    const siteId = `site_${i + 1}`;
    const archetype = archetypes[i % archetypes.length] ?? 'hamlet';
    const factionId = factions[i % factions.length] ?? 'town';
    let name = buildSiteName(rngFn, input.context.nameFirstPool, archetype);
    if (usedNames.has(name)) {
      name = `${name} ${i + 1}`;
    }
    usedNames.add(name);

    const boundArea = boundEntries.find(([, sId]) => sId === siteId)?.[0];
    const site: MacroSiteRecord = {
      id: siteId,
      name,
      archetype,
      status: 'intact',
      x: cell.x,
      y: cell.y,
      chunkX: cell.x - centerX,
      chunkY: cell.y - centerY,
      factionId,
      population: archetype === 'capital' ? 420 : archetype === 'town' ? 210 : archetype === 'fortress' ? 140 : 90,
      prosperity: archetype === 'capital' ? 78 : archetype === 'town' ? 64 : 52,
      foodStock: SITE_INITIAL_FOOD_STOCK,
      garrison: archetype === 'fortress' ? 48 : archetype === 'capital' ? 40 : 20,
      isCapital: i < factions.length && archetype === 'capital',
      foundedYear: 1,
      connectedSiteIds: [],
      residentFigureIds: [],
      artifactIds: [],
      ...(boundArea !== undefined ? { boundAreaId: boundArea } : {})
    };
    sitesRecord[siteId] = site;
    siteList.push(site);
  }

  // Build connected road graph (chain nearest neighbors + ring closure)
  const roadIndices = new Set<number>();
  const linkMap = new Map<string, Set<string>>();
  for (const s of siteList) linkMap.set(s.id, new Set<string>());

  for (let i = 0; i < siteList.length; i++) {
    const a = siteList[i]!;
    const nearest = [...siteList]
      .filter((b) => b.id !== a.id)
      .sort((u, v) => Math.hypot(u.x - a.x, u.y - a.y) - Math.hypot(v.x - a.x, v.y - a.y))
      .slice(0, 2);
    for (const b of nearest) {
      linkMap.get(a.id)!.add(b.id);
      linkMap.get(b.id)!.add(a.id);
      for (const [rx, ry] of traceBresenhamLine(a.x, a.y, b.x, b.y)) {
        if (rx >= 0 && rx < width && ry >= 0 && ry < height) {
          roadIndices.add(ry * width + rx);
        }
      }
    }
  }

  const siteCellByIdx = new Map<number, MacroSiteRecord>();
  for (const s of siteList) {
    siteCellByIdx.set(s.y * width + s.x, s);
    sitesRecord[s.id] = {
      ...s,
      connectedSiteIds: Array.from(linkMap.get(s.id) ?? [])
    };
  }

  const finalCells: MacroContinentCell[] = cells.map((cell, idx) => {
    const siteAt = siteCellByIdx.get(idx);
    return {
      ...cell,
      hasRiver: riverIndices.has(idx),
      hasRoad: roadIndices.has(idx),
      ...(siteAt !== undefined ? { siteId: siteAt.id, ownerFactionId: siteAt.factionId } : {})
    };
  });

  const initialWeather: MacroWeatherFront[] = input.enableWeatherFronts
    ? [
        {
          id: 'front_1',
          kind: 'rain',
          x: Math.floor(width * 0.25),
          y: Math.floor(height * 0.3),
          radiusCells: WEATHER_FRONT_BASE_RADIUS_CELLS,
          dx: 1,
          dy: 0,
          remainingTicks: WEATHER_INITIAL_DURATION_TICKS
        }
      ]
    : [];

  return {
    worldSeed: input.worldSeed,
    currentTick: 0,
    lastDispatchedTick: 0,
    tickIntervalTurns: input.tickIntervalTurns,
    continent: {
      width,
      height,
      cells: finalCells,
      seaLevel: CONTINENT_SEA_LEVEL
    },
    sites: sitesRecord,
    caravans: {},
    armies: {},
    weatherFronts: initialWeather,
    pendingSiteDeltas: [],
    materializedDeltaIds: [],
    legends: {
      worldName: input.worldName,
      simulatedYears: input.historyYears,
      eras: [],
      figures: {},
      artifacts: {},
      events: []
    }
  };
}
