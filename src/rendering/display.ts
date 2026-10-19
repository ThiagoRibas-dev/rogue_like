import * as ROT from 'rot-js';
import { type GameState } from '../types/game-state.types.ts';
import { GAME_ASPECT_RATIO } from '../constants/display.constants.ts';
import { type CampaignData, type SpriteSheetSource } from '../types/campaign.types.ts';

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
 * Loads all spritesheet images and composites them into one atlas canvas + merged tileMap.
 */
async function compositeAtlas(
  sheets: Record<string, SpriteSheetSource>,
  basePath: string
): Promise<{
  readonly atlas: HTMLCanvasElement;
  readonly mergedTileMap: Record<string, [number, number]>;
  readonly tileWidth: number;
  readonly tileHeight: number;
}> {
  const entries = Object.entries(sheets);
  const firstEntry = entries[0];
  if (!firstEntry) {
    throw new Error('No spritesheets provided');
  }

  const images = await Promise.all(
    entries.map(([_, sheet]) => {
      return new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`Failed to load spritesheet: ${sheet.src}`));
        img.src = `${basePath}/${sheet.src}`;
      });
    })
  );

  const tileWidth = firstEntry[1].tileWidth;
  const tileHeight = firstEntry[1].tileHeight;

  const totalHeight = images.reduce((sum, img) => sum + img.height, 0) + tileHeight;
  const maxWidth = Math.max(tileWidth, ...images.map((img) => img.width));

  const atlas = document.createElement('canvas');
  atlas.width = maxWidth;
  atlas.height = totalHeight;
  const ctx = atlas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get 2d context for spritesheet atlas composition');
  }

  const mergedTileMap: Record<string, [number, number]> = {};
  let yOffset = 0;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) continue;
    const [_, sheet] = entry;
    const img = images[i];
    if (!img) continue;
    ctx.drawImage(img, 0, yOffset);

    for (const [spriteId, mapping] of Object.entries(sheet.tileMap)) {
      if (Array.isArray(mapping)) {
        mergedTileMap[spriteId] = [mapping[0], mapping[1] + yOffset];
      } else {
        mergedTileMap[spriteId] = [mapping.default[0], mapping.default[1] + yOffset];
        if (mapping.commonAlts) {
          mapping.commonAlts.forEach((alt, idx) => {
            mergedTileMap[`${spriteId}__alt_${idx}`] = [alt[0], alt[1] + yOffset];
          });
        }
        if (mapping.rareAlts) {
          mapping.rareAlts.forEach((alt, idx) => {
            mergedTileMap[`${spriteId}__rare_${idx}`] = [alt[0], alt[1] + yOffset];
          });
        }
      }
    }
    yOffset += img.height;
  }

  // Generate a magenta square as a fallback for missing/unmapped sprites
  ctx.fillStyle = '#ff00ff';
  ctx.fillRect(0, yOffset, tileWidth, tileHeight);
  mergedTileMap['__fallback__'] = [0, yOffset];

  return { atlas, mergedTileMap, tileWidth, tileHeight };
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
  const sheets = campaign.theme.spriteSheets;

  if (sheets && Object.keys(sheets).length > 0) {
    try {
      const { atlas, mergedTileMap, tileWidth, tileHeight } = await compositeAtlas(sheets, basePath);
      display.setOptions({
        layout: 'tile',
        tileWidth,
        tileHeight,
        tileSet: atlas,
        tileMap: mergedTileMap,
        tileColorize: false,
        bg: 'transparent'
      });
      return true;
    } catch (err) {
      console.error('Sprite loading failed, falling back to ASCII:', err);
    }
  }

  // ASCII fallback / reset
  display.setOptions({
    layout: 'rect',
    fontSize: campaign.theme.ui.fontSize,
    fontFamily: campaign.theme.ui.fontFamily
  });
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
    const tileMap = display.getOptions().tileMap as Record<string, [number, number]> | undefined;
    
    const getSprite = (id: string | undefined, glyph: string) => {
      if (id && tileMap?.[id]) return id;
      if (tileMap?.[glyph]) return glyph; // In case the designer mapped the ASCII char directly
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
  } else {
    const top = entities.length > 0 ? (entities[entities.length - 1] ?? baseTile) : baseTile;
    display.draw(x, y, top.glyph, top.fg, top.bg);
  }
}

/**
 * Synchronizes the ROT.js Display grid width, height, and font size based on
 * the active campaign's theme settings, the current zoom level, and the global aspect ratio.
 *
 * @param display The ROT.js Display instance.
 * @param state The current immutable GameState.
 * @returns void
 */
export function syncDisplayLayout(display: ROT.Display, state: GameState): void {
  const theme = state.campaign.theme;
  const baseCols = theme.ui.displayWidth;
  const baseRows = theme.ui.displayHeight;
  const baseFontSize = theme.ui.fontSize;
  const fontFamily = theme.ui.fontFamily;

  const activeFontSize = Math.round(baseFontSize * state.zoomLevel);

  const spriteConfig = theme.spriteSheets;
  const isSpriteMode = spriteConfig && Object.keys(spriteConfig).length > 0;

  if (isSpriteMode) {
    // In sprite mode, don't set font options as it can reset the layout backend in some rot-js versions
  } else {
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
  } else if (isSpriteMode && spriteConfig) {
    const firstConfig = Object.values(spriteConfig)[0];
    if (firstConfig !== undefined) {
      cellWidth = firstConfig.tileWidth;
      cellHeight = firstConfig.tileHeight;
    }
  } else {
    cellWidth = activeFontSize;
    cellHeight = activeFontSize;
  }

  const baseColsAtZoom = Math.max(1, Math.round(baseCols / state.zoomLevel));
  const baseRowsAtZoom = Math.max(1, Math.round(baseRows / state.zoomLevel));

  const targetRatio = GAME_ASPECT_RATIO * (cellHeight / cellWidth);
  const currentRatio = baseColsAtZoom / baseRowsAtZoom;

  let finalCols = baseColsAtZoom;
  let finalRows = baseRowsAtZoom;

  if (currentRatio < targetRatio) {
    finalCols = Math.max(1, Math.round(baseRowsAtZoom * targetRatio));
  } else if (currentRatio > targetRatio) {
    finalRows = Math.max(1, Math.round(baseColsAtZoom / targetRatio));
  }

  display.setOptions({
    width: finalCols,
    height: finalRows
  });
}
