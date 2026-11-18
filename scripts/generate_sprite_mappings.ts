import fs from 'node:fs';
import path from 'node:path';
import type { SpritePack, SpritePackAttribution, SpriteSheetSource } from '../src/types/campaign.types.ts';

const TILE_SIZE = 32;
const TILESETS_DIR = path.join(process.cwd(), 'references', 'tilesets', '32rogues');
const PACK_DIR = path.join(process.cwd(), 'public', 'data', 'sprite_packs', '32rogues');

function readPngDimensions(filePath: string): { readonly width: number; readonly height: number } {
  const buf = fs.readFileSync(filePath);
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20)
  };
}

function sanitizeIdPart(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

type RowResolver = (parsedOneBasedRow: number, colZeroBased: number) => number;

function parseTxtFile(
  filename: string,
  prefix: string,
  resolveZeroBasedRow: RowResolver = (r) => r - 1
): Record<string, [number, number]> {
  const filePath = path.join(TILESETS_DIR, filename);
  if (!fs.existsSync(filePath)) {
    console.warn(`File not found: ${filePath}`);
    return {};
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/);
  const tileMap: Record<string, [number, number]> = {};

  for (const line of lines) {
    // Match format like "1.a. dirt wall (top)"
    const match = line.match(/^(\d+)\.([a-z])\.\s+(.+)$/);
    if (!match) continue;
    const parsedRow = parseInt(match[1]!, 10);
    const col = match[2]!.charCodeAt(0) - 'a'.charCodeAt(0);
    const row = resolveZeroBasedRow(parsedRow, col);
    const x = col * TILE_SIZE;
    const y = row * TILE_SIZE;

    const id = `${prefix}_${sanitizeIdPart(match[3]!)}`;
    let counter = 1;
    let finalId = id;
    while (tileMap[finalId]) {
      finalId = `${id}_${counter}`;
      counter++;
    }
    tileMap[finalId] = [x, y];
  }

  return tileMap;
}

function parseAnimatedTilesFile(
  filename: string,
  prefix: string,
  pngPath: string
): SpriteSheetSource['tileMap'] {
  const filePath = path.join(TILESETS_DIR, filename);
  if (!fs.existsSync(filePath)) return {};

  const { width, height } = readPngDimensions(pngPath);
  const cols = Math.floor(width / TILE_SIZE);
  const maxRows = Math.floor(height / TILE_SIZE);
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/);
  const tileMap: Record<string, { default: [number, number]; commonAlts?: [number, number][] }> = {};

  for (const line of lines) {
    const match = line.match(/^(\d+)\.\s+(.+)$/);
    if (!match) continue;
    const row = parseInt(match[1]!, 10) - 1;
    if (row < 0 || row >= maxRows) continue;
    const y = row * TILE_SIZE;
    const baseId = `${prefix}_${sanitizeIdPart(match[2]!)}`;
    const alts: [number, number][] = [];
    for (let col = 1; col < Math.min(4, cols); col++) {
      alts.push([col * TILE_SIZE, y]);
    }
    tileMap[baseId] = {
      default: [0, y],
      ...(alts.length > 0 ? { commonAlts: alts } : {})
    };
  }
  return tileMap;
}

function buildAutotileMap(pngPath: string): Record<string, [number, number]> {
  const { width, height } = readPngDimensions(pngPath);
  const cols = Math.floor(width / TILE_SIZE);
  const rows = Math.floor(height / TILE_SIZE);
  const map: Record<string, [number, number]> = {};
  for (let r = 0; r < rows; r++) {
    const kind = r < 4 ? 'water' : 'poison_swamp';
    const localRow = r < 4 ? r : r - 4;
    for (let c = 0; c < cols; c++) {
      map[`tile_autotile_${kind}_${localRow}_${c}`] = [c * TILE_SIZE, r * TILE_SIZE];
    }
  }
  return map;
}

function buildPaletteSwapItemMap(pngPath: string): Record<string, [number, number]> {
  const { width, height } = readPngDimensions(pngPath);
  const cols = Math.floor(width / TILE_SIZE);
  const rows = Math.floor(height / TILE_SIZE);
  const map: Record<string, [number, number]> = {};
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      map[`item_palette_r${r + 1}_c${c + 1}`] = [c * TILE_SIZE, r * TILE_SIZE];
    }
  }
  return map;
}

function copyAsset(srcName: string, dstSubdir: 'tiles' | 'sprites', dstName = srcName): string {
  const srcPath = path.join(TILESETS_DIR, srcName);
  const dstDir = path.join(PACK_DIR, dstSubdir);
  fs.mkdirSync(dstDir, { recursive: true });
  const dstPath = path.join(dstDir, dstName);
  fs.copyFileSync(srcPath, dstPath);
  return dstPath;
}

function build32RoguesAttribution(): SpritePackAttribution {
  return {
    author: 'Seth Boyles',
    license: '32rogues Free-Use License (Non-Redistributable)',
    restrictions: [
      'Free for non-commercial and commercial projects',
      'Excluded: NFT or blockchain-related projects',
      'Excluded: generative artificial intelligence or machine learning projects',
      'Modifications allowed; redistribution or resale of standalone tileset files is prohibited'
    ],
    notes: 'Copyright 2024 Seth Boyles. Credit is not strictly required by license, but appreciated.'
  };
}

function main(): void {
  copyAsset('animals.png', 'sprites');
  const animatedDst = copyAsset('animated-tiles.png', 'tiles');
  const autotilesDst = copyAsset('autotiles.png', 'tiles');
  const swapsDst = copyAsset('items-palette-swaps.png', 'sprites');
  copyAsset('tiles.png', 'tiles');
  copyAsset('rogues.png', 'sprites');
  copyAsset('monsters.png', 'sprites');
  copyAsset('items.png', 'sprites');
  fs.copyFileSync(path.join(TILESETS_DIR, 'LICENSE.txt'), path.join(PACK_DIR, 'LICENSE.txt'));

  const spriteSheets: Record<string, SpriteSheetSource> = {
    tiles: {
      src: 'tiles/tiles.png',
      tileWidth: TILE_SIZE,
      tileHeight: TILE_SIZE,
      tileMap: parseTxtFile('tiles.txt', 'tile')
    },
    rogues: {
      src: 'sprites/rogues.png',
      tileWidth: TILE_SIZE,
      tileHeight: TILE_SIZE,
      tileMap: parseTxtFile('rogues.txt', 'actor', (r, c) => {
        // Upstream rogues.txt typos: `6.f. warlock` belongs on row 5 (y=128), shifting 7.*/8.* by +1 row.
        if (r === 6 && c === 5) return 4;
        return r >= 7 ? r - 2 : r - 1;
      })
    },
    monsters: {
      src: 'sprites/monsters.png',
      tileWidth: TILE_SIZE,
      tileHeight: TILE_SIZE,
      tileMap: parseTxtFile('monsters.txt', 'monster')
    },
    items: {
      src: 'sprites/items.png',
      tileWidth: TILE_SIZE,
      tileHeight: TILE_SIZE,
      tileMap: parseTxtFile('items.txt', 'item')
    },
    animals: {
      src: 'sprites/animals.png',
      tileWidth: TILE_SIZE,
      tileHeight: TILE_SIZE,
      tileMap: parseTxtFile('animals.txt', 'monster_animal', (r, c) => {
        // Upstream animals.txt typos: `3.c. orangutan` belongs on row 2 (y=32), shifting 4..17 by +1 row,
        // and `16.e. sheep (ewe)` belongs on row 16 (y=480) alongside `17.a..d`.
        if (r === 3 && c === 2) return 1;
        if (r === 16 && c === 4) return 15;
        return r >= 4 ? r - 2 : r - 1;
      })
    },
    animated_tiles: {
      src: 'tiles/animated-tiles.png',
      tileWidth: TILE_SIZE,
      tileHeight: TILE_SIZE,
      tileMap: parseAnimatedTilesFile('animated-tiles.txt', 'tile_anim', animatedDst)
    },
    autotiles: {
      src: 'tiles/autotiles.png',
      tileWidth: TILE_SIZE,
      tileHeight: TILE_SIZE,
      tileMap: buildAutotileMap(autotilesDst)
    },
    items_palette_swaps: {
      src: 'sprites/items-palette-swaps.png',
      tileWidth: TILE_SIZE,
      tileHeight: TILE_SIZE,
      tileMap: buildPaletteSwapItemMap(swapsDst)
    }
  };

  const pack: SpritePack = {
    id: '32rogues',
    name: '32rogues Fantasy Tileset & Sprites',
    description:
      'Shared 32x32 dungeon tiles, animated props, autotiles, player/NPC rogues, monsters, animals, and item sprites.',
    attribution: build32RoguesAttribution(),
    spriteSheets
  };

  const packPath = path.join(PACK_DIR, 'pack.json');
  fs.writeFileSync(packPath, JSON.stringify(pack, null, 2) + '\n');
  console.log(`Updated ${packPath} with ${Object.keys(spriteSheets).length} spritesheets.`);
}

main();
