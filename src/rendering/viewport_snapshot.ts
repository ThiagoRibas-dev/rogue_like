/**
 * @file Pure view projection engine that converts GameState and ECS state into immutable ViewportSnapshot DTOs.
 */

import { MAX_RENDER_DEPTH_LAYERS } from '../constants/world_chunk.constants.ts';
import { getComponent, getEntitiesAtPosition } from '../core/ecs.ts';
import {
  ComponentType,
  type FieldComponent,
  type IdentityComponent,
  type PositionComponent,
  type TemplateComponent
} from '../types/components.types.ts';
import { getAvailableSpriteKeys } from './sprite_keys.ts';
import { recordMissingSprite } from './render_debug.ts';
import type { GameState } from '../types/game-state.types.ts';
import { getMapZBounds, getTileAt, isInMapBounds, isMultiZMap, toMapTileKey } from '../map/map_accessor.ts';
import { resolveThemeSpriteSheets } from '../utils/sprite_pack.ts';
import { getCameraOffset, resolveActiveViewZ } from './camera.ts';
import { buildTacticalViewportData } from './tactical_snapshot.ts';
import { isEffectiveSpriteMode, resolvePlaybackThemeConfig } from './procedural_sprites.ts';
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

function dimHexColorForDepth(hex: string, depth: number): string {
  if (depth <= 0 || !hex.startsWith('#') || (hex.length !== 7 && hex.length !== 4)) {
    return hex;
  }
  const full = hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;
  const r = Number.parseInt(full.slice(1, 3), 16);
  const g = Number.parseInt(full.slice(3, 5), 16);
  const b = Number.parseInt(full.slice(5, 7), 16);
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return hex;
  const scale = Math.max(0.32, 1 - depth * 0.22);
  const nr = Math.max(0, Math.min(255, Math.round(r * scale)));
  const ng = Math.max(0, Math.min(255, Math.round(g * scale)));
  const nb = Math.max(0, Math.min(255, Math.round(b * Math.min(1, scale + 0.08))));
  const toHex = (n: number): string => n.toString(16).padStart(2, '0');
  return `#${toHex(nr)}${toHex(ng)}${toHex(nb)}`;
}

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
  const multiZ = isMultiZMap(state.map);
  const zBounds = getMapZBounds(state.map);
  const viewZ = resolveActiveViewZ(state);

  const visibleIndices: ReadonlySet<number> = state.cachedFov;
  const effectiveTheme = resolvePlaybackThemeConfig(state.campaign);
  const effectiveSheets = resolveThemeSpriteSheets(effectiveTheme);
  const hasNativeSheets = Boolean(effectiveSheets && Object.keys(effectiveSheets).length > 0);
  const isSpriteMode = isEffectiveSpriteMode(state.campaign);
  const availableSpriteKeys =
    isSpriteMode && hasNativeSheets ? getAvailableSpriteKeys(state.campaign, effectiveTheme) : undefined;

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
      let renderZ = viewZ;
      let depthOffset = 0;
      const entitiesAtTile: EntityRenderDTO[] = [];

      if (isInMapBounds(state.map, mapX, mapY, viewZ)) {
        let tile = getTileAt(state.map, mapX, mapY, viewZ);
        let tileIndex = toMapTileKey(state.map, mapX, mapY, viewZ);
        isExplored = tile !== undefined && (state.map.isFullyExplored || tile.explored);
        isVisible = state.map.isFullyExplored || visibleIndices.has(tileIndex);

        if (multiZ && tile !== undefined) {
          const topDef = state.campaign.tiles[tile.tileId];
          if (topDef?.isOpenAir === true && (isExplored || isVisible)) {
            for (let d = 1; d <= MAX_RENDER_DEPTH_LAYERS; d++) {
              const probeZ = viewZ - d;
              if (probeZ < zBounds.minZ || !isInMapBounds(state.map, mapX, mapY, probeZ)) break;
              const lowerTile = getTileAt(state.map, mapX, mapY, probeZ);
              if (!lowerTile) continue;
              const lowerDef = state.campaign.tiles[lowerTile.tileId];
              const lowerIdx = toMapTileKey(state.map, mapX, mapY, probeZ);
              const lowerExplored = state.map.isFullyExplored || lowerTile.explored;
              const lowerVisible = state.map.isFullyExplored || visibleIndices.has(lowerIdx);
              if (!lowerExplored && !lowerVisible) break;
              if (lowerDef?.isOpenAir !== true || d === MAX_RENDER_DEPTH_LAYERS) {
                tile = lowerTile;
                tileIndex = lowerIdx;
                isExplored = lowerExplored;
                isVisible = lowerVisible;
                renderZ = probeZ;
                depthOffset = d;
                break;
              }
            }
          }
        }

        if (isExplored && tile !== undefined) {
          const tileDef = state.campaign.tiles[tile.tileId];
          if (tileDef !== undefined) {
            let fgColor = tileDef.fg;
            if (!isVisible) {
              if (!tileDef.transparent && tileDef.glyph !== ' ') {
                fgColor = state.campaign.theme.colors.wallDimFg ?? fgColor;
              } else {
                fgColor = state.campaign.theme.colors.floorDimFg ?? fgColor;
              }
            }
            if (depthOffset > 0) {
              fgColor = dimHexColorForDepth(fgColor, depthOffset);
            }
            glyph = tileDef.glyph;
            fg = fgColor;
            bg = depthOffset > 0 ? '#0c111d' : tileDef.bg;
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
          const entitiesAtTileIds = getEntitiesAtPosition(state, mapX, mapY, renderZ);
          if (entitiesAtTileIds.length > 0) {
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
                const entityPos = getComponent(state, entityId, ComponentType.Position) as
                  PositionComponent | undefined;
                const isMultiTileActor =
                  entityPos !== undefined &&
                  ((entityPos.footprintWidth ?? 1) > 1 || (entityPos.footprintHeight ?? 1) > 1);
                const isSubTileActor =
                  entityPos !== undefined &&
                  entityPos.subTileScale !== undefined &&
                  entityPos.subTileScale < 1 &&
                  getComponent(state, entityId, ComponentType.Fighter) !== undefined;
                const identity = getComponent(state, entityId, ComponentType.Identity) as IdentityComponent | undefined;
                const baseEntityFg = identity?.colorOverride ?? renderable.fg;
                const entityFg = depthOffset > 0 ? dimHexColorForDepth(baseEntityFg, depthOffset) : baseEntityFg;

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
                    if (!isMultiTileActor && !isSubTileActor) {
                      glyphOverlays.push({ vx, vy, glyph: renderable.glyph, fg: entityFg, bg: renderable.bg });
                    }
                  } else if (!availableSpriteKeys.has(renderable.spriteId)) {
                    recordMissingSprite(`${label} (unresolved: ${renderable.spriteId})`);
                    if (!isMultiTileActor && !isSubTileActor) {
                      glyphOverlays.push({ vx, vy, glyph: renderable.glyph, fg: entityFg, bg: renderable.bg });
                    }
                  }
                }

                // Multi-tile and sub-tile combat actors are rendered at true scaled dimensions
                // on the tactical overlay canvas so secondary tiles do not duplicate 1x1 sprites.
                if (isMultiTileActor || isSubTileActor) {
                  continue;
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
          } else if (!isVisible || depthOffset > 0) {
            fogCells.push({ vx, vy, alpha: !isVisible ? 0.55 : Math.min(0.45, depthOffset * 0.14) });
          }
        }
      }

      let highlight: { glyph: string; fg: string; bg: string } | undefined;
      if (state.targetingMode?.active && (state.targetingMode.z ?? 0) === viewZ) {
        const dx = mapX - state.targetingMode.x;
        const dy = mapY - state.targetingMode.y;
        const radius = state.targetingMode.radius ?? 0;
        if (dx === 0 && dy === 0) {
          highlight = { glyph: 'X', fg: '#000000', bg: '#ffff00' };
        } else if (radius > 0 && dx * dx + dy * dy <= radius * radius) {
          highlight = { glyph: '*', fg: '#ffdd88', bg: '#7c2d12' };
        }
      } else if (
        state.inspectMode?.active &&
        (state.inspectMode.z ?? 0) === viewZ &&
        state.inspectMode.x === mapX &&
        state.inspectMode.y === mapY
      ) {
        highlight = { glyph: 'X', fg: '#000000', bg: '#00ffff' };
      }

      if (isSpriteMode && highlight !== undefined) {
        glyphOverlays.push({ vx, vy, glyph: highlight.glyph, fg: highlight.fg, bg: highlight.bg });
      }

      cells.push({
        vx,
        vy,
        ...(renderZ !== 0 ? { z: renderZ } : {}),
        ...(depthOffset > 0 ? { depthOffset } : {}),
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
    ...(viewZ !== 0 ? { viewZ } : {}),
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
