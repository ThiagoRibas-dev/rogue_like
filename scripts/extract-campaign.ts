import fs from 'node:fs/promises';
import path from 'node:path';

// Import all the constants
import { ADVANCEMENT_TABLE } from '../src/constants/advancement.constants.ts';
import { AI_PROFILES } from '../src/constants/ai.constants.ts';
import * as colors from '../src/constants/colors.constants.ts';
import { ITEM_EFFECTS } from '../src/constants/effects.constants.ts';
import { HOSTILITY_MATRIX } from '../src/constants/faction.constants.ts';
import * as glyphs from '../src/constants/glyphs.constants.ts';
import { HUNGER_THRESHOLDS, MAX_SATIATION } from '../src/constants/hunger.constants.ts';
import { ITEM_REGISTRY, LOOT_TABLE, MAX_ITEMS_PER_ROOM } from '../src/constants/items.constants.ts';
import {
  MAP_WIDTH, MAP_HEIGHT, MIN_ROOM_WIDTH, MAX_ROOM_WIDTH,
  MIN_ROOM_HEIGHT, MAX_ROOM_HEIGHT, MIN_CORRIDOR_LENGTH,
  MAX_CORRIDOR_LENGTH, DUG_PERCENTAGE, MAX_DUNGEON_DEPTH, FOV_RADIUS
} from '../src/constants/map.constants.ts';
import { ENTITY_TEMPLATES, SPAWN_WEIGHTS, MAX_MONSTERS_PER_ROOM } from '../src/constants/spawning.constants.ts';
import { STATUS_EFFECTS } from '../src/constants/status.constants.ts';
import { TILE_REGISTRY } from '../src/constants/tile.constants.ts';
import { DISPLAY_WIDTH, DISPLAY_HEIGHT, FONT_SIZE, FONT_FAMILY } from '../src/constants/ui.constants.ts';

const outDir = path.resolve('public', 'data', 'campaigns', 'default');

async function writeJson(filename: string, data: any) {
  const filePath = path.join(outDir, filename);
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
  console.log(`Wrote ${filename}`);
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });

  // 1. Manifest
  await writeJson('manifest.json', {
    id: 'default',
    name: 'Descent',
    description: 'The base roguelike experience. Descend the dungeon and survive.',
    version: '1.0.0'
  });

  // 2. Rules
  await writeJson('rules.json', {
    map: {
      width: MAP_WIDTH,
      height: MAP_HEIGHT,
      minRoomWidth: MIN_ROOM_WIDTH,
      maxRoomWidth: MAX_ROOM_WIDTH,
      minRoomHeight: MIN_ROOM_HEIGHT,
      maxRoomHeight: MAX_ROOM_HEIGHT,
      minCorridorLength: MIN_CORRIDOR_LENGTH,
      maxCorridorLength: MAX_CORRIDOR_LENGTH,
      dugPercentage: DUG_PERCENTAGE,
      maxDungeonDepth: MAX_DUNGEON_DEPTH,
      fovRadius: FOV_RADIUS
    },
    hunger: {
      maxSatiation: MAX_SATIATION,
      thresholds: {
        satiated: HUNGER_THRESHOLDS.SATIATED,
        normal: HUNGER_THRESHOLDS.NORMAL,
        hungry: HUNGER_THRESHOLDS.HUNGRY,
        starving: HUNGER_THRESHOLDS.STARVING
      }
    },
    spawning: {
      maxMonstersPerRoom: MAX_MONSTERS_PER_ROOM,
      maxItemsPerRoom: MAX_ITEMS_PER_ROOM,
      spawnWeights: SPAWN_WEIGHTS,
      lootTable: LOOT_TABLE
    }
  });

  // 3. Theme
  const themeColors = Object.fromEntries(
    Object.entries(colors)
      .filter(([k]) => k.startsWith('COLOR_'))
      .map(([k, v]) => {
        // e.g. COLOR_PLAYER_FG -> playerFg
        const camel = k.replace(/^COLOR_/, '').toLowerCase().replace(/_([a-z])/g, g => g[1].toUpperCase());
        return [camel, v];
      })
  );
  const themeGlyphs = Object.fromEntries(
    Object.entries(glyphs)
      .filter(([k]) => k.startsWith('GLYPH_'))
      .map(([k, v]) => {
        const camel = k.replace(/^GLYPH_/, '').toLowerCase().replace(/_([a-z])/g, g => g[1].toUpperCase());
        return [camel, v];
      })
  );

  await writeJson('theme.json', {
    colors: themeColors,
    glyphs: themeGlyphs,
    ui: {
      displayWidth: DISPLAY_WIDTH,
      displayHeight: DISPLAY_HEIGHT,
      fontSize: FONT_SIZE,
      fontFamily: FONT_FAMILY
    }
  });

  // 4. Advancement
  await writeJson('advancement.json', ADVANCEMENT_TABLE);

  // 5. Items
  await writeJson('items.json', ITEM_REGISTRY);

  // 6. Effects
  await writeJson('effects.json', ITEM_EFFECTS);

  // 7. Entities
  await writeJson('entities.json', ENTITY_TEMPLATES);

  // 8. Status
  await writeJson('status.json', STATUS_EFFECTS);

  // 9. Tiles
  await writeJson('tiles.json', TILE_REGISTRY);

  // 10. Factions
  await writeJson('factions.json', HOSTILITY_MATRIX);

  // 11. AI
  await writeJson('ai.json', AI_PROFILES);

  console.log('Extraction complete!');
}

main().catch(console.error);
