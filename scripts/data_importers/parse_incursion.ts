import * as fs from 'fs';
import * as path from 'path';
import { RawMonster, RawItem, RawStaticMap } from './types.ts';

const INCURSION_DIR = path.resolve(process.cwd(), 'references/full games/incursion-roguelike/lib');
const OUT_DIR = path.resolve(process.cwd(), 'scripts/data_importers/intermediate');

if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

function extractBlocks(text: string, blockType: string): { name: string; content: string }[] {
  const blocks: { name: string; content: string }[] = [];
  const lines = text.split('\n');
  let inBlock = false;
  let braceDepth = 0;
  let currentName = '';
  let currentContent: string[] = [];

  for (const line of lines) {
    if (!inBlock) {
      const match = line.match(new RegExp(`^\\s*${blockType}\\s+"([^"]+)"`));
      if (match) {
        inBlock = true;
        currentName = match[1];
        currentContent = [line];
        braceDepth = 0;
        
        // Count braces on the definition line if any
        const openBraces = (line.match(/\{/g) || []).length;
        const closeBraces = (line.match(/\}/g) || []).length;
        braceDepth += openBraces - closeBraces;
      }
    } else {
      currentContent.push(line);
      const openBraces = (line.match(/\{/g) || []).length;
      const closeBraces = (line.match(/\}/g) || []).length;
      braceDepth += openBraces - closeBraces;

      // If we've seen at least one brace and we're back to 0 depth, block is done.
      // Or if the block closes gracefully
      if (braceDepth <= 0 && currentContent.some(l => l.includes('{'))) {
        blocks.push({
          name: currentName,
          content: currentContent.join('\n')
        });
        inBlock = false;
      }
    }
  }

  return blocks;
}

function parseMonsters(): void {
  console.log('Parsing Incursion monsters...');
  const files = ['mon1.irh', 'mon2.irh', 'mon3.irh', 'mon4.irh'];
  const monsters: RawMonster[] = [];

  for (const file of files) {
    const filePath = path.join(INCURSION_DIR, file);
    if (!fs.existsSync(filePath)) continue;
    
    const text = fs.readFileSync(filePath, 'utf-8');
    const blocks = extractBlocks(text, 'Monster');

    for (const block of blocks) {
      // Skip M_NOGEN entries (templates)
      if (block.content.includes('M_NOGEN')) continue;

      const rawId = block.name.replace(/\s+/g, '_');
      const name = block.name;

      const levelMatch = block.content.match(/CR:\s*(\d+)/);
      const level = levelMatch ? parseInt(levelMatch[1], 10) : 1;

      const hdMatch = block.content.match(/HD:\s*(\d+)/);
      const hp = hdMatch ? parseInt(hdMatch[1], 10) : 10;

      const armMatch = block.content.match(/Arm:\s*(\d+)/);
      const ac = armMatch ? parseInt(armMatch[1], 10) : 10;

      const spdMatch = block.content.match(/Spd:\s*(\d+)%/);
      const speed = spdMatch ? parseInt(spdMatch[1], 10) : 100;

      const imageMatch = block.content.match(/Image:\s*(\w+)\s+'([^']+)'/);
      const color = imageMatch ? imageMatch[1] : 'gray';
      const glyph = imageMatch ? imageMatch[2] : '?';

      const flagsMatch = block.content.match(/Flags:\s*([^;]+);/);
      let flags: string[] = [];
      if (flagsMatch) {
        flags = flagsMatch[1].split(',').map(f => f.trim());
      }

      const immuneMatch = block.content.match(/Immune:\s*([^;]+);/);
      let immunities: string[] = [];
      if (immuneMatch) {
        immunities = immuneMatch[1].split(',').map(i => i.trim());
      }

      monsters.push({
        source: 'incursion',
        rawId,
        name,
        glyph,
        color,
        level,
        hp,
        ac,
        speed,
        attacks: [], // Complex multi-line parsing skipped for MVP intermediate representation
        flags,
        immunities
      });
    }
  }

  console.log(`Parsed ${monsters.length} Incursion monsters.`);
  fs.writeFileSync(
    path.join(OUT_DIR, 'incursion_monsters_raw.json'),
    JSON.stringify(monsters, null, 2)
  );
}

function parseItems(): void {
  console.log('Parsing Incursion items...');
  const files = ['weapons.irh', 'mundane.irh'];
  const items: RawItem[] = [];

  for (const file of files) {
    const filePath = path.join(INCURSION_DIR, file);
    if (!fs.existsSync(filePath)) continue;
    
    const text = fs.readFileSync(filePath, 'utf-8');
    const blocks = extractBlocks(text, 'Item');

    for (const block of blocks) {
      if (block.content.includes('T_TEMPLATE')) continue;

      const rawId = block.name.replace(/\s+/g, '_');
      const name = block.name;

      const matMatch = block.content.match(/Mat:\s*(MAT_\w+)/);
      const material = matMatch ? matMatch[1] : 'MAT_IRON';

      const wgtMatch = block.content.match(/Weight:\s*(\d+)/);
      const weight = wgtMatch ? parseInt(wgtMatch[1], 10) : 10;

      const sDmgMatch = block.content.match(/SDmg:\s*(\w+)/);
      let smallDamage = 0;
      if (sDmgMatch) {
        // Parse "1d6" or similar
        const dice = sDmgMatch[1].split('d');
        if (dice.length === 2) {
          smallDamage = Math.round((parseInt(dice[0], 10) * (parseInt(dice[1], 10) + 1)) / 2);
        } else {
          smallDamage = parseInt(sDmgMatch[1], 10) || 0;
        }
      }

      const flagsMatch = block.content.match(/Flags:\s*([^;]+);/);
      let flags: string[] = [];
      if (flagsMatch) {
        flags = flagsMatch[1].split(',').map(f => f.trim());
      }

      items.push({
        source: 'incursion',
        rawId,
        name,
        category: 'weapon',
        glyph: ')', // Default
        color: 'gray', // Default
        material,
        weight,
        cost: 10,
        smallDamage,
        flags
      });
    }
  }

  console.log(`Parsed ${items.length} Incursion items.`);
  fs.writeFileSync(
    path.join(OUT_DIR, 'incursion_items_raw.json'),
    JSON.stringify(items, null, 2)
  );
}

function parseMaps(): void {
  console.log('Parsing Incursion maps...');
  const filePath = path.join(INCURSION_DIR, 'dungeon.irh');
  const maps: RawStaticMap[] = [];

  if (fs.existsSync(filePath)) {
    const text = fs.readFileSync(filePath, 'utf-8');
    const blocks = extractBlocks(text, 'Region');

    for (const block of blocks) {
      const gridMatch = block.content.match(/Grid:\s*\{:\s*([\s\S]*?)\s*:\}/);
      if (!gridMatch) continue;

      const layout = gridMatch[1].split('\n').map(l => l.trim()).filter(l => l.length > 0);
      
      const tilesMatch = block.content.match(/Tiles:\s*([\s\S]*?)(?:Grid:|;)/);
      const legend: Record<string, string> = {};
      if (tilesMatch) {
        const tileLines = tilesMatch[1].split(',');
        for (const tl of tileLines) {
          const match = tl.match(/'(.)':\s*\$?"([^"]+)"/);
          if (match) {
            legend[match[1]] = match[2];
          }
        }
      }

      maps.push({
        source: 'incursion',
        rawId: block.name.replace(/\s+/g, '_'),
        name: block.name,
        layout,
        legend,
        placedEntities: [] // Placements skipped for MVP
      });
    }
  }

  console.log(`Parsed ${maps.length} Incursion maps.`);
  fs.writeFileSync(
    path.join(OUT_DIR, 'incursion_maps_raw.json'),
    JSON.stringify(maps, null, 2)
  );
}

function main() {
  parseMonsters();
  parseItems();
  parseMaps();
}

main();
