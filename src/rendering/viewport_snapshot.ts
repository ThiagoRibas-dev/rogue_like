/**
 * @file Pure view projection engine that converts GameState and ECS state into immutable ViewportSnapshot DTOs.
 */

import { getComponent } from '../core/ecs.ts';
import {
  ComponentType,
  type FieldComponent,
  type IdentityComponent,
  type TemplateComponent
} from '../types/components.types.ts';
import { getAvailableSpriteKeys } from './sprite_keys.ts';
import { recordMissingSprite } from './render_debug.ts';
import type { GameState } from '../types/game-state.types.ts';
import { coordToIndex } from '../utils/grid.ts';
import { getCameraOffset } from './camera.ts';
import { buildTacticalViewportData } from './tactical_snapshot.ts';
import { isEffectiveSpriteMode } from './procedural_sprites.ts';
import { buildInspectTooltip } from './inspect_tooltip.ts';
import type {
  EntityRenderDTO,
  FogOverlayCellDTO,
  FogOverlayDTO,
  GlyphOverlayDTO,
  ViewportCellDTO,
  ViewportSnapshot,
  VisualEffectDTO
} from './viewport_snapshot.types.ts';

export * from './inspect_tooltip.ts';

/**
 * Builds an immutable, pre-projected ViewportSnapshot for the given GameState and viewport dimensions.
 *
 * @param state The current immutable GameState.
 * @param viewportW Viewport width in grid cells.
 * @param viewportH Viewport height in grid cells.
 * @returns Fully populated ViewportSnapshot DTO.
 */
export function buildViewportSnapshot(state: GameState, viewportW: number, viewportH: number): ViewportSnapshot {
  const { x: cameraX, y: cameraY } = getCameraOffset(state, viewportW, viewportH);
  const visibleIndices: ReadonlySet<number> = state.cachedFov;
  const hasNativeSheets = Boolean(
    state.campaign.theme.spriteSheets && Object.keys(state.campaign.theme.spriteSheets).length > 0
  );
  const isSpriteMode = isEffectiveSpriteMode(state.campaign);
  const availableSpriteKeys = isSpriteMode && hasNativeSheets ? getAvailableSpriteKeys(state.campaign) : undefined;

  const cells: ViewportCellDTO[] = [];
  const fogCells: FogOverlayCellDTO[] = [];
  const glyphOverlays: GlyphOverlayDTO[] = [];

  for (let vy = 0; vy < viewportH; vy++) {
    for (let vx = 0; vx < viewportW; vx++) {
      const mapX = vx + cameraX;
      const mapY = vy + cameraY;

      let glyph = ' ';
      let fg = '#000000';
      let bg = '#000000';
      let spriteId: string | undefined;
      let isExplored = false;
      let isVisible = false;
      const entitiesAtTile: EntityRenderDTO[] = [];

      if (mapX >= 0 && mapX < state.map.width && mapY >= 0 && mapY < state.map.height) {
        const tileIndex = coordToIndex(mapX, mapY, state.map.width);
        const tile = state.map.tiles[tileIndex];
        isExplored = tile !== undefined && (state.map.isFullyExplored || tile.explored);
        isVisible = state.map.isFullyExplored || visibleIndices.has(tileIndex);

        if (isExplored && tile !== undefined) {
          const tileDef = state.campaign.tiles[tile.tileId];
          if (tileDef !== undefined) {
            let fgColor = tileDef.fg;
            if (!isVisible) {
              if (tile.tileId === 'stone_wall') {
                fgColor = state.campaign.theme.colors.wallDimFg ?? fgColor;
              } else {
                fgColor = state.campaign.theme.colors.floorDimFg ?? fgColor;
              }
            }
            glyph = tileDef.glyph;
            fg = fgColor;
            bg = tileDef.bg;
            spriteId = tileDef.spriteId;

            if (availableSpriteKeys !== undefined) {
              if (spriteId === undefined) {
                recordMissingSprite(`tile:${tile.tileId} (no-spriteId)`);
                glyphOverlays.push({ vx, vy, glyph: tileDef.glyph, fg: fgColor, bg: tileDef.bg });
              } else if (!availableSpriteKeys.has(spriteId)) {
                recordMissingSprite(`tile:${tile.tileId} (unresolved: ${spriteId})`);
                glyphOverlays.push({ vx, vy, glyph: tileDef.glyph, fg: fgColor, bg: tileDef.bg });
              }
            }
          }
        }

        if (isVisible) {
          const entitiesAtTileIds = state.spatialIndex.get(`${mapX},${mapY}`);
          if (entitiesAtTileIds && entitiesAtTileIds.length > 0) {
            const sortedEntitiesAtTile = [...entitiesAtTileIds].sort((a, b) => {
              const aPlayer = getComponent(state, a, ComponentType.Player) ? 1 : 0;
              const bPlayer = getComponent(state, b, ComponentType.Player) ? 1 : 0;
              if (aPlayer !== bPlayer) return aPlayer - bPlayer;

              const aActor = getComponent(state, a, ComponentType.Actor) ? 1 : 0;
              const bActor = getComponent(state, b, ComponentType.Actor) ? 1 : 0;
              if (aActor !== bActor) return aActor - bActor;

              const aField = getComponent(state, a, ComponentType.Field) ? 1 : 0;
              const bField = getComponent(state, b, ComponentType.Field) ? 1 : 0;
              return bField - aField;
            });

            for (const entityId of sortedEntitiesAtTile) {
              const renderable = getComponent(state, entityId, ComponentType.Renderable);
              if (renderable) {
                const identity = getComponent(state, entityId, ComponentType.Identity) as IdentityComponent | undefined;
                const entityFg = identity?.colorOverride ?? renderable.fg;

                if (availableSpriteKeys !== undefined) {
                  const template = getComponent(state, entityId, ComponentType.Template) as
                    TemplateComponent | undefined;
                  const field = getComponent(state, entityId, ComponentType.Field) as FieldComponent | undefined;
                  const label = template
                    ? `entity:${template.templateId}`
                    : field
                      ? `field:${field.fieldType}`
                      : `entity#${entityId}`;
                  if (renderable.spriteId === undefined) {
                    recordMissingSprite(`${label} (no-spriteId)`);
                    glyphOverlays.push({ vx, vy, glyph: renderable.glyph, fg: entityFg, bg: renderable.bg });
                  } else if (!availableSpriteKeys.has(renderable.spriteId)) {
                    recordMissingSprite(`${label} (unresolved: ${renderable.spriteId})`);
                    glyphOverlays.push({ vx, vy, glyph: renderable.glyph, fg: entityFg, bg: renderable.bg });
                  }
                }

                entitiesAtTile.push({
                  glyph: renderable.glyph,
                  fg: entityFg,
                  bg: renderable.bg,
                  ...(renderable.spriteId !== undefined ? { spriteId: renderable.spriteId } : {})
                });
              }
            }
          }
        }

        if (isSpriteMode) {
          if (!isExplored) {
            fogCells.push({ vx, vy, alpha: 1.0 });
          } else if (!isVisible) {
            fogCells.push({ vx, vy, alpha: 0.55 });
          }
        }
      }

      let highlight: { glyph: string; fg: string; bg: string } | undefined;
      if (state.targetingMode?.active && state.targetingMode.x === mapX && state.targetingMode.y === mapY) {
        highlight = { glyph: 'X', fg: '#000000', bg: '#ffff00' };
      } else if (state.inspectMode?.active && state.inspectMode.x === mapX && state.inspectMode.y === mapY) {
        highlight = { glyph: 'X', fg: '#000000', bg: '#00ffff' };
      }

      if (isSpriteMode && highlight !== undefined) {
        glyphOverlays.push({ vx, vy, glyph: highlight.glyph, fg: highlight.fg, bg: highlight.bg });
      }

      cells.push({
        vx,
        vy,
        glyph,
        fg,
        bg,
        ...(spriteId !== undefined ? { spriteId } : {}),
        entities: entitiesAtTile,
        isExplored,
        isVisible,
        ...(highlight !== undefined ? { highlight } : {})
      });
    }
  }

  const visualEffects: VisualEffectDTO[] = state.visualEffects.map((effect) => {
    const vx = effect.x - cameraX;
    const vy = effect.y - cameraY;
    const inViewport = vx >= 0 && vx < viewportW && vy >= 0 && vy < viewportH;
    return {
      id: effect.id,
      content: effect.content,
      color: effect.color,
      vx,
      vy,
      inViewport
    };
  });

  const inspectTooltip = buildInspectTooltip(state, cameraX, cameraY, viewportW, viewportH);

  const fogOverlay: FogOverlayDTO = {
    active: isSpriteMode,
    cameraX,
    cameraY,
    viewportW,
    viewportH,
    cells: fogCells
  };

  const tactical = buildTacticalViewportData(state, cameraX, cameraY, viewportW, viewportH, visibleIndices);

  return {
    viewportW,
    viewportH,
    cameraX,
    cameraY,
    isSpriteMode,
    is3D: state.is3D,
    cells,
    visualEffects,
    inspectTooltip,
    fogOverlay,
    glyphOverlays,
    tactical
  };
}
