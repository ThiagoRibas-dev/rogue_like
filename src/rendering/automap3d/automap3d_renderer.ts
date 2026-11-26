import {
  AUTOMAP_BEACON_PLUMB_HALF_SPAN_Z,
  AUTOMAP_FALLBACK_COLORS,
  AUTOMAP_FLOOR_SLAB_HEIGHT,
  AUTOMAP_GHOST_ABOVE_ALPHA,
  AUTOMAP_LOWER_Z_DIM_STEP,
  AUTOMAP_LOWER_Z_MIN_ALPHA,
  AUTOMAP_PERSPECTIVE_DISTANCE,
  AUTOMAP_PERSPECTIVE_FOCAL,
  AUTOMAP_STAIR_HEIGHT_RATIO,
  AUTOMAP_WALL_HEIGHT_RATIO,
  AUTOMAP_Z_VERTICAL_SCALE
} from '../../constants/automap3d.constants.ts';
import type {
  AutomapBeacon3D,
  AutomapCameraState3D,
  AutomapHitResult3D,
  AutomapScene3D,
  AutomapVoxelCell3D,
  AutomapVoxelKind
} from '../../types/automap3d.types.ts';

/** 2D projected screen coordinate with camera-space depth (`camZ`, larger = closer to camera). */
export interface ProjectedPoint3D {
  readonly sx: number;
  readonly sy: number;
  readonly camZ: number;
  readonly scale: number;
}

/** Optional render-time selection/hover highlight state. */
export interface RenderAutomapOptions3D {
  readonly hoveredVoxel?: AutomapVoxelCell3D | undefined;
  readonly selectedVoxel?: AutomapVoxelCell3D | undefined;
  readonly hoveredBeacon?: AutomapBeacon3D | undefined;
}

interface RenderableVoxelItem {
  readonly voxel: AutomapVoxelCell3D;
  readonly camZ: number;
  readonly alpha: number;
  readonly isFadedArea: boolean;
}

/**
 * Projects a world-space point `(wx, wy, wz)` through the active 3D camera into 2D canvas coordinates.
 */
export function projectAutomapPoint3D(
  wx: number,
  wy: number,
  wz: number,
  scene: Readonly<AutomapScene3D>,
  camera: Readonly<AutomapCameraState3D>,
  canvasWidth: number,
  canvasHeight: number
): ProjectedPoint3D {
  const dx = wx - scene.focusWx;
  const dy = wy - scene.focusWy;
  const dz = (wz - scene.focusWz) * AUTOMAP_Z_VERTICAL_SCALE;

  const cosYaw = Math.cos(camera.yawRad);
  const sinYaw = Math.sin(camera.yawRad);
  const rx = dx * cosYaw - dy * sinYaw;
  const ry = dx * sinYaw + dy * cosYaw;

  const cosPitch = Math.cos(camera.pitchRad);
  const sinPitch = Math.sin(camera.pitchRad);
  const syView = ry * sinPitch - dz * cosPitch;
  const camZ = ry * cosPitch + dz * sinPitch;

  let scale = camera.zoom;
  if (camera.projection === 'perspective') {
    const denom = Math.max(8, AUTOMAP_PERSPECTIVE_DISTANCE - camZ);
    scale = camera.zoom * (AUTOMAP_PERSPECTIVE_FOCAL / denom);
  }

  return {
    sx: canvasWidth * 0.5 + camera.panX + rx * scale,
    sy: canvasHeight * 0.5 + camera.panY + syView * scale,
    camZ,
    scale
  };
}

/**
 * Computes an appropriate zoom multiplier so an entire `AutomapScene3D` fits comfortably inside `(width, height)`.
 */
export function fitCameraToScene3D(
  scene: Readonly<AutomapScene3D>,
  camera: Readonly<AutomapCameraState3D>,
  canvasWidth: number,
  canvasHeight: number
): AutomapCameraState3D {
  const spanX = Math.max(8, scene.bounds.maxWx - scene.bounds.minWx + 4);
  const spanY = Math.max(8, scene.bounds.maxWy - scene.bounds.minWy + 4);
  const spanZ = Math.max(2, (scene.bounds.maxWz - scene.bounds.minWz + 2) * AUTOMAP_Z_VERTICAL_SCALE);
  const diag = Math.hypot(spanX, spanY, spanZ);
  const minViewport = Math.max(200, Math.min(canvasWidth, canvasHeight));
  const targetZoom = Math.max(2.8, Math.min(26, (minViewport * 0.72) / Math.max(12, diag)));

  return {
    ...camera,
    zoom: targetZoom,
    panX: 0,
    panY: 0
  };
}

function getVoxelPrismHeight(kind: AutomapVoxelKind, fluidDepth?: number): number {
  switch (kind) {
    case 'wall':
      return AUTOMAP_WALL_HEIGHT_RATIO * AUTOMAP_Z_VERTICAL_SCALE;
    case 'stairs_up':
    case 'stairs_down':
    case 'stairs_both':
    case 'ladder':
    case 'ramp':
      return AUTOMAP_STAIR_HEIGHT_RATIO * AUTOMAP_Z_VERTICAL_SCALE;
    case 'water':
    case 'magma':
    case 'oil':
    case 'mud': {
      const ratio = fluidDepth && fluidDepth > 0 ? Math.min(1, fluidDepth / 7) : 0.45;
      return (AUTOMAP_FLOOR_SLAB_HEIGHT + ratio * 0.25) * AUTOMAP_Z_VERTICAL_SCALE;
    }
    case 'floor':
      return AUTOMAP_FLOOR_SLAB_HEIGHT * AUTOMAP_Z_VERTICAL_SCALE;
  }
}

function computeVoxelCutawayAlpha(voxel: AutomapVoxelCell3D, camera: Readonly<AutomapCameraState3D>): number | null {
  const dz = Math.round(voxel.wz) - camera.activeZ;
  if (camera.cutawayMode === 'isolate_z' && dz !== 0) {
    return null;
  }
  if (camera.cutawayMode === 'ghost_above') {
    if (dz > 0) return AUTOMAP_GHOST_ABOVE_ALPHA;
    if (dz < 0) return Math.max(AUTOMAP_LOWER_Z_MIN_ALPHA, 1 - Math.abs(dz) * AUTOMAP_LOWER_Z_DIM_STEP);
    return 1;
  }
  return 1;
}

function drawPolygon(
  ctx: CanvasRenderingContext2D,
  pts: ReadonlyArray<ProjectedPoint3D>,
  fillStyle: string,
  strokeStyle: string | undefined,
  lineWidth = 0.8
): void {
  if (pts.length < 3) return;
  ctx.beginPath();
  ctx.moveTo(pts[0]!.sx, pts[0]!.sy);
  for (let i = 1; i < pts.length; i++) {
    ctx.lineTo(pts[i]!.sx, pts[i]!.sy);
  }
  ctx.closePath();
  ctx.fillStyle = fillStyle;
  ctx.fill();
  if (strokeStyle) {
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = strokeStyle;
    ctx.stroke();
  }
}

function drawVoxelPrism(
  ctx: CanvasRenderingContext2D,
  voxel: AutomapVoxelCell3D,
  scene: Readonly<AutomapScene3D>,
  camera: Readonly<AutomapCameraState3D>,
  width: number,
  height: number,
  camDirX: number,
  camDirY: number,
  isHighlighted: boolean,
  skipMicroStroke: boolean
): void {
  const heightWorld = getVoxelPrismHeight(voxel.kind, voxel.fluidDepth);
  const hZ = heightWorld / AUTOMAP_Z_VERTICAL_SCALE;
  const x0 = voxel.wx - 0.5;
  const x1 = voxel.wx + 0.5;
  const y0 = voxel.wy - 0.5;
  const y1 = voxel.wy + 0.5;
  const z0 = voxel.wz;
  const z1 = voxel.wz + hZ;

  // Project only needed 8 corners of the voxel prism.
  const b00 = projectAutomapPoint3D(x0, y0, z0, scene, camera, width, height);
  const b10 = projectAutomapPoint3D(x1, y0, z0, scene, camera, width, height);
  const b11 = projectAutomapPoint3D(x1, y1, z0, scene, camera, width, height);
  const b01 = projectAutomapPoint3D(x0, y1, z0, scene, camera, width, height);

  const t00 = projectAutomapPoint3D(x0, y0, z1, scene, camera, width, height);
  const t10 = projectAutomapPoint3D(x1, y0, z1, scene, camera, width, height);
  const t11 = projectAutomapPoint3D(x1, y1, z1, scene, camera, width, height);
  const t01 = projectAutomapPoint3D(x0, y1, z1, scene, camera, width, height);

  const stroke = isHighlighted
    ? '#facc15'
    : skipMicroStroke && t00.scale < 5.5
      ? undefined
      : voxel.kind === 'wall'
        ? 'rgba(15, 23, 42, 0.72)'
        : 'rgba(15, 23, 42, 0.45)';
  const strokeWidth = isHighlighted ? 1.8 : 0.75;

  // X-facing side face visible toward camera
  if (camDirX >= 0) {
    drawPolygon(ctx, [b10, b11, t11, t10], voxel.sideColor, stroke, strokeWidth);
  } else {
    drawPolygon(ctx, [b00, b01, t01, t00], voxel.sideColor, stroke, strokeWidth);
  }

  // Y-facing side face visible toward camera
  if (camDirY >= 0) {
    drawPolygon(ctx, [b01, b11, t11, t01], voxel.sideColor, stroke, strokeWidth);
  } else {
    drawPolygon(ctx, [b00, b10, t10, t00], voxel.sideColor, stroke, strokeWidth);
  }

  // Top face (+Z)
  drawPolygon(ctx, [t00, t10, t11, t01], voxel.topColor, stroke, strokeWidth);

  // Subtle directional step indicator for stairs/ramps/ladders
  if (
    voxel.kind === 'stairs_up' ||
    voxel.kind === 'stairs_down' ||
    voxel.kind === 'stairs_both' ||
    voxel.kind === 'ramp' ||
    voxel.kind === 'ladder'
  ) {
    const center = projectAutomapPoint3D(voxel.wx, voxel.wy, z1 + 0.05, scene, camera, width, height);
    const r = Math.max(2, Math.min(7, center.scale * 0.28));
    ctx.fillStyle = '#e0f2fe';
    ctx.beginPath();
    if (voxel.kind === 'stairs_up') {
      ctx.moveTo(center.sx, center.sy - r);
      ctx.lineTo(center.sx + r, center.sy + r);
      ctx.lineTo(center.sx - r, center.sy + r);
    } else if (voxel.kind === 'stairs_down') {
      ctx.moveTo(center.sx - r, center.sy - r);
      ctx.lineTo(center.sx + r, center.sy - r);
      ctx.lineTo(center.sx, center.sy + r);
    } else {
      ctx.arc(center.sx, center.sy, r * 0.75, 0, Math.PI * 2);
    }
    ctx.closePath();
    ctx.fill();
  }

  // Daggerfall-style warm torchlight ember dot
  if (voxel.hasTorchEmber) {
    const emberPt = projectAutomapPoint3D(voxel.wx, voxel.wy, z1 + 0.12, scene, camera, width, height);
    const radius = Math.max(2, Math.min(5.5, emberPt.scale * 0.22));
    ctx.fillStyle = '#fb923c';
    ctx.beginPath();
    ctx.arc(emberPt.sx, emberPt.sy, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawCompassOverlay(
  ctx: CanvasRenderingContext2D,
  camera: Readonly<AutomapCameraState3D>,
  width: number
): void {
  const cx = width - 40;
  const cy = 40;
  const r = 20;
  ctx.save();
  ctx.fillStyle = 'rgba(10, 12, 17, 0.76)';
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.4)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // North vector in world coordinates is (0, -1, 0)
  const cosYaw = Math.cos(camera.yawRad);
  const sinYaw = Math.sin(camera.yawRad);
  const nx = -sinYaw * -1; // dx=0, dy=-1 => rx = -(-1)*sinYaw = sinYaw
  const ny = cosYaw * -1 * Math.sin(camera.pitchRad);
  const norm = Math.hypot(nx, ny) || 1;
  const px = (nx / norm) * (r - 5);
  const py = (ny / norm) * (r - 5);

  ctx.strokeStyle = '#ef4444';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + px, cy + py);
  ctx.stroke();

  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 10px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('N', cx + px * 1.12, cy + py * 1.12);
  ctx.restore();
}

/**
 * Renders the complete Daggerfall-style 3D dungeon automap or holistic campaign atlas
 * onto a 2D HTML5 `<canvas>` context with zero external 3D dependencies.
 */
export function renderAutomapScene3D(
  ctx: CanvasRenderingContext2D,
  scene: Readonly<AutomapScene3D>,
  camera: Readonly<AutomapCameraState3D>,
  width: number,
  height: number,
  options?: RenderAutomapOptions3D
): void {
  // 1. Background slate radial gradient matching Daggerfall Unity map backdrop
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, AUTOMAP_FALLBACK_COLORS.backgroundTop);
  grad.addColorStop(1, AUTOMAP_FALLBACK_COLORS.backgroundBottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  if (scene.voxels.length === 0) {
    ctx.fillStyle = '#94a3b8';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No explored tiles or geometry in this view yet.', width * 0.5, height * 0.5);
    return;
  }

  const camDirX = Math.sin(camera.yawRad) * Math.cos(camera.pitchRad);
  const camDirY = Math.cos(camera.yawRad) * Math.cos(camera.pitchRad);

  // 2. Collect visible voxels & sort strictly back-to-front (ascending camZ)
  const items: RenderableVoxelItem[] = [];
  for (const voxel of scene.voxels) {
    const baseAlpha = computeVoxelCutawayAlpha(voxel, camera);
    if (baseAlpha === null) continue;
    const isFadedArea = camera.highlightAreaId !== undefined && voxel.areaId !== camera.highlightAreaId;
    const alpha = isFadedArea ? Math.min(baseAlpha, 0.24) : baseAlpha;
    const projectedCenter = projectAutomapPoint3D(voxel.wx, voxel.wy, voxel.wz + 0.35, scene, camera, width, height);
    items.push({ voxel, camZ: projectedCenter.camZ, alpha, isFadedArea });
  }

  items.sort((a, b) => a.camZ - b.camZ);

  // 3. Draw voxels back-to-front (hoisting alpha changes cleanly for 60 FPS dense atlases)
  const hovered = options?.hoveredVoxel;
  const selected = options?.selectedVoxel;
  const skipMicroStroke = items.length > 6000;
  let lastAlpha = -1;

  for (const item of items) {
    const v = item.voxel;
    const isHighlighted =
      (hovered !== undefined &&
        hovered.areaId === v.areaId &&
        hovered.x === v.x &&
        hovered.y === v.y &&
        hovered.z === v.z) ||
      (selected !== undefined &&
        selected.areaId === v.areaId &&
        selected.x === v.x &&
        selected.y === v.y &&
        selected.z === v.z);

    if (item.alpha !== lastAlpha) {
      ctx.globalAlpha = item.alpha;
      lastAlpha = item.alpha;
    }
    drawVoxelPrism(ctx, v, scene, camera, width, height, camDirX, camDirY, isHighlighted, skipMicroStroke);
  }
  ctx.globalAlpha = 1;

  // 4. Draw inter-area 3D portal splines in holistic mode
  if (camera.showSplines && scene.splines.length > 0) {
    ctx.save();
    for (const spline of scene.splines) {
      const p0 = projectAutomapPoint3D(spline.fromWx, spline.fromWy, spline.fromWz + 0.5, scene, camera, width, height);
      const p1 = projectAutomapPoint3D(spline.toWx, spline.toWy, spline.toWz + 0.5, scene, camera, width, height);
      const midWx = (spline.fromWx + spline.toWx) * 0.5;
      const midWy = (spline.fromWy + spline.toWy) * 0.5;
      const midWz = Math.max(spline.fromWz, spline.toWz) + 3.2;
      const ctrl = projectAutomapPoint3D(midWx, midWy, midWz, scene, camera, width, height);

      const isRel =
        !camera.highlightAreaId ||
        spline.fromAreaId === camera.highlightAreaId ||
        spline.toAreaId === camera.highlightAreaId;
      ctx.globalAlpha = isRel ? 0.78 : 0.2;
      ctx.strokeStyle = spline.color;
      ctx.lineWidth = isRel ? 1.8 : 1;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(p0.sx, p0.sy);
      ctx.quadraticCurveTo(ctrl.sx, ctrl.sy, p1.sx, p1.sy);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = spline.color;
      ctx.beginPath();
      ctx.arc(p1.sx, p1.sy, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // 5. Draw Daggerfall-style vertical plumb-line beacons (red player, green portals, cyan stairs, gold notes)
  if (camera.showBeacons && scene.beacons.length > 0) {
    ctx.save();
    for (const beacon of scene.beacons) {
      if (camera.cutawayMode === 'isolate_z' && Math.round(beacon.wz) !== camera.activeZ) continue;
      if (camera.highlightAreaId && beacon.areaId !== camera.highlightAreaId) continue;

      const topPt = projectAutomapPoint3D(
        beacon.wx,
        beacon.wy,
        beacon.wz + AUTOMAP_BEACON_PLUMB_HALF_SPAN_Z,
        scene,
        camera,
        width,
        height
      );
      const botPt = projectAutomapPoint3D(
        beacon.wx,
        beacon.wy,
        beacon.wz - AUTOMAP_BEACON_PLUMB_HALF_SPAN_Z,
        scene,
        camera,
        width,
        height
      );
      const midPt = projectAutomapPoint3D(beacon.wx, beacon.wy, beacon.wz + 0.4, scene, camera, width, height);

      const isPlumb = beacon.kind === 'player' || beacon.kind === 'portal' || beacon.kind === 'note';
      if (isPlumb) {
        ctx.strokeStyle = beacon.color;
        ctx.lineWidth = beacon.kind === 'player' ? 2.2 : 1.4;
        ctx.globalAlpha = beacon.kind === 'player' ? 0.92 : 0.72;
        ctx.beginPath();
        ctx.moveTo(botPt.sx, botPt.sy);
        ctx.lineTo(topPt.sx, topPt.sy);
        ctx.stroke();
      }

      const hoveredB = options?.hoveredBeacon && options.hoveredBeacon.id === beacon.id;
      const size = hoveredB ? 7 : beacon.kind === 'player' ? 6 : 4.5;
      ctx.globalAlpha = 1;
      ctx.fillStyle = beacon.color;
      ctx.strokeStyle = '#090d14';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(midPt.sx, midPt.sy - size);
      ctx.lineTo(midPt.sx + size, midPt.sy);
      ctx.lineTo(midPt.sx, midPt.sy + size);
      ctx.lineTo(midPt.sx - size, midPt.sy);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      if (camera.showLabels && (beacon.kind === 'player' || beacon.kind === 'note' || hoveredB)) {
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(10, 12, 18, 0.82)';
        const textWidth = ctx.measureText(beacon.label).width;
        ctx.fillRect(midPt.sx + 9, midPt.sy - 9, textWidth + 10, 18);
        ctx.fillStyle = '#f8fafc';
        ctx.fillText(beacon.label, midPt.sx + 14, midPt.sy);
      }
    }
    ctx.restore();
  }

  // 6. Draw cluster title labels in holistic mode
  if (camera.showLabels && scene.mode === 'holistic' && scene.clusters.length > 0) {
    ctx.save();
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const cluster of scene.clusters) {
      const centerWx = cluster.offsetWx + (cluster.minLocalX + cluster.maxLocalX) * 0.5;
      const centerWy = cluster.offsetWy + (cluster.minLocalY + cluster.maxLocalY) * 0.5;
      const topWz = cluster.offsetWz + cluster.maxZ + 1.6;
      const pt = projectAutomapPoint3D(centerWx, centerWy, topWz, scene, camera, width, height);
      const isSelectedArea = camera.highlightAreaId === cluster.areaId;
      const faded = camera.highlightAreaId !== undefined && !isSelectedArea;

      ctx.globalAlpha = faded ? 0.35 : 0.94;
      const label = `${cluster.name} (D${cluster.dangerRating})`;
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = isSelectedArea ? 'rgba(230, 184, 76, 0.92)' : 'rgba(15, 23, 42, 0.82)';
      ctx.strokeStyle = isSelectedArea ? '#fef08a' : 'rgba(148, 163, 184, 0.45)';
      ctx.lineWidth = 1;
      ctx.fillRect(pt.sx - tw * 0.5 - 6, pt.sy - 10, tw + 12, 20);
      ctx.strokeRect(pt.sx - tw * 0.5 - 6, pt.sy - 10, tw + 12, 20);
      ctx.fillStyle = isSelectedArea ? '#090d14' : '#f1f5f9';
      ctx.fillText(label, pt.sx, pt.sy);
    }
    ctx.restore();
  }

  // 7. North compass indicator
  drawCompassOverlay(ctx, camera, width);
}

/**
 * Performs 3D-aware screen-space picking against visible beacons and voxels, returning the
 * frontmost (`camZ` closest to camera) match or `null` when clicking empty backdrop.
 */
export function pickAutomapVoxelAtScreenPoint(
  screenX: number,
  screenY: number,
  scene: Readonly<AutomapScene3D>,
  camera: Readonly<AutomapCameraState3D>,
  width: number,
  height: number
): AutomapHitResult3D | null {
  let bestBeacon: { readonly beacon: AutomapBeacon3D; readonly camZ: number } | null = null;
  if (camera.showBeacons) {
    for (const beacon of scene.beacons) {
      if (camera.cutawayMode === 'isolate_z' && Math.round(beacon.wz) !== camera.activeZ) continue;
      if (camera.highlightAreaId && beacon.areaId !== camera.highlightAreaId) continue;
      const pt = projectAutomapPoint3D(beacon.wx, beacon.wy, beacon.wz + 0.4, scene, camera, width, height);
      const dist = Math.hypot(screenX - pt.sx, screenY - pt.sy);
      if (dist <= 11 && (!bestBeacon || pt.camZ > bestBeacon.camZ)) {
        bestBeacon = { beacon, camZ: pt.camZ };
      }
    }
  }
  if (bestBeacon) {
    return { kind: 'beacon', beacon: bestBeacon.beacon, screenX, screenY };
  }

  let bestVoxel: { readonly voxel: AutomapVoxelCell3D; readonly camZ: number } | null = null;
  for (const voxel of scene.voxels) {
    if (computeVoxelCutawayAlpha(voxel, camera) === null) continue;
    const hZ = getVoxelPrismHeight(voxel.kind, voxel.fluidDepth) / AUTOMAP_Z_VERTICAL_SCALE;
    const pt = projectAutomapPoint3D(voxel.wx, voxel.wy, voxel.wz + hZ * 0.6, scene, camera, width, height);
    const hitRadius = Math.max(5, pt.scale * 0.65);
    if (Math.abs(screenX - pt.sx) <= hitRadius && Math.abs(screenY - pt.sy) <= hitRadius) {
      if (!bestVoxel || pt.camZ > bestVoxel.camZ) {
        bestVoxel = { voxel, camZ: pt.camZ };
      }
    }
  }

  if (bestVoxel) {
    return { kind: 'voxel', voxel: bestVoxel.voxel, screenX, screenY };
  }
  return null;
}
