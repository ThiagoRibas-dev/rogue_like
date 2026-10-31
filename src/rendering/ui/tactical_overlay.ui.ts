/**
 * @file Dedicated 2D canvas overlay view for RimWorld/Dwarf Fortress tactical telemetry:
 * warm torchlight FOV radial lighting, unit micro health bars, faction hostility pips,
 * status indicators, path preview dots, and corner-bracket cursor.
 */

import type { Display } from 'rot-js';
import { TACTICAL_COLORS } from '../../constants/ui.constants.ts';
import type { TacticalAttitude, TacticalViewportDTO } from '../viewport_snapshot.types.ts';
import { getTilePixelMetrics } from './inspect_view.ui.ts';

/** Ratio of health bar height to cell height. */
const BAR_HEIGHT_RATIO = 0.14;
/** Minimum pixel height for a unit micro health bar. */
const MIN_BAR_HEIGHT_PX = 3;
/** Ratio of corner bracket arm length to cell size. */
const BRACKET_ARM_RATIO = 0.28;
/** Minimum HP ratio threshold for green health bar color. */
const HP_HIGH_THRESHOLD = 0.65;
/** Minimum HP ratio threshold for amber health bar color. */
const HP_MID_THRESHOLD = 0.35;

/**
 * Resolves the hex color for a given tactical attitude.
 */
function getAttitudeColor(attitude: TacticalAttitude | 'terrain'): string {
  switch (attitude) {
    case 'hostile':
      return TACTICAL_COLORS.hostile;
    case 'friendly':
      return TACTICAL_COLORS.friendly;
    case 'neutral':
      return TACTICAL_COLORS.neutral;
    case 'player':
      return TACTICAL_COLORS.player;
    case 'terrain':
      return TACTICAL_COLORS.terrain;
  }
}

/**
 * Ensures the `#tactical-overlay` canvas exists inside `#effects-overlay` and matches the display canvas dimensions.
 */
function ensureTacticalCanvas(displayCanvas: HTMLCanvasElement): HTMLCanvasElement | null {
  const effectsOverlay = document.getElementById('effects-overlay');
  if (!effectsOverlay) return null;

  let tacCanvas = document.getElementById('tactical-overlay') as HTMLCanvasElement | null;
  if (!tacCanvas) {
    tacCanvas = document.createElement('canvas');
    tacCanvas.id = 'tactical-overlay';
    tacCanvas.className = 'tactical-overlay-canvas';
    tacCanvas.style.position = 'absolute';
    tacCanvas.style.top = '0';
    tacCanvas.style.left = '0';
    tacCanvas.style.width = '100%';
    tacCanvas.style.height = '100%';
    tacCanvas.style.pointerEvents = 'none';
    effectsOverlay.insertBefore(tacCanvas, effectsOverlay.firstChild);
  }

  const targetW = Math.max(1, displayCanvas.clientWidth);
  const targetH = Math.max(1, displayCanvas.clientHeight);
  if (tacCanvas.width !== targetW || tacCanvas.height !== targetH) {
    tacCanvas.width = targetW;
    tacCanvas.height = targetH;
  }
  tacCanvas.style.left = `${displayCanvas.offsetLeft}px`;
  tacCanvas.style.top = `${displayCanvas.offsetTop}px`;
  tacCanvas.style.width = `${targetW}px`;
  tacCanvas.style.height = `${targetH}px`;

  return tacCanvas;
}

/**
 * Renders the tactical telemetry overlay onto `#tactical-overlay` using the pure TacticalViewportDTO.
 *
 * @param tactical Presentational tactical viewport DTO.
 * @param display The ROT.js Display instance.
 * @param viewportW Viewport width in grid cells.
 * @param viewportH Viewport height in grid cells.
 */
export function renderTacticalOverlay(
  tactical: TacticalViewportDTO,
  display: Display,
  viewportW: number,
  viewportH: number
): void {
  const displayCanvas = display.getContainer() as HTMLCanvasElement | null;
  if (!displayCanvas) return;

  const tacCanvas = ensureTacticalCanvas(displayCanvas);
  if (!tacCanvas) return;

  const ctx = tacCanvas.getContext('2d');
  if (!ctx) return;

  ctx.clearRect(0, 0, tacCanvas.width, tacCanvas.height);

  const { tileWidthPx, tileHeightPx } = getTilePixelMetrics(displayCanvas, viewportW, viewportH);
  if (tileWidthPx <= 0 || tileHeightPx <= 0) return;

  // 1. Warm Torchlight FOV (strictly clipped to currently visible FOV tiles so unexplored void stays pure black)
  if (tactical.playerVx !== null && tactical.playerVy !== null && tactical.visibleCells.length > 0) {
    ctx.save();
    ctx.beginPath();
    for (const cell of tactical.visibleCells) {
      ctx.rect(
        Math.floor(cell.vx * tileWidthPx),
        Math.floor(cell.vy * tileHeightPx),
        Math.ceil(tileWidthPx),
        Math.ceil(tileHeightPx)
      );
    }
    ctx.clip();

    const cx = (tactical.playerVx + 0.5) * tileWidthPx;
    const cy = (tactical.playerVy + 0.5) * tileHeightPx;
    const innerRadius = Math.max(tileWidthPx * 1.2, tactical.fovRadius * tileWidthPx * 0.3);
    const outerRadius = Math.max(innerRadius + 10, tactical.fovRadius * tileWidthPx * 1.15);

    const grad = ctx.createRadialGradient(cx, cy, innerRadius * 0.15, cx, cy, outerRadius);
    grad.addColorStop(0, TACTICAL_COLORS.torchInner);
    grad.addColorStop(0.6, TACTICAL_COLORS.torchMid);
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, tacCanvas.width, tacCanvas.height);
    ctx.restore();
  }

  // 2. Unit Micro Health Bars, Attitude Pips & Status Dots
  for (const badge of tactical.unitBadges) {
    const cellX = badge.vx * tileWidthPx;
    const cellY = badge.vy * tileHeightPx;

    // Draw hostility / attitude pip in top-left of non-player units
    if (badge.attitude !== 'player') {
      const pipSize = Math.max(3, Math.floor(Math.min(tileWidthPx, tileHeightPx) * 0.18));
      ctx.fillStyle = getAttitudeColor(badge.attitude);
      ctx.fillRect(Math.floor(cellX + 2), Math.floor(cellY + 2), pipSize, pipSize);
    }

    // Draw status effect pips in top-right
    for (let i = 0; i < badge.statusColors.length; i++) {
      const color = badge.statusColors[i];
      if (!color) continue;
      const pipSize = Math.max(3, Math.floor(Math.min(tileWidthPx, tileHeightPx) * 0.16));
      const px = cellX + tileWidthPx - 2 - (i + 1) * (pipSize + 2);
      const py = cellY + 2;
      ctx.fillStyle = color;
      ctx.fillRect(Math.floor(px), Math.floor(py), pipSize, pipSize);
    }

    // Draw micro health bar along bottom edge (always shown for injured units or hostiles)
    if (badge.hpRatio < 1 || badge.attitude === 'hostile') {
      const barH = Math.max(MIN_BAR_HEIGHT_PX, Math.floor(tileHeightPx * BAR_HEIGHT_RATIO));
      const padX = Math.max(1, Math.floor(tileWidthPx * 0.08));
      const barW = Math.max(4, tileWidthPx - padX * 2);
      const barX = cellX + padX;
      const barY = cellY + tileHeightPx - barH - 1;

      ctx.fillStyle = TACTICAL_COLORS.hpBg;
      ctx.fillRect(Math.floor(barX), Math.floor(barY), Math.floor(barW), barH);

      const fillW = Math.max(1, Math.floor(barW * badge.hpRatio));
      ctx.fillStyle =
        badge.hpRatio >= HP_HIGH_THRESHOLD
          ? TACTICAL_COLORS.hpHigh
          : badge.hpRatio >= HP_MID_THRESHOLD
            ? TACTICAL_COLORS.hpMid
            : TACTICAL_COLORS.hpLow;
      ctx.fillRect(Math.floor(barX), Math.floor(barY), fillW, barH);
    }
  }

  // 3. Path Preview Breadcrumbs & Corner-Bracket Cursor
  if (tactical.cursor !== null) {
    const cursor = tactical.cursor;
    const dotRadius = Math.max(2, Math.floor(Math.min(tileWidthPx, tileHeightPx) * 0.12));

    for (let i = 0; i < cursor.pathSteps.length; i++) {
      const step = cursor.pathSteps[i];
      if (!step) continue;
      // Don't draw a breadcrumb dot over the final cursor cell itself
      if (step.vx === cursor.vx && step.vy === cursor.vy) continue;

      const sx = (step.vx + 0.5) * tileWidthPx;
      const sy = (step.vy + 0.5) * tileHeightPx;
      ctx.fillStyle = step.blocked ? TACTICAL_COLORS.pathBlocked : TACTICAL_COLORS.pathDot;
      ctx.beginPath();
      ctx.arc(sx, sy, dotRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    const cx = cursor.vx * tileWidthPx;
    const cy = cursor.vy * tileHeightPx;
    const armX = Math.max(4, Math.floor(tileWidthPx * BRACKET_ARM_RATIO));
    const armY = Math.max(4, Math.floor(tileHeightPx * BRACKET_ARM_RATIO));

    ctx.strokeStyle = getAttitudeColor(cursor.attitude);
    ctx.lineWidth = 2;

    ctx.beginPath();
    // Top-left bracket
    ctx.moveTo(cx + 1, cy + armY);
    ctx.lineTo(cx + 1, cy + 1);
    ctx.lineTo(cx + armX, cy + 1);
    // Top-right bracket
    ctx.moveTo(cx + tileWidthPx - armX, cy + 1);
    ctx.lineTo(cx + tileWidthPx - 1, cy + 1);
    ctx.lineTo(cx + tileWidthPx - 1, cy + armY);
    // Bottom-right bracket
    ctx.moveTo(cx + tileWidthPx - 1, cy + tileHeightPx - armY);
    ctx.lineTo(cx + tileWidthPx - 1, cy + tileHeightPx - 1);
    ctx.lineTo(cx + tileWidthPx - armX, cy + tileHeightPx - 1);
    // Bottom-left bracket
    ctx.moveTo(cx + armX, cy + tileHeightPx - 1);
    ctx.lineTo(cx + 1, cy + tileHeightPx - 1);
    ctx.lineTo(cx + 1, cy + tileHeightPx - armY);
    ctx.stroke();
  }
}
