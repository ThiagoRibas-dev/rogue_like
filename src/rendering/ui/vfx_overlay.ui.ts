/**
 * @file Dedicated DOM and canvas view for visual effects (floating combat text) and sprite-mode fog of war overlays.
 */

import type { Display } from 'rot-js';
import type { VisualEffectDTO, FogOverlayDTO } from '../viewport_snapshot.types.ts';
import { getTilePixelMetrics } from './inspect_view.ui.ts';

/**
 * Synchronizes floating visual effect DOM elements with the current presentational list.
 *
 * @param visualEffects List of active visual effect DTOs in this frame.
 * @param display The ROT.js Display instance.
 * @param viewportW Viewport width in cells.
 * @param viewportH Viewport height in cells.
 */
export function renderVisualEffectsOverlay(
  visualEffects: ReadonlyArray<VisualEffectDTO>,
  display: Display,
  viewportW: number,
  viewportH: number
): void {
  const overlay = document.getElementById('effects-overlay');
  if (!overlay) return;

  const canvas = display.getContainer() as HTMLCanvasElement | null;
  if (!canvas) return;

  const activeIds = new Set(visualEffects.map((e) => e.id));

  // Remove DOM elements for expired effects
  Array.from(overlay.children).forEach((child) => {
    if (!activeIds.has(child.id)) {
      overlay.removeChild(child);
    }
  });

  const { tileWidthPx, tileHeightPx, offsetX, offsetY } = getTilePixelMetrics(canvas, viewportW, viewportH);

  for (const effect of visualEffects) {
    let el = document.getElementById(effect.id);
    if (!el) {
      el = document.createElement('div');
      el.id = effect.id;
      el.className = 'visual-effect';
      el.textContent = effect.content;
      el.style.color = effect.color;
      overlay.appendChild(el);
    }

    if (effect.inViewport) {
      el.style.display = 'block';
      const pxX = offsetX + effect.vx * tileWidthPx + tileWidthPx / 2;
      const pxY = offsetY + effect.vy * tileHeightPx + tileHeightPx / 2;
      el.style.left = `${pxX}px`;
      el.style.top = `${pxY}px`;
    } else {
      el.style.display = 'none';
    }
  }
}

/**
 * Synchronizes the secondary 2D fog-of-war canvas overlay in sprite mode.
 *
 * @param fogOverlay Presentational fog overlay DTO.
 * @param display The ROT.js Display instance.
 */
export function renderFogOverlayCanvas(fogOverlay: FogOverlayDTO, display: Display): void {
  const overlayCanvas = document.getElementById('fog-overlay') as HTMLCanvasElement | null;
  if (!overlayCanvas) return;

  const ctx = overlayCanvas.getContext('2d');
  if (!ctx) return;

  if (!fogOverlay.active) {
    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    return;
  }

  const canvas = display.getContainer() as HTMLCanvasElement | null;
  if (!canvas) return;

  if (overlayCanvas.width !== canvas.clientWidth || overlayCanvas.height !== canvas.clientHeight) {
    overlayCanvas.width = canvas.clientWidth;
    overlayCanvas.height = canvas.clientHeight;
  }

  const { tileWidthPx, tileHeightPx, offsetX, offsetY } = getTilePixelMetrics(
    canvas,
    fogOverlay.viewportW,
    fogOverlay.viewportH
  );

  ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

  for (const cell of fogOverlay.cells) {
    const pxX = offsetX + cell.vx * tileWidthPx;
    const pxY = offsetY + cell.vy * tileHeightPx;

    ctx.fillStyle = cell.alpha === 1.0 ? 'rgba(0, 0, 0, 1.0)' : 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(Math.floor(pxX), Math.floor(pxY), Math.ceil(tileWidthPx), Math.ceil(tileHeightPx));
  }
}

/**
 * Dispatches both visual effects and fog overlay presentation updates.
 *
 * @param visualEffects List of active visual effect DTOs.
 * @param fogOverlay Presentational fog overlay DTO.
 * @param display The ROT.js Display instance.
 * @param viewportW Viewport width in cells.
 * @param viewportH Viewport height in cells.
 */
export function renderVFXAndFogOverlay(
  visualEffects: ReadonlyArray<VisualEffectDTO>,
  fogOverlay: FogOverlayDTO,
  display: Display,
  viewportW: number,
  viewportH: number
): void {
  renderVisualEffectsOverlay(visualEffects, display, viewportW, viewportH);
  renderFogOverlayCanvas(fogOverlay, display);
}
