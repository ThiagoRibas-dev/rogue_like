/**
 * @file Canvas mouse controller for RimWorld / Dwarf Fortress Steam style pointer UX:
 * non-mutating hover tile inspection, left-click move/attack/smart-interact,
 * right-click floating context verb menu, and foldable HUD card controls.
 */

import type * as ROT from 'rot-js';
import { createMoveAction, createWaitAction } from '../../actions/core.actions.ts';
import { createApplyAction } from '../../actions/interaction.actions.ts';
import { createPickUpAction } from '../../actions/inventory.actions.ts';
import { createFireAimedAction, createToggleTargetingAction } from '../../actions/targeting.actions.ts';
import { getCameraOffset } from '../../rendering/camera.ts';
import { setHudDockDisplayRef } from '../../rendering/ui/hud_dock.ui.ts';
import { getValidVerbsForTarget, getVerbOptionsForTarget } from '../../systems/apply.system.ts';
import { ComponentType, type PositionComponent } from '../../types/components.types.ts';
import { type EntityId, type GameState, UIMode } from '../../types/game-state.types.ts';
import type { ApplyIntentTarget } from '../../types/intents/interaction.intents.ts';
import { coordToIndex, getBresenhamLine, isInBounds } from '../../utils/grid.ts';
import { getComponent } from '../ecs.ts';
import { getGameState, queuePlayerIntent, setGameState } from '../game-loop.ts';
import { setContextMenuAnchor, setHoveredTile } from '../hover_state.ts';
import { markDomainDirty, PresentationDomain } from '../presentation_queue.ts';
import { getIsPlayingReplay } from '../replay.ts';

/**
 * Converts a DOM MouseEvent over the display canvas into world map coordinates `(mapX, mapY)`.
 */
function resolveEventWorldCoords(
  event: MouseEvent,
  display: ROT.Display,
  state: GameState
): { readonly mapX: number; readonly mapY: number } | null {
  const pos = display.eventToPosition(event);
  if (!Array.isArray(pos) || pos.length < 2) return null;
  const vx = pos[0];
  const vy = pos[1];
  if (typeof vx !== 'number' || typeof vy !== 'number' || vx < 0 || vy < 0) return null;

  const opts = display.getOptions();
  const viewportW = opts.width ?? state.map.width;
  const viewportH = opts.height ?? state.map.height;
  const { x: cameraX, y: cameraY } = getCameraOffset(state, viewportW, viewportH);

  const mapX = vx + cameraX;
  const mapY = vy + cameraY;
  if (!isInBounds(mapX, mapY, state.map.width, state.map.height)) return null;

  return { mapX, mapY };
}

/**
 * Opens the RimWorld-style floating context verb menu for the given world tile.
 */
function openContextVerbMenuAtTile(
  state: GameState,
  playerEntityId: EntityId,
  mapX: number,
  mapY: number,
  clientX: number,
  clientY: number
): void {
  const entitiesOnTile = state.spatialIndex.get(`${mapX},${mapY}`) ?? [];
  const otherEntityId = entitiesOnTile.find((id) => id !== playerEntityId);
  const playerPos = getComponent(state, playerEntityId, ComponentType.Position) as PositionComponent | undefined;

  let target: ApplyIntentTarget;
  if (otherEntityId !== undefined) {
    const isItem = getComponent(state, otherEntityId, ComponentType.Item) !== undefined;
    target = isItem ? { type: 'item', itemEntityId: otherEntityId } : { type: 'entity', entityId: otherEntityId };
  } else if (playerPos && playerPos.x === mapX && playerPos.y === mapY) {
    target = { type: 'self' };
  } else {
    target = { type: 'tile', x: mapX, y: mapY };
  }

  const validVerbs = getValidVerbsForTarget(state, playerEntityId, target);
  const verbOptions = getVerbOptionsForTarget(state, playerEntityId, target);

  setContextMenuAnchor({ x: clientX, y: clientY });
  setGameState({
    ...state,
    uiMode: UIMode.VerbMenu,
    verbMenu: {
      target,
      availableVerbs: validVerbs,
      verbOptions
    }
  });
}

/**
 * Handles a left-click on the map canvas to move, bump-attack, aim-fire, or smart-interact.
 */
function handleCanvasLeftClick(state: GameState, playerEntityId: EntityId, mapX: number, mapY: number): void {
  if (state.uiMode === UIMode.VerbMenu) {
    setContextMenuAnchor(null);
    setGameState({ ...state, uiMode: UIMode.Game, verbMenu: undefined });
    return;
  }

  if (state.uiMode !== UIMode.Game) return;

  // If targeting mode is active, move target to clicked tile and fire/throw
  if (state.targetingMode?.active) {
    const context = state.targetingMode.context;
    setGameState({
      ...state,
      targetingMode: {
        ...state.targetingMode,
        x: mapX,
        y: mapY
      }
    });
    if (context?.verb === 'throw' && context.toolEntityId !== undefined) {
      queuePlayerIntent(
        createApplyAction(playerEntityId, 'throw', { type: 'tile', x: mapX, y: mapY }, context.toolEntityId)
      );
      queuePlayerIntent(createToggleTargetingAction(playerEntityId));
    } else {
      queuePlayerIntent(createFireAimedAction(playerEntityId));
    }
    return;
  }

  const playerPos = getComponent(state, playerEntityId, ComponentType.Position) as PositionComponent | undefined;
  if (!playerPos) return;

  const dx = mapX - playerPos.x;
  const dy = mapY - playerPos.y;

  // Clicked on the player's own tile: pick up item if present, otherwise wait a turn
  if (dx === 0 && dy === 0) {
    const entitiesHere = state.spatialIndex.get(`${mapX},${mapY}`) ?? [];
    const hasItemOnTile = entitiesHere.some(
      (id) => id !== playerEntityId && getComponent(state, id, ComponentType.Item) !== undefined
    );
    if (hasItemOnTile) {
      queuePlayerIntent(createPickUpAction(playerEntityId));
    } else {
      queuePlayerIntent(createWaitAction(playerEntityId));
    }
    return;
  }

  // Orthogonal step (adjacent 4-way): direct MoveAction (handles walk, bump-attack, bump-talk, bump-door)
  if (Math.abs(dx) + Math.abs(dy) === 1) {
    queuePlayerIntent(createMoveAction(playerEntityId, dx, dy));
    return;
  }

  // Non-adjacent or diagonal tile: step 1 orthogonal tile along Bresenham path toward clicked tile
  const tileIdx = coordToIndex(mapX, mapY, state.map.width);
  const tile = state.map.tiles[tileIdx];
  if (!tile || (!tile.explored && !state.map.isFullyExplored)) return;

  const line = getBresenhamLine(playerPos.x, playerPos.y, mapX, mapY);
  const nextPt = line[1];
  if (!nextPt) return;

  const stepDx = nextPt.x - playerPos.x;
  const stepDy = nextPt.y - playerPos.y;
  if (stepDx !== 0 && stepDy !== 0) {
    // Prefer horizontal or vertical cardinal step if diagonal
    queuePlayerIntent(createMoveAction(playerEntityId, stepDx, 0));
  } else {
    queuePlayerIntent(createMoveAction(playerEntityId, stepDx, stepDy));
  }
}

/**
 * Binds canvas mouse hover, left-click smart action, right-click context verb menu,
 * and foldable HUD card buttons.
 *
 * @param display The ROT.Display instance.
 */
export function bindCanvasMouseControls(display: ROT.Display): void {
  setHudDockDisplayRef(display);

  const wrapper = document.getElementById('game-canvas-wrapper');
  if (wrapper) {
    wrapper.addEventListener('mousemove', (event: MouseEvent) => {
      if (getIsPlayingReplay()) return;
      const state = getGameState();
      if (state.uiMode !== UIMode.Game && state.uiMode !== UIMode.VerbMenu) return;

      const coords = resolveEventWorldCoords(event, display, state);
      if (setHoveredTile(coords ? { x: coords.mapX, y: coords.mapY } : null)) {
        markDomainDirty(PresentationDomain.Map);
        markDomainDirty(PresentationDomain.HUD);
      }
    });

    wrapper.addEventListener('mouseleave', () => {
      if (setHoveredTile(null)) {
        markDomainDirty(PresentationDomain.Map);
        markDomainDirty(PresentationDomain.HUD);
      }
    });

    wrapper.addEventListener('click', (event: MouseEvent) => {
      if (getIsPlayingReplay()) return;
      const state = getGameState();
      const playerEntityId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined);
      if (playerEntityId === undefined) return;

      const coords = resolveEventWorldCoords(event, display, state);
      if (!coords) return;

      handleCanvasLeftClick(state, playerEntityId, coords.mapX, coords.mapY);
    });

    wrapper.addEventListener('contextmenu', (event: MouseEvent) => {
      event.preventDefault();
      if (getIsPlayingReplay()) return;
      const state = getGameState();
      if (state.uiMode !== UIMode.Game && state.uiMode !== UIMode.VerbMenu) return;

      const playerEntityId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined);
      if (playerEntityId === undefined) return;

      const coords = resolveEventWorldCoords(event, display, state);
      if (!coords) return;

      openContextVerbMenuAtTile(state, playerEntityId, coords.mapX, coords.mapY, event.clientX, event.clientY);
    });
  }

  // Bind edge icon tabs (click icon -> expand card from screen edge)
  document.querySelectorAll<HTMLButtonElement>('.hud-edge-tab').forEach((tabBtn) => {
    tabBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const card = tabBtn.closest('.hud-card');
      if (!card) return;
      card.classList.remove('folded');
      const foldBtn = card.querySelector<HTMLButtonElement>('.hud-fold-btn');
      foldBtn?.setAttribute('aria-expanded', 'true');
      syncMasterEdgeToggleIcon();
    });
  });

  // Bind card header collapse buttons (click « / » -> collapse card to edge icon)
  document.querySelectorAll<HTMLButtonElement>('.hud-fold-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const card = btn.closest('.hud-card');
      if (!card) return;
      card.classList.add('folded');
      btn.setAttribute('aria-expanded', 'false');
      syncMasterEdgeToggleIcon();
    });
  });

  // Bind collapse/expand-all HUD toggle button [Tab]
  const btnFoldAll = document.getElementById('btn-toggle-hud-fold');
  btnFoldAll?.addEventListener('click', () => {
    toggleAllHudPanelsFolded();
  });
}

/**
 * Synchronizes the master edge toggle button icon (`⊞` vs `⊟`) based on whether any HUD card is open.
 */
function syncMasterEdgeToggleIcon(): void {
  const btnFoldAll = document.getElementById('btn-toggle-hud-fold');
  if (!btnFoldAll) return;
  const anyExpanded = document.querySelector('.hud-card:not(.folded)') !== null;
  const iconSpan = btnFoldAll.querySelector('.hud-edge-icon');
  if (iconSpan) {
    iconSpan.textContent = anyExpanded ? '⊟' : '⊞';
  }
}

/**
 * Toggles all floating side HUD cards between 44x44px edge icons and expanded panels (`[Tab]`).
 */
export function toggleAllHudPanelsFolded(): void {
  const cards = Array.from(document.querySelectorAll<HTMLElement>('.hud-card'));
  if (cards.length === 0) return;

  const anyExpanded = cards.some((card) => !card.classList.contains('folded'));
  for (const card of cards) {
    card.classList.toggle('folded', anyExpanded);
    const foldBtn = card.querySelector<HTMLButtonElement>('.hud-fold-btn');
    foldBtn?.setAttribute('aria-expanded', String(!anyExpanded));
  }
  syncMasterEdgeToggleIcon();
}
