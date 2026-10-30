/**
 * @file Dedicated DOM view for rendering inspect tooltips and sidebar inspect panels.
 */

import type { Display } from 'rot-js';
import type { InspectTooltipDTO } from '../viewport_snapshot.types.ts';

/**
 * Calculates the true rendering bounds of the canvas, compensating for 'object-fit: contain' letterboxing.
 *
 * @param canvas The HTMLCanvasElement container of the display.
 * @param viewportW Viewport width in cells.
 * @param viewportH Viewport height in cells.
 * @returns Pixel metrics including tile width/height and offsets.
 */
export function getTilePixelMetrics(
  canvas: HTMLCanvasElement,
  viewportW: number,
  viewportH: number
): {
  readonly tileWidthPx: number;
  readonly tileHeightPx: number;
  readonly offsetX: number;
  readonly offsetY: number;
} {
  return {
    tileWidthPx: canvas.clientWidth / viewportW,
    tileHeightPx: canvas.clientHeight / viewportH,
    offsetX: canvas.offsetLeft,
    offsetY: canvas.offsetTop
  };
}

/**
 * Renders the inspect tooltip and sidebar panel using the presentational InspectTooltipDTO.
 *
 * @param tooltipDto Presentational inspect tooltip data.
 * @param display The ROT.js Display instance.
 * @param viewportW Viewport grid width.
 * @param viewportH Viewport grid height.
 * @param is3D Whether the display is in 3D mode.
 */
export function renderInspectView(
  tooltipDto: InspectTooltipDTO,
  display: Display,
  viewportW: number,
  viewportH: number,
  is3D: boolean
): void {
  const tooltip = document.getElementById('inspect-tooltip');
  const inspectPanel = document.getElementById('inspect-panel');
  const inspectContent = document.getElementById('inspect-content');

  if (!tooltipDto.active) {
    if (tooltip) tooltip.classList.add('hidden');
    if (inspectPanel) inspectPanel.classList.add('hidden');
    return;
  }

  if (inspectPanel) {
    inspectPanel.classList.remove('hidden');
  }

  if (tooltip && !is3D) {
    const canvas = display.getContainer() as HTMLCanvasElement | null;
    if (canvas) {
      const { tileWidthPx, tileHeightPx, offsetX, offsetY } = getTilePixelMetrics(canvas, viewportW, viewportH);
      const pxX = offsetX + tooltipDto.vx * tileWidthPx + tileWidthPx;
      const pxY = offsetY + tooltipDto.vy * tileHeightPx;
      tooltip.style.left = `${pxX + 10}px`;
      tooltip.style.top = `${pxY}px`;
      tooltip.classList.remove('hidden');
    }
  } else if (tooltip) {
    tooltip.classList.add('hidden');
  }

  const fragment = document.createDocumentFragment();

  for (const section of tooltipDto.sections) {
    if (section.type === 'header') {
      const el = document.createElement('div');
      el.className = 'inspect-header';
      el.textContent = section.value;
      fragment.appendChild(el);
    } else if (section.type === 'stat') {
      const el = document.createElement('div');
      el.className = 'inspect-stat';
      if (section.label) {
        const lbl = document.createElement('span');
        lbl.textContent = section.label;
        const val = document.createElement('span');
        val.textContent = section.value;
        if (section.color) {
          val.style.color = section.color;
        }
        el.appendChild(lbl);
        el.appendChild(val);
      } else {
        el.textContent = section.value;
      }
      fragment.appendChild(el);
    } else if (section.type === 'desc') {
      const el = document.createElement('div');
      el.className = 'inspect-desc';
      if (section.color) {
        el.style.color = section.color;
      }
      if (section.isHtml) {
        el.innerHTML = section.value;
      } else {
        el.textContent = section.value;
      }
      fragment.appendChild(el);
    }
  }

  if (tooltip && !is3D) {
    tooltip.replaceChildren(fragment.cloneNode(true));
  }

  if (inspectContent) {
    inspectContent.replaceChildren(fragment);
  }
}
