import * as fs from 'fs';
import * as path from 'path';
import { RawMonster, RawItem } from './types.ts';

const NETHACK_DIR = path.resolve(process.cwd(), 'references/full games/NetHack/include');
const OUT_DIR = path.resolve(process.cwd(), 'scripts/data_importers/intermediate');

// Ensure output dir exists
if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

function parseMonsters(): void {
  console.log('Parsing NetHack monsters...');
  const text = fs.readFileSync(path.join(NETHACK_DIR, 'monsters.h'), 'utf-8');
  const monsters: RawMonster[] = [];

  // Regex to match the MON macro blocks
  // MON(NAM("name"), S_CLASS, LVL(...), ..., A(...), SIZ(...), ..., flags, ..., color, ID)
  // We'll use a relatively permissive regex with dotAll (s flag).
  const monRegex = /MON\(\s*NAM\("([^"]+)"\)\s*,\s*(S_\w+)\s*,\s*LVL\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(-?\d+).*?A\((.*?)\)\s*,\s*SIZ\(.*?\).*?,\s*(M1_[^,]+|0)\s*,\s*(M2_[^,]+|0)\s*,\s*(M3_[^,]+|0)\s*,\s*(\d+)\s*,\s*(CLR_\w+|NO_COLOR)/gs;

  let match;
  while ((match = monRegex.exec(text)) !== null) {
    const [
      ,
      name,
      symbolClass,
      levelStr,
      speedStr,
      acStr,
      attacksStr,
      m1,
      m2,
      m3,
      difficulty,
      color
    ] = match;

    const attacks = attacksStr
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== 'NO_ATTK' && s.length > 0);

    const flags = [m1, m2, m3]
      .flatMap((m) => m.split('|'))
      .map((f) => f.trim())
      .filter((f) => f !== '0');

    monsters.push({
      source: 'nethack',
      rawId: name.replace(/\s+/g, '_'),
      name,
      glyph: symbolClass,
      color,
      level: parseInt(levelStr, 10),
      speed: parseInt(speedStr, 10),
      ac: parseInt(acStr, 10),
      hp: parseInt(levelStr, 10) * 8, // Derived raw value
      attacks,
      flags,
      immunities: [] // Extracting immunities accurately from the regex is complex, we skip it for MVP
    });
  }

  console.log(`Parsed ${monsters.length} NetHack monsters.`);
  fs.writeFileSync(
    path.join(OUT_DIR, 'nethack_monsters_raw.json'),
    JSON.stringify(monsters, null, 2)
  );
}

function parseItems(): void {
  console.log('Parsing NetHack items...');
  const text = fs.readFileSync(path.join(NETHACK_DIR, 'objects.h'), 'utf-8');
  const items: RawItem[] = [];

  // Macro regexes
  const weaponRegex = /WEAPON\("([^"]+)",[^,]+,\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,[^,]+,[^,]+,[^,]+,\s*([^,]+)\s*,\s*([^, \)]+)/g;
  const potionRegex = /POTION\("([^"]+)",[^,]+,\s*\d+\s*,\s*([^,]+)\s*,\s*\d+\s*,\s*(\d+)\s*,\s*([^, \)]+)/g;
  const scrollRegex = /SCROLL\("([^"]+)",[^,]+,\s*\d+\s*,\s*\d+\s*,\s*(\d+)\s*,[^, \)]+/g;
  const ringRegex = /RING\("([^"]+)",[^,]+,\s*([^,]+)\s*,\s*(\d+)\s*,.*?([^,]+)\s*,\s*([^, \)]+)/g;

  let match;
  while ((match = weaponRegex.exec(text)) !== null) {
    items.push({
      source: 'nethack',
      rawId: match[1].replace(/\s+/g, '_'),
      name: match[1],
      category: 'weapon',
      glyph: ')', // Default
      weight: parseInt(match[2], 10),
      cost: parseInt(match[3], 10),
      smallDamage: parseInt(match[4], 10),
      largeDamage: parseInt(match[5], 10),
      material: match[6].trim(),
      color: match[7].trim(),
      flags: []
    });
  }

  while ((match = potionRegex.exec(text)) !== null) {
    items.push({
      source: 'nethack',
      rawId: 'potion_of_' + match[1].replace(/\s+/g, '_'),
      name: 'Potion of ' + match[1],
      category: 'potion',
      glyph: '!',
      weight: 20,
      cost: parseInt(match[3], 10),
      power: match[2].trim(),
      material: 'GLASS',
      color: match[4].trim(),
      flags: []
    });
  }

  while ((match = scrollRegex.exec(text)) !== null) {
    items.push({
      source: 'nethack',
      rawId: 'scroll_of_' + match[1].replace(/\s+/g, '_'),
      name: 'Scroll of ' + match[1],
      category: 'scroll',
      glyph: '?',
      weight: 5,
      cost: parseInt(match[2], 10),
      material: 'PAPER',
      color: 'CLR_WHITE',
      flags: []
    });
  }

  console.log(`Parsed ${items.length} NetHack items.`);
  fs.writeFileSync(
    path.join(OUT_DIR, 'nethack_items_raw.json'),
    JSON.stringify(items, null, 2)
  );
}

function main() {
  parseMonsters();
  parseItems();
}

main();
