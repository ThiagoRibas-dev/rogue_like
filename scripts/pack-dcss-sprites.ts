import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';
import type { SpritePack, SpritePackAttribution, SpriteSheetSource } from '../src/types/campaign.types.ts';

const TILE_PX = 32;
const ATLAS_COLUMNS = 32;
const BYTES_PER_PIXEL = 4;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const DCSS_FULL_ROOT = join(process.cwd(), 'scratch', 'crawl-tiles', 'Dungeon Crawl Stone Soup Full');
const DCSS_SPELLS_ALT_ROOT = join(process.cwd(), 'scratch', 'crawl-tiles', 'crawl-tiles Oct-5-2010', 'spells');
const OUT_PACK_DIR = join(process.cwd(), 'public', 'data', 'sprite_packs', 'dcss');
const OUT_SHEETS_DIR = join(OUT_PACK_DIR, 'sheets');

interface RgbaImage {
  readonly width: number;
  readonly height: number;
  readonly data: Buffer;
}

const CRC_TABLE: Uint32Array = ((): Uint32Array => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8)) >>> 0;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makePngChunk(type: string, payload: Buffer): Buffer {
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(payload.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBuf, payload]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, typeBuf, payload, crcBuf]);
}

function encodeRgbaPng(width: number, height: number, rgba: Buffer): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * BYTES_PER_PIXEL;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowOut = y * (stride + 1);
    raw[rowOut] = 0; // Filter type 0 (None)
    rgba.copy(raw, rowOut + 1, y * stride, (y + 1) * stride);
  }

  const compressed = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    PNG_SIGNATURE,
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', compressed),
    makePngChunk('IEND', Buffer.alloc(0))
  ]);
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function getBytesPerPixelForColorType(colorType: number, bitDepth: number): number {
  if (bitDepth !== 8 && colorType !== 3) {
    throw new Error(`Unsupported PNG bitDepth=${bitDepth} for colorType=${colorType}`);
  }
  switch (colorType) {
    case 0:
      return 1;
    case 2:
      return 3;
    case 3:
      return 1;
    case 4:
      return 2;
    case 6:
      return 4;
    default:
      throw new Error(`Unsupported PNG colorType=${colorType}`);
  }
}

const ADAM7_PASSES: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 8, 0, 8],
  [4, 8, 0, 8],
  [0, 4, 4, 8],
  [2, 4, 0, 4],
  [0, 2, 2, 4],
  [1, 2, 0, 2],
  [0, 1, 1, 2]
];

function decodeScanlinesToRgba(
  inflated: Buffer,
  startOffset: number,
  passWidth: number,
  passHeight: number,
  colorType: number,
  bitDepth: number,
  palette: Buffer | undefined,
  trns: Buffer | undefined,
  onPixel: (px: number, py: number, r: number, g: number, b: number, a: number) => void
): number {
  if (passWidth === 0 || passHeight === 0) return startOffset;

  let pos = startOffset;
  if (colorType === 3 && bitDepth < 8) {
    const stride = Math.ceil((passWidth * bitDepth) / 8);
    const prevRow = Buffer.alloc(stride);
    const curRow = Buffer.alloc(stride);
    const mask = (1 << bitDepth) - 1;
    const pixelsPerByte = 8 / bitDepth;
    for (let y = 0; y < passHeight; y++) {
      const filterType = inflated[pos++]!;
      for (let x = 0; x < stride; x++) {
        const rawByte = inflated[pos++]!;
        const a = x >= 1 ? curRow[x - 1]! : 0;
        const b = prevRow[x]!;
        const c = x >= 1 ? prevRow[x - 1]! : 0;
        curRow[x] = applyPngFilter(filterType, rawByte, a, b, c);
      }
      for (let px = 0; px < passWidth; px++) {
        const byteIdx = Math.floor(px / pixelsPerByte);
        const shift = 8 - bitDepth * ((px % pixelsPerByte) + 1);
        const idx = (curRow[byteIdx]! >> shift) & mask;
        const pOff = idx * 3;
        onPixel(
          px,
          y,
          palette?.[pOff] ?? 0,
          palette?.[pOff + 1] ?? 0,
          palette?.[pOff + 2] ?? 0,
          trns && idx < trns.length ? trns[idx]! : 255
        );
      }
      curRow.copy(prevRow);
    }
    return pos;
  }

  const bpp = getBytesPerPixelForColorType(colorType, bitDepth);
  const stride = passWidth * bpp;
  const prevRow = Buffer.alloc(stride);
  const curRow = Buffer.alloc(stride);

  for (let y = 0; y < passHeight; y++) {
    const filterType = inflated[pos++]!;
    for (let x = 0; x < stride; x++) {
      const rawByte = inflated[pos++]!;
      const a = x >= bpp ? curRow[x - bpp]! : 0;
      const b = prevRow[x]!;
      const c = x >= bpp ? prevRow[x - bpp]! : 0;
      curRow[x] = applyPngFilter(filterType, rawByte, a, b, c);
    }

    for (let px = 0; px < passWidth; px++) {
      const inOff = px * bpp;
      if (colorType === 6) {
        onPixel(px, y, curRow[inOff]!, curRow[inOff + 1]!, curRow[inOff + 2]!, curRow[inOff + 3]!);
      } else if (colorType === 2) {
        const r = curRow[inOff]!;
        const g = curRow[inOff + 1]!;
        const b = curRow[inOff + 2]!;
        const isTransparentKey =
          trns !== undefined &&
          trns.length >= 6 &&
          r === trns.readUInt16BE(0) &&
          g === trns.readUInt16BE(2) &&
          b === trns.readUInt16BE(4);
        onPixel(px, y, r, g, b, isTransparentKey ? 0 : 255);
      } else if (colorType === 3) {
        const idx = curRow[inOff]!;
        const pOff = idx * 3;
        onPixel(
          px,
          y,
          palette?.[pOff] ?? 0,
          palette?.[pOff + 1] ?? 0,
          palette?.[pOff + 2] ?? 0,
          trns && idx < trns.length ? trns[idx]! : 255
        );
      } else if (colorType === 4) {
        const v = curRow[inOff]!;
        onPixel(px, y, v, v, v, curRow[inOff + 1]!);
      } else {
        const v = curRow[inOff]!;
        const isTransparentGray = trns !== undefined && trns.length >= 2 && v === trns.readUInt16BE(0);
        onPixel(px, y, v, v, v, isTransparentGray ? 0 : 255);
      }
    }
    curRow.copy(prevRow);
  }
  return pos;
}

function decodePngToRgba(filePath: string): RgbaImage {
  const buf = readFileSync(filePath);
  if (buf.length < 24 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error(`Not a valid PNG: ${filePath}`);
  }

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette: Buffer | undefined;
  let trns: Buffer | undefined;
  const idatChunks: Buffer[] = [];

  let offset = 8;
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkData = buf.subarray(dataStart, dataEnd);
    offset = dataEnd + 4;

    if (type === 'IHDR') {
      width = chunkData.readUInt32BE(0);
      height = chunkData.readUInt32BE(4);
      bitDepth = chunkData[8]!;
      colorType = chunkData[9]!;
      interlace = chunkData[12]!;
      if (interlace !== 0 && interlace !== 1) {
        throw new Error(`Unsupported PNG interlace=${interlace}: ${filePath}`);
      }
    } else if (type === 'PLTE') {
      palette = chunkData;
    } else if (type === 'tRNS') {
      trns = chunkData;
    } else if (type === 'IDAT') {
      idatChunks.push(chunkData);
    } else if (type === 'IEND') {
      break;
    }
  }

  const inflated = inflateSync(Buffer.concat(idatChunks));
  const rgba = Buffer.alloc(width * height * BYTES_PER_PIXEL);

  const writePixel = (gx: number, gy: number, r: number, g: number, b: number, a: number): void => {
    const outOff = (gy * width + gx) * 4;
    rgba[outOff] = r;
    rgba[outOff + 1] = g;
    rgba[outOff + 2] = b;
    rgba[outOff + 3] = a;
  };

  if (interlace === 0) {
    decodeScanlinesToRgba(inflated, 0, width, height, colorType, bitDepth, palette, trns, writePixel);
    return { width, height, data: rgba };
  }

  let cursor = 0;
  for (const [xStart, xStep, yStart, yStep] of ADAM7_PASSES) {
    const passWidth = width > xStart ? Math.ceil((width - xStart) / xStep) : 0;
    const passHeight = height > yStart ? Math.ceil((height - yStart) / yStep) : 0;
    cursor = decodeScanlinesToRgba(
      inflated,
      cursor,
      passWidth,
      passHeight,
      colorType,
      bitDepth,
      palette,
      trns,
      (px, py, r, g, b, a) => {
        writePixel(xStart + px * xStep, yStart + py * yStep, r, g, b, a);
      }
    );
  }

  return { width, height, data: rgba };
}

function applyPngFilter(filterType: number, rawByte: number, a: number, b: number, c: number): number {
  switch (filterType) {
    case 0:
      return rawByte & 0xff;
    case 1:
      return (rawByte + a) & 0xff;
    case 2:
      return (rawByte + b) & 0xff;
    case 3:
      return (rawByte + Math.floor((a + b) / 2)) & 0xff;
    case 4:
      return (rawByte + paethPredictor(a, b, c)) & 0xff;
    default:
      throw new Error(`Unsupported PNG filter type=${filterType}`);
  }
}

interface SourceEntry {
  readonly filePath: string;
  readonly id: string;
  readonly relKey: string;
}

function slugifyPath(relPath: string): string {
  return relPath
    .replace(/\.png$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function walkPngFiles(dir: string): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkPngFiles(full));
    } else if (entry.name.toLowerCase().endsWith('.png')) {
      results.push(full);
    }
  }
  return results;
}

function collectSheetSources(): Readonly<Record<string, ReadonlyArray<SourceEntry>>> {
  const sheets: Record<string, SourceEntry[]> = {
    dungeon: [],
    monsters: [],
    items: [],
    actors: [],
    effects: [],
    spells: [],
    misc: [],
    gui: [],
    player_layers: []
  };

  const pushFiles = (sheetId: string, rootDir: string, prefix: string, filterFn?: (rel: string) => boolean): void => {
    const list = walkPngFiles(rootDir);
    for (const filePath of list) {
      const rel = relative(rootDir, filePath).replace(/\\/g, '/');
      if (filterFn && !filterFn(rel)) continue;
      sheets[sheetId]!.push({
        filePath,
        id: `${prefix}_${slugifyPath(rel)}`,
        relKey: `${prefix}/${rel}`
      });
    }
  };

  pushFiles('dungeon', join(DCSS_FULL_ROOT, 'dungeon'), 'dcss_dungeon');
  pushFiles('monsters', join(DCSS_FULL_ROOT, 'monster'), 'dcss_monster');
  pushFiles('items', join(DCSS_FULL_ROOT, 'item'), 'dcss_item');
  pushFiles('actors', join(DCSS_FULL_ROOT, 'player', 'base'), 'dcss_actor');
  pushFiles('player_layers', join(DCSS_FULL_ROOT, 'player'), 'dcss_player', (rel) => !rel.startsWith('base/'));
  pushFiles('effects', join(DCSS_FULL_ROOT, 'effect'), 'dcss_effect');
  pushFiles('spells', join(DCSS_FULL_ROOT, 'gui', 'spells'), 'dcss_spell');
  pushFiles('spells', DCSS_SPELLS_ALT_ROOT, 'dcss_spell_alt');
  pushFiles('misc', join(DCSS_FULL_ROOT, 'misc'), 'dcss_misc');
  pushFiles('misc', join(DCSS_FULL_ROOT, 'emissaries'), 'dcss_emissary');
  pushFiles('gui', join(DCSS_FULL_ROOT, 'gui'), 'dcss_gui', (rel) => !rel.startsWith('spells/'));

  return sheets;
}

/**
 * Canonical `32rogues` spriteId aliases mapped to DCSS relative keys (`<prefix>/<relPath>`)
 * so existing campaigns (`default`, `dnd35e-crypt`, `realms-of-shroudgarde`) and D&D 3.5e
 * SRD content render cleanly under `dcss` standalone or with `32rogues` fallback.
 */
const CANONICAL_ALIASES: Readonly<Record<string, string>> = {
  // Actors (humanoid base & iconic DCSS characters)
  actor_rogue: 'dcss_monster/deep_elf_blademaster.png',
  actor_knight: 'dcss_monster/hell_knight_new.png',
  actor_shield_knight: 'dcss_monster/holy/paladin.png',
  actor_female_war_cleric: 'dcss_monster/deep_elf_priest.png',
  actor_male_wizard: 'dcss_monster/necromancer_new.png',
  actor_ranger: 'dcss_monster/deep_elf_master_archer.png',
  actor_fencer: 'dcss_monster/unique/edmund_new.png',
  actor_barbarian: 'dcss_monster/unique/crazy_yiuf.png',
  actor_male_barbarian: 'dcss_monster/unique/crazy_yiuf.png',
  actor_shopkeep: 'dcss_monster/human_new.png',
  actor_blacksmith: 'dcss_monster/deep_dwarf.png',
  actor_scholar: 'dcss_monster/unique/boris_new.png',
  actor_peasant: 'dcss_monster/human_slave.png',
  actor_bandit: 'dcss_monster/unique/duane.png',

  // Monsters
  monster_cultist: 'dcss_monster/deep_elf_demonologist.png',
  monster_death_knight: 'dcss_monster/death_knight.png',
  monster_dragon: 'dcss_monster/golden_dragon.png',
  monster_dryad: 'dcss_monster/dryad.png',
  monster_ettin: 'dcss_monster/ettin_new.png',
  monster_two_headed_ettin: 'dcss_monster/ettin_old.png',
  monster_faceless_monk: 'dcss_monster/human_monk_ghost.png',
  monster_forest_spirit: 'dcss_monster/fungi_plants/treant.png',
  monster_ghoul: 'dcss_monster/undead/ghoul.png',
  monster_giant_rat: 'dcss_monster/animals/grey_rat.png',
  monster_giant_spider: 'dcss_monster/animals/wolf_spider_new.png',
  monster_goblin: 'dcss_monster/goblin_new.png',
  monster_goblin_archer: 'dcss_monster/hobgoblin_new.png',
  monster_goblin_brute: 'dcss_monster/big_kobold_new.png',
  monster_goblin_mage: 'dcss_monster/kobold_demonologist.png',
  monster_gorgon_medusa: 'dcss_monster/panlord/demon_head_medusa_top_new.png',
  monster_imp_devil: 'dcss_monster/demons/imp.png',
  monster_kobold_canine: 'dcss_monster/kobold_new.png',
  monster_large_myconid: 'dcss_monster/fungi_plants/wandering_mushroom_new.png',
  monster_lich: 'dcss_monster/undead/lich.png',
  monster_manticore: 'dcss_monster/manticore.png',
  monster_minotaur: 'dcss_monster/minotaur.png',
  monster_naga: 'dcss_monster/naga_mage.png',
  monster_orc: 'dcss_monster/orc_new.png',
  monster_orc_blademaster: 'dcss_monster/orc_knight_new.png',
  monster_orc_warchief: 'dcss_monster/orc_warlord.png',
  monster_orc_wizard: 'dcss_monster/orc_wizard_new.png',
  monster_rock_golem: 'dcss_monster/nonliving/clay_golem.png',
  monster_skeleton: 'dcss_monster/undead/skeletons/skeleton_humanoid_small_new.png',
  monster_skeleton_archer: 'dcss_monster/undead/skeletons/skeleton_humanoid_large_new.png',
  monster_troll: 'dcss_monster/deep_troll.png',
  monster_unholy_cardinal: 'dcss_monster/deep_elf_high_priest.png',
  monster_warg_dire_wolf: 'dcss_monster/animals/warg.png',
  monster_wraith: 'dcss_monster/undead/wraith.png',
  monster_zombie: 'dcss_monster/undead/necrophage_new.png',

  // Tiles & Props
  tile_empty: 'dcss_dungeon/floor/cobble_blood_1_new.png',
  tile_blank_floor_dark_grey: 'dcss_dungeon/floor/grey_dirt_6_old.png',
  tile_blank_blue_floor: 'dcss_dungeon/floor/crypt_10.png',
  tile_blue_stone_floor_1_blue_bg: 'dcss_dungeon/floor/crypt_11.png',
  tile_red_stone_floor_1_red_bg: 'dcss_dungeon/floor/cobble_blood_5_new.png',
  tile_floor_stone_1: 'dcss_dungeon/floor/pebble_brown_2_old.png',
  tile_floor_stone_2: 'dcss_dungeon/floor/cobble_blood_2_new.png',
  tile_stone_floor_1: 'dcss_dungeon/floor/floor_sand_stone_0.png',
  tile_dirt_1: 'dcss_dungeon/floor/dirt_0_new.png',
  tile_dirt_1_green_bg: 'dcss_dungeon/floor/lair_2_old.png',
  tile_grass_1: 'dcss_dungeon/floor/grass/grass_flowers_blue_3_new.png',
  tile_rough_stone_wall_top: 'dcss_dungeon/wall/stone_2_gray0.png',
  tile_stone_brick_wall_top: 'dcss_dungeon/wall/stone_brick_2.png',
  tile_igneous_wall_top: 'dcss_dungeon/wall/brick_brown_0.png',
  tile_catacombs_skull_wall_top: 'dcss_dungeon/wall/brick_dark_0.png',
  tile_door_1: 'dcss_dungeon/doors/closed_door.png',
  tile_framed_door_1_shut: 'dcss_dungeon/doors/closed_door.png',
  tile_framed_door_1_open: 'dcss_dungeon/doors/open_door.png',
  tile_grated_door: 'dcss_dungeon/doors/gate_closed_middle.png',
  tile_staircase_down: 'dcss_dungeon/gateways/stone_stairs_down.png',
  tile_staircase_up: 'dcss_dungeon/gateways/stone_stairs_up.png',
  tile_chest_closed: 'dcss_dungeon/chest_2_closed.png',
  tile_chest_open: 'dcss_dungeon/chest_2_open.png',
  tile_sarcophagus_closed: 'dcss_dungeon/vaults/sarcophagus_sealed.png',
  tile_barrel: 'dcss_dungeon/large_box.png',
  tile_jar_closed: 'dcss_dungeon/altars/altar_base.png',
  tile_bone_1: 'dcss_dungeon/floor/green_bones_1.png',
  tile_corpse_bones_1: 'dcss_dungeon/floor/green_bones_2.png',
  tile_blood_spatter_1: 'dcss_misc/blood/blood_red_1_new.png',
  tile_large_rock_1: 'dcss_dungeon/boulder.png',
  tile_pentagram: 'dcss_dungeon/altars/altar_lugonu.png',
  tile_pit: 'dcss_dungeon/traps/shadow.png',
  tile_pressure_plate_up: 'dcss_dungeon/traps/pressure_plate.png',
  tile_spikes_down: 'dcss_dungeon/traps/trap_spear.png',
  tile_slime_large: 'dcss_monster/amorphous/jelly.png',
  tile_slime_small: 'dcss_monster/amorphous/azure_jelly_new.png',
  tile_tree: 'dcss_dungeon/trees/tree_1_yellow.png',

  // Items
  item_ankh: 'dcss_item/amulet/celtic_yellow.png',
  item_apple: 'dcss_item/food/apple.png',
  item_bread: 'dcss_item/food/bread_ration_new.png',
  item_blue_staff: 'dcss_item/staff/staff_0.png',
  item_crystal_staff: 'dcss_item/staff/staff_1.png',
  item_druid_staff: 'dcss_item/staff/staff_2.png',
  item_flame_staff: 'dcss_item/staff/staff_3.png',
  item_book: 'dcss_item/book/dark_gray_new.png',
  item_red_book: 'dcss_item/book/manual_1.png',
  item_chain_mail: 'dcss_item/armor/torso/chain_mail_1.png',
  item_cloth_armor: 'dcss_item/armor/torso/robe_1_new.png',
  item_leather_armor: 'dcss_item/armor/torso/leather_armor_1.png',
  item_scale_mail: 'dcss_item/armor/torso/elven_scalemail.png',
  item_crystal_pendant: 'dcss_item/amulet/crystal_green.png',
  item_dagger: 'dcss_item/weapon/dagger_new.png',
  item_kukri: 'dcss_item/weapon/cutlass_1.png',
  item_long_sword: 'dcss_item/weapon/long_sword_1_new.png',
  item_short_sword: 'dcss_item/weapon/short_sword_1_new.png',
  item_mace_1: 'dcss_item/weapon/mace_1_new.png',
  item_gold_key: 'dcss_item/misc/key.png',
  item_metal_key: 'dcss_item/misc/key.png',
  item_primitive_key: 'dcss_item/misc/key.png',
  item_coin: 'dcss_item/gold/gold_pile_1.png',
  item_coin_purse: 'dcss_item/gold/gold_pile_10.png',
  item_green_potion: 'dcss_item/potion/emerald.png',
  item_orange_potion: 'dcss_item/potion/orange_new.png',
  item_red_potion: 'dcss_item/potion/ruby_new.png',
  item_page: 'dcss_item/scroll/blank_paper.png',
  item_scroll: 'dcss_item/scroll/scroll-brown.png',
  item_scroll_2: 'dcss_item/scroll/scroll-blue.png',
  item_round_shield: 'dcss_item/armor/shields/buckler_1_new.png',
  item_silver_signet_ring: 'dcss_item/ring/moonstone.png'
};

function parseDcssContributors(readmeText: string): string[] {
  const contributors: string[] = [];
  for (const rawLine of readmeText.split(/\r?\n/)) {
    const m = rawLine.match(/^\s*-\s+(.+?)\s*$/);
    if (m?.[1]) {
      contributors.push(m[1].trim());
    }
  }
  return contributors;
}

function buildDcssAttribution(): SpritePackAttribution {
  const readmePath = join(DCSS_FULL_ROOT, 'README.txt');
  const readmeText = readFileSync(readmePath, 'utf-8');
  return {
    author: 'Dungeon Crawl Stone Soup Tile Artists',
    license: 'CC0-1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/legalcode',
    sourceUrl: 'https://github.com/crawl/tiles/tree/master/releases',
    notes:
      'Combined CC0 32x32 sprites and tiles from Dungeon Crawl Stone Soup Full and crawl-tiles Oct-5-2010 (originally evolved from public-domain RLTiles).',
    contributors: parseDcssContributors(readmeText)
  };
}

function main(): void {
  mkdirSync(OUT_SHEETS_DIR, { recursive: true });

  const sheetSources = collectSheetSources();
  const spriteSheets: Record<string, SpriteSheetSource> = {};
  const locationByRelKey = new Map<string, { readonly sheetId: string; readonly coords: [number, number] }>();
  let totalPacked = 0;

  for (const [sheetId, entries] of Object.entries(sheetSources)) {
    if (entries.length === 0) continue;

    const cols = Math.min(ATLAS_COLUMNS, Math.max(1, entries.length));
    const rows = Math.ceil(entries.length / cols);
    const atlasWidth = cols * TILE_PX;
    const atlasHeight = rows * TILE_PX;
    const atlasBuf = Buffer.alloc(atlasWidth * atlasHeight * BYTES_PER_PIXEL);

    const tileMap: Record<string, [number, number]> = {};
    const usedIds = new Set<string>();

    for (let idx = 0; idx < entries.length; idx++) {
      const entry = entries[idx]!;
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const ox = col * TILE_PX;
      const oy = row * TILE_PX;

      const decoded = decodePngToRgba(entry.filePath);
      if (decoded.width !== TILE_PX || decoded.height !== TILE_PX) {
        throw new Error(
          `Expected 32x32 PNG in "${sheetId}", got ${decoded.width}x${decoded.height} at ${entry.filePath}`
        );
      }

      for (let py = 0; py < TILE_PX; py++) {
        const srcRowStart = py * TILE_PX * BYTES_PER_PIXEL;
        const srcRowEnd = srcRowStart + TILE_PX * BYTES_PER_PIXEL;
        const dstOffset = ((oy + py) * atlasWidth + ox) * BYTES_PER_PIXEL;
        decoded.data.copy(atlasBuf, dstOffset, srcRowStart, srcRowEnd);
      }

      let finalId = entry.id;
      let dupCounter = 1;
      while (usedIds.has(finalId)) {
        finalId = `${entry.id}_${dupCounter}`;
        dupCounter++;
      }
      usedIds.add(finalId);
      tileMap[finalId] = [ox, oy];
      locationByRelKey.set(entry.relKey, { sheetId, coords: [ox, oy] });
      totalPacked++;
    }

    const relPngPath = `sheets/${sheetId}.png`;
    writeFileSync(join(OUT_PACK_DIR, relPngPath), encodeRgbaPng(atlasWidth, atlasHeight, atlasBuf));

    spriteSheets[sheetId] = {
      src: relPngPath,
      tileWidth: TILE_PX,
      tileHeight: TILE_PX,
      tileMap
    };
    console.log(`Packed "${sheetId}" (${entries.length} sprites, ${atlasWidth}x${atlasHeight}) -> ${relPngPath}`);
  }

  for (const [aliasId, relKey] of Object.entries(CANONICAL_ALIASES)) {
    const loc = locationByRelKey.get(relKey);
    if (!loc) {
      throw new Error(`Canonical alias "${aliasId}" points to missing DCSS asset "${relKey}"`);
    }
    const sheet = spriteSheets[loc.sheetId]!;
    sheet.tileMap[aliasId] = loc.coords;
  }

  copyFileSync(join(DCSS_FULL_ROOT, 'LICENSE.txt'), join(OUT_PACK_DIR, 'LICENSE.txt'));
  copyFileSync(join(DCSS_FULL_ROOT, 'README.txt'), join(OUT_PACK_DIR, 'NOTICE.txt'));

  const pack: SpritePack = {
    id: 'dcss',
    name: 'Dungeon Crawl Stone Soup (CC0 32x32)',
    description:
      'Complete CC0 32x32 roguelike tileset featuring dungeon terrain, monsters, items, actors, paperdoll layers, spells, effects, and UI icons.',
    attribution: buildDcssAttribution(),
    spriteSheets
  };

  writeFileSync(join(OUT_PACK_DIR, 'pack.json'), JSON.stringify(pack, null, 2) + '\n');
  console.log(
    `Generated ${join(OUT_PACK_DIR, 'pack.json')} (${totalPacked} unique sprites + ${Object.keys(CANONICAL_ALIASES).length} canonical aliases across ${Object.keys(spriteSheets).length} sheets).`
  );
}

main();
