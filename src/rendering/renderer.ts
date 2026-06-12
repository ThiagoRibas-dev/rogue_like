import type { Display } from 'rot-js';
import type { GameState, EntityId } from '../types/game-state.types.ts';
import { getComponent, queryEntities } from '../core/ecs.ts';
import { ComponentType } from '../types/components.types.ts';

import { coordToIndex } from '../utils/grid.ts';
import { computeFOV } from '../map/fov.ts';
import { getCameraOffset } from './camera.ts';
import { getEffectiveStats } from '../utils/stats.ts';

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
  const players = queryEntities(state, [ComponentType.Player, ComponentType.Position]);
  const playerEntityId = players[0];
  let visibleIndices = new Set<number>();

  if (playerEntityId !== undefined) {
    const playerPos = getComponent(state, playerEntityId, ComponentType.Position);
    if (playerPos !== undefined) {
      visibleIndices = computeFOV(state, playerPos.x, playerPos.y);
    }
  }

  // 4. Draw the visible/explored map tiles in the camera viewport
  for (let vy = 0; vy < viewportH; vy++) {
    for (let vx = 0; vx < viewportW; vx++) {
      const mapX = vx + cameraX;
      const mapY = vy + cameraY;

      const tileIndex = coordToIndex(mapX, mapY, state.map.width);
      const tile = state.map.tiles[tileIndex];
      const isTileExplored = tile !== undefined && (state.map.isFullyExplored || tile.explored);

      if (isTileExplored) {
        const tileDef = state.campaign.tiles[tile.tileId];
        if (tileDef !== undefined) {
          const isVisible = state.map.isFullyExplored || visibleIndices.has(tileIndex);

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
    }
  }

  // 5. Query and draw all entities that are in the player's line of sight
  const renderableEntities: ReadonlyArray<EntityId> = queryEntities(state, [
    ComponentType.Position,
    ComponentType.Renderable
  ]);

  const sortedEntities = [...renderableEntities].sort((a, b) => {
    const aPlayer = getComponent(state, a, ComponentType.Player) ? 1 : 0;
    const bPlayer = getComponent(state, b, ComponentType.Player) ? 1 : 0;
    if (aPlayer !== bPlayer) return aPlayer - bPlayer; // Player draws last

    const aActor = getComponent(state, a, ComponentType.Actor) ? 1 : 0;
    const bActor = getComponent(state, b, ComponentType.Actor) ? 1 : 0;
    return aActor - bActor; // Actors draw above non-actors (like stairs)
  });

  for (const entityId of sortedEntities) {
    const position = getComponent(state, entityId, ComponentType.Position);
    const renderable = getComponent(state, entityId, ComponentType.Renderable);

    if (position !== undefined && renderable !== undefined) {
      const tileIndex = coordToIndex(position.x, position.y, state.map.width);

      // Only draw entities that are in the player's active field of view (or if map is fully explored)
      if (state.map.isFullyExplored || visibleIndices.has(tileIndex)) {
        const vx = position.x - cameraX;
        const vy = position.y - cameraY;

        // Draw only if within the display viewport bounds
        if (vx >= 0 && vx < viewportW && vy >= 0 && vy < viewportH) {
          display.draw(vx, vy, renderable.glyph, renderable.fg, renderable.bg);
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
      titleEl.textContent += `Actor`; // Could look up names if we had a NameComponent
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
