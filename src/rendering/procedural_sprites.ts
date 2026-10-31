/**
 * @file Procedural 32x32 2D pixel-art sprite atlas synthesizer for Dwarf Fortress / Ultima style
 * graphical tile rendering on ASCII campaigns or unmapped glyphs.
 */

import { getSettings } from '../core/settings.ts';
import type { CampaignData } from '../types/campaign.types.ts';

/** Standard pixel dimension for procedural 2D tile cells. */
const PROCEDURAL_TILE_SIZE = 32;

/**
 * Determines whether the engine should render in 2D tile/sprite mode based on
 * the active campaign's spriteSheets and the user's `renderMode` preference.
 *
 * @param campaign The active CampaignData.
 * @returns True when 2D sprite rendering is active.
 */
export function isEffectiveSpriteMode(campaign: CampaignData): boolean {
  const pref = getSettings().visualFeedback.renderMode;
  if (pref === 'ascii') {
    return false;
  }
  if (pref === 'sprites') {
    return true;
  }
  return Boolean(campaign.theme.spriteSheets && Object.keys(campaign.theme.spriteSheets).length > 0);
}

/**
 * Draws a single 32x32 procedural 2D pixel-art tile or entity onto a canvas context.
 */
function paintProceduralSprite(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  glyph: string,
  fg: string,
  bg: string,
  kind: 'tile' | 'entity'
): void {
  const s = PROCEDURAL_TILE_SIZE;

  if (kind === 'tile') {
    ctx.fillStyle = bg && bg !== 'transparent' ? bg : '#0c0f14';
    ctx.fillRect(ox, oy, s, s);

    if (glyph === '#') {
      // Beveled stone wall masonry
      ctx.fillStyle = fg;
      ctx.fillRect(ox + 1, oy + 1, s - 2, s - 4);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
      ctx.fillRect(ox + 1, oy + 1, s - 2, 3);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.38)';
      ctx.fillRect(ox + 1, oy + 14, s - 2, 2);
      ctx.fillRect(ox + 15, oy + 1, 2, 13);
      ctx.fillRect(ox + 8, oy + 16, 2, 13);
      ctx.fillRect(ox + 23, oy + 16, 2, 13);
      return;
    }

    if (glyph === '.' || glyph === ',') {
      // Textured flagstone floor with subtle pebbles
      ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
      ctx.strokeRect(ox + 0.5, oy + 0.5, s - 1, s - 1);
      ctx.fillStyle = fg;
      ctx.fillRect(ox + 7, oy + 9, 2, 2);
      ctx.fillRect(ox + 22, oy + 20, 2, 2);
      ctx.fillRect(ox + 14, oy + 25, 2, 1);
      return;
    }

    if (glyph === '+' || glyph === '/') {
      // Wooden dungeon door
      ctx.fillStyle = '#5c3a21';
      ctx.fillRect(ox + 4, oy + 2, s - 8, s - 4);
      ctx.fillStyle = '#2d1c10';
      ctx.fillRect(ox + 10, oy + 2, 2, s - 4);
      ctx.fillRect(ox + 20, oy + 2, 2, s - 4);
      ctx.fillStyle = '#d4af37';
      ctx.fillRect(ox + 22, oy + 15, 3, 3);
      return;
    }

    if (glyph === '<' || glyph === '>') {
      // Stone staircase steps
      ctx.fillStyle = fg;
      for (let step = 0; step < 4; step++) {
        const sy = oy + 6 + step * 5;
        const sx = glyph === '>' ? ox + 5 + step * 4 : ox + 17 - step * 4;
        ctx.fillRect(sx, sy, 10, 4);
      }
      return;
    }
  }

  // Entity or special glyph: draw drop shadow + crisp stylized emblem/character silhouette
  if (kind === 'entity') {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.beginPath();
    ctx.ellipse(ox + s / 2, oy + s - 5, s * 0.32, 4, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Stylized pixel-art badge & crisp glyph
  ctx.fillStyle = 'rgba(10, 14, 20, 0.65)';
  ctx.beginPath();
  ctx.arc(ox + s / 2, oy + s / 2 - 1, s * 0.36, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = fg;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(ox + s / 2, oy + s / 2 - 1, s * 0.36, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = fg;
  ctx.font = 'bold 18px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(glyph, ox + s / 2, oy + s / 2);
}

/**
 * Synthesizes an in-memory 32x32 2D pixel-art sprite atlas for a campaign that
 * has no native PNG spritesheets (or when procedural sprite mode is enabled).
 *
 * @param campaign The active CampaignData.
 * @returns Generated atlas canvas, tileMap, and cell dimensions.
 */
export function buildProceduralSpriteAtlas(campaign: CampaignData): {
  readonly atlas: HTMLCanvasElement;
  readonly mergedTileMap: Record<string, [number, number]>;
  readonly tileWidth: number;
  readonly tileHeight: number;
} {
  const entries: Array<{
    readonly key: string;
    readonly glyph: string;
    readonly fg: string;
    readonly bg: string;
    readonly kind: 'tile' | 'entity';
  }> = [];
  const seen = new Set<string>();

  const register = (key: string, glyph: string, fg: string, bg: string, kind: 'tile' | 'entity'): void => {
    if (seen.has(key)) return;
    seen.add(key);
    entries.push({ key, glyph, fg, bg, kind });
  };

  for (const tileDef of Object.values(campaign.tiles)) {
    if (tileDef.spriteId) {
      register(tileDef.spriteId, tileDef.glyph, tileDef.fg, tileDef.bg, 'tile');
    }
    register(tileDef.glyph, tileDef.glyph, tileDef.fg, tileDef.bg, 'tile');
  }

  for (const entityDef of Object.values(campaign.entities)) {
    if (entityDef.spriteId) {
      register(entityDef.spriteId, entityDef.glyph, entityDef.fg, entityDef.bg, 'entity');
    }
    register(entityDef.glyph, entityDef.glyph, entityDef.fg, entityDef.bg, 'entity');
  }

  for (const itemDef of Object.values(campaign.items)) {
    if (itemDef.spriteId) {
      register(itemDef.spriteId, itemDef.glyph, itemDef.fg, itemDef.bg, 'entity');
    }
    register(itemDef.glyph, itemDef.glyph, itemDef.fg, itemDef.bg, 'entity');
  }

  register('@', '@', '#ffd32a', 'transparent', 'entity');
  register('X', 'X', '#00ffff', 'transparent', 'entity');

  const cols = 8;
  const rows = Math.max(1, Math.ceil((entries.length + 1) / cols));
  const atlas = document.createElement('canvas');
  atlas.width = cols * PROCEDURAL_TILE_SIZE;
  atlas.height = rows * PROCEDURAL_TILE_SIZE;

  const ctx = atlas.getContext('2d');
  const mergedTileMap: Record<string, [number, number]> = {};

  if (ctx) {
    entries.forEach((entry, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const ox = col * PROCEDURAL_TILE_SIZE;
      const oy = row * PROCEDURAL_TILE_SIZE;
      paintProceduralSprite(ctx, ox, oy, entry.glyph, entry.fg, entry.bg, entry.kind);
      mergedTileMap[entry.key] = [ox, oy];
    });

    const fallbackIdx = entries.length;
    const fx = (fallbackIdx % cols) * PROCEDURAL_TILE_SIZE;
    const fy = Math.floor(fallbackIdx / cols) * PROCEDURAL_TILE_SIZE;
    ctx.fillStyle = '#0b0b0b';
    ctx.fillRect(fx, fy, PROCEDURAL_TILE_SIZE, PROCEDURAL_TILE_SIZE);
    mergedTileMap['__fallback__'] = [fx, fy];
  }

  return {
    atlas,
    mergedTileMap,
    tileWidth: PROCEDURAL_TILE_SIZE,
    tileHeight: PROCEDURAL_TILE_SIZE
  };
}
