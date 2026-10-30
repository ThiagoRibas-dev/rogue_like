/**
 * @file Pure view projection engine that converts GameState and ECS state into immutable ViewportSnapshot DTOs.
 */

import { getComponent } from '../core/ecs.ts';
import {
  ComponentType,
  type IdentityComponent,
  type MemoryComponent,
  type NemesisComponent,
  type ChronicleComponent,
  type TemplateComponent,
  type FieldComponent
} from '../types/components.types.ts';
import { getAvailableSpriteKeys } from './sprite_keys.ts';
import { recordMissingSprite } from './render_debug.ts';
import { type GameState, UIMode } from '../types/game-state.types.ts';
import { coordToIndex } from '../utils/grid.ts';
import { getEffectiveStats } from '../utils/stats.ts';
import { getCameraOffset } from './camera.ts';
import { FACET_DOMINANT_HIGH_THRESHOLD, FACET_DOMINANT_LOW_THRESHOLD } from '../constants/personality.constants.ts';
import type {
  ViewportSnapshot,
  ViewportCellDTO,
  EntityRenderDTO,
  VisualEffectDTO,
  InspectTooltipDTO,
  InspectSectionDTO,
  FogOverlayDTO,
  FogOverlayCellDTO,
  GlyphOverlayDTO
} from './viewport_snapshot.types.ts';

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
  const isSpriteMode = Boolean(
    state.campaign.theme.spriteSheets && Object.keys(state.campaign.theme.spriteSheets).length > 0
  );
  const availableSpriteKeys = isSpriteMode ? getAvailableSpriteKeys(state.campaign) : undefined;

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
                    | TemplateComponent
                    | undefined;
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
    glyphOverlays
  };
}

/**
 * Builds the presentational inspect tooltip DTO from the inspectMode state.
 */
function buildInspectTooltip(
  state: GameState,
  cameraX: number,
  cameraY: number,
  viewportW: number,
  viewportH: number
): InspectTooltipDTO {
  if (!state.inspectMode?.active) {
    return { active: false, vx: 0, vy: 0, sections: [] };
  }

  const ix = state.inspectMode.x;
  const iy = state.inspectMode.y;
  const vx = ix - cameraX;
  const vy = iy - cameraY;

  if (vx < 0 || vx >= viewportW || vy < 0 || vy >= viewportH) {
    return { active: false, vx, vy, sections: [] };
  }

  const idx = coordToIndex(ix, iy, state.map.width);
  const tile = state.map.tiles[idx];
  if (!tile || (!tile.explored && !state.map.isFullyExplored)) {
    return { active: false, vx, vy, sections: [] };
  }

  const sections: InspectSectionDTO[] = [];
  const entitiesAt = state.spatialIndex.get(`${ix},${iy}`) || [];

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

    if (fighter) {
      const identity = getComponent(state, entityId, ComponentType.Identity) as IdentityComponent | undefined;
      const nameStr = identity ? `${identity.name} ${identity.title ?? ''}`.trim() : 'Actor';

      sections.push({
        type: 'header',
        value: `${renderable.glyph} ${nameStr}`
      });

      const stats = getEffectiveStats(state, entityId);
      sections.push({
        type: 'stat',
        label: 'HP',
        value: `${fighter.hp}/${stats.maxHp}`
      });
      sections.push({
        type: 'stat',
        label: 'ATK',
        value: `${stats.attack}`
      });
      sections.push({
        type: 'stat',
        label: 'DEF',
        value: `${stats.defense}`
      });

      const memory = getComponent(state, entityId, ComponentType.Memory) as MemoryComponent | undefined;
      if (memory) {
        if (memory.stress !== undefined && memory.stress > 0) {
          sections.push({
            type: 'stat',
            label: 'Stress',
            value: `${Math.floor(memory.stress)}`,
            color: '#ffaa00'
          });
        }
        if (memory.facets) {
          const dominant = Object.entries(memory.facets).filter(
            ([_, v]) => v >= FACET_DOMINANT_HIGH_THRESHOLD || v <= FACET_DOMINANT_LOW_THRESHOLD
          );
          if (dominant.length > 0) {
            sections.push({
              type: 'desc',
              value: 'Traits: ' + dominant.map(([k, v]) => `${k} (${v})`).join(', '),
              color: '#ff6666'
            });
          }
        }

        if (state.uiMode === UIMode.Debug) {
          sections.push({
            type: 'stat',
            label: 'Talk/Trd/Intm/Hlp/Btr',
            value: `${memory.timesTalked ?? 0}/${memory.timesTraded ?? 0}/${memory.timesIntimidated ?? 0}/${memory.timesHelped ?? 0}/${memory.timesBetrayed ?? 0}`,
            color: '#8888ff'
          });
        }

        const remainingPatience = (memory.patienceThreshold ?? 5) - (memory.timesTalked ?? 0);
        sections.push({
          type: 'stat',
          label: 'Patience',
          value: `${remainingPatience}/${memory.patienceThreshold ?? 5}`
        });

        if ((memory.annoyedDuration ?? 0) > 0) {
          sections.push({
            type: 'desc',
            value: `Annoyed (${memory.annoyedDuration} turns remaining)`,
            color: '#ffaa00'
          });
        }
        if ((memory.gratefulDuration ?? 0) > 0) {
          sections.push({
            type: 'desc',
            value: `Grateful (${memory.gratefulDuration} turns remaining)`,
            color: '#00ffaa'
          });
        }

        if (memory.relationshipAxes) {
          for (const [axis, value] of Object.entries(memory.relationshipAxes)) {
            if (value !== 0) {
              const formattedAxis = axis.charAt(0).toUpperCase() + axis.slice(1);
              sections.push({
                type: 'stat',
                label: formattedAxis,
                value: `${value > 0 ? '+' : ''}${value}`,
                color: value > 0 ? '#00ffaa' : '#ff4444'
              });
            }
          }
        }

        const knowledgeKeys = Object.keys(memory.knowledge ?? {});
        if (knowledgeKeys.length > 0) {
          sections.push({
            type: 'desc',
            value: 'Knowledge: ' + knowledgeKeys.join(', '),
            color: '#55ff55'
          });
        }
      }

      const nemesis = getComponent(state, entityId, ComponentType.Nemesis) as NemesisComponent | undefined;
      if (nemesis) {
        const rankDef = state.campaign.nemesisHierarchies[nemesis.hierarchyId]?.ranks.find(
          (r) => r.rankId === nemesis.rankId
        );
        if (rankDef) {
          sections.push({
            type: 'desc',
            value: `<strong>${rankDef.displayName}</strong> (Tier ${nemesis.tier})`,
            color: '#f1c40f',
            isHtml: true
          });
        }
      }

      const chronicle = getComponent(state, entityId, ComponentType.Chronicle) as ChronicleComponent | undefined;
      if (chronicle && chronicle.scars.length > 0) {
        sections.push({
          type: 'desc',
          value: `<em>Scars:</em> ${chronicle.scars.join(', ')}`,
          color: '#e74c3c',
          isHtml: true
        });
      }
      if (chronicle && chronicle.eventExcerpts.length > 0) {
        const latestEventId = chronicle.eventExcerpts[chronicle.eventExcerpts.length - 1];
        const latestEvent = state.historicalLedger.find((e) => e.id === latestEventId);
        if (latestEvent && latestEvent.summary) {
          sections.push({
            type: 'desc',
            value: `<em>Latest:</em> ${latestEvent.summary}`,
            color: '#bdc3c7',
            isHtml: true
          });
        }
      }
    } else if (item) {
      const itemDef = state.campaign.items[item.itemId];
      const isIdentified = state.identifiedItems.has(item.itemId);
      const name = isIdentified
        ? itemDef?.name
        : (state.itemUnidentifiedNames.get(item.itemId) ?? itemDef?.unidentifiedName ?? item.itemId);

      sections.push({
        type: 'header',
        value: `${renderable.glyph} ${name || 'Item'}`
      });

      if (itemDef?.description && isIdentified) {
        sections.push({
          type: 'desc',
          value: itemDef.description
        });
      }
    } else {
      sections.push({
        type: 'header',
        value: `${renderable.glyph} Feature`
      });
    }
  }

  if (sections.length === 0) {
    const tileDef = state.campaign.tiles[tile.tileId];
    if (tileDef) {
      const formattedName = tile.tileId
        .split('_')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
      sections.push({
        type: 'header',
        value: `${tileDef.glyph} ${formattedName}`
      });
    }
  }

  if (sections.length === 0) {
    sections.push({
      type: 'desc',
      value: 'Nothing inspected.'
    });
  }

  return {
    active: true,
    vx,
    vy,
    sections
  };
}
