import type { Display } from 'rot-js';
import { getComponent } from '../core/ecs.ts';
import { ComponentType, type IdentityComponent, type MemoryComponent } from '../types/components.types.ts';
import { type GameState, UIMode } from '../types/game-state.types.ts';

import { coordToIndex } from '../utils/grid.ts';
import { getEffectiveStats } from '../utils/stats.ts';
import { getCameraOffset } from './camera.ts';
import { FACET_DOMINANT_HIGH_THRESHOLD, FACET_DOMINANT_LOW_THRESHOLD } from '../constants/personality.constants.ts';

/**
 * Renders the visible and explored map tiles and all visible renderable entities
 * to the ROT.js Display, taking the camera scrolling viewport offset into account.
 *
 * @param display The ROT.js Display instance.
 * @param state The current GameState.
 */
export function render(display: Display, state: GameState): void {
  display.clear();

  // 1. Get viewport size from display
  const options = display.getOptions();
  const viewportW = options.width ?? state.map.width;
  const viewportH = options.height ?? state.map.height;

  // 2. Compute camera offset centered on the player
  const { x: cameraX, y: cameraY } = getCameraOffset(state, viewportW, viewportH);

  // 3. Compute active FOV visible set from player position
  const visibleIndices: ReadonlySet<number> = state.cachedFov;

  // 4. Draw the visible/explored map tiles and entities in the camera viewport
  for (let vy = 0; vy < viewportH; vy++) {
    for (let vx = 0; vx < viewportW; vx++) {
      const mapX = vx + cameraX;
      const mapY = vy + cameraY;

      // Ensure we do not render or calculate indexes for out-of-bounds coordinates
      if (mapX < 0 || mapX >= state.map.width || mapY < 0 || mapY >= state.map.height) {
        continue;
      }

      const tileIndex = coordToIndex(mapX, mapY, state.map.width);
      const tile = state.map.tiles[tileIndex];
      const isTileExplored = tile !== undefined && (state.map.isFullyExplored || tile.explored);
      const isVisible = state.map.isFullyExplored || visibleIndices.has(tileIndex);

      if (isTileExplored) {
        const tileDef = state.campaign.tiles[tile.tileId];
        if (tileDef !== undefined) {
          // Determine foreground color based on visibility (Fog of War)
          let fgColor = tileDef.fg;
          if (!isVisible) {
            if (tile.tileId === 'stone_wall') {
              fgColor = state.campaign.theme.colors.wallDimFg ?? fgColor;
            } else {
              fgColor = state.campaign.theme.colors.floorDimFg ?? fgColor;
            }
          }

          display.draw(vx, vy, tileDef.glyph, fgColor, tileDef.bg);
        }
      }

      // 5. Draw entities at this exact tile if it is currently visible
      if (isVisible) {
        const entitiesAtTile = state.spatialIndex.get(`${mapX},${mapY}`);
        if (entitiesAtTile && entitiesAtTile.length > 0) {
          // Sort entities so actors draw over items, and fields draw below everything
          const sortedEntitiesAtTile = [...entitiesAtTile].sort((a, b) => {
            const aPlayer = getComponent(state, a, ComponentType.Player) ? 1 : 0;
            const bPlayer = getComponent(state, b, ComponentType.Player) ? 1 : 0;
            if (aPlayer !== bPlayer) return aPlayer - bPlayer; // Player draws last

            const aActor = getComponent(state, a, ComponentType.Actor) ? 1 : 0;
            const bActor = getComponent(state, b, ComponentType.Actor) ? 1 : 0;
            if (aActor !== bActor) return aActor - bActor; // Actors draw above non-actors

            const aField = getComponent(state, a, ComponentType.Field) ? 1 : 0;
            const bField = getComponent(state, b, ComponentType.Field) ? 1 : 0;
            return bField - aField; // Fields draw below everything else
          });

          for (const entityId of sortedEntitiesAtTile) {
            const renderable = getComponent(state, entityId, ComponentType.Renderable);
            if (renderable) {
              const identity = getComponent(state, entityId, ComponentType.Identity) as IdentityComponent | undefined;
              const fg = identity?.colorOverride ?? renderable.fg;
              display.draw(vx, vy, renderable.glyph, fg, renderable.bg);
            }
          }
        }
      }
    }
  }

  // 6. Draw Targeting Highlight
  if (state.targetingMode?.active) {
    const vx = state.targetingMode.x - cameraX;
    const vy = state.targetingMode.y - cameraY;
    if (vx >= 0 && vx < viewportW && vy >= 0 && vy < viewportH) {
      // Draw a yellow targeting crosshair over whatever is there
      display.draw(vx, vy, 'X', '#000000', '#ffff00');
    }
  } else if (state.inspectMode?.active) {
    const vx = state.inspectMode.x - cameraX;
    const vy = state.inspectMode.y - cameraY;
    if (vx >= 0 && vx < viewportW && vy >= 0 && vy < viewportH) {
      // Draw a cyan inspect crosshair
      display.draw(vx, vy, 'X', '#000000', '#00ffff');
    }
  }

  // 7. Sync Visual Effects Overlay
  renderVisualEffects(state, display, cameraX, cameraY, viewportW, viewportH);

  // 8. Sync Inspect Tooltip
  renderInspectTooltip(state, display, cameraX, cameraY, viewportW, viewportH);
}

/**
 * Syncs the DOM overlay elements for visual effects (floating text, etc).
 */
function renderVisualEffects(
  state: GameState,
  display: Display,
  cameraX: number,
  cameraY: number,
  viewportW: number,
  viewportH: number
): void {
  const overlay = document.getElementById('effects-overlay');
  if (!overlay) return;

  const canvas = display.getContainer() as HTMLCanvasElement | null;
  if (!canvas) return;

  // We only want to create elements for effects that aren't already in the DOM.
  // Visual effects expire and are removed by the game loop, so we should clean up orphaned DOM elements.
  const activeEffectIds = new Set(state.visualEffects.map((e) => e.id));

  // Remove elements for expired effects
  Array.from(overlay.children).forEach((child) => {
    if (!activeEffectIds.has(child.id)) {
      overlay.removeChild(child);
    }
  });

  // Calculate the rendered size of a single tile in pixels
  const { tileWidthPx, tileHeightPx, offsetX, offsetY } = getTilePixelMetrics(canvas, viewportW, viewportH);

  for (const effect of state.visualEffects) {
    let el = document.getElementById(effect.id);
    if (!el) {
      // Create new effect element
      el = document.createElement('div');
      el.id = effect.id;
      el.className = 'visual-effect';
      el.textContent = effect.content;
      el.style.color = effect.color;
      overlay.appendChild(el);
    }

    // Position it
    const vx = effect.x - cameraX;
    const vy = effect.y - cameraY;

    // Only show if within viewport
    if (vx >= 0 && vx < viewportW && vy >= 0 && vy < viewportH) {
      el.style.display = 'block';
      // Center over the tile
      const pxX = offsetX + vx * tileWidthPx + tileWidthPx / 2;
      const pxY = offsetY + vy * tileHeightPx + tileHeightPx / 2;
      el.style.left = `${pxX}px`;
      el.style.top = `${pxY}px`;
    } else {
      el.style.display = 'none';
    }
  }
}

/**
 * Updates the inspect tooltip DOM element.
 */
function renderInspectTooltip(
  state: GameState,
  display: Display,
  cameraX: number,
  cameraY: number,
  viewportW: number,
  viewportH: number
): void {
  const tooltip = document.getElementById('inspect-tooltip');
  const inspectPanel = document.getElementById('inspect-panel');
  const inspectContent = document.getElementById('inspect-content');

  if (!state.inspectMode?.active) {
    if (tooltip) tooltip.classList.add('hidden');
    if (inspectPanel) inspectPanel.classList.add('hidden');
    return;
  }

  const ix = state.inspectMode.x;
  const iy = state.inspectMode.y;

  const vx = ix - cameraX;
  const vy = iy - cameraY;

  // Don't show if out of viewport
  if (vx < 0 || vx >= viewportW || vy < 0 || vy >= viewportH) {
    if (tooltip) tooltip.classList.add('hidden');
    if (inspectPanel) inspectPanel.classList.add('hidden');
    return;
  }

  if (tooltip && !state.is3D) {
    const canvas = display.getContainer() as HTMLCanvasElement | null;
    if (canvas) {
      const { tileWidthPx, tileHeightPx, offsetX, offsetY } = getTilePixelMetrics(canvas, viewportW, viewportH);
      const pxX = offsetX + vx * tileWidthPx + tileWidthPx;
      const pxY = offsetY + vy * tileHeightPx;
      tooltip.style.left = `${pxX + 10}px`;
      tooltip.style.top = `${pxY}px`;
      tooltip.classList.remove('hidden');
    }
  } else if (tooltip) {
    tooltip.classList.add('hidden');
  }

  if (inspectPanel) {
    inspectPanel.classList.remove('hidden');
  }

  const idx = coordToIndex(ix, iy, state.map.width);
  const tile = state.map.tiles[idx];

  if (!tile || (!tile.explored && !state.map.isFullyExplored)) {
    if (tooltip) tooltip.classList.add('hidden');
    if (inspectPanel) inspectPanel.classList.add('hidden');
    return;
  }

  const fragment = document.createDocumentFragment();
  let hasContent = false;

  // Render entities first
  const entitiesAt = state.spatialIndex.get(`${ix},${iy}`) || [];

  // Sort: Actors first, then items, then others
  const sortedEntities = [...entitiesAt].sort((a, b) => {
    const aActor = getComponent(state, a, ComponentType.Actor) ? 1 : 0;
    const bActor = getComponent(state, b, ComponentType.Actor) ? 1 : 0;
    return bActor - aActor;
  });

  for (const entityId of sortedEntities) {
    const renderable = getComponent(state, entityId, ComponentType.Renderable);
    if (!renderable) continue;

    const fighter = getComponent(state, entityId, ComponentType.Fighter);
    const item = getComponent(state, entityId, ComponentType.Item);

    const titleEl = document.createElement('div');
    titleEl.className = 'inspect-header';
    titleEl.textContent = `${renderable.glyph} `;

    if (fighter) {
      // It's an actor
      const identity = getComponent(state, entityId, ComponentType.Identity) as IdentityComponent | undefined;
      const nameStr = identity ? `${identity.name} ${identity.title ?? ''}`.trim() : 'Actor';
      titleEl.textContent += nameStr;
      fragment.appendChild(titleEl);

      const stats = getEffectiveStats(state, entityId);

      const hpEl = document.createElement('div');
      hpEl.className = 'inspect-stat';
      hpEl.innerHTML = `<span>HP</span><span>${fighter.hp}/${stats.maxHp}</span>`;
      fragment.appendChild(hpEl);

      const atkEl = document.createElement('div');
      atkEl.className = 'inspect-stat';
      atkEl.innerHTML = `<span>ATK</span><span>${stats.attack}</span>`;
      fragment.appendChild(atkEl);

      const defEl = document.createElement('div');
      defEl.className = 'inspect-stat';
      defEl.innerHTML = `<span>DEF</span><span>${stats.defense}</span>`;
      fragment.appendChild(defEl);

      const memory = getComponent(state, entityId, ComponentType.Memory) as MemoryComponent | undefined;
      if (memory) {
        if (memory.stress !== undefined && memory.stress > 0) {
          const stressEl = document.createElement('div');
          stressEl.className = 'inspect-stat';
          stressEl.innerHTML = `<span>Stress</span><span style="color: #ffaa00">${Math.floor(memory.stress)}</span>`;
          fragment.appendChild(stressEl);
        }
        if (memory.facets) {
          const dominant = Object.entries(memory.facets).filter(
            ([_, v]) => v >= FACET_DOMINANT_HIGH_THRESHOLD || v <= FACET_DOMINANT_LOW_THRESHOLD
          );
          if (dominant.length > 0) {
            const facetsEl = document.createElement('div');
            facetsEl.className = 'inspect-desc';
            facetsEl.style.color = '#ff6666';
            facetsEl.textContent = 'Traits: ' + dominant.map(([k, v]) => `${k} (${v})`).join(', ');
            fragment.appendChild(facetsEl);
          }
        }

        // Social Metrics
        if (state.uiMode === UIMode.Debug) {
          const countsEl = document.createElement('div');
          countsEl.className = 'inspect-stat';
          countsEl.style.fontSize = '11px';
          countsEl.style.color = '#8888ff';
          countsEl.innerHTML = `<span>Talk/Trd/Intm/Hlp/Btr</span><span>${memory.timesTalked ?? 0}/${memory.timesTraded ?? 0}/${memory.timesIntimidated ?? 0}/${memory.timesHelped ?? 0}/${memory.timesBetrayed ?? 0}</span>`;
          fragment.appendChild(countsEl);
        }

        const remainingPatience = (memory.patienceThreshold ?? 5) - (memory.timesTalked ?? 0);
        const patienceEl = document.createElement('div');
        patienceEl.className = 'inspect-stat';
        patienceEl.innerHTML = `<span>Patience</span><span>${remainingPatience}/${memory.patienceThreshold ?? 5}</span>`;
        fragment.appendChild(patienceEl);

        if ((memory.annoyedDuration ?? 0) > 0) {
          const stateEl = document.createElement('div');
          stateEl.className = 'inspect-desc';
          stateEl.style.color = '#ffaa00';
          stateEl.textContent = `Annoyed (${memory.annoyedDuration} turns remaining)`;
          fragment.appendChild(stateEl);
        }
        if ((memory.gratefulDuration ?? 0) > 0) {
          const stateEl = document.createElement('div');
          stateEl.className = 'inspect-desc';
          stateEl.style.color = '#00ffaa';
          stateEl.textContent = `Grateful (${memory.gratefulDuration} turns remaining)`;
          fragment.appendChild(stateEl);
        }

        if (memory.relationshipAxes) {
          for (const [axis, value] of Object.entries(memory.relationshipAxes)) {
            if (value !== 0) {
              const axisEl = document.createElement('div');
              axisEl.className = 'inspect-stat';
              const formattedAxis = axis.charAt(0).toUpperCase() + axis.slice(1);
              axisEl.innerHTML = `<span>${formattedAxis}</span><span style="color: ${value > 0 ? '#00ffaa' : '#ff4444'}">${value > 0 ? '+' : ''}${value}</span>`;
              fragment.appendChild(axisEl);
            }
          }
        }

        const knowledgeKeys = Object.keys(memory.knowledge ?? {});
        if (knowledgeKeys.length > 0) {
          const knowledgeEl = document.createElement('div');
          knowledgeEl.className = 'inspect-desc';
          knowledgeEl.style.color = '#55ff55';
          knowledgeEl.textContent = 'Knowledge: ' + knowledgeKeys.join(', ');
          fragment.appendChild(knowledgeEl);
        }
      }

      hasContent = true;
    } else if (item) {
      // It's an item
      const itemDef = state.campaign.items[item.itemId];
      const isIdentified = state.identifiedItems.has(item.itemId);
      const name = isIdentified
        ? itemDef?.name
        : (state.itemUnidentifiedNames.get(item.itemId) ?? itemDef?.unidentifiedName ?? item.itemId);

      titleEl.textContent += name || 'Item';
      fragment.appendChild(titleEl);

      if (itemDef?.description && isIdentified) {
        const descEl = document.createElement('div');
        descEl.className = 'inspect-desc';
        descEl.textContent = itemDef.description;
        fragment.appendChild(descEl);
      }
      hasContent = true;
    } else {
      // Other feature (like stairs)
      titleEl.textContent += `Feature`;
      fragment.appendChild(titleEl);
      hasContent = true;
    }
  }

  // Render tile info if no entities or as fallback
  if (!hasContent) {
    const tileDef = state.campaign.tiles[tile.tileId];
    if (tileDef) {
      const titleEl = document.createElement('div');
      titleEl.className = 'inspect-header';

      // format tileId: 'stone_wall' -> 'Stone Wall'
      const formattedName = tile.tileId
        .split('_')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');

      titleEl.textContent = `${tileDef.glyph} ${formattedName}`;
      fragment.appendChild(titleEl);
      hasContent = true;
    }
  }

  if (!hasContent) {
    const emptyEl = document.createElement('div');
    emptyEl.className = 'status-empty';
    emptyEl.textContent = 'Nothing inspected.';
    fragment.appendChild(emptyEl);
  }

  if (tooltip && !state.is3D) {
    tooltip.innerHTML = '';
    tooltip.appendChild(fragment.cloneNode(true));
  }

  if (inspectContent) {
    inspectContent.innerHTML = '';
    inspectContent.appendChild(fragment);
  }
}

/**
 * Calculates the true rendering bounds of the canvas, compensating for 'object-fit: contain' letterboxing.
 */
function getTilePixelMetrics(canvas: HTMLCanvasElement, viewportW: number, viewportH: number) {
  return {
    tileWidthPx: canvas.clientWidth / viewportW,
    tileHeightPx: canvas.clientHeight / viewportH,
    offsetX: canvas.offsetLeft,
    offsetY: canvas.offsetTop
  };
}
