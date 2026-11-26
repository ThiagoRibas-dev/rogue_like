import type { ComponentChildren, JSX, TargetedKeyboardEvent, TargetedMouseEvent, TargetedWheelEvent } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  AUTOMAP_BEACON_COLORS,
  AUTOMAP_CUTAWAY_LABELS,
  AUTOMAP_DEFAULT_CANVAS_HEIGHT,
  AUTOMAP_DEFAULT_CANVAS_WIDTH,
  AUTOMAP_MAX_PITCH_RAD,
  AUTOMAP_MAX_ZOOM,
  AUTOMAP_MIN_PITCH_RAD,
  AUTOMAP_MIN_ZOOM,
  createDefaultAutomapCamera
} from '../../../constants/automap3d.constants.ts';
import type {
  AutomapBeacon3D,
  AutomapCameraState3D,
  AutomapHitResult3D,
  AutomapScene3D,
  AutomapVoxelCell3D,
  AutomapZCutawayMode
} from '../../../types/automap3d.types.ts';
import {
  fitCameraToScene3D,
  pickAutomapVoxelAtScreenPoint,
  renderAutomapScene3D
} from '../../automap3d/automap3d_renderer.ts';
import { Button } from './Button.tsx';
import { Select } from './FormControls.tsx';

/** Props for the shared interactive `<Automap3DViewport />` primitive. */
export interface Automap3DViewportProps {
  readonly scene: AutomapScene3D;
  readonly initialActiveZ?: number | undefined;
  readonly initialCutaway?: AutomapZCutawayMode | undefined;
  readonly heightPx?: number | undefined;
  readonly selectedVoxel?: AutomapVoxelCell3D | undefined;
  readonly onSelectVoxel?: ((hit: AutomapHitResult3D | null) => void) | undefined;
  readonly onActivateCluster?: ((areaId: string) => void) | undefined;
  readonly toolbarExtras?: ComponentChildren | undefined;
  readonly extraInspector?: ComponentChildren | undefined;
  readonly dataTestId?: string | undefined;
}

const CUTAWAY_MODES: ReadonlyArray<AutomapZCutawayMode> = ['ghost_above', 'isolate_z', 'full_stack'];

/**
 * Shared zero-dependency interactive `<canvas>` 3D viewport used across the in-game Automap modal,
 * the Campaign Editor Local 3D View, and the Campaign Editor Holistic World Atlas.
 */
export function Automap3DViewport({
  scene,
  initialActiveZ,
  initialCutaway = 'ghost_above',
  heightPx = 500,
  selectedVoxel,
  onSelectVoxel,
  onActivateCluster,
  toolbarExtras,
  extraInspector,
  dataTestId = 'automap-3d-viewport'
}: Automap3DViewportProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const zMin = Math.floor(scene.bounds.minWz);
  const zMax = Math.ceil(scene.bounds.maxWz);

  const [viewportSize, setViewportSize] = useState<{ readonly w: number; readonly h: number }>({
    w: AUTOMAP_DEFAULT_CANVAS_WIDTH,
    h: heightPx || AUTOMAP_DEFAULT_CANVAS_HEIGHT
  });

  const [camera, setCamera] = useState<AutomapCameraState3D>(() =>
    fitCameraToScene3D(
      scene,
      createDefaultAutomapCamera(initialActiveZ ?? Math.round(scene.focusWz), initialCutaway),
      AUTOMAP_DEFAULT_CANVAS_WIDTH,
      heightPx || AUTOMAP_DEFAULT_CANVAS_HEIGHT
    )
  );

  const [hoveredHit, setHoveredHit] = useState<AutomapHitResult3D | null>(null);
  const [internalSelected, setInternalSelected] = useState<AutomapHitResult3D | null>(null);

  // Refit activeZ smoothly when switching between scenes / areas.
  useEffect(() => {
    const targetZ =
      initialActiveZ !== undefined
        ? Math.max(zMin, Math.min(zMax, initialActiveZ))
        : Math.max(zMin, Math.min(zMax, Math.round(scene.focusWz)));
    setCamera((prev) =>
      fitCameraToScene3D(
        scene,
        {
          ...prev,
          activeZ: targetZ,
          ...(prev.highlightAreaId && !scene.clusters.some((c) => c.areaId === prev.highlightAreaId)
            ? { highlightAreaId: undefined }
            : {})
        },
        viewportSize.w,
        viewportSize.h
      )
    );
  }, [scene, initialActiveZ, zMin, zMax, viewportSize.w, viewportSize.h]);

  // Keep canvas crisp using ResizeObserver when supported.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = (): void => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 40) {
        setViewportSize({ w: Math.round(rect.width), h: heightPx });
      }
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [heightPx]);

  const effectiveSelectedVoxel: AutomapVoxelCell3D | undefined =
    selectedVoxel ?? (internalSelected?.kind === 'voxel' ? internalSelected.voxel : undefined);
  const hoveredVoxel: AutomapVoxelCell3D | undefined = hoveredHit?.kind === 'voxel' ? hoveredHit.voxel : undefined;
  const hoveredBeacon: AutomapBeacon3D | undefined = hoveredHit?.kind === 'beacon' ? hoveredHit.beacon : undefined;

  // Render scene whenever camera, scene, size, or hover/selection changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    canvas.width = Math.max(1, Math.round(viewportSize.w * dpr));
    canvas.height = Math.max(1, Math.round(viewportSize.h * dpr));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.save();
    ctx.scale(dpr, dpr);
    renderAutomapScene3D(ctx, scene, camera, viewportSize.w, viewportSize.h, {
      hoveredVoxel,
      selectedVoxel: effectiveSelectedVoxel,
      hoveredBeacon
    });
    ctx.restore();
  }, [scene, camera, viewportSize, hoveredVoxel, effectiveSelectedVoxel, hoveredBeacon]);

  const dragRef = useRef<{
    active: boolean;
    mode: 'orbit' | 'pan';
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    movedPx: number;
  } | null>(null);

  const getLocalCanvasCoords = useCallback(
    (clientX: number, clientY: number): { readonly x: number; readonly y: number } => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      return { x: clientX - rect.left, y: clientY - rect.top };
    },
    []
  );

  const handleMouseDown = (event: TargetedMouseEvent<HTMLCanvasElement>): void => {
    event.preventDefault();
    const isPan = event.button === 2 || event.button === 1 || event.shiftKey;
    dragRef.current = {
      active: true,
      mode: isPan ? 'pan' : 'orbit',
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      movedPx: 0
    };
    canvasRef.current?.focus();
  };

  const handleMouseMove = (event: TargetedMouseEvent<HTMLCanvasElement>): void => {
    const drag = dragRef.current;
    if (drag?.active) {
      const dx = event.clientX - drag.lastX;
      const dy = event.clientY - drag.lastY;
      drag.lastX = event.clientX;
      drag.lastY = event.clientY;
      drag.movedPx += Math.hypot(dx, dy);

      if (drag.mode === 'orbit') {
        setCamera((prev) => ({
          ...prev,
          yawRad: prev.yawRad + dx * 0.0085,
          pitchRad: Math.max(AUTOMAP_MIN_PITCH_RAD, Math.min(AUTOMAP_MAX_PITCH_RAD, prev.pitchRad + dy * 0.0075))
        }));
      } else {
        setCamera((prev) => ({
          ...prev,
          panX: prev.panX + dx,
          panY: prev.panY + dy
        }));
      }
      return;
    }

    const pt = getLocalCanvasCoords(event.clientX, event.clientY);
    const hit = pickAutomapVoxelAtScreenPoint(pt.x, pt.y, scene, camera, viewportSize.w, viewportSize.h);
    setHoveredHit((prev) => {
      if (prev === null && hit === null) return prev;
      if (prev?.kind === 'voxel' && hit?.kind === 'voxel' && prev.voxel === hit.voxel) return prev;
      if (prev?.kind === 'beacon' && hit?.kind === 'beacon' && prev.beacon === hit.beacon) return prev;
      return hit;
    });
  };

  const handleMouseUp = (event: TargetedMouseEvent<HTMLCanvasElement>): void => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || drag.movedPx >= 5) return;

    const pt = getLocalCanvasCoords(event.clientX, event.clientY);
    const hit = pickAutomapVoxelAtScreenPoint(pt.x, pt.y, scene, camera, viewportSize.w, viewportSize.h);
    setInternalSelected(hit);
    onSelectVoxel?.(hit);
  };

  const handleDoubleClick = (event: TargetedMouseEvent<HTMLCanvasElement>): void => {
    if (!onActivateCluster) return;
    const pt = getLocalCanvasCoords(event.clientX, event.clientY);
    const hit = pickAutomapVoxelAtScreenPoint(pt.x, pt.y, scene, camera, viewportSize.w, viewportSize.h);
    const areaId = hit?.voxel?.areaId ?? hit?.beacon?.areaId;
    if (areaId) {
      onActivateCluster(areaId);
    }
  };

  const handleWheel = (event: TargetedWheelEvent<HTMLCanvasElement>): void => {
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.12 : 0.89;
    setCamera((prev) => ({
      ...prev,
      zoom: Math.max(AUTOMAP_MIN_ZOOM, Math.min(AUTOMAP_MAX_ZOOM, prev.zoom * factor))
    }));
  };

  const handleKeyDown = (event: TargetedKeyboardEvent<HTMLCanvasElement>): void => {
    switch (event.key) {
      case 'ArrowLeft':
      case 'a':
      case 'A':
        event.preventDefault();
        setCamera((prev) => ({ ...prev, yawRad: prev.yawRad - 0.14 }));
        break;
      case 'ArrowRight':
      case 'd':
      case 'D':
        event.preventDefault();
        setCamera((prev) => ({ ...prev, yawRad: prev.yawRad + 0.14 }));
        break;
      case 'ArrowUp':
      case 'w':
      case 'W':
        event.preventDefault();
        setCamera((prev) => ({
          ...prev,
          pitchRad: Math.min(AUTOMAP_MAX_PITCH_RAD, prev.pitchRad + 0.1)
        }));
        break;
      case 'ArrowDown':
      case 's':
      case 'S':
        event.preventDefault();
        setCamera((prev) => ({
          ...prev,
          pitchRad: Math.max(AUTOMAP_MIN_PITCH_RAD, prev.pitchRad - 0.1)
        }));
        break;
      case '+':
      case '=':
        event.preventDefault();
        setCamera((prev) => ({ ...prev, zoom: Math.min(AUTOMAP_MAX_ZOOM, prev.zoom * 1.15) }));
        break;
      case '-':
      case '_':
        event.preventDefault();
        setCamera((prev) => ({ ...prev, zoom: Math.max(AUTOMAP_MIN_ZOOM, prev.zoom * 0.87) }));
        break;
      case '[':
        event.preventDefault();
        setCamera((prev) => ({ ...prev, activeZ: Math.max(zMin, prev.activeZ - 1) }));
        break;
      case ']':
        event.preventDefault();
        setCamera((prev) => ({ ...prev, activeZ: Math.min(zMax, prev.activeZ + 1) }));
        break;
    }
  };

  const clusterOptions = useMemo(
    () => [
      { value: '__all__', label: `All Areas (${scene.clusters.length})` },
      ...scene.clusters.map((c) => ({
        value: c.areaId,
        label: `${c.name} (${c.voxelCount} voxels)`
      }))
    ],
    [scene.clusters]
  );

  const activeInspect = hoveredHit ?? internalSelected;

  return (
    <div className="ui-automap3d" data-testid={dataTestId}>
      <div className="ui-automap3d__toolbar">
        <div className="ui-automap3d__group">
          <Button
            size="sm"
            onClick={() => setCamera((p) => ({ ...p, activeZ: Math.max(zMin, p.activeZ - 1) }))}
            disabled={camera.activeZ <= zMin}
            title="Step down one Z-stratum ([)"
          >
            Z −
          </Button>
          <span className="ui-badge ui-badge--accent ui-tabular" data-testid="automap3d-active-z">
            Z: {camera.activeZ}
          </span>
          <Button
            size="sm"
            onClick={() => setCamera((p) => ({ ...p, activeZ: Math.min(zMax, p.activeZ + 1) }))}
            disabled={camera.activeZ >= zMax}
            title="Step up one Z-stratum (])"
          >
            Z +
          </Button>
        </div>

        <div className="ui-automap3d__group">
          {CUTAWAY_MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              className="ui-chip"
              aria-pressed={camera.cutawayMode === mode}
              onClick={() => setCamera((p) => ({ ...p, cutawayMode: mode }))}
            >
              {AUTOMAP_CUTAWAY_LABELS[mode]}
            </button>
          ))}
        </div>

        <div className="ui-automap3d__group">
          <button
            type="button"
            className="ui-chip"
            aria-pressed={camera.projection === 'isometric'}
            onClick={() =>
              setCamera((p) => ({
                ...p,
                projection: p.projection === 'perspective' ? 'isometric' : 'perspective'
              }))
            }
          >
            {camera.projection === 'perspective' ? 'Perspective' : 'Isometric'}
          </button>
          <button
            type="button"
            className="ui-chip"
            aria-pressed={camera.showBeacons}
            onClick={() => setCamera((p) => ({ ...p, showBeacons: !p.showBeacons }))}
          >
            Beacons
          </button>
          <button
            type="button"
            className="ui-chip"
            aria-pressed={camera.showLabels}
            onClick={() => setCamera((p) => ({ ...p, showLabels: !p.showLabels }))}
          >
            Labels
          </button>
          {scene.splines.length > 0 ? (
            <button
              type="button"
              className="ui-chip"
              aria-pressed={camera.showSplines}
              onClick={() => setCamera((p) => ({ ...p, showSplines: !p.showSplines }))}
            >
              Splines
            </button>
          ) : null}
          <Button
            size="sm"
            onClick={() =>
              setCamera((p) =>
                fitCameraToScene3D(
                  scene,
                  {
                    ...createDefaultAutomapCamera(
                      initialActiveZ ?? Math.round(scene.focusWz),
                      p.cutawayMode,
                      p.highlightAreaId
                    ),
                    projection: p.projection,
                    showBeacons: p.showBeacons,
                    showLabels: p.showLabels,
                    showSplines: p.showSplines
                  },
                  viewportSize.w,
                  viewportSize.h
                )
              )
            }
          >
            Fit View
          </Button>
          {toolbarExtras}
        </div>
      </div>

      {scene.clusters.length > 1 ? (
        <div className="ui-automap3d__toolbar">
          <div className="ui-automap3d__group">
            <span className="ui-editor-muted">Focus Area:</span>
            <Select
              ariaLabel="Filter holistic area"
              value={camera.highlightAreaId ?? '__all__'}
              options={clusterOptions}
              onChange={(val) =>
                setCamera((p) => ({
                  ...p,
                  highlightAreaId: val === '__all__' ? undefined : val
                }))
              }
            />
          </div>
          {onActivateCluster && camera.highlightAreaId ? (
            <Button size="sm" variant="primary" onClick={() => onActivateCluster(camera.highlightAreaId!)}>
              Open Selected Area
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="ui-automap3d__stage-wrap">
        <div ref={containerRef} className="ui-automap3d__canvas-box" style={{ height: `${heightPx}px` }}>
          <canvas
            ref={canvasRef}
            className="ui-automap3d__canvas"
            tabIndex={0}
            aria-label={`3D dungeon map canvas for ${scene.title}`}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={() => {
              dragRef.current = null;
              setHoveredHit(null);
            }}
            onDblClick={handleDoubleClick}
            onWheel={handleWheel}
            onKeyDown={handleKeyDown}
            onContextMenu={(e) => e.preventDefault()}
          />
          <div className="ui-automap3d__hud-overlay ui-tabular">
            <span>Drag: Orbit</span>
            <span>·</span>
            <span>Shift+Drag / Right-Drag: Pan</span>
            <span>·</span>
            <span>Wheel: Zoom</span>
            <span>·</span>
            <span>[ / ]: Z-Slice</span>
            {scene.seed !== undefined ? (
              <>
                <span>·</span>
                <span>Seed: {scene.seed}</span>
              </>
            ) : null}
          </div>
        </div>

        <aside className="ui-automap3d__sidebar">
          <section className="ui-automap3d__card">
            <h4 className="ui-automap3d__card-title">Scene Telemetry</h4>
            <div className="ui-tabular">Voxels: {scene.voxels.length}</div>
            <div className="ui-tabular">Beacons: {scene.beacons.length}</div>
            <div className="ui-tabular">
              Z-Span: {zMin} .. {zMax}
            </div>
            {scene.clusters.length > 1 ? (
              <div className="ui-tabular">
                Areas: {scene.clusters.length} · Links: {scene.splines.length}
              </div>
            ) : null}
          </section>

          <section className="ui-automap3d__card">
            <h4 className="ui-automap3d__card-title">Beacon Legend</h4>
            <div className="ui-automap3d__legend-row">
              <span className="ui-automap3d__swatch" style={{ background: AUTOMAP_BEACON_COLORS.player }} />
              <span>Player / Active Anchor</span>
            </div>
            <div className="ui-automap3d__legend-row">
              <span className="ui-automap3d__swatch" style={{ background: AUTOMAP_BEACON_COLORS.portal }} />
              <span>Area Portal / Exit</span>
            </div>
            <div className="ui-automap3d__legend-row">
              <span className="ui-automap3d__swatch" style={{ background: AUTOMAP_BEACON_COLORS.stairs }} />
              <span>Stairs / Ramp / Ladder</span>
            </div>
            <div className="ui-automap3d__legend-row">
              <span className="ui-automap3d__swatch" style={{ background: AUTOMAP_BEACON_COLORS.note }} />
              <span>Player Map Note</span>
            </div>
            <div className="ui-automap3d__legend-row">
              <span className="ui-automap3d__swatch" style={{ background: AUTOMAP_BEACON_COLORS.torch }} />
              <span>Lit Torch / Light Ember</span>
            </div>
          </section>

          <section className="ui-automap3d__card" data-testid="automap3d-inspector">
            <h4 className="ui-automap3d__card-title">Inspector</h4>
            {activeInspect?.kind === 'beacon' && activeInspect.beacon ? (
              <>
                <strong>{activeInspect.beacon.label}</strong>
                <span className="ui-editor-muted">{activeInspect.beacon.subtitle ?? activeInspect.beacon.areaId}</span>
                <span className="ui-tabular">
                  ({activeInspect.beacon.x}, {activeInspect.beacon.y}, Z:{activeInspect.beacon.z})
                </span>
              </>
            ) : activeInspect?.kind === 'voxel' && activeInspect.voxel ? (
              <>
                <strong>{activeInspect.voxel.tileId}</strong>
                <span className="ui-editor-muted">
                  Kind: {activeInspect.voxel.kind} · Area: {activeInspect.voxel.areaId}
                </span>
                <span className="ui-tabular">
                  Local: ({activeInspect.voxel.x}, {activeInspect.voxel.y}, Z:{activeInspect.voxel.z})
                </span>
                {activeInspect.voxel.entityMarker ? (
                  <span>Entity: {activeInspect.voxel.entityMarker.label}</span>
                ) : null}
                {activeInspect.voxel.portalTargetAreaId ? (
                  <span>Portal → {activeInspect.voxel.portalTargetAreaId}</span>
                ) : null}
              </>
            ) : (
              <span className="ui-editor-muted">Hover or click any voxel or plumb-line beacon to inspect.</span>
            )}
          </section>

          {extraInspector}
        </aside>
      </div>
    </div>
  );
}
