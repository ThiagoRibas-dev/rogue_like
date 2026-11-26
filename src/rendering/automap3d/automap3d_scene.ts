import * as ROT from 'rot-js';
import {
  AUTOMAP_BEACON_COLORS,
  AUTOMAP_FALLBACK_COLORS,
  DEFAULT_ATLAS_PREVIEW_SEED
} from '../../constants/automap3d.constants.ts';
import {
  FLUID_DEPTH_MASK,
  FLUID_KIND_MASK,
  FLUID_KIND_SHIFT,
  FluidKindCode
} from '../../constants/world_chunk.constants.ts';
import { getComponent } from '../../core/ecs.ts';
import { getMapZBounds, getTileAt, getFluidByteAt, isTileKeyInFov } from '../../map/map_accessor.ts';
import type {
  AutomapAreaCluster3D,
  AutomapBeacon3D,
  AutomapNote,
  AutomapScene3D,
  AutomapSceneBounds3D,
  AutomapVisibilityMode,
  AutomapVoxelCell3D,
  AutomapVoxelEntityMarker,
  AutomapVoxelKind
} from '../../types/automap3d.types.ts';
import type { AreaConnection, CampaignData, TileDefinition } from '../../types/campaign.types.ts';
import {
  ComponentType,
  type EdgeTransitionComponent,
  type IdentityComponent,
  type LightEmitterComponent,
  type PortalComponent,
  type PositionComponent,
  type RenderableComponent
} from '../../types/components.types.ts';
import type { GameMap, GameState } from '../../types/game-state.types.ts';
import { toSpatialKey } from '../../utils/grid.ts';

/** Placed entity descriptor accepted by {@link buildAreaVoxelScene3D} for static/generated previews. */
export interface AutomapPlacedEntityHint {
  readonly templateId: string;
  readonly x: number;
  readonly y: number;
  readonly z?: number | undefined;
}

/** Portal descriptor accepted by {@link buildAreaVoxelScene3D}. */
export interface AutomapPortalHint {
  readonly x: number;
  readonly y: number;
  readonly z?: number | undefined;
  readonly connection: AreaConnection;
}

/** Options controlling how a single area `GameMap` is extracted into 3D voxels and beacons. */
export interface BuildAreaSceneOptions {
  readonly areaId: string;
  readonly areaName: string;
  readonly generatorType?: string | undefined;
  readonly dangerRating?: number | undefined;
  readonly map: Readonly<GameMap>;
  readonly tiles: Readonly<Record<string, TileDefinition>>;
  readonly entities?: Readonly<CampaignData['entities']> | undefined;
  readonly visibilityMode: AutomapVisibilityMode;
  readonly offsetWx?: number | undefined;
  readonly offsetWy?: number | undefined;
  readonly offsetWz?: number | undefined;
  readonly startPos?: { readonly x: number; readonly y: number; readonly z?: number | undefined } | undefined;
  readonly portals?: ReadonlyArray<AutomapPortalHint> | undefined;
  readonly placedEntities?: ReadonlyArray<AutomapPlacedEntityHint> | undefined;
  readonly notes?: ReadonlyArray<AutomapNote> | undefined;
  readonly fovChecker?: ((x: number, y: number, z: number) => boolean) | undefined;
  readonly seed?: number | undefined;
  readonly maxRadiusFromStart?: number | undefined;
}

/** Parsed RGB triplet `[r, g, b]` in `0..255`. */
type RgbTriplet = readonly [number, number, number];

function parseHexRgb(hex: string | undefined): RgbTriplet | null {
  if (!hex || hex[0] !== '#') return null;
  const clean = hex.slice(1).trim();
  if (clean.length === 3) {
    const r = Number.parseInt(clean[0]! + clean[0]!, 16);
    const g = Number.parseInt(clean[1]! + clean[1]!, 16);
    const b = Number.parseInt(clean[2]! + clean[2]!, 16);
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
    return [r, g, b];
  }
  if (clean.length === 6) {
    const r = Number.parseInt(clean.slice(0, 2), 16);
    const g = Number.parseInt(clean.slice(2, 4), 16);
    const b = Number.parseInt(clean.slice(4, 6), 16);
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
    return [r, g, b];
  }
  return null;
}

function rgbToHex(r: number, g: number, b: number): string {
  const clampByte = (v: number): string =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, '0');
  return `#${clampByte(r)}${clampByte(g)}${clampByte(b)}`;
}

function blendHex(a: string, b: string, factorB: number): string {
  const rgbA = parseHexRgb(a);
  const rgbB = parseHexRgb(b);
  if (!rgbA || !rgbB) return a;
  const t = Math.max(0, Math.min(1, factorB));
  return rgbToHex(rgbA[0] * (1 - t) + rgbB[0] * t, rgbA[1] * (1 - t) + rgbB[1] * t, rgbA[2] * (1 - t) + rgbB[2] * t);
}

function scaleHex(hex: string, multiplier: number): string {
  const rgb = parseHexRgb(hex);
  if (!rgb) return hex;
  return rgbToHex(rgb[0] * multiplier, rgb[1] * multiplier, rgb[2] * multiplier);
}

function isPureBlackHex(hex: string | undefined): boolean {
  const rgb = parseHexRgb(hex);
  if (!rgb) return true;
  return rgb[0] < 8 && rgb[1] < 8 && rgb[2] < 8;
}

/**
 * Classifies a map cell strictly from its declarative `TileDefinition` properties and cellular fluid byte
 * (Rule 21: zero tile-ID branching). Returns `null` for non-solid empty void / open air cells.
 */
export function classifyTileVoxelKind(def: TileDefinition | undefined, fluidByte: number): AutomapVoxelKind | null {
  const fluidDepth = fluidByte & FLUID_DEPTH_MASK;
  const fluidCode = (fluidByte & FLUID_KIND_MASK) >> FLUID_KIND_SHIFT;

  if (fluidDepth > 0 && fluidCode !== FluidKindCode.None) {
    if (fluidCode === FluidKindCode.Magma) return 'magma';
    if (fluidCode === FluidKindCode.Oil) return 'oil';
    if (fluidCode === FluidKindCode.Mud) return 'mud';
    return 'water';
  }

  if (!def) return null;
  if (def.isOpenAir === true) return null;

  if (def.verticalLink !== undefined) {
    return def.verticalLink;
  }
  if (def.isClimbable === true) {
    return 'ladder';
  }

  // Non-solid void space (walkable=false, transparent=false, non-mineable blank glyph) stays transparent in 3D.
  if (
    !def.walkable &&
    !def.transparent &&
    def.isSolidObstacle !== true &&
    def.mineable !== true &&
    def.isLoadBearing !== true &&
    def.glyph.trim() === ''
  ) {
    return null;
  }

  if (def.walkable && def.glyph === '<') return 'stairs_up';
  if (def.walkable && def.glyph === '>') return 'stairs_down';

  const tags = def.tags;
  if (tags && tags.length > 0) {
    if (tags.includes('magma') || tags.includes('lava')) return 'magma';
    if (tags.includes('oil')) return 'oil';
    if (tags.includes('mud')) return 'mud';
    if (tags.includes('water') || tags.includes('liquid')) return 'water';
  }

  if (!def.walkable || def.isSolidObstacle === true) {
    return 'wall';
  }

  return 'floor';
}

function resolveVoxelColors(
  kind: AutomapVoxelKind,
  def: TileDefinition | undefined
): { readonly topColor: string; readonly sideColor: string } {
  const bgValid = def && !isPureBlackHex(def.bg) ? def.bg : undefined;
  const fgValid = def && !isPureBlackHex(def.fg) ? def.fg : undefined;

  switch (kind) {
    case 'wall': {
      const base =
        bgValid ??
        (fgValid ? blendHex(fgValid, AUTOMAP_FALLBACK_COLORS.wallTop, 0.42) : AUTOMAP_FALLBACK_COLORS.wallTop);
      return { topColor: base, sideColor: scaleHex(base, 0.72) };
    }
    case 'stairs_up':
    case 'stairs_down':
    case 'stairs_both':
    case 'ladder':
    case 'ramp': {
      const base = fgValid ?? AUTOMAP_FALLBACK_COLORS.stairsTop;
      return {
        topColor: blendHex(base, AUTOMAP_FALLBACK_COLORS.stairsTop, 0.35),
        sideColor: scaleHex(base, 0.68)
      };
    }
    case 'water': {
      const base = bgValid ?? fgValid ?? AUTOMAP_FALLBACK_COLORS.waterTop;
      return { topColor: base, sideColor: scaleHex(base, 0.72) };
    }
    case 'magma': {
      const base = bgValid ?? fgValid ?? AUTOMAP_FALLBACK_COLORS.magmaTop;
      return { topColor: base, sideColor: scaleHex(base, 0.74) };
    }
    case 'oil': {
      const base = bgValid ?? fgValid ?? AUTOMAP_FALLBACK_COLORS.oilTop;
      return { topColor: base, sideColor: scaleHex(base, 0.72) };
    }
    case 'mud': {
      const base = bgValid ?? fgValid ?? AUTOMAP_FALLBACK_COLORS.mudTop;
      return { topColor: base, sideColor: scaleHex(base, 0.72) };
    }
    case 'floor': {
      const base =
        bgValid ??
        (fgValid ? blendHex(AUTOMAP_FALLBACK_COLORS.floorTop, fgValid, 0.25) : AUTOMAP_FALLBACK_COLORS.floorTop);
      return { topColor: base, sideColor: scaleHex(base, 0.7) };
    }
  }
}

interface RawCellEntry {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly tileId: string;
  readonly def: TileDefinition | undefined;
  readonly kind: AutomapVoxelKind;
  readonly explored: boolean;
  readonly fluidDepth: number;
}

const WALL_SHELL_OFFSETS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [1, 1, 0],
  [-1, 1, 0],
  [1, -1, 0],
  [-1, -1, 0],
  [0, 0, 1],
  [0, 0, -1]
];

function collectRawAreaCells(
  map: Readonly<GameMap>,
  tiles: Readonly<Record<string, TileDefinition>>,
  visibilityMode: AutomapVisibilityMode,
  windowBounds?: {
    readonly minX: number;
    readonly maxX: number;
    readonly minY: number;
    readonly maxY: number;
  }
): {
  readonly cellMap: Map<string, RawCellEntry>;
  readonly minLocalX: number;
  readonly maxLocalX: number;
  readonly minLocalY: number;
  readonly maxLocalY: number;
  readonly minZ: number;
  readonly maxZ: number;
} {
  const cellMap = new Map<string, RawCellEntry>();
  let minLocalX = Infinity;
  let maxLocalX = -Infinity;
  let minLocalY = Infinity;
  let maxLocalY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  const inspectCell = (x: number, y: number, z: number): void => {
    if (
      windowBounds !== undefined &&
      (x < windowBounds.minX || x > windowBounds.maxX || y < windowBounds.minY || y > windowBounds.maxY)
    ) {
      return;
    }
    const snap = getTileAt(map, x, y, z);
    if (!snap) return;
    const isExplored = map.isFullyExplored === true || snap.explored;
    if (visibilityMode === 'explored_only' && !isExplored) return;

    const fluidByte = getFluidByteAt(map, x, y, z);
    const def = tiles[snap.tileId];
    const kind = classifyTileVoxelKind(def, fluidByte);
    if (!kind) return;

    const fluidDepth = fluidByte & FLUID_DEPTH_MASK;
    cellMap.set(toSpatialKey(x, y, z), {
      x,
      y,
      z,
      tileId: snap.tileId,
      def,
      kind,
      explored: isExplored,
      fluidDepth
    });

    if (x < minLocalX) minLocalX = x;
    if (x > maxLocalX) maxLocalX = x;
    if (y < minLocalY) minLocalY = y;
    if (y > maxLocalY) maxLocalY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  };

  if (map.chunkGrid !== undefined) {
    for (const chunk of map.chunkGrid.chunks.values()) {
      const baseX = chunk.cx * chunk.size;
      const baseY = chunk.cy * chunk.size;
      for (let ly = 0; ly < chunk.size; ly++) {
        for (let lx = 0; lx < chunk.size; lx++) {
          inspectCell(baseX + lx, baseY + ly, chunk.cz);
        }
      }
    }
  } else {
    const { minZ: mapMinZ, maxZ: mapMaxZ } = getMapZBounds(map);
    for (let z = mapMinZ; z <= mapMaxZ; z++) {
      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          inspectCell(x, y, z);
        }
      }
    }
  }

  if (!Number.isFinite(minLocalX)) {
    return { cellMap, minLocalX: 0, maxLocalX: 0, minLocalY: 0, maxLocalY: 0, minZ: 0, maxZ: 0 };
  }
  return { cellMap, minLocalX, maxLocalX, minLocalY, maxLocalY, minZ, maxZ };
}

function hasAdjacentNonWallSpace(cellMap: ReadonlyMap<string, RawCellEntry>, x: number, y: number, z: number): boolean {
  for (const [dx, dy, dz] of WALL_SHELL_OFFSETS) {
    const neighbor = cellMap.get(toSpatialKey(x + dx, y + dy, z + dz));
    if (neighbor && neighbor.kind !== 'wall') {
      return true;
    }
  }
  return false;
}

/**
 * Computes inclusive world-space bounds for any array of voxels (returning zeroed bounds if empty).
 */
export function computeSceneBounds3D(voxels: ReadonlyArray<AutomapVoxelCell3D>): AutomapSceneBounds3D {
  if (voxels.length === 0) {
    return { minWx: 0, maxWx: 0, minWy: 0, maxWy: 0, minWz: 0, maxWz: 0 };
  }
  let minWx = Infinity;
  let maxWx = -Infinity;
  let minWy = Infinity;
  let maxWy = -Infinity;
  let minWz = Infinity;
  let maxWz = -Infinity;
  for (const v of voxels) {
    if (v.wx < minWx) minWx = v.wx;
    if (v.wx > maxWx) maxWx = v.wx;
    if (v.wy < minWy) minWy = v.wy;
    if (v.wy > maxWy) maxWy = v.wy;
    if (v.wz < minWz) minWz = v.wz;
    if (v.wz > maxWz) maxWz = v.wz;
  }
  return { minWx, maxWx, minWy, maxWy, minWz, maxWz };
}

/**
 * Builds a complete `AutomapScene3D` for a single finite or chunked area map, culling interior solid bedrock
 * into Daggerfall-style hollow corridor shells and projecting stairs, fluids, light embers, portals, and notes.
 */
export function buildAreaVoxelScene3D(options: BuildAreaSceneOptions): AutomapScene3D {
  const offsetWx = options.offsetWx ?? 0;
  const offsetWy = options.offsetWy ?? 0;
  const offsetWz = options.offsetWz ?? 0;

  const radius = options.maxRadiusFromStart;
  const windowBounds =
    radius !== undefined && options.startPos !== undefined
      ? {
          minX: options.startPos.x - radius,
          maxX: options.startPos.x + radius,
          minY: options.startPos.y - radius,
          maxY: options.startPos.y + radius
        }
      : undefined;

  const collected = collectRawAreaCells(options.map, options.tiles, options.visibilityMode, windowBounds);

  // Build quick coordinate lookup sets for placed lights and portals.
  const portalByCoord = new Map<string, AutomapPortalHint>();
  for (const portal of options.portals ?? []) {
    portalByCoord.set(toSpatialKey(portal.x, portal.y, portal.z ?? 0), portal);
  }

  const torchByCoord = new Set<string>();
  for (const placed of options.placedEntities ?? []) {
    const tpl = options.entities?.[placed.templateId];
    const hasLightTag = tpl?.tags?.some((t) => t === 'light_source' || t === 'torch' || t === 'brazier') ?? false;
    if (hasLightTag) {
      torchByCoord.add(toSpatialKey(placed.x, placed.y, placed.z ?? 0));
    }
  }

  const voxels: AutomapVoxelCell3D[] = [];
  const beacons: AutomapBeacon3D[] = [];

  for (const entry of collected.cellMap.values()) {
    if (entry.kind === 'wall' && !hasAdjacentNonWallSpace(collected.cellMap, entry.x, entry.y, entry.z)) {
      continue;
    }

    const wx = entry.x + offsetWx;
    const wy = entry.y + offsetWy;
    const wz = entry.z + offsetWz;
    const key = toSpatialKey(entry.x, entry.y, entry.z);
    const colors = resolveVoxelColors(entry.kind, entry.def);
    const portal = portalByCoord.get(key);
    const inFov = options.fovChecker ? options.fovChecker(entry.x, entry.y, entry.z) : undefined;
    const hasTorchEmber = torchByCoord.has(key);

    const cell: AutomapVoxelCell3D = {
      areaId: options.areaId,
      x: entry.x,
      y: entry.y,
      z: entry.z,
      wx,
      wy,
      wz,
      tileId: entry.tileId,
      kind: entry.kind,
      topColor: colors.topColor,
      sideColor: colors.sideColor,
      explored: entry.explored,
      ...(inFov !== undefined ? { inFov } : {}),
      ...(hasTorchEmber ? { hasTorchEmber: true } : {}),
      ...(entry.fluidDepth > 0 ? { fluidDepth: entry.fluidDepth } : {}),
      ...(portal ? { portalTargetAreaId: portal.connection.targetAreaId } : {}),
      label: entry.tileId
    };
    voxels.push(cell);

    if (
      entry.kind === 'stairs_up' ||
      entry.kind === 'stairs_down' ||
      entry.kind === 'stairs_both' ||
      entry.kind === 'ladder' ||
      entry.kind === 'ramp'
    ) {
      beacons.push({
        id: `stairs:${options.areaId}:${entry.x},${entry.y},${entry.z}`,
        kind: 'stairs',
        areaId: options.areaId,
        x: entry.x,
        y: entry.y,
        z: entry.z,
        wx,
        wy,
        wz,
        color: AUTOMAP_BEACON_COLORS.stairs,
        label: entry.kind.replace('_', ' '),
        subtitle: `${options.areaName} (Z:${entry.z})`
      });
    }

    if (portal) {
      beacons.push({
        id: `portal:${options.areaId}:${entry.x},${entry.y},${entry.z}->${portal.connection.targetAreaId}`,
        kind: 'portal',
        areaId: options.areaId,
        x: entry.x,
        y: entry.y,
        z: entry.z,
        wx,
        wy,
        wz,
        color: AUTOMAP_BEACON_COLORS.portal,
        label: `Exit -> ${portal.connection.targetAreaId}`,
        subtitle: `${portal.connection.direction} (${entry.x},${entry.y},Z:${entry.z})`
      });
    }
  }

  // Emit start position beacon in omniscient / editor preview scenes when visible.
  if (options.startPos && options.visibilityMode === 'full_omniscient') {
    const sx = options.startPos.x;
    const sy = options.startPos.y;
    const sz = options.startPos.z ?? 0;
    beacons.push({
      id: `start:${options.areaId}:${sx},${sy},${sz}`,
      kind: 'start',
      areaId: options.areaId,
      x: sx,
      y: sy,
      z: sz,
      wx: sx + offsetWx,
      wy: sy + offsetWy,
      wz: sz + offsetWz,
      color: AUTOMAP_BEACON_COLORS.start,
      label: `Entry Point`,
      subtitle: `${options.areaName} (${sx},${sy},Z:${sz})`
    });
  }

  // Emit custom player notes scoped to this area (or omniscient when tile is explored).
  for (const note of options.notes ?? []) {
    if (note.areaId !== options.areaId) continue;
    beacons.push({
      id: `note:${note.id}`,
      kind: 'note',
      areaId: options.areaId,
      x: note.x,
      y: note.y,
      z: note.z,
      wx: note.x + offsetWx,
      wy: note.y + offsetWy,
      wz: note.z + offsetWz,
      color: note.color ?? AUTOMAP_BEACON_COLORS.note,
      label: note.label,
      subtitle: `Note (${note.x},${note.y},Z:${note.z})`
    });
  }

  const bounds = computeSceneBounds3D(voxels);
  const focusWx = options.startPos ? options.startPos.x + offsetWx : (bounds.minWx + bounds.maxWx) * 0.5;
  const focusWy = options.startPos ? options.startPos.y + offsetWy : (bounds.minWy + bounds.maxWy) * 0.5;
  const focusWz = options.startPos ? (options.startPos.z ?? 0) + offsetWz : (bounds.minWz + bounds.maxWz) * 0.5;

  const cluster: AutomapAreaCluster3D = {
    areaId: options.areaId,
    name: options.areaName,
    generatorType: options.generatorType ?? 'static',
    dangerRating: options.dangerRating ?? 0,
    offsetWx,
    offsetWy,
    offsetWz,
    minLocalX: collected.minLocalX,
    minLocalY: collected.minLocalY,
    maxLocalX: collected.maxLocalX,
    maxLocalY: collected.maxLocalY,
    minZ: collected.minZ,
    maxZ: collected.maxZ,
    voxelCount: voxels.length,
    beaconCount: beacons.length
  };

  return {
    mode: 'local',
    title: options.areaName,
    ...(options.seed !== undefined ? { seed: options.seed } : {}),
    voxels,
    beacons,
    splines: [],
    clusters: [cluster],
    bounds,
    focusWx,
    focusWy,
    focusWz
  };
}

/**
 * Extracts the active live gameplay `AutomapScene3D` from `GameState`, respecting explored fog-of-war
 * (unless `revealUnexplored` or `state.map.isFullyExplored` is active), live portals, lit light emitters,
 * visible creatures/NPCs, player position, and custom `state.automapNotes`.
 */
export function buildLiveGameAutomapScene3D(state: Readonly<GameState>, revealUnexplored = false): AutomapScene3D {
  const areaDef = state.campaign.areas[state.currentAreaId];
  const areaName = areaDef?.name ?? state.currentAreaId;
  const visibilityMode: AutomapVisibilityMode =
    revealUnexplored || state.map.isFullyExplored === true ? 'full_omniscient' : 'explored_only';

  let playerPos: { readonly x: number; readonly y: number; readonly z: number } | undefined;
  const livePortals: AutomapPortalHint[] = [];
  const liveTorches = new Set<string>();
  const entityMarkers = new Map<string, AutomapVoxelEntityMarker>();

  for (const entityId of state.entities) {
    const pos = getComponent(state, entityId, ComponentType.Position) as PositionComponent | undefined;
    if (!pos) continue;
    const z = pos.z ?? 0;
    const key = toSpatialKey(pos.x, pos.y, z);

    const isPlayer = getComponent(state, entityId, ComponentType.Player) !== undefined;
    if (isPlayer) {
      playerPos = { x: pos.x, y: pos.y, z };
    }

    const portal = getComponent(state, entityId, ComponentType.Portal) as PortalComponent | undefined;
    if (portal) {
      livePortals.push({
        x: pos.x,
        y: pos.y,
        z,
        connection: {
          targetAreaId: portal.targetAreaId,
          direction: 'portal',
          ...(portal.targetX !== undefined ? { targetX: portal.targetX } : {}),
          ...(portal.targetY !== undefined ? { targetY: portal.targetY } : {}),
          ...(portal.targetZ !== undefined ? { targetZ: portal.targetZ } : {})
        }
      });
    }

    const edge = getComponent(state, entityId, ComponentType.EdgeTransition) as EdgeTransitionComponent | undefined;
    if (edge) {
      livePortals.push({
        x: pos.x,
        y: pos.y,
        z,
        connection: { targetAreaId: edge.targetAreaId, direction: 'edge' }
      });
    }

    const light = getComponent(state, entityId, ComponentType.LightEmitter) as LightEmitterComponent | undefined;
    if (light?.isLit) {
      liveTorches.add(key);
    }

    const inFov = isTileKeyInFov(state, pos.x, pos.y, z);
    if (isPlayer || inFov || visibilityMode === 'full_omniscient') {
      const renderable = getComponent(state, entityId, ComponentType.Renderable) as RenderableComponent | undefined;
      if (renderable && !entityMarkers.has(key)) {
        const identity = getComponent(state, entityId, ComponentType.Identity) as IdentityComponent | undefined;
        entityMarkers.set(key, {
          glyph: renderable.glyph,
          color: renderable.fg,
          label: isPlayer ? 'You' : (identity?.name ?? renderable.glyph)
        });
      }
    }
  }

  const baseScene = buildAreaVoxelScene3D({
    areaId: state.currentAreaId,
    areaName,
    generatorType: areaDef?.generatorType,
    dangerRating: areaDef?.dangerRating,
    map: state.map,
    tiles: state.campaign.tiles,
    entities: state.campaign.entities,
    visibilityMode,
    startPos: playerPos,
    portals: livePortals,
    notes: state.automapNotes,
    fovChecker: (x, y, z) => isTileKeyInFov(state, x, y, z)
  });

  // Enrich extracted voxels with live lit LightEmitter beacons and FOV entity markers.
  const enrichedVoxels = baseScene.voxels.map((v) => {
    const key = toSpatialKey(v.x, v.y, v.z);
    const hasTorch = v.hasTorchEmber || liveTorches.has(key);
    const entityMarker = entityMarkers.get(key);
    if (!hasTorch && !entityMarker) return v;
    return {
      ...v,
      ...(hasTorch ? { hasTorchEmber: true } : {}),
      ...(entityMarker ? { entityMarker } : {})
    };
  });

  const extraBeacons: AutomapBeacon3D[] = [...baseScene.beacons];
  if (playerPos) {
    // Replace 'start' beacon generated from startPos with live red 'player' plumb-line beacon.
    const filtered = extraBeacons.filter((b) => b.kind !== 'start');
    filtered.push({
      id: `player:${state.currentAreaId}`,
      kind: 'player',
      areaId: state.currentAreaId,
      x: playerPos.x,
      y: playerPos.y,
      z: playerPos.z,
      wx: playerPos.x,
      wy: playerPos.y,
      wz: playerPos.z,
      color: AUTOMAP_BEACON_COLORS.player,
      label: 'Player Position',
      subtitle: `${areaName} (${playerPos.x},${playerPos.y},Z:${playerPos.z})`
    });
    return {
      ...baseScene,
      voxels: enrichedVoxels,
      beacons: filtered,
      focusWx: playerPos.x,
      focusWy: playerPos.y,
      focusWz: playerPos.z
    };
  }

  return {
    ...baseScene,
    voxels: enrichedVoxels
  };
}

/**
 * Helper to execute an arbitrary callback under a fixed ROT.js seed, preserving and restoring
 * `ROT.RNG.getState()` safely in a `try / finally` block.
 */
export function withFixedRotSeed<T>(seed: number, fn: () => T): T {
  const prevState = ROT.RNG.getState();
  ROT.RNG.setSeed(Number.isFinite(seed) ? Math.floor(seed) : DEFAULT_ATLAS_PREVIEW_SEED);
  try {
    return fn();
  } finally {
    ROT.RNG.setState(prevState);
  }
}
