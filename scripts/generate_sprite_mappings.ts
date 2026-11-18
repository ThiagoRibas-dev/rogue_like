import fs from 'fs';
import path from 'path';

const TILE_SIZE = 32;
const TILESETS_DIR = path.join(process.cwd(), 'references', 'tilesets', '32rogues');
const PACK_DIR = path.join(process.cwd(), 'public', 'data', 'sprite_packs', '32rogues');

function parseTxtFile(filename: string, prefix: string) {
  const filePath = path.join(TILESETS_DIR, filename);
  if (!fs.existsSync(filePath)) {
    console.warn(`File not found: ${filePath}`);
    return {};
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  
  const tileMap: Record<string, [number, number]> = {};

  for (const line of lines) {
    // Match format like "1.a. dirt wall (top)"
    const match = line.match(/^(\d+)\.([a-z])\.\s+(.+)$/);
    if (match) {
      const rowStr = match[1];
      const colStr = match[2];
      const nameStr = match[3];

      const row = parseInt(rowStr, 10) - 1; // 1-indexed to 0-indexed
      const col = colStr.charCodeAt(0) - 'a'.charCodeAt(0);

      const x = col * TILE_SIZE;
      const y = row * TILE_SIZE;

      // Sanitize name for ID
      const cleanName = nameStr
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '');
      
      let id = `${prefix}_${cleanName}`;
      
      // Handle duplicates
      let counter = 1;
      let finalId = id;
      while (tileMap[finalId]) {
        finalId = `${id}_${counter}`;
        counter++;
      }

      tileMap[finalId] = [x, y];
    }
  }

  return tileMap;
}

function main() {
  const spriteSheets = {
    tiles: {
      src: "tiles/tiles.png",
      tileWidth: TILE_SIZE,
      tileHeight: TILE_SIZE,
      tileMap: parseTxtFile('tiles.txt', 'tile')
    },
    rogues: {
      src: "sprites/rogues.png",
      tileWidth: TILE_SIZE,
      tileHeight: TILE_SIZE,
      tileMap: parseTxtFile('rogues.txt', 'actor')
    },
    monsters: {
      src: "sprites/monsters.png",
      tileWidth: TILE_SIZE,
      tileHeight: TILE_SIZE,
      tileMap: parseTxtFile('monsters.txt', 'monster')
    },
    items: {
      src: "sprites/items.png",
      tileWidth: TILE_SIZE,
      tileHeight: TILE_SIZE,
      tileMap: parseTxtFile('items.txt', 'item')
    }
  };

  const packPath = path.join(PACK_DIR, 'pack.json');
  if (fs.existsSync(packPath)) {
    const packStr = fs.readFileSync(packPath, 'utf-8');
    const pack = JSON.parse(packStr);
    pack.spriteSheets = spriteSheets;
    fs.writeFileSync(packPath, JSON.stringify(pack, null, 2) + '\n');
    console.log(`Updated ${packPath} with ${Object.keys(spriteSheets).length} spritesheets.`);
  } else {
    console.error(`Could not find pack.json at ${packPath}`);
  }
}

main();
