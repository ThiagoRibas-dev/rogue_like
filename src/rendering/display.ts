import * as ROT from 'rot-js';
import { type GameState } from '../types/game-state.types.ts';
import {
  DEFAULT_VIEWPORT_TILE_HEIGHT_PERCENT,
  GAME_ASPECT_RATIO,
  MIN_ASCII_FONT_SIZE_PX
} from '../constants/display.constants.ts';
import { type CampaignData } from '../types/campaign.types.ts';
import { recordDrawCommand } from './render_debug.ts';
import { buildProceduralSpriteAtlas, isEffectiveSpriteMode } from './procedural_sprites.ts';
import { compositeAtlas, mountDisplayWithFogOverlay } from './sprite_atlas.ts';

export * from './sprite_atlas.ts';

/**
 * Default procedural sprite cell dimension (px) when no custom spritesheet is configured.
 */
const DEFAULT_PROCEDURAL_TILE_PX = 32;

/**
 * Pixel dimensions of the active map viewport container.
 */
interface ViewportPixelBounds {
  readonly width: number;
  readonly height: number;
}

/**
 * Internal interface representing a ROT.js rectangular layout backend
 * that exposes the horizontal and vertical cell spacing.
 */
interface RectBackend {
  readonly _spacingX: number;
  readonly _spacingY: number;
}

/**
 * Type guard to determine if a ROT.js display backend is a rectangular backend
 * exposing the expected _spacingX and _spacingY properties.
 *
 * @param obj The unknown object to check.
 * @returns True if the object matches the RectBackend shape, false otherwise.
 */
function isRectBackend(obj: unknown): obj is RectBackend {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    '_spacingX' in obj &&
    typeof (obj as { readonly _spacingX: unknown })._spacingX === 'number' &&
    '_spacingY' in obj &&
    typeof (obj as { readonly _spacingY: unknown })._spacingY === 'number'
  );
}

/**
 * Resolves the live viewport pixel bounds from `#game-canvas-wrapper` or `window`,
 * returning `undefined` in headless environments without DOM dimensions.
 */
function resolveViewportPixelBounds(): ViewportPixelBounds | undefined {
  if (typeof document !== 'undefined' && typeof document.getElementById === 'function') {
    const wrapper = document.getElementById('game-canvas-wrapper');
    if (wrapper && wrapper.clientWidth > 0 && wrapper.clientHeight > 0) {
      return { width: wrapper.clientWidth, height: wrapper.clientHeight };
    }
  }
  if (typeof window !== 'undefined' && window.innerWidth > 0 && window.innerHeight > 0) {
    return { width: window.innerWidth, height: window.innerHeight };
  }
  return undefined;
}

/**
 * Dynamically configures an existing ROT.Display instance for a campaign,
 * switching between tile layout and ASCII layout as needed.
 */
export async function configureDisplayForCampaign(
  display: ROT.Display,
  campaign: CampaignData,
  basePath: string
): Promise<boolean> {
  const useSprites = isEffectiveSpriteMode(campaign);
  const sheets = campaign.theme.spriteSheets;

  display.clear();

  if (useSprites) {
    if (sheets && Object.keys(sheets).length > 0) {
      try {
        const { atlas, mergedTileMap, tileWidth, tileHeight } = await compositeAtlas(sheets, basePath);
        display.clear();
        display.setOptions({
          layout: 'tile',
          tileWidth,
          tileHeight,
          tileSet: atlas,
          tileMap: mergedTileMap,
          tileColorize: false,
          bg: 'transparent'
        });
        mountDisplayWithFogOverlay(display, campaign);
        return true;
      } catch (err) {
        console.error('Sprite loading failed, falling back to procedural sprite atlas:', err);
      }
    }

    const { atlas, mergedTileMap, tileWidth, tileHeight } = buildProceduralSpriteAtlas(campaign);
    display.clear();
    display.setOptions({
      layout: 'tile',
      tileWidth,
      tileHeight,
      tileSet: atlas,
      tileMap: mergedTileMap,
      tileColorize: false,
      bg: 'transparent'
    });
    mountDisplayWithFogOverlay(display, campaign);
    return true;
  }

  display.setOptions({
    layout: 'rect',
    fontSize: campaign.theme.ui.fontSize,
    fontFamily: campaign.theme.ui.fontFamily
  });
  mountDisplayWithFogOverlay(display, campaign);
  return false;
}

/**
 * Creates a ROT.Display, optionally in tile mode with a composited atlas.
 *
 * @param campaign The CampaignData definition.
 * @param basePath The base URL path to resolve image references.
 * @param customOptions Additional display options to merge.
 */
export async function createDisplay(
  campaign: CampaignData,
  basePath: string,
  customOptions: Partial<NonNullable<Parameters<ROT.Display['setOptions']>[0]>> = {}
): Promise<ROT.Display> {
  const display = new ROT.Display(customOptions);
  await configureDisplayForCampaign(display, campaign, basePath);
  return display;
}

/**
 * Draws a cell to the ROT.Display, supporting stacking in sprite mode and fallback in ASCII mode.
 */
export function drawCell(
  display: ROT.Display,
  x: number,
  y: number,
  isSpriteMode: boolean,
  baseTile: {
    readonly glyph: string;
    readonly fg: string;
    readonly bg: string;
    readonly spriteId?: string | undefined;
  },
  entities: ReadonlyArray<{
    readonly glyph: string;
    readonly fg: string;
    readonly bg: string;
    readonly spriteId?: string | undefined;
  }> = []
): void {
  if (isSpriteMode) {
    if (entities.length === 0 && !baseTile.spriteId && baseTile.glyph === ' ') {
      display.draw(x, y, '', baseTile.fg, baseTile.bg);
      recordDrawCommand(x, y, '', true);
      return;
    }

    const tileMap = display.getOptions().tileMap as Record<string, [number, number]> | undefined;

    const getSprite = (id: string | undefined, glyph: string): string => {
      if (id && tileMap?.[id]) return id;
      if (tileMap?.[glyph]) return glyph;
      return '__fallback__';
    };

    const chars = [getSprite(baseTile.spriteId, baseTile.glyph)];
    const fgs = [baseTile.fg];
    const bgs = [baseTile.bg];

    for (const ent of entities) {
      chars.push(getSprite(ent.spriteId, ent.glyph));
      fgs.push(ent.fg);
      bgs.push(ent.bg);
    }
    display.draw(x, y, chars as unknown as string, fgs as unknown as string, bgs as unknown as string);
    recordDrawCommand(x, y, String(chars[0] ?? ''), true);
  } else {
    const top = entities.length > 0 ? (entities[entities.length - 1] ?? baseTile) : baseTile;
    const candidateBg = top.bg && top.bg !== 'transparent' ? top.bg : baseTile.bg;
    const bg = candidateBg && candidateBg !== 'transparent' ? candidateBg : '#000000';

    display.draw(x, y, top.glyph, top.fg, bg);
    recordDrawCommand(x, y, top.glyph, false);
  }
}

/**
 * Synchronizes the ROT.js Display grid width, height, font size, and canvas CSS scale
 * so that at `zoomLevel = 1.0`, each tile occupies a consistent percentage of the viewport
 * (`DEFAULT_VIEWPORT_TILE_HEIGHT_PERCENT`) regardless of screen resolution.
 *
 * @param display The ROT.js Display instance.
 * @param state The current immutable GameState.
 * @returns void
 */
export function syncDisplayLayout(display: ROT.Display, state: GameState): void {
  const theme = state.campaign.theme;
  const baseFontSize = theme.ui.fontSize;
  const fontFamily = theme.ui.fontFamily;
  const spriteConfig = theme.spriteSheets;
  const isSpriteMode = isEffectiveSpriteMode(state.campaign);

  const viewportBounds = resolveViewportPixelBounds();
  const targetTilePercent = DEFAULT_VIEWPORT_TILE_HEIGHT_PERCENT * state.zoomLevel;
  const referenceSpanPx = viewportBounds ? Math.min(viewportBounds.width, viewportBounds.height) : undefined;
  const targetTileSpanPx = referenceSpanPx !== undefined ? Math.max(1, referenceSpanPx * targetTilePercent) : undefined;

  const activeFontSize =
    targetTileSpanPx !== undefined
      ? Math.max(MIN_ASCII_FONT_SIZE_PX, Math.round(targetTileSpanPx))
      : Math.max(MIN_ASCII_FONT_SIZE_PX, Math.round(baseFontSize * state.zoomLevel));

  if (!isSpriteMode) {
    display.setOptions({
      fontSize: activeFontSize,
      fontFamily
    });
  }

  const backend = (display as unknown as { readonly _backend: unknown })._backend;
  let cellWidth = 0;
  let cellHeight = 0;

  if (isRectBackend(backend)) {
    cellWidth = backend._spacingX;
    cellHeight = backend._spacingY;
  } else if (isSpriteMode && spriteConfig && Object.keys(spriteConfig).length > 0) {
    const firstConfig = Object.values(spriteConfig)[0];
    if (firstConfig !== undefined) {
      cellWidth = firstConfig.tileWidth;
      cellHeight = firstConfig.tileHeight;
    }
  } else if (isSpriteMode) {
    cellWidth = DEFAULT_PROCEDURAL_TILE_PX;
    cellHeight = DEFAULT_PROCEDURAL_TILE_PX;
  } else {
    cellWidth = activeFontSize;
    cellHeight = activeFontSize;
  }

  const safeCellW = Math.max(1, cellWidth);
  const safeCellH = Math.max(1, cellHeight);

  let finalCols: number;
  let finalRows: number;

  if (viewportBounds !== undefined && targetTileSpanPx !== undefined) {
    if (!isSpriteMode) {
      finalCols = Math.max(1, Math.round(viewportBounds.width / safeCellW));
      finalRows = Math.max(1, Math.round(viewportBounds.height / safeCellH));
    } else {
      const tileAspectRatio = safeCellW / safeCellH;
      finalRows = Math.max(1, Math.round(viewportBounds.height / targetTileSpanPx));
      finalCols = Math.max(1, Math.round(viewportBounds.width / (targetTileSpanPx * tileAspectRatio)));
    }
  } else {
    const targetRatio = GAME_ASPECT_RATIO * (safeCellH / safeCellW);
    finalRows = Math.max(1, Math.round(1 / targetTilePercent));
    finalCols = Math.max(1, Math.round(finalRows * targetRatio));
  }

  display.setOptions({
    width: finalCols,
    height: finalRows
  });

  const canvas =
    typeof display.getContainer === 'function' ? (display.getContainer() as HTMLCanvasElement | null) : null;
  if (canvas && viewportBounds !== undefined) {
    const intrinsicW = Math.max(1, finalCols * safeCellW);
    const intrinsicH = Math.max(1, finalRows * safeCellH);
    const scale = Math.min(viewportBounds.width / intrinsicW, viewportBounds.height / intrinsicH);
    canvas.style.width = `${Math.max(1, Math.round(intrinsicW * scale))}px`;
    canvas.style.height = `${Math.max(1, Math.round(intrinsicH * scale))}px`;
  }
}
