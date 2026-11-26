import {
  AUTOMAP_BEACON_COLORS,
  AUTOMAP_BEACON_PLUMB_HALF_SPAN_Z,
  AUTOMAP_DEFAULT_PITCH_RAD,
  AUTOMAP_DEFAULT_YAW_RAD,
  AUTOMAP_DEFAULT_ZOOM,
  AUTOMAP_FALLBACK_COLORS,
  AUTOMAP_FLOOR_SLAB_HEIGHT,
  AUTOMAP_GHOST_ABOVE_ALPHA,
  AUTOMAP_LOWER_Z_DIM_STEP,
  AUTOMAP_LOWER_Z_MIN_ALPHA,
  AUTOMAP_MAX_PITCH_RAD,
  AUTOMAP_MAX_ZOOM,
  AUTOMAP_MIN_PITCH_RAD,
  AUTOMAP_MIN_ZOOM,
  AUTOMAP_PERSPECTIVE_DISTANCE,
  AUTOMAP_PERSPECTIVE_FOCAL,
  AUTOMAP_STAIR_HEIGHT_RATIO,
  AUTOMAP_WALL_HEIGHT_RATIO,
  AUTOMAP_Z_VERTICAL_SCALE,
  DEFAULT_ATLAS_PREVIEW_SEED
} from '../src/constants/automap3d.constants.ts';
import type { AutomapScene3D, AutomapVoxelCell3D } from '../src/types/automap3d.types.ts';

/** Compiled campaign atlas bundle embedded into `docs/campaign_atlas_3d.html`. */
export interface StandaloneAtlasCampaignEntry {
  readonly campaignId: string;
  readonly campaignName: string;
  readonly rulesetId: string;
  readonly description: string;
  readonly scene: AutomapScene3D;
}

interface PackedScenePayload {
  readonly mode: AutomapScene3D['mode'];
  readonly title: string;
  readonly seed?: number | undefined;
  readonly areas: ReadonlyArray<string>;
  readonly tiles: ReadonlyArray<string>;
  readonly kinds: ReadonlyArray<string>;
  readonly colors: ReadonlyArray<string>;
  readonly targets: ReadonlyArray<string>;
  /** Packed tuple: [areaIdx, x, y, z, wx, wy, wz, tileIdx, kindIdx, topIdx, sideIdx, flags(bit0=torch), fluidDepth, targetIdxPlus1] */
  readonly voxels: ReadonlyArray<ReadonlyArray<number>>;
  readonly beacons: AutomapScene3D['beacons'];
  readonly splines: AutomapScene3D['splines'];
  readonly clusters: AutomapScene3D['clusters'];
  readonly bounds: AutomapScene3D['bounds'];
  readonly focusWx: number;
  readonly focusWy: number;
  readonly focusWz: number;
}

function escapeHtmlText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function serializeSafeJsonForScript(payload: unknown): string {
  return JSON.stringify(payload)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

function packScene3D(scene: Readonly<AutomapScene3D>): PackedScenePayload {
  const areaTable: string[] = [];
  const areaIdxMap = new Map<string, number>();
  const tileTable: string[] = [];
  const tileIdxMap = new Map<string, number>();
  const kindTable: string[] = [];
  const kindIdxMap = new Map<string, number>();
  const colorTable: string[] = [];
  const colorIdxMap = new Map<string, number>();
  const targetTable: string[] = [];
  const targetIdxMap = new Map<string, number>();

  const intern = (table: string[], map: Map<string, number>, val: string): number => {
    const existing = map.get(val);
    if (existing !== undefined) return existing;
    const next = table.length;
    table.push(val);
    map.set(val, next);
    return next;
  };

  const packedVoxels: Array<ReadonlyArray<number>> = new Array<ReadonlyArray<number>>(scene.voxels.length);
  for (let i = 0; i < scene.voxels.length; i++) {
    const v: AutomapVoxelCell3D = scene.voxels[i]!;
    const aIdx = intern(areaTable, areaIdxMap, v.areaId);
    const tIdx = intern(tileTable, tileIdxMap, v.tileId);
    const kIdx = intern(kindTable, kindIdxMap, v.kind);
    const tcIdx = intern(colorTable, colorIdxMap, v.topColor);
    const scIdx = intern(colorTable, colorIdxMap, v.sideColor);
    const flags = v.hasTorchEmber ? 1 : 0;
    const fDepth = v.fluidDepth ?? 0;
    const tgt = v.portalTargetAreaId ? intern(targetTable, targetIdxMap, v.portalTargetAreaId) + 1 : 0;
    packedVoxels[i] = [aIdx, v.x, v.y, v.z, v.wx, v.wy, v.wz, tIdx, kIdx, tcIdx, scIdx, flags, fDepth, tgt];
  }

  return {
    mode: scene.mode,
    title: scene.title,
    ...(scene.seed !== undefined ? { seed: scene.seed } : {}),
    areas: areaTable,
    tiles: tileTable,
    kinds: kindTable,
    colors: colorTable,
    targets: targetTable,
    voxels: packedVoxels,
    beacons: scene.beacons,
    splines: scene.splines,
    clusters: scene.clusters,
    bounds: scene.bounds,
    focusWx: scene.focusWx,
    focusWy: scene.focusWy,
    focusWz: scene.focusWz
  };
}

/**
 * Generates a 100% self-contained, zero-dependency interactive Daggerfall-style 3D campaign atlas
 * HTML viewer embedding palette-compressed `AutomapScene3D` scenes and a native 60 FPS Canvas 3D renderer.
 */
export function buildStandaloneAtlasHtml(
  entries: ReadonlyArray<StandaloneAtlasCampaignEntry>,
  seed: number = DEFAULT_ATLAS_PREVIEW_SEED
): string {
  const initialId = entries[0]?.campaignId ?? '';
  const optionsHtml = entries
    .map(
      (e) =>
        `<option value="${escapeHtmlText(e.campaignId)}">${escapeHtmlText(e.campaignName)} (${escapeHtmlText(e.campaignId)} · ${escapeHtmlText(e.rulesetId)} · ${e.scene.clusters.length} areas)</option>`
    )
    .join('\n          ');

  const packedEntries = entries.map((e) => ({
    campaignId: e.campaignId,
    campaignName: e.campaignName,
    rulesetId: e.rulesetId,
    description: e.description,
    scene: packScene3D(e.scene)
  }));

  const embeddedPayload = serializeSafeJsonForScript({
    seed,
    initialCampaignId: initialId,
    campaigns: packedEntries,
    constants: {
      defaultYawRad: AUTOMAP_DEFAULT_YAW_RAD,
      defaultPitchRad: AUTOMAP_DEFAULT_PITCH_RAD,
      minPitchRad: AUTOMAP_MIN_PITCH_RAD,
      maxPitchRad: AUTOMAP_MAX_PITCH_RAD,
      defaultZoom: AUTOMAP_DEFAULT_ZOOM,
      minZoom: AUTOMAP_MIN_ZOOM,
      maxZoom: AUTOMAP_MAX_ZOOM,
      perspectiveDistance: AUTOMAP_PERSPECTIVE_DISTANCE,
      perspectiveFocal: AUTOMAP_PERSPECTIVE_FOCAL,
      zVerticalScale: AUTOMAP_Z_VERTICAL_SCALE,
      wallHeightRatio: AUTOMAP_WALL_HEIGHT_RATIO,
      floorSlabHeight: AUTOMAP_FLOOR_SLAB_HEIGHT,
      stairHeightRatio: AUTOMAP_STAIR_HEIGHT_RATIO,
      ghostAboveAlpha: AUTOMAP_GHOST_ABOVE_ALPHA,
      lowerZDimStep: AUTOMAP_LOWER_Z_DIM_STEP,
      lowerZMinAlpha: AUTOMAP_LOWER_Z_MIN_ALPHA,
      plumbHalfSpanZ: AUTOMAP_BEACON_PLUMB_HALF_SPAN_Z,
      colors: AUTOMAP_FALLBACK_COLORS,
      beaconColors: AUTOMAP_BEACON_COLORS
    }
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>3D Campaign Atlas — Daggerfall-Style Multi-Z Topology Viewer</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #080b10;
      --surface: #111622;
      --surface-alt: #182032;
      --border: #2a344a;
      --ink: #e2e8f0;
      --muted: #94a3b8;
      --accent: #e6b84c;
      --accent-soft: rgba(230, 184, 76, 0.16);
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      background: var(--bg);
      color: var(--ink);
      font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      overflow: hidden;
    }
    .atlas-shell {
      display: grid;
      grid-template-rows: auto auto 1fr;
      height: 100vh;
      width: 100vw;
    }
    .atlas-header {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 10px 14px;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
    }
    .atlas-title {
      display: flex;
      align-items: baseline;
      gap: 10px;
    }
    .atlas-title h1 {
      margin: 0;
      font-size: 15px;
      letter-spacing: 0.03em;
      color: var(--accent);
    }
    .atlas-title .seed-pill {
      font-size: 11px;
      padding: 2px 7px;
      border-radius: 3px;
      background: var(--surface-alt);
      border: 1px solid var(--border);
      color: var(--muted);
      font-family: monospace;
    }
    .atlas-toolbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      padding: 7px 14px;
      background: #0d121b;
      border-bottom: 1px solid var(--border);
      font-size: 12px;
    }
    .ctrl-group {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 6px;
      border: 1px solid var(--border);
      border-radius: 4px;
      background: var(--surface);
    }
    select, button {
      background: var(--surface-alt);
      color: var(--ink);
      border: 1px solid var(--border);
      border-radius: 3px;
      padding: 4px 8px;
      font-size: 12px;
      cursor: pointer;
    }
    button:hover, select:hover { border-color: var(--accent); }
    button.active {
      background: var(--accent-soft);
      border-color: var(--accent);
      color: var(--accent);
      font-weight: 600;
    }
    .atlas-main {
      display: grid;
      grid-template-columns: 1fr 310px;
      min-height: 0;
      overflow: hidden;
    }
    .atlas-canvas-wrap {
      position: relative;
      overflow: hidden;
      background: var(--bg);
      cursor: grab;
    }
    .atlas-canvas-wrap:active { cursor: grabbing; }
    canvas { display: block; width: 100%; height: 100%; }
    .atlas-legend {
      position: absolute;
      left: 12px;
      bottom: 12px;
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      padding: 6px 10px;
      background: rgba(11, 15, 24, 0.86);
      border: 1px solid var(--border);
      border-radius: 4px;
      font-size: 11px;
      color: var(--muted);
      pointer-events: none;
    }
    .legend-dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 2px;
      margin-right: 4px;
      vertical-align: middle;
    }
    .atlas-hint {
      position: absolute;
      left: 12px;
      top: 12px;
      padding: 4px 8px;
      background: rgba(11, 15, 24, 0.78);
      border: 1px solid var(--border);
      border-radius: 4px;
      font-size: 11px;
      color: var(--muted);
      pointer-events: none;
    }
    .atlas-sidebar {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 12px;
      background: var(--surface);
      border-left: 1px solid var(--border);
      overflow-y: auto;
      font-size: 12px;
    }
    .side-card {
      padding: 9px 10px;
      background: var(--surface-alt);
      border: 1px solid var(--border);
      border-radius: 4px;
    }
    .side-card h2 {
      margin: 0 0 6px 0;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--accent);
    }
    .kv-row {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 4px;
      font-size: 12px;
    }
    .kv-row span:first-child { color: var(--muted); }
    .area-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
      max-height: 360px;
      overflow-y: auto;
    }
    .area-btn {
      display: flex;
      justify-content: space-between;
      align-items: center;
      text-align: left;
      width: 100%;
      padding: 5px 8px;
      font-size: 11px;
    }
    .area-btn .meta {
      color: var(--muted);
      font-family: monospace;
      font-size: 10px;
    }
    @media (max-width: 900px) {
      .atlas-main { grid-template-columns: 1fr; grid-template-rows: 1fr 220px; }
      .atlas-sidebar { border-left: none; border-top: 1px solid var(--border); }
    }
  </style>
</head>
<body>
  <div class="atlas-shell">
    <header class="atlas-header">
      <div class="atlas-title">
        <h1>3D Campaign Atlas</h1>
        <span class="seed-pill" id="seed-badge">Fixed Seed: ${seed}</span>
        <span class="seed-pill" id="stats-badge">0 voxels</span>
      </div>
      <div class="ctrl-group">
        <label for="campaign-select">Campaign:</label>
        <select id="campaign-select">
          ${optionsHtml}
        </select>
        <label for="area-select">Area Focus:</label>
        <select id="area-select">
          <option value="">All Areas (Holistic Atlas)</option>
        </select>
      </div>
    </header>

    <div class="atlas-toolbar">
      <div class="ctrl-group">
        <button id="btn-z-down" title="Step Z down ([)">Z-</button>
        <span id="z-readout" style="min-width: 48px; text-align: center; font-family: monospace;">Z = 0</span>
        <button id="btn-z-up" title="Step Z up (])">Z+</button>
      </div>
      <div class="ctrl-group">
        <button data-cutaway="ghost_above" class="active">Ghost Above</button>
        <button data-cutaway="isolate_z">Isolate Z</button>
        <button data-cutaway="full_stack">Full Stack</button>
      </div>
      <div class="ctrl-group">
        <button id="btn-projection">Perspective</button>
        <button id="btn-beacons" class="active">Beacons</button>
        <button id="btn-labels" class="active">Labels</button>
        <button id="btn-splines" class="active">Splines</button>
      </div>
      <button id="btn-fit" title="Reset camera fit (R)">Fit View [R]</button>
    </div>

    <div class="atlas-main">
      <div class="atlas-canvas-wrap" id="canvas-wrap">
        <canvas id="atlas-canvas"></canvas>
        <div class="atlas-hint">Left-Drag: Orbit · Right/Shift-Drag: Pan · Wheel: Zoom · [ / ]: Z Slice · R: Fit</div>
        <div class="atlas-legend">
          <span><i class="legend-dot" style="background:${AUTOMAP_BEACON_COLORS.start}"></i>Entry</span>
          <span><i class="legend-dot" style="background:${AUTOMAP_BEACON_COLORS.portal}"></i>Portal Exit</span>
          <span><i class="legend-dot" style="background:${AUTOMAP_BEACON_COLORS.stairs}"></i>Stairs / Ramp</span>
          <span><i class="legend-dot" style="background:${AUTOMAP_BEACON_COLORS.torch}"></i>Torch / Light</span>
          <span><i class="legend-dot" style="background:${AUTOMAP_FALLBACK_COLORS.splineVertical}"></i>Vertical Link</span>
        </div>
      </div>

      <aside class="atlas-sidebar">
        <div class="side-card">
          <h2>Inspector</h2>
          <div id="inspector-body">Click or hover over any voxel or beacon to inspect coordinates, portals, and elevation.</div>
        </div>
        <div class="side-card">
          <h2>Campaign Areas</h2>
          <div class="area-list" id="area-list"></div>
        </div>
      </aside>
    </div>
  </div>

  <script id="atlas-scenes" type="application/json">${embeddedPayload}</script>
  <script>
    (function () {
      const raw = document.getElementById('atlas-scenes')?.textContent || '{}';
      const data = JSON.parse(raw);
      const C = data.constants;
      const campaigns = data.campaigns || [];
      if (campaigns.length === 0) return;

      const unpackedCache = new Map();
      function getUnpackedScene(entry) {
        const cached = unpackedCache.get(entry.campaignId);
        if (cached) return cached;
        const p = entry.scene;
        const voxels = new Array(p.voxels.length);
        for (let i = 0; i < p.voxels.length; i++) {
          const t = p.voxels[i];
          voxels[i] = {
            areaId: p.areas[t[0]],
            x: t[1],
            y: t[2],
            z: t[3],
            wx: t[4],
            wy: t[5],
            wz: t[6],
            tileId: p.tiles[t[7]],
            kind: p.kinds[t[8]],
            topColor: p.colors[t[9]],
            sideColor: p.colors[t[10]],
            hasTorchEmber: (t[11] & 1) !== 0,
            fluidDepth: t[12],
            portalTargetAreaId: t[13] > 0 ? p.targets[t[13] - 1] : undefined
          };
        }
        const unpacked = {
          mode: p.mode,
          title: p.title,
          seed: p.seed,
          voxels,
          beacons: p.beacons,
          splines: p.splines,
          clusters: p.clusters,
          bounds: p.bounds,
          focusWx: p.focusWx,
          focusWy: p.focusWy,
          focusWz: p.focusWz
        };
        unpackedCache.set(entry.campaignId, unpacked);
        return unpacked;
      }

      let activeEntry = campaigns[0];
      let activeScene = getUnpackedScene(activeEntry);
      let hoveredVoxel = null;
      let selectedVoxel = null;
      let hoveredBeacon = null;
      let rafPending = false;

      const cam = {
        yawRad: C.defaultYawRad,
        pitchRad: C.defaultPitchRad,
        zoom: C.defaultZoom,
        panX: 0,
        panY: 0,
        activeZ: 0,
        cutawayMode: 'ghost_above',
        projection: 'perspective',
        showBeacons: true,
        showLabels: true,
        showSplines: true,
        highlightAreaId: undefined
      };

      const canvas = document.getElementById('atlas-canvas');
      const wrap = document.getElementById('canvas-wrap');
      const ctx = canvas.getContext('2d');
      const campaignSelect = document.getElementById('campaign-select');
      const areaSelect = document.getElementById('area-select');
      const areaListEl = document.getElementById('area-list');
      const zReadout = document.getElementById('z-readout');
      const statsBadge = document.getElementById('stats-badge');
      const inspectorBody = document.getElementById('inspector-body');

      function scheduleDraw() {
        if (rafPending) return;
        rafPending = true;
        requestAnimationFrame(() => {
          rafPending = false;
          draw();
        });
      }

      function projectPoint(wx, wy, wz, scene, w, h) {
        const dx = wx - scene.focusWx;
        const dy = wy - scene.focusWy;
        const dz = (wz - scene.focusWz) * C.zVerticalScale;
        const cy = Math.cos(cam.yawRad), sy = Math.sin(cam.yawRad);
        const rx = dx * cy - dy * sy;
        const ry = dx * sy + dy * cy;
        const cp = Math.cos(cam.pitchRad), sp = Math.sin(cam.pitchRad);
        const syView = ry * sp - dz * cp;
        const camZ = ry * cp + dz * sp;
        let scale = cam.zoom;
        if (cam.projection === 'perspective') {
          const denom = Math.max(8, C.perspectiveDistance - camZ);
          scale = cam.zoom * (C.perspectiveFocal / denom);
        }
        return {
          sx: w * 0.5 + cam.panX + rx * scale,
          sy: h * 0.5 + cam.panY + syView * scale,
          camZ,
          scale
        };
      }

      function voxelHeight(kind, depth) {
        if (kind === 'wall') return C.wallHeightRatio * C.zVerticalScale;
        if (kind === 'stairs_up' || kind === 'stairs_down' || kind === 'stairs_both' || kind === 'ladder' || kind === 'ramp') {
          return C.stairHeightRatio * C.zVerticalScale;
        }
        if (kind === 'water' || kind === 'magma' || kind === 'oil' || kind === 'mud') {
          const r = depth && depth > 0 ? Math.min(1, depth / 7) : 0.45;
          return (C.floorSlabHeight + r * 0.25) * C.zVerticalScale;
        }
        return C.floorSlabHeight * C.zVerticalScale;
      }

      function cutawayAlpha(voxel) {
        const dz = Math.round(voxel.wz) - cam.activeZ;
        if (cam.cutawayMode === 'isolate_z' && dz !== 0) return null;
        if (cam.cutawayMode === 'ghost_above') {
          if (dz > 0) return C.ghostAboveAlpha;
          if (dz < 0) return Math.max(C.lowerZMinAlpha, 1 - Math.abs(dz) * C.lowerZDimStep);
          return 1;
        }
        return 1;
      }

      function fitScene() {
        const scene = activeScene;
        const w = canvas.clientWidth || 920;
        const h = canvas.clientHeight || 560;
        const spanX = Math.max(8, scene.bounds.maxWx - scene.bounds.minWx + 4);
        const spanY = Math.max(8, scene.bounds.maxWy - scene.bounds.minWy + 4);
        const spanZ = Math.max(2, (scene.bounds.maxWz - scene.bounds.minWz + 2) * C.zVerticalScale);
        const diag = Math.hypot(spanX, spanY, spanZ);
        const minV = Math.max(200, Math.min(w, h));
        cam.zoom = Math.max(C.minZoom, Math.min(C.maxZoom, (minV * 0.72) / Math.max(12, diag)));
        cam.panX = 0;
        cam.panY = 0;
        cam.activeZ = Math.round(scene.focusWz);
        updateReadouts();
      }

      function focusAreaCluster(areaId) {
        cam.highlightAreaId = areaId || undefined;
        const cluster = activeScene.clusters.find((c) => c.areaId === areaId);
        if (cluster) {
          cam.activeZ = Math.round(cluster.offsetWz + cluster.minZ);
        }
        areaSelect.value = areaId || '';
        renderAreaList();
        updateReadouts();
        scheduleDraw();
      }

      function drawPoly(pts, fill, stroke, lw) {
        ctx.beginPath();
        ctx.moveTo(pts[0].sx, pts[0].sy);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].sx, pts[i].sy);
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();
        if (stroke) {
          ctx.lineWidth = lw;
          ctx.strokeStyle = stroke;
          ctx.stroke();
        }
      }

      function draw() {
        const w = wrap.clientWidth || 920;
        const h = wrap.clientHeight || 560;
        const dpr = window.devicePixelRatio || 1;
        if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
          canvas.width = Math.floor(w * dpr);
          canvas.height = Math.floor(h * dpr);
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, C.colors.backgroundTop);
        grad.addColorStop(1, C.colors.backgroundBottom);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);

        const scene = activeScene;
        if (!scene || scene.voxels.length === 0) return;

        const camDirX = Math.sin(cam.yawRad) * Math.cos(cam.pitchRad);
        const camDirY = Math.cos(cam.yawRad) * Math.cos(cam.pitchRad);

        const items = [];
        for (let i = 0; i < scene.voxels.length; i++) {
          const v = scene.voxels[i];
          const baseA = cutawayAlpha(v);
          if (baseA === null) continue;
          const faded = cam.highlightAreaId && v.areaId !== cam.highlightAreaId;
          const alpha = faded ? Math.min(baseA, 0.22) : baseA;
          const p = projectPoint(v.wx, v.wy, v.wz + 0.35, scene, w, h);
          if (p.sx < -40 || p.sx > w + 40 || p.sy < -40 || p.sy > h + 40) continue;
          items.push({ v, camZ: p.camZ, alpha });
        }
        items.sort((a, b) => a.camZ - b.camZ);

        const skipMicroStroke = items.length > 5000;
        let lastAlpha = -1;

        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          const v = it.v;
          const hz = voxelHeight(v.kind, v.fluidDepth) / C.zVerticalScale;
          const x0 = v.wx - 0.5, x1 = v.wx + 0.5, y0 = v.wy - 0.5, y1 = v.wy + 0.5, z0 = v.wz, z1 = v.wz + hz;
          const b00 = projectPoint(x0, y0, z0, scene, w, h);
          const b10 = projectPoint(x1, y0, z0, scene, w, h);
          const b11 = projectPoint(x1, y1, z0, scene, w, h);
          const b01 = projectPoint(x0, y1, z0, scene, w, h);
          const t00 = projectPoint(x0, y0, z1, scene, w, h);
          const t10 = projectPoint(x1, y0, z1, scene, w, h);
          const t11 = projectPoint(x1, y1, z1, scene, w, h);
          const t01 = projectPoint(x0, y1, z1, scene, w, h);
          const hi = (hoveredVoxel === v) || (selectedVoxel === v);
          const stroke = hi ? '#facc15' : (skipMicroStroke && t00.scale < 5.5 ? null : (v.kind === 'wall' ? 'rgba(15,23,42,0.72)' : 'rgba(15,23,42,0.45)'));
          const sw = hi ? 1.8 : 0.7;

          if (it.alpha !== lastAlpha) {
            ctx.globalAlpha = it.alpha;
            lastAlpha = it.alpha;
          }
          if (camDirX >= 0) drawPoly([b10, b11, t11, t10], v.sideColor, stroke, sw);
          else drawPoly([b00, b01, t01, t00], v.sideColor, stroke, sw);
          if (camDirY >= 0) drawPoly([b01, b11, t11, t01], v.sideColor, stroke, sw);
          else drawPoly([b00, b10, t10, t00], v.sideColor, stroke, sw);
          drawPoly([t00, t10, t11, t01], v.topColor, stroke, sw);

          if (v.hasTorchEmber) {
            const ep = projectPoint(v.wx, v.wy, z1 + 0.12, scene, w, h);
            ctx.fillStyle = '#fb923c';
            ctx.beginPath();
            ctx.arc(ep.sx, ep.sy, Math.max(1.8, Math.min(5, ep.scale * 0.22)), 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.globalAlpha = 1;

        if (cam.showSplines && scene.splines.length > 0) {
          ctx.save();
          for (const sp of scene.splines) {
            const p0 = projectPoint(sp.fromWx, sp.fromWy, sp.fromWz + 0.5, scene, w, h);
            const p1 = projectPoint(sp.toWx, sp.toWy, sp.toWz + 0.5, scene, w, h);
            const ctrl = projectPoint((sp.fromWx + sp.toWx) * 0.5, (sp.fromWy + sp.toWy) * 0.5, Math.max(sp.fromWz, sp.toWz) + 3.2, scene, w, h);
            const rel = !cam.highlightAreaId || sp.fromAreaId === cam.highlightAreaId || sp.toAreaId === cam.highlightAreaId;
            ctx.globalAlpha = rel ? 0.78 : 0.2;
            ctx.strokeStyle = sp.color;
            ctx.lineWidth = rel ? 1.8 : 1;
            ctx.setLineDash([5, 4]);
            ctx.beginPath();
            ctx.moveTo(p0.sx, p0.sy);
            ctx.quadraticCurveTo(ctrl.sx, ctrl.sy, p1.sx, p1.sy);
            ctx.stroke();
            ctx.setLineDash([]);
          }
          ctx.restore();
        }

        if (cam.showBeacons && scene.beacons.length > 0) {
          ctx.save();
          for (const b of scene.beacons) {
            if (cam.cutawayMode === 'isolate_z' && Math.round(b.wz) !== cam.activeZ) continue;
            if (cam.highlightAreaId && b.areaId !== cam.highlightAreaId) continue;
            const topP = projectPoint(b.wx, b.wy, b.wz + C.plumbHalfSpanZ, scene, w, h);
            const botP = projectPoint(b.wx, b.wy, b.wz - C.plumbHalfSpanZ, scene, w, h);
            const midP = projectPoint(b.wx, b.wy, b.wz + 0.4, scene, w, h);
            if (b.kind === 'portal' || b.kind === 'start' || b.kind === 'player') {
              ctx.strokeStyle = b.color;
              ctx.lineWidth = 1.5;
              ctx.globalAlpha = 0.74;
              ctx.beginPath();
              ctx.moveTo(botP.sx, botP.sy);
              ctx.lineTo(topP.sx, topP.sy);
              ctx.stroke();
            }
            const sz = hoveredBeacon === b ? 7 : 4.5;
            ctx.globalAlpha = 1;
            ctx.fillStyle = b.color;
            ctx.strokeStyle = '#090d14';
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.moveTo(midP.sx, midP.sy - sz);
            ctx.lineTo(midP.sx + sz, midP.sy);
            ctx.lineTo(midP.sx, midP.sy + sz);
            ctx.lineTo(midP.sx - sz, midP.sy);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
          }
          ctx.restore();
        }

        if (cam.showLabels && scene.clusters.length > 0) {
          ctx.save();
          ctx.font = 'bold 11px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          for (const cl of scene.clusters) {
            const cx = cl.offsetWx + (cl.minLocalX + cl.maxLocalX) * 0.5;
            const cy = cl.offsetWy + (cl.minLocalY + cl.maxLocalY) * 0.5;
            const cz = cl.offsetWz + cl.maxZ + 1.6;
            const pt = projectPoint(cx, cy, cz, scene, w, h);
            const sel = cam.highlightAreaId === cl.areaId;
            ctx.globalAlpha = cam.highlightAreaId && !sel ? 0.32 : 0.94;
            const txt = cl.name + ' (D' + cl.dangerRating + ')';
            const tw = ctx.measureText(txt).width;
            ctx.fillStyle = sel ? 'rgba(230,184,76,0.92)' : 'rgba(15,23,42,0.82)';
            ctx.strokeStyle = sel ? '#fef08a' : 'rgba(148,163,184,0.45)';
            ctx.lineWidth = 1;
            ctx.fillRect(pt.sx - tw * 0.5 - 6, pt.sy - 10, tw + 12, 20);
            ctx.strokeRect(pt.sx - tw * 0.5 - 6, pt.sy - 10, tw + 12, 20);
            ctx.fillStyle = sel ? '#090d14' : '#f1f5f9';
            ctx.fillText(txt, pt.sx, pt.sy);
          }
          ctx.restore();
        }
      }

      function pickAt(sx, sy) {
        const w = wrap.clientWidth || 920;
        const h = wrap.clientHeight || 560;
        const scene = activeScene;
        let bestB = null;
        if (cam.showBeacons) {
          for (const b of scene.beacons) {
            if (cam.cutawayMode === 'isolate_z' && Math.round(b.wz) !== cam.activeZ) continue;
            if (cam.highlightAreaId && b.areaId !== cam.highlightAreaId) continue;
            const p = projectPoint(b.wx, b.wy, b.wz + 0.4, scene, w, h);
            if (Math.hypot(sx - p.sx, sy - p.sy) <= 11 && (!bestB || p.camZ > bestB.camZ)) {
              bestB = { b, camZ: p.camZ };
            }
          }
        }
        if (bestB) return { kind: 'beacon', beacon: bestB.b };

        let bestV = null;
        for (const v of scene.voxels) {
          if (cutawayAlpha(v) === null) continue;
          const hz = voxelHeight(v.kind, v.fluidDepth) / C.zVerticalScale;
          const p = projectPoint(v.wx, v.wy, v.wz + hz * 0.6, scene, w, h);
          const r = Math.max(5, p.scale * 0.65);
          if (Math.abs(sx - p.sx) <= r && Math.abs(sy - p.sy) <= r && (!bestV || p.camZ > bestV.camZ)) {
            bestV = { v, camZ: p.camZ };
          }
        }
        return bestV ? { kind: 'voxel', voxel: bestV.v } : null;
      }

      function renderInspector(hit) {
        if (!hit) {
          inspectorBody.textContent = activeEntry.description || 'Hover or click any voxel/beacon to inspect.';
          return;
        }
        if (hit.kind === 'beacon') {
          const b = hit.beacon;
          inspectorBody.innerHTML =
            '<div class="kv-row"><span>Beacon</span><strong>' + b.label + '</strong></div>' +
            '<div class="kv-row"><span>Area</span><span>' + b.areaId + '</span></div>' +
            '<div class="kv-row"><span>Coord</span><span>(' + b.x + ', ' + b.y + ', Z:' + b.z + ')</span></div>' +
            (b.subtitle ? '<div class="kv-row"><span>Detail</span><span>' + b.subtitle + '</span></div>' : '');
          return;
        }
        const v = hit.voxel;
        inspectorBody.innerHTML =
          '<div class="kv-row"><span>Tile</span><strong>' + v.tileId + '</strong></div>' +
          '<div class="kv-row"><span>Kind</span><span>' + v.kind + '</span></div>' +
          '<div class="kv-row"><span>Area</span><span>' + v.areaId + '</span></div>' +
          '<div class="kv-row"><span>Coord</span><span>(' + v.x + ', ' + v.y + ', Z:' + v.z + ')</span></div>' +
          (v.portalTargetAreaId ? '<div class="kv-row"><span>Portal</span><span>-> ' + v.portalTargetAreaId + '</span></div>' : '');
      }

      function renderAreaList() {
        const scene = activeScene;
        areaListEl.innerHTML = '';
        for (const cl of scene.clusters) {
          const btn = document.createElement('button');
          btn.className = 'area-btn' + (cam.highlightAreaId === cl.areaId ? ' active' : '');
          btn.innerHTML = '<span>' + cl.name + '</span><span class="meta">D' + cl.dangerRating + ' · Z:' + cl.minZ + '..' + cl.maxZ + '</span>';
          btn.onclick = () => focusAreaCluster(cam.highlightAreaId === cl.areaId ? '' : cl.areaId);
          areaListEl.appendChild(btn);
        }
      }

      function updateReadouts() {
        zReadout.textContent = 'Z = ' + cam.activeZ;
        statsBadge.textContent = activeScene.voxels.length + ' voxels · ' + activeScene.clusters.length + ' areas';
      }

      function selectCampaign(id) {
        const found = campaigns.find((c) => c.campaignId === id) || campaigns[0];
        if (!found) return;
        activeEntry = found;
        activeScene = getUnpackedScene(found);
        cam.highlightAreaId = undefined;
        hoveredVoxel = null;
        selectedVoxel = null;
        hoveredBeacon = null;
        areaSelect.innerHTML = '<option value="">All Areas (Holistic Atlas)</option>';
        for (const cl of activeScene.clusters) {
          const opt = document.createElement('option');
          opt.value = cl.areaId;
          opt.textContent = cl.name + ' (' + cl.areaId + ')';
          areaSelect.appendChild(opt);
        }
        renderAreaList();
        renderInspector(null);
        fitScene();
        scheduleDraw();
      }

      campaignSelect.onchange = () => selectCampaign(campaignSelect.value);
      areaSelect.onchange = () => focusAreaCluster(areaSelect.value);
      document.getElementById('btn-z-down').onclick = () => { cam.activeZ -= 1; updateReadouts(); scheduleDraw(); };
      document.getElementById('btn-z-up').onclick = () => { cam.activeZ += 1; updateReadouts(); scheduleDraw(); };
      document.getElementById('btn-fit').onclick = () => { fitScene(); scheduleDraw(); };
      document.getElementById('btn-projection').onclick = (e) => {
        cam.projection = cam.projection === 'perspective' ? 'isometric' : 'perspective';
        e.target.textContent = cam.projection === 'perspective' ? 'Perspective' : 'Isometric';
        scheduleDraw();
      };
      document.getElementById('btn-beacons').onclick = (e) => {
        cam.showBeacons = !cam.showBeacons;
        e.target.classList.toggle('active', cam.showBeacons);
        scheduleDraw();
      };
      document.getElementById('btn-labels').onclick = (e) => {
        cam.showLabels = !cam.showLabels;
        e.target.classList.toggle('active', cam.showLabels);
        scheduleDraw();
      };
      document.getElementById('btn-splines').onclick = (e) => {
        cam.showSplines = !cam.showSplines;
        e.target.classList.toggle('active', cam.showSplines);
        scheduleDraw();
      };
      document.querySelectorAll('[data-cutaway]').forEach((btn) => {
        btn.onclick = () => {
          cam.cutawayMode = btn.getAttribute('data-cutaway');
          document.querySelectorAll('[data-cutaway]').forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          scheduleDraw();
        };
      });

      let dragMode = null;
      let lastX = 0, lastY = 0, downX = 0, downY = 0;
      canvas.oncontextmenu = (e) => e.preventDefault();
      canvas.onmousedown = (e) => {
        dragMode = (e.button === 2 || e.shiftKey) ? 'pan' : 'orbit';
        lastX = downX = e.clientX;
        lastY = downY = e.clientY;
      };
      window.addEventListener('mousemove', (e) => {
        if (dragMode) {
          const dx = e.clientX - lastX;
          const dy = e.clientY - lastY;
          lastX = e.clientX;
          lastY = e.clientY;
          if (dragMode === 'orbit') {
            cam.yawRad += dx * 0.009;
            cam.pitchRad = Math.max(C.minPitchRad, Math.min(C.maxPitchRad, cam.pitchRad + dy * 0.008));
          } else {
            cam.panX += dx;
            cam.panY += dy;
          }
          scheduleDraw();
        }
      });
      canvas.onmousemove = (e) => {
        if (dragMode) return;
        const rect = canvas.getBoundingClientRect();
        const hit = pickAt(e.clientX - rect.left, e.clientY - rect.top);
        const nextV = hit && hit.kind === 'voxel' ? hit.voxel : null;
        const nextB = hit && hit.kind === 'beacon' ? hit.beacon : null;
        if (nextV !== hoveredVoxel || nextB !== hoveredBeacon) {
          hoveredVoxel = nextV;
          hoveredBeacon = nextB;
          renderInspector(hit || (selectedVoxel ? { kind: 'voxel', voxel: selectedVoxel } : null));
          scheduleDraw();
        }
      };
      window.addEventListener('mouseup', (e) => {
        if (!dragMode) return;
        const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
        dragMode = null;
        if (moved < 5) {
          const rect = canvas.getBoundingClientRect();
          const hit = pickAt(e.clientX - rect.left, e.clientY - rect.top);
          if (hit && hit.kind === 'voxel') {
            selectedVoxel = hit.voxel;
            renderInspector(hit);
            scheduleDraw();
          } else if (hit && hit.kind === 'beacon') {
            renderInspector(hit);
          }
        }
      });
      canvas.ondblclick = (e) => {
        const rect = canvas.getBoundingClientRect();
        const hit = pickAt(e.clientX - rect.left, e.clientY - rect.top);
        if (hit && hit.voxel) focusAreaCluster(hit.voxel.areaId);
      };
      canvas.onwheel = (e) => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.12 : 0.89;
        cam.zoom = Math.max(C.minZoom, Math.min(C.maxZoom, cam.zoom * factor));
        scheduleDraw();
      };
      window.addEventListener('keydown', (e) => {
        if (e.target && (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT')) return;
        if (e.key === '[' || e.key === '<') { cam.activeZ -= 1; updateReadouts(); scheduleDraw(); }
        else if (e.key === ']' || e.key === '>') { cam.activeZ += 1; updateReadouts(); scheduleDraw(); }
        else if (e.key === 'r' || e.key === 'R') { fitScene(); scheduleDraw(); }
        else if (e.key === 'q' || e.key === 'Q') { cam.yawRad -= 0.14; scheduleDraw(); }
        else if (e.key === 'e' || e.key === 'E') { cam.yawRad += 0.14; scheduleDraw(); }
        else if (e.key === '+' || e.key === '=') { cam.zoom = Math.min(C.maxZoom, cam.zoom * 1.15); scheduleDraw(); }
        else if (e.key === '-') { cam.zoom = Math.max(C.minZoom, cam.zoom * 0.87); scheduleDraw(); }
        else if (e.key === 'ArrowLeft' || e.key === 'a') { cam.panX += 24; scheduleDraw(); }
        else if (e.key === 'ArrowRight' || e.key === 'd') { cam.panX -= 24; scheduleDraw(); }
        else if (e.key === 'ArrowUp' || e.key === 'w') { cam.panY += 24; scheduleDraw(); }
        else if (e.key === 'ArrowDown' || e.key === 's') { cam.panY -= 24; scheduleDraw(); }
      });
      window.addEventListener('resize', scheduleDraw);

      selectCampaign(data.initialCampaignId);
    })();
  </script>
</body>
</html>
`;
}
