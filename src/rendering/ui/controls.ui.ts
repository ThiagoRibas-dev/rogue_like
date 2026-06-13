import { type GameState, EngineMode } from '../../types/game-state.types.ts';

/**
 * Updates the Real-Time with Pause (RTwP) UI controls in the sidebar.
 * @param state The current GameState.
 */
export function renderRTwPControls(state: GameState): void {
  const btnMode = document.getElementById('btn-engine-mode');
  const rtwpControls = document.getElementById('rtwp-controls');
  const btnPause = document.getElementById('btn-pause');
  const btnSpeed1 = document.getElementById('btn-speed-1');
  const btnSpeed2 = document.getElementById('btn-speed-2');
  const btnSpeed4 = document.getElementById('btn-speed-4');

  if (btnMode) {
    btnMode.textContent = state.engineMode === EngineMode.TurnBased ? 'Turn-Based Mode' : 'RTwP Mode';
    btnMode.classList.toggle('active', state.engineMode === EngineMode.RTwP);
  }

  if (rtwpControls) {
    rtwpControls.style.display = state.engineMode === EngineMode.RTwP ? 'flex' : 'none';
  }

  if (state.engineMode === EngineMode.RTwP && btnPause) {
    if (state.rtwpState.paused) {
      btnPause.textContent = '▶ Paused';
      btnPause.classList.add('paused');
    } else {
      btnPause.textContent = '⏸ Playing';
      btnPause.classList.remove('paused');
    }
  }

  if (state.engineMode === EngineMode.RTwP) {
    if (btnSpeed1) btnSpeed1.classList.toggle('active', state.rtwpState.speedMultiplier === 1);
    if (btnSpeed2) btnSpeed2.classList.toggle('active', state.rtwpState.speedMultiplier === 2);
    if (btnSpeed4) btnSpeed4.classList.toggle('active', state.rtwpState.speedMultiplier === 4);
  }
}

/**
 * Updates the view controls (Rotation, 3D tilt, and Zoom) and applies the canvas transform.
 * @param state The current GameState.
 */
export function renderViewControls(state: GameState): void {
  const canvasWrapper = document.getElementById('game-canvas-wrapper');
  const btnToggleRotate = document.getElementById('btn-toggle-rotate');
  const btnToggle3D = document.getElementById('btn-toggle-3d');

  if (canvasWrapper) {
    let transformStr = `perspective(1000px)`;

    if (state.is3D) {
      transformStr += ` rotateX(55deg)`;
    }

    if (state.isRotated) {
      transformStr += ` rotateZ(45deg)`;
    }

    transformStr += ` scale(${state.zoomLevel})`;

    canvasWrapper.style.transform = transformStr;

    // Remove shadow if 3D tilted because it looks weird
    if (state.is3D) {
      canvasWrapper.style.boxShadow = 'none';
    } else {
      canvasWrapper.style.boxShadow = ''; // restore CSS default
    }
  }

  if (btnToggleRotate) {
    btnToggleRotate.classList.toggle('active', state.isRotated);
  }
  if (btnToggle3D) {
    btnToggle3D.classList.toggle('active', state.is3D);
  }
}
