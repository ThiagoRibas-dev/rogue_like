import {
  AUTOMAP_FALLBACK_COLORS,
  AUTOMAP_HOLISTIC_AREA_GAP,
  AUTOMAP_HOLISTIC_STREAMING_PREVIEW_RADIUS,
  AUTOMAP_HOLISTIC_VERTICAL_STEP_Z,
  DEFAULT_ATLAS_PREVIEW_SEED
} from '../../constants/automap3d.constants.ts';
import { generateArea } from '../../map/generator.ts';
import type {
  AutomapAreaCluster3D,
  AutomapBeacon3D,
  AutomapPortalSpline3D,
  AutomapScene3D,
  AutomapVoxelCell3D
} from '../../types/automap3d.types.ts';
import type { CampaignData } from '../../types/campaign.types.ts';
import type { GeneratedArea } from '../../types/generation.types.ts';
import { buildAreaVoxelScene3D, computeSceneBounds3D, withFixedRotSeed } from './automap3d_scene.ts';

/** Options controlling holistic multi-area campaign 3D atlas compilation. */
export interface BuildHolisticAtlasOptions {
  readonly seed?: number | undefined;
  readonly startAreaId?: string | undefined;
}

interface AreaWorldBox {
  readonly minWx: number;
  readonly maxWx: number;
  readonly minWy: number;
  readonly maxWy: number;
  readonly minWz: number;
  readonly maxWz: number;
}

function boxesOverlap3D(a: AreaWorldBox, b: AreaWorldBox, padXY: number): boolean {
  if (a.maxWz < b.minWz || b.maxWz < a.minWz) return false;
  if (a.maxWx + padXY < b.minWx || b.maxWx + padXY < a.minWx) return false;
  if (a.maxWy + padXY < b.minWy || b.maxWy + padXY < a.minWy) return false;
  return true;
}

function resolveDeltaOffsetForDirection(
  direction: 'up' | 'down' | 'edge' | 'portal',
  placementSide: 'top' | 'bottom' | 'left' | 'right' | 'any' | undefined,
  fromSpanX: number,
  fromSpanY: number,
  toSpanX: number,
  toSpanY: number,
  verticalSpanZ: number
): { readonly dx: number; readonly dy: number; readonly dz: number } {
  const stepX = Math.round((fromSpanX + toSpanX) * 0.5) + AUTOMAP_HOLISTIC_AREA_GAP;
  const stepY = Math.round((fromSpanY + toSpanY) * 0.5) + AUTOMAP_HOLISTIC_AREA_GAP;

  if (direction === 'down') {
    return { dx: 0, dy: 0, dz: -Math.max(AUTOMAP_HOLISTIC_VERTICAL_STEP_Z, verticalSpanZ + 1) };
  }
  if (direction === 'up') {
    return { dx: 0, dy: 0, dz: Math.max(AUTOMAP_HOLISTIC_VERTICAL_STEP_Z, verticalSpanZ + 1) };
  }

  switch (placementSide) {
    case 'top':
      return { dx: 0, dy: -stepY, dz: 0 };
    case 'bottom':
      return { dx: 0, dy: stepY, dz: 0 };
    case 'left':
      return { dx: -stepX, dy: 0, dz: 0 };
    case 'right':
      return { dx: stepX, dy: 0, dz: 0 };
    case 'any':
    case undefined:
      return { dx: stepX, dy: 0, dz: 0 };
  }
}

/**
 * Generates every area in a campaign deterministically using a fixed ROT.js seed (saving/restoring RNG state),
 * solves collision-free 3D world offsets via BFS over declarative `AreaConnection` directions (`up`/`down`/cardinal),
 * and returns a unified holistic `AutomapScene3D` with cross-area portal splines.
 */
export function buildCampaignHolisticScene3D(
  campaign: CampaignData,
  options?: BuildHolisticAtlasOptions
): AutomapScene3D {
  const seed = options?.seed ?? DEFAULT_ATLAS_PREVIEW_SEED;
  const areaIds = Object.keys(campaign.areas);
  if (areaIds.length === 0) {
    return {
      mode: 'holistic',
      title: campaign.manifest.name,
      seed,
      voxels: [],
      beacons: [],
      splines: [],
      clusters: [],
      bounds: { minWx: 0, maxWx: 0, minWy: 0, maxWy: 0, minWz: 0, maxWz: 0 },
      focusWx: 0,
      focusWy: 0,
      focusWz: 0
    };
  }

  const rootAreaId =
    options?.startAreaId && campaign.areas[options.startAreaId]
      ? options.startAreaId
      : campaign.areas[campaign.rules.map.startingAreaId]
        ? campaign.rules.map.startingAreaId
        : areaIds[0]!;

  // Step 1: Deterministic fixed-seed area generation preserving global ROT.RNG state.
  const localScenes = new Map<string, { readonly scene: AutomapScene3D; readonly generated: GeneratedArea }>();
  withFixedRotSeed(seed, () => {
    for (const areaId of areaIds) {
      const areaDef = campaign.areas[areaId]!;
      try {
        const generated = generateArea(campaign, areaId);
        const scene = buildAreaVoxelScene3D({
          areaId,
          areaName: areaDef.name,
          generatorType: areaDef.generatorType,
          dangerRating: areaDef.dangerRating,
          map: generated.map,
          tiles: campaign.tiles,
          entities: campaign.entities,
          visibilityMode: 'full_omniscient',
          startPos: generated.startPos,
          portals: generated.portals,
          placedEntities: generated.placedEntities,
          seed,
          ...(generated.map.chunkGrid !== undefined
            ? { maxRadiusFromStart: AUTOMAP_HOLISTIC_STREAMING_PREVIEW_RADIUS }
            : {})
        });
        localScenes.set(areaId, { scene, generated });
      } catch {
        // Skip broken/unconfigured WIP areas gracefully in editor/validator atlases.
      }
    }
  });

  // Step 2: BFS 3D AABB layout packing anchored at rootAreaId.
  const placedOffsets = new Map<string, { readonly ox: number; readonly oy: number; readonly oz: number }>();
  const occupiedBoxes: AreaWorldBox[] = [];

  const getLocalSpan = (
    areaId: string
  ): {
    readonly spanX: number;
    readonly spanY: number;
    readonly spanZ: number;
    readonly minX: number;
    readonly maxX: number;
    readonly minY: number;
    readonly maxY: number;
    readonly minZ: number;
    readonly maxZ: number;
  } => {
    const entry = localScenes.get(areaId);
    const bounds = entry?.scene.bounds;
    if (!bounds) {
      return { spanX: 16, spanY: 16, spanZ: 1, minX: 0, maxX: 16, minY: 0, maxY: 16, minZ: 0, maxZ: 0 };
    }
    return {
      spanX: Math.max(8, bounds.maxWx - bounds.minWx + 1),
      spanY: Math.max(8, bounds.maxWy - bounds.minWy + 1),
      spanZ: Math.max(1, bounds.maxWz - bounds.minWz + 1),
      minX: bounds.minWx,
      maxX: bounds.maxWx,
      minY: bounds.minWy,
      maxY: bounds.maxWy,
      minZ: bounds.minWz,
      maxZ: bounds.maxWz
    };
  };

  const commitOffset = (areaId: string, candidateOx: number, candidateOy: number, candidateOz: number): void => {
    const span = getLocalSpan(areaId);
    let ox = candidateOx;
    let oy = candidateOy;
    const oz = candidateOz;

    // Resolve horizontal overlap deterministically if multiple branches converge at the same Z.
    let guard = 0;
    while (guard < 24) {
      const box: AreaWorldBox = {
        minWx: span.minX + ox,
        maxWx: span.maxX + ox,
        minWy: span.minY + oy,
        maxWy: span.maxY + oy,
        minWz: span.minZ + oz,
        maxWz: span.maxZ + oz
      };
      const overlaps = occupiedBoxes.some((existing) => boxesOverlap3D(box, existing, 4));
      if (!overlaps) {
        occupiedBoxes.push(box);
        break;
      }
      ox += Math.round(span.spanX * 0.5) + AUTOMAP_HOLISTIC_AREA_GAP;
      if (guard % 3 === 2) {
        oy += Math.round(span.spanY * 0.45) + AUTOMAP_HOLISTIC_AREA_GAP;
      }
      guard++;
    }

    placedOffsets.set(areaId, { ox, oy, oz });
  };

  const queue: string[] = [];
  if (localScenes.has(rootAreaId)) {
    commitOffset(rootAreaId, 0, 0, 0);
    queue.push(rootAreaId);
  }

  while (queue.length > 0) {
    const curId = queue.shift()!;
    const curOff = placedOffsets.get(curId);
    const curDef = campaign.areas[curId];
    if (!curOff || !curDef) continue;
    const curSpan = getLocalSpan(curId);

    for (const conn of curDef.connections ?? []) {
      const targetId = conn.targetAreaId;
      if (!localScenes.has(targetId) || placedOffsets.has(targetId)) continue;
      const targetSpan = getLocalSpan(targetId);
      const delta = resolveDeltaOffsetForDirection(
        conn.direction,
        conn.placementSide,
        curSpan.spanX,
        curSpan.spanY,
        targetSpan.spanX,
        targetSpan.spanY,
        Math.max(curSpan.spanZ, targetSpan.spanZ)
      );
      commitOffset(targetId, curOff.ox + delta.dx, curOff.oy + delta.dy, curOff.oz + delta.dz);
      queue.push(targetId);
    }
  }

  // Place disconnected / orphan areas neatly along a lower horizontal row so nothing is hidden.
  let disconnectedCursorX = 0;
  for (const box of occupiedBoxes) {
    if (box.maxWx + AUTOMAP_HOLISTIC_AREA_GAP > disconnectedCursorX) {
      disconnectedCursorX = box.maxWx + AUTOMAP_HOLISTIC_AREA_GAP;
    }
  }
  for (const areaId of areaIds) {
    if (!localScenes.has(areaId) || placedOffsets.has(areaId)) continue;
    const span = getLocalSpan(areaId);
    commitOffset(areaId, disconnectedCursorX - span.minX, 0, 0);
    disconnectedCursorX += span.spanX + AUTOMAP_HOLISTIC_AREA_GAP;
  }

  // Step 3: Offset all voxels, beacons, clusters, and emit cross-area 3D portal splines.
  const allVoxels: AutomapVoxelCell3D[] = [];
  const allBeacons: AutomapBeacon3D[] = [];
  const allClusters: AutomapAreaCluster3D[] = [];
  const splines: AutomapPortalSpline3D[] = [];

  for (const areaId of areaIds) {
    const entry = localScenes.get(areaId);
    const offset = placedOffsets.get(areaId);
    if (!entry || !offset) continue;

    const { ox, oy, oz } = offset;
    for (const v of entry.scene.voxels) {
      allVoxels.push({
        ...v,
        wx: v.wx + ox,
        wy: v.wy + oy,
        wz: v.wz + oz
      });
    }
    for (const b of entry.scene.beacons) {
      allBeacons.push({
        ...b,
        wx: b.wx + ox,
        wy: b.wy + oy,
        wz: b.wz + oz
      });
    }
    for (const c of entry.scene.clusters) {
      allClusters.push({
        ...c,
        offsetWx: ox,
        offsetWy: oy,
        offsetWz: oz
      });
    }
  }

  for (const areaId of areaIds) {
    const entry = localScenes.get(areaId);
    const fromOffset = placedOffsets.get(areaId);
    if (!entry || !fromOffset) continue;

    for (const portal of entry.generated.portals) {
      const targetId = portal.connection.targetAreaId;
      const targetEntry = localScenes.get(targetId);
      const targetOffset = placedOffsets.get(targetId);
      if (!targetEntry || !targetOffset) continue;

      const destX = portal.connection.targetX ?? targetEntry.generated.startPos.x;
      const destY = portal.connection.targetY ?? targetEntry.generated.startPos.y;
      const destZ = portal.connection.targetZ ?? targetEntry.generated.startPos.z ?? 0;

      const isVertical = portal.connection.direction === 'up' || portal.connection.direction === 'down';
      splines.push({
        id: `spline:${areaId}->${targetId}:${portal.x},${portal.y},${portal.z ?? 0}`,
        fromAreaId: areaId,
        toAreaId: targetId,
        fromWx: portal.x + fromOffset.ox,
        fromWy: portal.y + fromOffset.oy,
        fromWz: (portal.z ?? 0) + fromOffset.oz,
        toWx: destX + targetOffset.ox,
        toWy: destY + targetOffset.oy,
        toWz: destZ + targetOffset.oz,
        direction: portal.connection.direction,
        color: isVertical ? AUTOMAP_FALLBACK_COLORS.splineVertical : AUTOMAP_FALLBACK_COLORS.splineDefault,
        label: `${areaId} -> ${targetId} (${portal.connection.direction})`
      });
    }
  }

  const bounds = computeSceneBounds3D(allVoxels);
  const rootCluster = allClusters.find((c) => c.areaId === rootAreaId);
  const focusWx = rootCluster
    ? rootCluster.offsetWx + (rootCluster.minLocalX + rootCluster.maxLocalX) * 0.5
    : (bounds.minWx + bounds.maxWx) * 0.5;
  const focusWy = rootCluster
    ? rootCluster.offsetWy + (rootCluster.minLocalY + rootCluster.maxLocalY) * 0.5
    : (bounds.minWy + bounds.maxWy) * 0.5;
  const focusWz = rootCluster ? rootCluster.offsetWz : (bounds.minWz + bounds.maxWz) * 0.5;

  return {
    mode: 'holistic',
    title: `${campaign.manifest.name} — Campaign Atlas`,
    seed,
    voxels: allVoxels,
    beacons: allBeacons,
    splines,
    clusters: allClusters,
    bounds,
    focusWx,
    focusWy,
    focusWz
  };
}
