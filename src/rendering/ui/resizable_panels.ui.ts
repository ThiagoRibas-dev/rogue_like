/**
 * @file Interactive Resizable Layout Panels and Drag Splitters (Milestone 118).
 * Manages dragging, clamping, CSS variables, and persistent panel dimensions.
 */

import type * as ROT from 'rot-js';
import { getGameState } from '../../core/game-loop.ts';
import { getSettings, updatePanelLayout } from '../../core/settings.ts';
import { syncDisplayLayout } from '../display.ts';

const DEFAULT_SIDEBAR_WIDTH_PX = 268;
const MIN_SIDEBAR_WIDTH_PX = 200;
const MAX_SIDEBAR_WIDTH_PX = 520;

/**
 * Applies saved panel layout dimensions to CSS variables on document.documentElement.
 */
export function applyPanelLayoutSettings(): void {
  const layout = getSettings().panelLayout;
  const root = document.documentElement;

  if (layout?.leftSidebarWidthPx !== undefined) {
    root.style.setProperty('--left-sidebar-width', `${layout.leftSidebarWidthPx}px`);
  }
  if (layout?.rightSidebarWidthPx !== undefined) {
    root.style.setProperty('--right-sidebar-width', `${layout.rightSidebarWidthPx}px`);
  }
  if (layout?.logDrawerHeightPx !== undefined) {
    root.style.setProperty('--log-drawer-height', `${layout.logDrawerHeightPx}px`);
  }
  if (layout?.modalMasterWidthPercent !== undefined) {
    root.style.setProperty('--modal-master-percent', `${layout.modalMasterWidthPercent}%`);
  }
}

/**
 * Triggers viewport display recalculation after layout resize ends.
 */
function triggerViewportReflow(): void {
  const canvas = document.querySelector<HTMLCanvasElement>('.canvas-wrapper canvas');
  if (!canvas) return;
  const display = (window as unknown as { __rotDisplay?: ROT.Display }).__rotDisplay;
  if (display) {
    syncDisplayLayout(display, getGameState());
  }
}

/**
 * Attaches pointer drag listeners to a splitter handle.
 */
function attachDragSplitter(
  handle: HTMLElement,
  options: {
    readonly isHorizontal?: boolean | undefined;
    readonly onDrag: (delta: number, currentClientPos: number) => void;
    readonly onDragEnd?: (() => void) | undefined;
  }
): void {
  let startPos = 0;
  let active = false;

  const onPointerDown = (e: PointerEvent): void => {
    e.preventDefault();
    active = true;
    startPos = options.isHorizontal ? e.clientY : e.clientX;
    handle.classList.add('dragging');
    document.body.classList.add('resizing');
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  };

  const onPointerMove = (e: PointerEvent): void => {
    if (!active) return;
    const current = options.isHorizontal ? e.clientY : e.clientX;
    const delta = current - startPos;
    options.onDrag(delta, current);
  };

  const onPointerUp = (): void => {
    if (!active) return;
    active = false;
    handle.classList.remove('dragging');
    document.body.classList.remove('resizing');
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    if (options.onDragEnd) {
      options.onDragEnd();
    }
    triggerViewportReflow();
  };

  handle.addEventListener('pointerdown', onPointerDown);
}

let resizablePanelsInitialized = false;

/**
 * Initializes interactive drag splitters on the Left HUD stack, Right HUD stack, and Log drawer.
 */
export function initResizablePanels(): void {
  if (resizablePanelsInitialized) return;
  resizablePanelsInitialized = true;

  applyPanelLayoutSettings();

  const leftStack = document.getElementById('hud-left-stack');
  const rightStack = document.getElementById('hud-right-stack');

  // Left Sidebar Splitter (drags rightwards to expand)
  if (leftStack) {
    let splitter = leftStack.querySelector<HTMLElement>('.splitter-left');
    if (!splitter) {
      splitter = document.createElement('div');
      splitter.className = 'panel-splitter splitter-vertical splitter-left';
      splitter.title = 'Drag to resize Left HUD stack';
      leftStack.appendChild(splitter);
    }

    let initialWidth = DEFAULT_SIDEBAR_WIDTH_PX;
    attachDragSplitter(splitter, {
      onDrag: (delta: number) => {
        const next = Math.max(MIN_SIDEBAR_WIDTH_PX, Math.min(MAX_SIDEBAR_WIDTH_PX, initialWidth + delta));
        document.documentElement.style.setProperty('--left-sidebar-width', `${next}px`);
      },
      onDragEnd: () => {
        const val = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--left-sidebar-width'));
        if (!isNaN(val)) {
          initialWidth = val;
          updatePanelLayout({ leftSidebarWidthPx: val });
        }
      }
    });
  }

  // Right Sidebar Splitter (drags leftwards to expand)
  if (rightStack) {
    let splitter = rightStack.querySelector<HTMLElement>('.splitter-right');
    if (!splitter) {
      splitter = document.createElement('div');
      splitter.className = 'panel-splitter splitter-vertical splitter-right';
      splitter.title = 'Drag to resize Right HUD stack';
      rightStack.appendChild(splitter);
    }

    let initialWidth = DEFAULT_SIDEBAR_WIDTH_PX;
    attachDragSplitter(splitter, {
      onDrag: (delta: number) => {
        const next = Math.max(MIN_SIDEBAR_WIDTH_PX, Math.min(MAX_SIDEBAR_WIDTH_PX, initialWidth - delta));
        document.documentElement.style.setProperty('--right-sidebar-width', `${next}px`);
      },
      onDragEnd: () => {
        const val = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--right-sidebar-width'));
        if (!isNaN(val)) {
          initialWidth = val;
          updatePanelLayout({ rightSidebarWidthPx: val });
        }
      }
    });
  }
}
