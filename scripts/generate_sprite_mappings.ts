import fs from 'fs';
import path from 'path';

const TILE_SIZE = 32;
const TILESETS_DIR = path.join(process.cwd(), 'references', 'tilesets', '32rogues');
const CAMPAIGN_DIR = path.join(process.cwd(), 'public', 'data', 'campaigns', 'default');

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
      src: "tiles.png",
      tileWidth: TILE_SIZE,
      tileHeight: TILE_SIZE,
      tileMap: parseTxtFile('tiles.txt', 'tile')
    },
    rogues: {
      src: "rogues.png",
      tileWidth: TILE_SIZE,
      tileHeight: TILE_SIZE,
      tileMap: parseTxtFile('rogues.txt', 'actor')
    },
    monsters: {
      src: "monsters.png",
      tileWidth: TILE_SIZE,
      tileHeight: TILE_SIZE,
      tileMap: parseTxtFile('monsters.txt', 'monster')
    },
    items: {
      src: "items.png",
      tileWidth: TILE_SIZE,
      tileHeight: TILE_SIZE,
      tileMap: parseTxtFile('items.txt', 'item')
    }
  };

  const themePath = path.join(CAMPAIGN_DIR, 'theme.json');
  if (fs.existsSync(themePath)) {
    const themeStr = fs.readFileSync(themePath, 'utf-8');
    const theme = JSON.parse(themeStr);
    theme.spriteSheets = spriteSheets;
    fs.writeFileSync(themePath, JSON.stringify(theme, null, 2));
    console.log(`Updated ${themePath} with ${Object.keys(spriteSheets).length} spritesheets.`);
  } else {
    console.error(`Could not find theme.json at ${themePath}`);
  }
}

main();
