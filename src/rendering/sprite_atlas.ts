import * as ROT from 'rot-js';
import { type CampaignData, type SpriteSheetSource } from '../types/campaign.types.ts';
import { isEffectiveSpriteMode } from './procedural_sprites.ts';

/**
 * Loads all spritesheet images and composites them into one atlas canvas + merged tileMap.
 */
export async function compositeAtlas(
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

  ctx.fillStyle = '#0b0b0b';
  ctx.fillRect(0, yOffset, tileWidth, tileHeight);
  mergedTileMap['__fallback__'] = [0, yOffset];

  return { atlas, mergedTileMap, tileWidth, tileHeight };
}

/**
 * Mounts the ROT.Display container element and initializes the fog overlay canvas if required.
 *
 * @param display The ROT.js display instance to mount.
 * @param campaign The campaign data determining whether sprite sheets and fog overlay are active.
 */
export function mountDisplayWithFogOverlay(display: ROT.Display, campaign: CampaignData): void {
  const container = document.getElementById('game-canvas-wrapper');
  if (!container) {
    console.error("Failed to find '#game-canvas-wrapper' element in the DOM.");
    return;
  }

  const canvasElement = display.getContainer() as HTMLCanvasElement | null;
  if (!canvasElement) return;

  for (const existing of Array.from(container.querySelectorAll('canvas'))) {
    if (existing !== canvasElement && existing.id !== 'fog-overlay' && existing.id !== 'tactical-overlay') {
      existing.remove();
    }
  }

  if (canvasElement.parentElement !== container) {
    const fogCanvas = document.getElementById('fog-overlay');
    if (fogCanvas && fogCanvas.parentElement === container) {
      container.insertBefore(canvasElement, fogCanvas);
    } else {
      container.appendChild(canvasElement);
    }
  }

  syncFogOverlayCanvas(campaign);
}

/**
 * Synchronizes the existence of the fog overlay canvas based on whether sprite mode is enabled.
 *
 * @param campaign The active campaign data.
 */
export function syncFogOverlayCanvas(campaign: CampaignData): void {
  const container = document.getElementById('game-canvas-wrapper');
  if (!container) return;

  let fogCanvas = document.getElementById('fog-overlay') as HTMLCanvasElement | null;
  const hasSpriteSheets = isEffectiveSpriteMode(campaign);

  if (hasSpriteSheets) {
    if (!fogCanvas) {
      fogCanvas = document.createElement('canvas');
      fogCanvas.id = 'fog-overlay';
      fogCanvas.style.position = 'absolute';
      fogCanvas.style.top = '0';
      fogCanvas.style.left = '0';
      fogCanvas.style.width = '100%';
      fogCanvas.style.height = '100%';
      fogCanvas.style.pointerEvents = 'none';
      container.style.position = 'relative';
      container.appendChild(fogCanvas);
    }
  } else if (fogCanvas) {
    fogCanvas.remove();
  }
}
