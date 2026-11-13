import { test, expect } from 'bun:test';
import { applyViewportResize } from '../src/core/session_controller.ts';
import { consumeDirtyDomains, PresentationDomain } from '../src/core/presentation_queue.ts';
import { DEFAULT_VIEWPORT_TILE_HEIGHT_PERCENT } from '../src/constants/display.constants.ts';
import { getCameraOffset } from '../src/rendering/camera.ts';
import { syncDisplayLayout } from '../src/rendering/display.ts';
import { buildViewportSnapshot } from '../src/rendering/viewport_snapshot.ts';
import { addComponent, queryEntities } from '../src/core/ecs.ts';
import { ComponentType } from '../src/types/components.types.ts';
import { loadCampaignFromDisk, buildGameState } from './helpers.ts';

test('applyViewportResize re-syncs layout and forces a full redraw', () => {
  const campaign = loadCampaignFromDisk('megacampaign'); // ASCII → no fog overlay canvas
  const state = buildGameState(campaign);

  consumeDirtyDomains(); // start from a clean dirty set

  const setOptionsCalls: unknown[] = [];
  const display = {
    getOptions: () => ({ width: 50, height: 25 }),
    setOptions: (options: unknown) => {
      setOptionsCalls.push(options);
    },
    _backend: { _spacingX: 8, _spacingY: 16 }
  };

  const previousDocument = (globalThis as Record<string, unknown>)['document'];
  (globalThis as Record<string, unknown>)['document'] = { getElementById: () => null };

  try {
    applyViewportResize(display as never, state);
  } finally {
    (globalThis as Record<string, unknown>)['document'] = previousDocument;
  }

  expect(setOptionsCalls.length).toBeGreaterThan(0);
  const dirty = consumeDirtyDomains();
  expect(dirty.has(PresentationDomain.Map)).toBe(true);
});

test('syncDisplayLayout scales 1.0x tile size to a fixed viewport percentage across resolutions in Sprite Mode', () => {
  const campaign = loadCampaignFromDisk('dnd35e-crypt');
  const state = buildGameState(campaign);

  const runWithViewport = (
    viewportW: number,
    viewportH: number,
    zoomLevel: number
  ): {
    readonly width: number;
    readonly height: number;
    readonly cssW: number;
    readonly cssH: number;
  } => {
    const fakeCanvas = { style: { width: '', height: '' } };
    let recordedWidth = 0;
    let recordedHeight = 0;
    const display = {
      getOptions: () => ({ width: recordedWidth, height: recordedHeight }),
      getContainer: () => fakeCanvas,
      setOptions: (opts: { readonly width?: number; readonly height?: number }) => {
        if (opts.width !== undefined) recordedWidth = opts.width;
        if (opts.height !== undefined) recordedHeight = opts.height;
      },
      _backend: {}
    };

    const previousDocument = (globalThis as Record<string, unknown>)['document'];
    (globalThis as Record<string, unknown>)['document'] = {
      getElementById: (id: string) =>
        id === 'game-canvas-wrapper' ? { clientWidth: viewportW, clientHeight: viewportH } : null
    };

    try {
      syncDisplayLayout(display as never, { ...state, zoomLevel });
    } finally {
      (globalThis as Record<string, unknown>)['document'] = previousDocument;
    }

    return {
      width: recordedWidth,
      height: recordedHeight,
      cssW: parseInt(fakeCanvas.style.width, 10),
      cssH: parseInt(fakeCanvas.style.height, 10)
    };
  };

  // 1080p landscape at 1.0x: 1 tile = 4% of viewport height -> 25 rows, ~44 cols, scaled to fill 1080px height
  const hd = runWithViewport(1920, 1080, 1.0);
  const expectedRowsAt1x = Math.round(1 / DEFAULT_VIEWPORT_TILE_HEIGHT_PERCENT);
  expect(hd.height).toBe(expectedRowsAt1x);
  expect(hd.width).toBe(44);
  expect(hd.cssH).toBe(1080);

  // 720p landscape at 1.0x: exact same tile grid proportions (25 rows x 44 cols), scaled to 720px height
  const sd = runWithViewport(1280, 720, 1.0);
  expect(sd.height).toBe(expectedRowsAt1x);
  expect(sd.width).toBe(44);
  expect(sd.cssH).toBe(720);

  // 4:3 desktop window at 1.0x: 25 rows x 33 cols
  const classic43 = runWithViewport(1024, 768, 1.0);
  expect(classic43.height).toBe(expectedRowsAt1x);
  expect(classic43.width).toBe(33);
  expect(classic43.cssH).toBe(768);

  // Zooming in reduces visible row/col counts proportionally while keeping viewport filled
  const zoomedIn = runWithViewport(1920, 1080, 1.6);
  expect(zoomedIn.height).toBeLessThan(hd.height);
  expect(zoomedIn.width).toBeLessThan(hd.width);
  expect(zoomedIn.cssH).toBe(1080);
});

test('getCameraOffset keeps player centered with full overscroll near map boundaries and handles void in snapshot', () => {
  const campaign = loadCampaignFromDisk('dnd35e-crypt');
  const base = buildGameState(campaign);
  const playerId = queryEntities(base, [ComponentType.Player, ComponentType.Position])[0]!;

  // Top-left corner (0, 0) on a 44x25 viewport -> negative camera offset keeps player centered at (22, 12)
  const topLeftState = addComponent(base, playerId, { type: ComponentType.Position, x: 0, y: 0 });
  const topLeftCam = getCameraOffset(topLeftState, 44, 25);
  expect(topLeftCam).toEqual({ x: -22, y: -12 });

  const snap = buildViewportSnapshot(topLeftState, 44, 25);
  expect(snap.tactical.playerVx).toBe(22);
  expect(snap.tactical.playerVy).toBe(12);
  // Top-left screen cell maps to (-22, -12), outside map bounds, cleanly rendered as void
  expect(snap.cells[0]?.isExplored).toBe(false);
  expect(snap.cells[0]?.glyph).toBe(' ');

  // Bottom-right corner on map -> camera overscrolls past map edge to keep player centered
  const maxX = topLeftState.map.width - 1;
  const maxY = topLeftState.map.height - 1;
  const bottomRightState = addComponent(topLeftState, playerId, {
    type: ComponentType.Position,
    x: maxX,
    y: maxY
  });
  const bottomRightCam = getCameraOffset(bottomRightState, 44, 25);
  expect(bottomRightCam).toEqual({ x: maxX - 22, y: maxY - 12 });
});


