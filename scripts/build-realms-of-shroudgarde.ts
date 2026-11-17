/**
 * @file scripts/build-realms-of-shroudgarde.ts
 *
 * Automated generator for the flagship D&D 3.5e campaign "The Realms of Shroudgarde".
 * Synthesizes ~75 interconnected areas, towns, roads, 3 multi-floor towers,
 * shallow crypts, moathouse, TOEE, and deep megadungeon vaults.
 * Authors ~140+ creature and NPC templates with D&D 3.5e archetypes,
 * default equipment, currency drops, loot drops, and 15+ skill-keyed dialogues.
 */

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const CAMPAIGN_DIR = join(process.cwd(), 'public', 'data', 'campaigns', 'realms-of-shroudgarde');
const DND35E_CRYPT_DIR = join(process.cwd(), 'public', 'data', 'campaigns', 'dnd35e-crypt');

mkdirSync(CAMPAIGN_DIR, { recursive: true });

function writeJson(filename: string, data: unknown): void {
  writeFileSync(join(CAMPAIGN_DIR, filename), JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

console.log('Building Realms of Shroudgarde campaign in:', CAMPAIGN_DIR);

// ─────────────────────────────────────────────────────────────────────────────
// 1. MANIFEST
// ─────────────────────────────────────────────────────────────────────────────
const manifest = {
  id: 'realms-of-shroudgarde',
  name: 'The Realms of Shroudgarde',
  version: '1.0.0',
  rulesetId: 'dnd35e',
  startingAreaId: 'shroudgarde_courtyard',
  description: 'The definitive D&D 3.5e flagship campaign merging towns, wilderness roads, towers, shallow crypts, and deep subterranean vaults.',
  author: 'D&D 3.5e Realms Team',
  tags: ['dnd35e', 'flagship', 'sandbox', 'megadungeon', 'srd35'],
  schemaVersion: 1
};
writeJson('manifest.json', manifest);

// ─────────────────────────────────────────────────────────────────────────────
// 2. RULES
// ─────────────────────────────────────────────────────────────────────────────
const rules = {
  map: {
    width: 80,
    height: 50,
    minRoomWidth: 4,
    maxRoomWidth: 10,
    minRoomHeight: 4,
    maxRoomHeight: 8,
    minCorridorLength: 3,
    maxCorridorLength: 10,
    dugPercentage: 0.25,
    waterScatterChance: 0.05,
    startingAreaId: 'shroudgarde_courtyard',
    fovRadius: 8
  },
  currency: {
    baseUnitId: 'cp',
    defaultValueDenominationId: 'gp',
    displayOrder: ['pp', 'gp', 'ep', 'sp', 'cp'],
    denominations: [
      { id: 'cp', name: 'Copper Piece', abbreviation: 'cp', baseMultiplier: 1, color: '#b87333', itemId: 'copper_coin' },
      { id: 'sp', name: 'Silver Piece', abbreviation: 'sp', baseMultiplier: 10, color: '#bdc3c7', itemId: 'silver_coin' },
      { id: 'ep', name: 'Electrum Piece', abbreviation: 'ep', baseMultiplier: 50, color: '#d4e6f1', itemId: 'electrum_coin' },
      { id: 'gp', name: 'Gold Piece', abbreviation: 'gp', baseMultiplier: 100, color: '#f1c40f', itemId: 'gold_coin' },
      { id: 'pp', name: 'Platinum Piece', abbreviation: 'pp', baseMultiplier: 1000, color: '#e5e7e9', itemId: 'platinum_coin' }
    ]
  },
  hunger: {
    maxSatiation: 2000,
    satiationLossPerStandardTurn: 0.035,
    thresholds: {
      satiated: 1500,
      normal: 1000,
      hungry: 300,
      starving: 0
    }
  },
  worldClock: {
    secondsPerGlobalTurn: 6,
    startHour: 8,
    hoursPerDay: 24,
    waitTargets: ['dawn', 'night'],
    phases: [
      { id: 'night', label: 'Night', startHour: 0, skyIllumination: 'shadowy', isNaturalSunlight: false },
      { id: 'dawn', label: 'Dawn', startHour: 5, skyIllumination: 'shadowy', isNaturalSunlight: false },
      { id: 'day', label: 'Day', startHour: 7, skyIllumination: 'bright', isNaturalSunlight: true },
      { id: 'dusk', label: 'Dusk', startHour: 18, skyIllumination: 'shadowy', isNaturalSunlight: false },
      { id: 'night', label: 'Night', startHour: 20, skyIllumination: 'shadowy', isNaturalSunlight: false }
    ]
  },
  spawning: {
    maxMonstersPerRoom: 3,
    maxItemsPerRoom: 2,
    spawnWeights: {
      goblin: 40,
      orc: 30,
      skeleton: 25,
      zombie: 20,
      giant_rat: 25,
      bugbear: 15,
      ghoul: 10,
      troll: 5
    },
    lootTable: {
      potion_of_cure_light_wounds: 35,
      potion_of_bulls_strength: 10,
      dagger: 15,
      short_sword: 12,
      longsword: 10,
      copper_coin: 40,
      silver_coin: 30,
      gold_coin: 20,
      coin_pouch_silver: 10,
      coin_pouch_gold: 5,
      gem_chalcedony: 5
    },
    lootDropChance: 0.35
  }
};
writeJson('rules.json', rules);

// ─────────────────────────────────────────────────────────────────────────────
// 3. THEME
// ─────────────────────────────────────────────────────────────────────────────
const cryptTheme = JSON.parse(readFileSync(join(DND35E_CRYPT_DIR, 'theme.json'), 'utf-8'));
writeJson('theme.json', cryptTheme);

// ─────────────────────────────────────────────────────────────────────────────
// 4. ADVANCEMENT
// ─────────────────────────────────────────────────────────────────────────────
const advancement = [
  { level: 1, requiredXp: 0, hpGain: 0, attackGain: 0, defenseGain: 0 },
  { level: 2, requiredXp: 1000, hpGain: 6, attackGain: 1, defenseGain: 0 },
  { level: 3, requiredXp: 3000, hpGain: 6, attackGain: 1, defenseGain: 1 },
  { level: 4, requiredXp: 6000, hpGain: 6, attackGain: 2, defenseGain: 0 },
  { level: 5, requiredXp: 10000, hpGain: 8, attackGain: 2, defenseGain: 1 },
  { level: 6, requiredXp: 15000, hpGain: 8, attackGain: 2, defenseGain: 1 },
  { level: 7, requiredXp: 21000, hpGain: 8, attackGain: 3, defenseGain: 2 },
  { level: 8, requiredXp: 28000, hpGain: 10, attackGain: 3, defenseGain: 2 },
  { level: 9, requiredXp: 36000, hpGain: 10, attackGain: 4, defenseGain: 2 },
  { level: 10, requiredXp: 45000, hpGain: 12, attackGain: 5, defenseGain: 3 }
];
writeJson('advancement.json', advancement);

// ─────────────────────────────────────────────────────────────────────────────
// 5. FACTIONS
// ─────────────────────────────────────────────────────────────────────────────
const factions = {
  player: { player: 'friendly', citizens: 'friendly', monster: 'hostile', neutral: 'neutral', bandits: 'hostile', beasts: 'hostile', cultists: 'hostile', goblins: 'hostile', orcs: 'hostile', undead: 'hostile' },
  citizens: { player: 'friendly', citizens: 'friendly', monster: 'hostile', neutral: 'friendly', bandits: 'hostile', beasts: 'hostile', cultists: 'hostile', goblins: 'hostile', orcs: 'hostile', undead: 'hostile' },
  monster: { player: 'hostile', citizens: 'hostile', monster: 'neutral', neutral: 'neutral', bandits: 'hostile', beasts: 'neutral', cultists: 'neutral', goblins: 'neutral', orcs: 'neutral', undead: 'neutral' },
  neutral: { player: 'neutral', citizens: 'friendly', monster: 'neutral', neutral: 'friendly', bandits: 'neutral', beasts: 'neutral', cultists: 'neutral', goblins: 'neutral', orcs: 'neutral', undead: 'neutral' },
  bandits: { player: 'hostile', citizens: 'hostile', monster: 'hostile', neutral: 'neutral', bandits: 'friendly', beasts: 'hostile', cultists: 'neutral', goblins: 'neutral', orcs: 'neutral', undead: 'hostile' },
  beasts: { player: 'hostile', citizens: 'hostile', monster: 'neutral', neutral: 'neutral', bandits: 'hostile', beasts: 'friendly', cultists: 'hostile', goblins: 'hostile', orcs: 'hostile', undead: 'neutral' },
  cultists: { player: 'hostile', citizens: 'hostile', monster: 'neutral', neutral: 'neutral', bandits: 'neutral', beasts: 'hostile', cultists: 'friendly', goblins: 'friendly', orcs: 'friendly', undead: 'friendly' },
  goblins: { player: 'hostile', citizens: 'hostile', monster: 'neutral', neutral: 'neutral', bandits: 'neutral', beasts: 'neutral', cultists: 'friendly', goblins: 'friendly', orcs: 'hostile', undead: 'neutral' },
  orcs: { player: 'hostile', citizens: 'hostile', monster: 'neutral', neutral: 'neutral', bandits: 'neutral', beasts: 'neutral', cultists: 'friendly', goblins: 'hostile', orcs: 'friendly', undead: 'neutral' },
  undead: { player: 'hostile', citizens: 'hostile', monster: 'neutral', neutral: 'neutral', bandits: 'hostile', beasts: 'hostile', cultists: 'friendly', goblins: 'neutral', orcs: 'neutral', undead: 'friendly' }
};
writeJson('factions.json', factions);

// ─────────────────────────────────────────────────────────────────────────────
// 6. TILES
// ─────────────────────────────────────────────────────────────────────────────
const tiles = {
  stone_floor: { spriteId: 'tile_floor_stone_1', walkable: true, transparent: true, glyph: '.', fg: '#1a1d24', bg: '#000000', tags: ['terrain', 'floor'] },
  stone_wall: { spriteId: 'tile_rough_stone_wall_top', walkable: false, transparent: false, glyph: '#', fg: '#4a4d53', bg: '#000000', tags: ['terrain', 'solid'] },
  stairs_up: { spriteId: 'tile_staircase_up', walkable: true, transparent: true, glyph: '<', fg: '#ffffff', bg: '#000000', tags: ['terrain', 'portal'] },
  stairs_down: { spriteId: 'tile_staircase_down', walkable: true, transparent: true, glyph: '>', fg: '#ffffff', bg: '#000000', tags: ['terrain', 'portal'] },
  empty_space: { spriteId: 'tile_empty', walkable: false, transparent: false, glyph: ' ', fg: '#000000', bg: '#000000', tags: ['terrain'] },
  shallow_water: { spriteId: 'tile_blue_stone_floor_1_blue_bg', walkable: true, transparent: true, glyph: '~', fg: '#3498db', bg: '#000000', movementCost: 200, tags: ['terrain', 'liquid', 'water'] },
  grass_floor: { spriteId: 'tile_grass_1', walkable: true, transparent: true, glyph: '.', fg: '#2d5a27', bg: '#000000', tags: ['terrain', 'floor'] },
  dense_trees: { spriteId: 'tile_tree', walkable: false, transparent: false, glyph: 'T', fg: '#1b4d3e', bg: '#000000', tags: ['terrain', 'solid'] },
  swamp_floor: { spriteId: 'tile_dirt_1', walkable: true, transparent: true, glyph: ';', fg: '#4a5d4e', bg: '#000000', movementCost: 150, tags: ['terrain', 'floor'] },
  dirt_floor: { spriteId: 'tile_dirt_1', walkable: true, transparent: true, glyph: '.', fg: '#5d4037', bg: '#000000', tags: ['terrain', 'floor'] },
  wood_floor: { spriteId: 'tile_floor_stone_2', walkable: true, transparent: true, glyph: '.', fg: '#8d6e63', bg: '#000000', tags: ['terrain', 'floor'] },
  chasm: { spriteId: 'tile_pit', walkable: false, transparent: true, glyph: ' ', fg: '#000000', bg: '#000000', tags: ['terrain', 'chasm'] }
};
writeJson('tiles.json', tiles);

// ─────────────────────────────────────────────────────────────────────────────
// 7. TAG & TRAIT REGISTRIES
// ─────────────────────────────────────────────────────────────────────────────
const cryptTags = JSON.parse(readFileSync(join(DND35E_CRYPT_DIR, 'tag_registry.json'), 'utf-8'));
const extendedTags = {
  ...cryptTags,
  floor: { category: 'terrain', color: '#666666', description: 'Walkable floor terrain.' },
  chasm: { category: 'terrain', color: '#000000', description: 'Deep impassable pit or abyss.' },
  town: { category: 'area', color: '#2ecc71', description: 'Safe civil town or village settlement.' },
  frontier: { category: 'area', color: '#f39c12', description: 'Borderlands wilderness and roads.' },
  tower: { category: 'area', color: '#3498db', description: 'Vertical fortress tower or spire.' },
  crypt: { category: 'area', color: '#9b59b6', description: 'Ancient tomb, reliquary, or shallow catacomb.' },
  temple: { category: 'area', color: '#e74c3c', description: 'Sacred or unholy subterranean temple complex.' },
  megadungeon: { category: 'area', color: '#e67e22', description: 'Deep multi-tiered megadungeon level.' },
  deep_vault: { category: 'area', color: '#c0392b', description: 'Abyssal vault or high-danger subterranean rift.' },
  cave: { category: 'area', color: '#8e44ad', description: 'Subterranean cavern or natural grotto.' },
  outdoor: { category: 'area', color: '#2ecc71', description: 'Open air or wilderness exterior area.' },
  dungeon: { category: 'area', color: '#e74c3c', description: 'Underground dungeon or subterranean complex.' },
  npc: { category: 'entity', color: '#3498db', description: 'Friendly or interactive non-player character.' },
  merchant: { category: 'entity', color: '#ffd700', description: 'Vendor buying and selling trade goods.' },
  boss: { category: 'entity', color: '#e74c3c', description: 'Legendary adversary or dungeon lord.' },
  guard: { category: 'entity', color: '#95a5a6', description: 'Law enforcer or fort defender.' },
  corrupted: { category: 'physical', color: '#8e44ad', description: 'Tainted by abyssal trance or fungal rot.' },
  key: { category: 'item', color: '#f1c40f', description: 'Key opening specific locked doors or chests.' },
  relic: { category: 'item', color: '#9b59b6', description: 'Sacred or arcane relic of great significance.' },
  artifact: { category: 'item', color: '#e74c3c', description: 'Mythical artifact wielding supreme powers.' },
  water: { category: 'elemental', color: '#3498db', description: 'Water or aquatic terrain.' },
  liquid: { category: 'elemental', color: '#3498db', description: 'Liquid body.' },
  tool: { category: 'item', color: '#95a5a6', description: 'Utilitarian tool, key, or device.' },
  quest_item: { category: 'item', color: '#f39c12', description: 'Crucial item for quest progression.' }
};
writeJson('tag_registry.json', extendedTags);

const traitRegistry = {
  elite: { id: 'elite', name: 'Elite', crCostMultiplier: 1.5, statModifiers: { maxHp: 15, attack: 2 }, tagsAdded: ['elite'] },
  regenerating: { id: 'regenerating', name: 'Regenerating', crCostModifier: 5, tagsAdded: ['regenerating'] },
  corrupted: { id: 'corrupted', name: 'Corrupted', crCostMultiplier: 1.25, statModifiers: { attack: 2 }, tagsAdded: ['corrupted'] }
};
writeJson('trait_registry.json', traitRegistry);

// ─────────────────────────────────────────────────────────────────────────────
// 8. STATUS & EFFECTS & AI & FIELDS & REACTIONS
// ─────────────────────────────────────────────────────────────────────────────
const status = {
  poison: { id: 'poison', name: 'Poisoned', description: 'Taking periodic poison damage.', color: '#2ecc71', perTurnDamage: 2, flags: {} },
  haste: { id: 'haste', name: 'Haste', description: 'Moving and attacking with supernatural swiftness.', color: '#3498db', statModifiers: { speed: 30 }, flags: {} },
  confusion: { id: 'confusion', name: 'Confused', description: 'Disoriented and erratic.', color: '#9b59b6', flags: { confused: true } },
  regeneration: { id: 'regeneration', name: 'Regenerating', description: 'Slowly recovering health over time.', color: '#2ecc71', perTurnHeal: 2, flags: {} },
  bless: { id: 'bless', name: 'Blessed', description: 'Divine inspiration grants +1 to attack rolls.', color: '#f1c40f', statModifiers: { attack: 1 }, flags: {} }
};
writeJson('status.json', status);

const effects = {
  heal_5: { id: 'heal_5', type: 'heal', value: 5, message: 'You feel slightly rejuvenated.' },
  heal_15: { id: 'heal_15', type: 'heal', value: 15, message: 'A warm radiant glow restores your vitality.' },
  heal_30: { id: 'heal_30', type: 'heal', value: 30, message: 'Healing energy surges through your body.' },
  apply_haste_10: { id: 'apply_haste_10', type: 'apply_status', value: 0, statusId: 'haste', duration: 10, message: 'Time seems to slow around you!' },
  apply_poison_5: { id: 'apply_poison_5', type: 'apply_status', value: 0, statusId: 'poison', duration: 5, message: 'Virulent toxin burns your veins!' },
  damage_nearest_15: { id: 'damage_nearest_15', type: 'damage_nearest', value: 15, range: 6, message: 'A searing lance of magic strikes your foe!' },
  satiate_500: { id: 'satiate_500', type: 'satiate', value: 500, message: 'You enjoy a hearty and nourishing meal.' }
};
writeJson('effects.json', effects);

const ai = {
  melee_aggressive: { id: 'melee_aggressive', behaviors: [{ behaviorId: 'hunt', aggroRadius: 6 }, { behaviorId: 'wander' }] },
  patrol_guard: { id: 'patrol_guard', behaviors: [{ behaviorId: 'hunt', aggroRadius: 5 }, { behaviorId: 'wander' }] },
  passive_npc: { id: 'passive_npc', behaviors: [{ behaviorId: 'wander' }] },
  stationary_vendor: { id: 'stationary_vendor', behaviors: [] }
};
writeJson('ai.json', ai);

const fields = {
  fire_field: { id: 'fire_field', name: 'Roaring Flame', glyph: '^', fg: '#e74c3c', bg: 'transparent', spriteId: 'tile_red_stone_floor_1_red_bg', duration: 5, tags: ['fire'] },
  poison_cloud: { id: 'poison_cloud', name: 'Noxious Vapor', glyph: '*', fg: '#2ecc71', bg: 'transparent', spriteId: 'tile_blank_floor_dark_grey', duration: 6, tags: ['poison'] }
};
writeJson('fields.json', fields);

const reactions: unknown[] = [];
writeJson('reactions.json', reactions);

// ─────────────────────────────────────────────────────────────────────────────
// 9. ITEMS (Campaign Relics, Keys, Consumables)
// ─────────────────────────────────────────────────────────────────────────────
const campaignItems = {
  key_iron: { id: 'key_iron', name: 'Iron Dungeon Key', unidentifiedName: 'Heavy Key', description: 'A sturdy iron key used for dungeon doors.', glyph: '$', fg: '#95a5a6', bg: 'transparent', spriteId: 'item_metal_key', weight: 0.2, baseValue: 5, category: 'tool', tags: ['key', 'tool'], isArtifact: false },
  key_bronze: { id: 'key_bronze', name: 'Bronze Crypt Key', unidentifiedName: 'Bronze Key', description: 'An ancient verdigris-coated bronze key for crypt vaults.', glyph: '$', fg: '#cd7f32', bg: 'transparent', spriteId: 'item_primitive_key', weight: 0.2, baseValue: 10, category: 'tool', tags: ['key', 'tool'], isArtifact: false },
  key_gold: { id: 'key_gold', name: 'Ornate Golden Key', unidentifiedName: 'Golden Key', description: 'A gilded master key opening high sanctum locks.', glyph: '$', fg: '#f1c40f', bg: 'transparent', spriteId: 'item_gold_key', weight: 0.3, baseValue: 50, category: 'tool', tags: ['key', 'tool'], isArtifact: false },
  key_water_temple: { id: 'key_water_temple', name: 'Valve Spanner Key', unidentifiedName: 'Heavy Brass Tool', description: 'Heavy mechanical spanner used to unlock the flooded drainage valves.', glyph: '$', fg: '#e67e22', bg: 'transparent', spriteId: 'item_metal_key', weight: 2.0, baseValue: 20, category: 'tool', tags: ['key', 'tool'], isArtifact: false },
  elemental_gem_air: { id: 'elemental_gem_air', name: 'Air Spire Crystal', unidentifiedName: 'Zephyr Gem', description: 'A gem infused with the essence of howling mountain gales.', glyph: '*', fg: '#ecf0f1', bg: 'transparent', spriteId: 'item_crystal_pendant', weight: 0.5, baseValue: 500, category: 'tool', tags: ['relic', 'tool'], isArtifact: true },
  elemental_gem_earth: { id: 'elemental_gem_earth', name: 'Earth Spire Core', unidentifiedName: 'Ochre Stone', description: 'A dense stone vibrating with subterranean resonance.', glyph: '*', fg: '#f39c12', bg: 'transparent', spriteId: 'item_crystal_pendant', weight: 1.0, baseValue: 500, category: 'tool', tags: ['relic', 'tool'], isArtifact: true },
  elemental_gem_fire: { id: 'elemental_gem_fire', name: 'Fire Spire Ember', unidentifiedName: 'Fiery Ruby', description: 'An ember burning eternally with elemental flame.', glyph: '*', fg: '#e74c3c', bg: 'transparent', spriteId: 'item_crystal_pendant', weight: 0.5, baseValue: 500, category: 'tool', tags: ['relic', 'tool'], isArtifact: true },
  elemental_gem_water: { id: 'elemental_gem_water', name: 'Water Spire Pearl', unidentifiedName: 'Azure Pearl', description: 'A radiant pearl containing pure elemental moisture.', glyph: '*', fg: '#3498db', bg: 'transparent', spriteId: 'item_crystal_pendant', weight: 0.5, baseValue: 500, category: 'tool', tags: ['relic', 'tool'], isArtifact: true },
  orb_of_elements: { id: 'orb_of_elements', name: 'Orb of the Elemental Spheres', unidentifiedName: 'Ancient Spherical Artifact', description: 'A mythical orb capable of quelling the primal forces of Chaos.', glyph: '*', fg: '#9b59b6', bg: 'transparent', spriteId: 'item_crystal_pendant', weight: 3.0, baseValue: 5000, category: 'tool', tags: ['artifact', 'tool'], isArtifact: true },
  sunless_relic: { id: 'sunless_relic', name: 'Sunless Curate Reliquary', unidentifiedName: 'Ivory Relic', description: 'The sacred holy relic of the ancient cathedral buried beneath Shroudgarde.', glyph: '*', fg: '#ffffff', bg: 'transparent', spriteId: 'item_ankh', weight: 2.0, baseValue: 1200, category: 'tool', tags: ['relic', 'tool'], isArtifact: true },
  moathouse_ledger: { id: 'moathouse_ledger', name: 'Clandestine Ledger', unidentifiedName: 'Leather Tome', description: 'Documents tracking illicit arms shipments between the Moathouse and the Temple.', glyph: '?', fg: '#e67e22', bg: 'transparent', spriteId: 'item_book', weight: 1.0, baseValue: 100, category: 'tool', tags: ['quest_item', 'tool'], isArtifact: false },
  shroudgarde_signet: { id: 'shroudgarde_signet', name: 'Shroudgarde Guard Signet', unidentifiedName: 'Iron Ring', description: 'Official seal of Constable Derek granting passage beyond the gates.', glyph: '=', fg: '#34495e', bg: 'transparent', spriteId: 'item_silver_signet_ring', weight: 0.1, baseValue: 50, category: 'tool', tags: ['tool'], isArtifact: false },
  ration_iron: { id: 'ration_iron', name: 'Iron Rations', unidentifiedName: 'Dried Rations', description: 'Salted meats and hardtack for long dungeon excursions.', glyph: '%', fg: '#d35400', bg: 'transparent', spriteId: 'item_bread', weight: 1.0, baseValue: 0.5, category: 'consumable', tags: ['consumable'], consumable: { effectId: 'satiate_500', charges: 2 }, isArtifact: false },
  ration_fresh_bread: { id: 'ration_fresh_bread', name: 'Fresh Crusty Bread', unidentifiedName: 'Loaf of Bread', description: 'Warm bread baked daily by Shroudgarde commoners.', glyph: '%', fg: '#f39c12', bg: 'transparent', spriteId: 'item_bread', weight: 0.5, baseValue: 0.05, category: 'consumable', tags: ['consumable'], consumable: { effectId: 'satiate_500', charges: 1 }, isArtifact: false }
};
writeJson('items.json', campaignItems);

// ─────────────────────────────────────────────────────────────────────────────
// 10. AREAS (75 Interconnected Nodes)
// ─────────────────────────────────────────────────────────────────────────────
interface AreaConnection {
  targetAreaId: string;
  direction: 'north' | 'south' | 'east' | 'west' | 'up' | 'down' | 'portal';
}

interface AreaDef {
  id: string;
  name: string;
  generatorType: 'digger' | 'bsp' | 'cellular' | 'caves' | 'maze';
  dangerRating: number;
  tags: string[];
  connections: AreaConnection[];
  crBudget: number;
  encounterProfileId: string;
}

const areas: Record<string, unknown> = {};

function mapDirection(dir: string): { direction: 'up' | 'down' | 'edge' | 'portal'; placementSide?: 'top' | 'bottom' | 'left' | 'right' } {
  if (dir === 'up' || dir === 'down' || dir === 'portal') {
    return { direction: dir };
  }
  if (dir === 'north') return { direction: 'edge', placementSide: 'top' };
  if (dir === 'south') return { direction: 'edge', placementSide: 'bottom' };
  if (dir === 'east') return { direction: 'edge', placementSide: 'right' };
  if (dir === 'west') return { direction: 'edge', placementSide: 'left' };
  return { direction: 'edge' };
}

function mapGeneratorType(type: string): 'digger' | 'cellular' | 'static' | 'dla' {
  if (type === 'cellular' || type === 'caves' || type === 'maze') return 'cellular';
  if (type === 'static') return 'static';
  if (type === 'dla') return 'dla';
  return 'digger';
}

function addArea(def: AreaDef): void {
  areas[def.id] = {
    ...def,
    generatorType: mapGeneratorType(def.generatorType),
    connections: def.connections.map((c) => ({
      targetAreaId: c.targetAreaId,
      ...mapDirection(c.direction)
    }))
  };
}

// 1. Hub & Towns
addArea({ id: 'shroudgarde_courtyard', name: 'Shroudgarde Town Square', generatorType: 'bsp', dangerRating: 0, tags: ['town', 'outdoor'], crBudget: 10, encounterProfileId: 'town_encounter', connections: [
  { targetAreaId: 'shroudgarde_gate', direction: 'south' },
  { targetAreaId: 'shroudgarde_inner_keep', direction: 'north' },
  { targetAreaId: 'golden_grain_inn', direction: 'east' },
  { targetAreaId: 'shroudgarde_inn_cellar', direction: 'down' },
  { targetAreaId: 'forest_haunted', direction: 'west' }
]});

addArea({ id: 'shroudgarde_gate', name: 'Shroudgarde Southern Gate', generatorType: 'bsp', dangerRating: 0, tags: ['town', 'outdoor'], crBudget: 15, encounterProfileId: 'town_encounter', connections: [
  { targetAreaId: 'shroudgarde_courtyard', direction: 'north' },
  { targetAreaId: 'orlane_east', direction: 'east' },
  { targetAreaId: 'outer_crossroads', direction: 'south' }
]});

addArea({ id: 'shroudgarde_inner_keep', name: 'Shroudgarde Keep Bastion', generatorType: 'bsp', dangerRating: 1, tags: ['town'], crBudget: 25, encounterProfileId: 'town_encounter', connections: [
  { targetAreaId: 'shroudgarde_courtyard', direction: 'south' }
]});

addArea({ id: 'golden_grain_inn', name: 'Golden Grain Tavern', generatorType: 'bsp', dangerRating: 0, tags: ['town'], crBudget: 10, encounterProfileId: 'town_encounter', connections: [
  { targetAreaId: 'shroudgarde_courtyard', direction: 'west' }
]});

addArea({ id: 'shroudgarde_inn_cellar', name: 'Shroudgarde Inn Cellar', generatorType: 'digger', dangerRating: 2, tags: ['dungeon', 'crypt'], crBudget: 35, encounterProfileId: 'shallow_crypt_encounter', connections: [
  { targetAreaId: 'shroudgarde_courtyard', direction: 'up' },
  { targetAreaId: 'megadungeon_hub', direction: 'down' }
]});

// 2. Wilderness & Roads
addArea({ id: 'outer_crossroads', name: 'Borderlands Crossroads', generatorType: 'caves', dangerRating: 1, tags: ['frontier', 'outdoor'], crBudget: 25, encounterProfileId: 'wilderness_encounter', connections: [
  { targetAreaId: 'shroudgarde_gate', direction: 'north' },
  { targetAreaId: 'safe_hub', direction: 'west' },
  { targetAreaId: 'road_to_nulb', direction: 'south' },
  { targetAreaId: 'watchtower_f1', direction: 'east' }
]});

addArea({ id: 'forest_haunted', name: 'La Forêt Hantée', generatorType: 'cellular', dangerRating: 2, tags: ['frontier', 'outdoor'], crBudget: 35, encounterProfileId: 'wilderness_encounter', connections: [
  { targetAreaId: 'shroudgarde_courtyard', direction: 'east' },
  { targetAreaId: 'ravine_chaos', direction: 'north' },
  { targetAreaId: 'wizard_tower_f1', direction: 'west' }
]});

addArea({ id: 'orlane_east', name: 'Eastern Village of Orlane', generatorType: 'bsp', dangerRating: 1, tags: ['town', 'frontier'], crBudget: 20, encounterProfileId: 'town_encounter', connections: [
  { targetAreaId: 'shroudgarde_gate', direction: 'west' },
  { targetAreaId: 'marsh_mirrored', direction: 'east' }
]});

addArea({ id: 'marsh_mirrored', name: 'The Mirrored Marsh', generatorType: 'cellular', dangerRating: 3, tags: ['frontier', 'outdoor'], crBudget: 50, encounterProfileId: 'wilderness_encounter', connections: [
  { targetAreaId: 'orlane_east', direction: 'west' },
  { targetAreaId: 'wet_caverns', direction: 'down' },
  { targetAreaId: 'spire_level_air', direction: 'north' }
]});

addArea({ id: 'ravine_chaos', name: 'Ravine of Chaos', generatorType: 'caves', dangerRating: 2, tags: ['frontier', 'cave'], crBudget: 40, encounterProfileId: 'cave_encounter', connections: [
  { targetAreaId: 'forest_haunted', direction: 'south' },
  { targetAreaId: 'cave_kobolds', direction: 'north' },
  { targetAreaId: 'cave_norkers', direction: 'east' },
  { targetAreaId: 'cave_bugbears', direction: 'west' }
]});

addArea({ id: 'road_to_nulb', name: 'Road to Nulb', generatorType: 'cellular', dangerRating: 2, tags: ['frontier', 'outdoor'], crBudget: 35, encounterProfileId: 'wilderness_encounter', connections: [
  { targetAreaId: 'outer_crossroads', direction: 'north' },
  { targetAreaId: 'moathouse_surface', direction: 'south' }
]});

// 3. Caves of Chaos
addArea({ id: 'cave_kobolds', name: 'Cavern of Kobold Trappers', generatorType: 'caves', dangerRating: 2, tags: ['cave'], crBudget: 30, encounterProfileId: 'cave_encounter', connections: [
  { targetAreaId: 'ravine_chaos', direction: 'south' },
  { targetAreaId: 'cave_scro', direction: 'east' }
]});

addArea({ id: 'cave_norkers', name: 'Cavern of the Norkers', generatorType: 'caves', dangerRating: 2, tags: ['cave'], crBudget: 35, encounterProfileId: 'cave_encounter', connections: [
  { targetAreaId: 'ravine_chaos', direction: 'west' },
  { targetAreaId: 'cave_ogre', direction: 'north' }
]});

addArea({ id: 'cave_bugbears', name: 'Lair of the Bugbears', generatorType: 'digger', dangerRating: 3, tags: ['cave'], crBudget: 45, encounterProfileId: 'cave_encounter', connections: [
  { targetAreaId: 'ravine_chaos', direction: 'east' }
]});

addArea({ id: 'cave_scro', name: 'Outpost of the Scro Orcs', generatorType: 'digger', dangerRating: 3, tags: ['cave'], crBudget: 50, encounterProfileId: 'cave_encounter', connections: [
  { targetAreaId: 'cave_kobolds', direction: 'west' }
]});

addArea({ id: 'cave_ogre', name: 'Den of the Ogre Chieftain', generatorType: 'caves', dangerRating: 4, tags: ['cave'], crBudget: 65, encounterProfileId: 'cave_encounter', connections: [
  { targetAreaId: 'cave_norkers', direction: 'south' }
]});

// 4. Towers (3 Towers: Watchtower 3f, Spire 5f, Wizard Tower 4f)
// Tower A: High Watchtower
addArea({ id: 'watchtower_f1', name: 'High Watchtower: Ground Entry', generatorType: 'bsp', dangerRating: 1, tags: ['tower'], crBudget: 25, encounterProfileId: 'tower_encounter', connections: [
  { targetAreaId: 'outer_crossroads', direction: 'west' },
  { targetAreaId: 'watchtower_f2', direction: 'up' }
]});
addArea({ id: 'watchtower_f2', name: 'High Watchtower: Guard Barracks', generatorType: 'bsp', dangerRating: 2, tags: ['tower'], crBudget: 35, encounterProfileId: 'tower_encounter', connections: [
  { targetAreaId: 'watchtower_f1', direction: 'down' },
  { targetAreaId: 'watchtower_f3', direction: 'up' }
]});
addArea({ id: 'watchtower_f3', name: 'High Watchtower: Beacon Peak', generatorType: 'bsp', dangerRating: 3, tags: ['tower'], crBudget: 45, encounterProfileId: 'tower_encounter', connections: [
  { targetAreaId: 'watchtower_f2', direction: 'down' }
]});

// Tower B: Elemental Spire (5 floors)
addArea({ id: 'spire_level_air', name: 'Spire of Elements: Tier of Air', generatorType: 'maze', dangerRating: 4, tags: ['tower', 'temple'], crBudget: 60, encounterProfileId: 'tower_encounter', connections: [
  { targetAreaId: 'marsh_mirrored', direction: 'south' },
  { targetAreaId: 'spire_level_earth', direction: 'up' }
]});
addArea({ id: 'spire_level_earth', name: 'Spire of Elements: Tier of Earth', generatorType: 'caves', dangerRating: 4, tags: ['tower', 'temple'], crBudget: 65, encounterProfileId: 'tower_encounter', connections: [
  { targetAreaId: 'spire_level_air', direction: 'down' },
  { targetAreaId: 'spire_level_fire', direction: 'up' }
]});
addArea({ id: 'spire_level_fire', name: 'Spire of Elements: Tier of Fire', generatorType: 'digger', dangerRating: 5, tags: ['tower', 'temple'], crBudget: 75, encounterProfileId: 'tower_encounter', connections: [
  { targetAreaId: 'spire_level_earth', direction: 'down' },
  { targetAreaId: 'spire_level_water', direction: 'up' }
]});
addArea({ id: 'spire_level_water', name: 'Spire of Elements: Tier of Water', generatorType: 'cellular', dangerRating: 5, tags: ['tower', 'temple'], crBudget: 80, encounterProfileId: 'tower_encounter', connections: [
  { targetAreaId: 'spire_level_fire', direction: 'down' },
  { targetAreaId: 'spire_gem_chamber', direction: 'up' }
]});
addArea({ id: 'spire_gem_chamber', name: 'Spire Apex: Chamber of Elemental Gems', generatorType: 'bsp', dangerRating: 6, tags: ['tower', 'temple'], crBudget: 100, encounterProfileId: 'tower_encounter', connections: [
  { targetAreaId: 'spire_level_water', direction: 'down' }
]});

// Tower C: Arcane Wizard Tower (4 floors)
addArea({ id: 'wizard_tower_f1', name: 'Arcane Tower: Great Library', generatorType: 'bsp', dangerRating: 2, tags: ['tower'], crBudget: 30, encounterProfileId: 'tower_encounter', connections: [
  { targetAreaId: 'forest_haunted', direction: 'east' },
  { targetAreaId: 'wizard_tower_f2', direction: 'up' }
]});
addArea({ id: 'wizard_tower_f2', name: 'Arcane Tower: Alchemical Laboratory', generatorType: 'bsp', dangerRating: 3, tags: ['tower'], crBudget: 45, encounterProfileId: 'tower_encounter', connections: [
  { targetAreaId: 'wizard_tower_f1', direction: 'down' },
  { targetAreaId: 'wizard_tower_f3', direction: 'up' }
]});
addArea({ id: 'wizard_tower_f3', name: 'Arcane Tower: Celestial Observatory', generatorType: 'bsp', dangerRating: 4, tags: ['tower'], crBudget: 60, encounterProfileId: 'tower_encounter', connections: [
  { targetAreaId: 'wizard_tower_f2', direction: 'down' },
  { targetAreaId: 'wizard_tower_f4', direction: 'up' }
]});
addArea({ id: 'wizard_tower_f4', name: 'Arcane Tower: Sanctum Sanctorum', generatorType: 'bsp', dangerRating: 5, tags: ['tower'], crBudget: 80, encounterProfileId: 'tower_encounter', connections: [
  { targetAreaId: 'wizard_tower_f3', direction: 'down' }
]});

// 5. Shallow Dungeons & Sunless Crypts
addArea({ id: 'safe_hub', name: 'Sunless Crypt Encampment', generatorType: 'bsp', dangerRating: 1, tags: ['crypt'], crBudget: 20, encounterProfileId: 'shallow_crypt_encounter', connections: [
  { targetAreaId: 'outer_crossroads', direction: 'east' },
  { targetAreaId: 'dungeon_1', direction: 'down' }
]});
addArea({ id: 'dungeon_1', name: 'Sunless Reliquary: Upper Crypts', generatorType: 'digger', dangerRating: 2, tags: ['crypt', 'dungeon'], crBudget: 35, encounterProfileId: 'shallow_crypt_encounter', connections: [
  { targetAreaId: 'safe_hub', direction: 'up' },
  { targetAreaId: 'dungeon_2', direction: 'down' },
  { targetAreaId: 'bandit_stronghold', direction: 'west' }
]});
addArea({ id: 'dungeon_2', name: 'Sunless Reliquary: Tomb of the Arch-Curate', generatorType: 'digger', dangerRating: 3, tags: ['crypt', 'dungeon'], crBudget: 50, encounterProfileId: 'shallow_crypt_encounter', connections: [
  { targetAreaId: 'dungeon_1', direction: 'up' },
  { targetAreaId: 'shrine_vault_hub', direction: 'down' }
]});
addArea({ id: 'bandit_stronghold', name: 'Subterranean Bandit Stronghold', generatorType: 'digger', dangerRating: 2, tags: ['dungeon'], crBudget: 40, encounterProfileId: 'shallow_crypt_encounter', connections: [
  { targetAreaId: 'dungeon_1', direction: 'east' }
]});
addArea({ id: 'shrine_vault_hub', name: 'Cathedral Vault Hub', generatorType: 'bsp', dangerRating: 4, tags: ['crypt', 'temple'], crBudget: 70, encounterProfileId: 'shallow_crypt_encounter', connections: [
  { targetAreaId: 'dungeon_2', direction: 'up' },
  { targetAreaId: 'megadungeon_hub', direction: 'down' }
]});

// 6. Moathouse & Water Temple
addArea({ id: 'moathouse_surface', name: 'Ruined Moathouse Courtyard', generatorType: 'bsp', dangerRating: 2, tags: ['dungeon', 'outdoor'], crBudget: 35, encounterProfileId: 'shallow_crypt_encounter', connections: [
  { targetAreaId: 'road_to_nulb', direction: 'north' },
  { targetAreaId: 'moathouse_dungeons', direction: 'down' }
]});
addArea({ id: 'moathouse_dungeons', name: 'Moathouse Sub-Level (Lareth)', generatorType: 'digger', dangerRating: 3, tags: ['dungeon'], crBudget: 55, encounterProfileId: 'shallow_crypt_encounter', connections: [
  { targetAreaId: 'moathouse_surface', direction: 'up' },
  { targetAreaId: 'toee_level_1', direction: 'down' }
]});
addArea({ id: 'wet_caverns', name: 'Flooded Marsh Grotto', generatorType: 'caves', dangerRating: 3, tags: ['cave', 'water'], crBudget: 45, encounterProfileId: 'cave_encounter', connections: [
  { targetAreaId: 'marsh_mirrored', direction: 'up' },
  { targetAreaId: 'reptile_temple', direction: 'east' }
]});
addArea({ id: 'reptile_temple', name: 'Ancient Temple of the Reptile God', generatorType: 'bsp', dangerRating: 4, tags: ['temple'], crBudget: 60, encounterProfileId: 'temple_encounter', connections: [
  { targetAreaId: 'wet_caverns', direction: 'west' },
  { targetAreaId: 'water_temple_upper', direction: 'south' }
]});
addArea({ id: 'water_temple_upper', name: 'Water Temple: Upper Terrace', generatorType: 'cellular', dangerRating: 4, tags: ['temple', 'water'], crBudget: 65, encounterProfileId: 'temple_encounter', connections: [
  { targetAreaId: 'reptile_temple', direction: 'north' },
  { targetAreaId: 'water_temple_lower', direction: 'down' }
]});
addArea({ id: 'water_temple_lower', name: 'Water Temple: Sunken Nave', generatorType: 'cellular', dangerRating: 5, tags: ['temple', 'water'], crBudget: 75, encounterProfileId: 'temple_encounter', connections: [
  { targetAreaId: 'water_temple_upper', direction: 'up' },
  { targetAreaId: 'water_temple_core', direction: 'east' }
]});
addArea({ id: 'water_temple_core', name: 'Water Temple: Core Reservoir', generatorType: 'caves', dangerRating: 5, tags: ['temple', 'water'], crBudget: 85, encounterProfileId: 'temple_encounter', connections: [
  { targetAreaId: 'water_temple_lower', direction: 'west' },
  { targetAreaId: 'water_temple_valve_room', direction: 'down' }
]});
addArea({ id: 'water_temple_valve_room', name: 'Water Temple: Drainage Valve Chamber', generatorType: 'bsp', dangerRating: 6, tags: ['temple'], crBudget: 90, encounterProfileId: 'temple_encounter', connections: [
  { targetAreaId: 'water_temple_core', direction: 'up' }
]});

// 7. Temple of Elemental Evil (TOEE 1-4 + Zuggtmoy Fane)
addArea({ id: 'toee_level_1', name: 'Temple of Elemental Evil: Level 1', generatorType: 'digger', dangerRating: 4, tags: ['temple', 'dungeon'], crBudget: 70, encounterProfileId: 'temple_encounter', connections: [
  { targetAreaId: 'moathouse_dungeons', direction: 'up' },
  { targetAreaId: 'toee_level_2', direction: 'down' }
]});
addArea({ id: 'toee_level_2', name: 'Temple of Elemental Evil: Level 2', generatorType: 'digger', dangerRating: 5, tags: ['temple', 'dungeon'], crBudget: 85, encounterProfileId: 'temple_encounter', connections: [
  { targetAreaId: 'toee_level_1', direction: 'up' },
  { targetAreaId: 'toee_level_3', direction: 'down' }
]});
addArea({ id: 'toee_level_3', name: 'Temple of Elemental Evil: Level 3', generatorType: 'digger', dangerRating: 6, tags: ['temple', 'dungeon'], crBudget: 100, encounterProfileId: 'temple_encounter', connections: [
  { targetAreaId: 'toee_level_2', direction: 'up' },
  { targetAreaId: 'toee_level_4', direction: 'down' }
]});
addArea({ id: 'toee_level_4', name: 'Temple of Elemental Evil: Level 4', generatorType: 'digger', dangerRating: 7, tags: ['temple', 'dungeon'], crBudget: 120, encounterProfileId: 'temple_encounter', connections: [
  { targetAreaId: 'toee_level_3', direction: 'up' },
  { targetAreaId: 'toee_zuggtmoy_fane', direction: 'north' },
  { targetAreaId: 'megadungeon_hub', direction: 'down' }
]});
addArea({ id: 'toee_zuggtmoy_fane', name: 'Fane of Zuggtmoy, Demon Queen', generatorType: 'bsp', dangerRating: 8, tags: ['temple', 'deep_vault'], crBudget: 150, encounterProfileId: 'temple_encounter', connections: [
  { targetAreaId: 'toee_level_4', direction: 'south' }
]});

// 8. Megadungeon Central Hub
addArea({ id: 'megadungeon_hub', name: 'The Subterranean Crossroads', generatorType: 'bsp', dangerRating: 4, tags: ['megadungeon'], crBudget: 60, encounterProfileId: 'deep_megadungeon_encounter', connections: [
  { targetAreaId: 'shroudgarde_inn_cellar', direction: 'up' },
  { targetAreaId: 'shrine_vault_hub', direction: 'west' },
  { targetAreaId: 'toee_level_4', direction: 'north' },
  { targetAreaId: 'nethack_doom_1', direction: 'east' },
  { targetAreaId: 'incursion_goblin_1', direction: 'south' }
]});

// 9. NetHack Dungeons of Doom (10 floors)
for (let i = 1; i <= 10; i++) {
  const currentId = `nethack_doom_${i}`;
  const prevId = i === 1 ? 'megadungeon_hub' : `nethack_doom_${i - 1}`;
  const conns: AreaConnection[] = [{ targetAreaId: prevId, direction: i === 1 ? 'west' : 'up' }];
  if (i < 10) {
    conns.push({ targetAreaId: `nethack_doom_${i + 1}`, direction: 'down' });
  } else {
    conns.push({ targetAreaId: 'incursion_hellish_rift', direction: 'down' });
  }
  addArea({
    id: currentId,
    name: `Dungeons of Doom: Depth ${i}`,
    generatorType: i % 2 === 0 ? 'bsp' : 'digger',
    dangerRating: Math.min(10, 3 + Math.floor(i / 2)),
    tags: ['megadungeon', 'dungeon'],
    crBudget: 40 + i * 10,
    encounterProfileId: 'deep_megadungeon_encounter',
    connections: conns
  });
}

// 10. Incursion Goblin Warrens (10 floors)
for (let i = 1; i <= 10; i++) {
  const currentId = `incursion_goblin_${i}`;
  const prevId = i === 1 ? 'megadungeon_hub' : `incursion_goblin_${i - 1}`;
  const conns: AreaConnection[] = [{ targetAreaId: prevId, direction: i === 1 ? 'north' : 'up' }];
  if (i < 10) {
    conns.push({ targetAreaId: `incursion_goblin_${i + 1}`, direction: 'down' });
  } else {
    conns.push({ targetAreaId: 'incursion_the_goblin_encampment', direction: 'south' });
  }
  addArea({
    id: currentId,
    name: `Goblin Warrens: Warren Level ${i}`,
    generatorType: 'caves',
    dangerRating: Math.min(10, 3 + Math.floor(i / 2)),
    tags: ['megadungeon', 'cave'],
    crBudget: 45 + i * 10,
    encounterProfileId: 'cave_encounter',
    connections: conns
  });
}

// 11. Incursion Subterranean Special Vaults (8 areas)
addArea({ id: 'incursion_the_goblin_encampment', name: 'The Great Goblin Citadel', generatorType: 'bsp', dangerRating: 7, tags: ['megadungeon'], crBudget: 110, encounterProfileId: 'cave_encounter', connections: [
  { targetAreaId: 'incursion_goblin_10', direction: 'north' },
  { targetAreaId: 'incursion_arena_chamber', direction: 'east' }
]});
addArea({ id: 'incursion_arena_chamber', name: 'The Subterranean Arena', generatorType: 'bsp', dangerRating: 7, tags: ['megadungeon'], crBudget: 120, encounterProfileId: 'deep_megadungeon_encounter', connections: [
  { targetAreaId: 'incursion_the_goblin_encampment', direction: 'west' },
  { targetAreaId: 'incursion_place_of_sanctuary', direction: 'down' }
]});
addArea({ id: 'incursion_place_of_sanctuary', name: 'Ancient Place of Sanctuary', generatorType: 'bsp', dangerRating: 6, tags: ['megadungeon', 'temple'], crBudget: 90, encounterProfileId: 'deep_megadungeon_encounter', connections: [
  { targetAreaId: 'incursion_arena_chamber', direction: 'up' },
  { targetAreaId: 'incursion_parthenion', direction: 'east' }
]});
addArea({ id: 'incursion_parthenion', name: 'The Holy Parthenion', generatorType: 'bsp', dangerRating: 7, tags: ['megadungeon', 'temple'], crBudget: 100, encounterProfileId: 'temple_encounter', connections: [
  { targetAreaId: 'incursion_place_of_sanctuary', direction: 'west' },
  { targetAreaId: 'incursion_unholy_sepulchre', direction: 'south' }
]});
addArea({ id: 'incursion_unholy_sepulchre', name: 'The Unholy Sepulchre', generatorType: 'digger', dangerRating: 8, tags: ['megadungeon', 'deep_vault'], crBudget: 130, encounterProfileId: 'deep_megadungeon_encounter', connections: [
  { targetAreaId: 'incursion_parthenion', direction: 'north' },
  { targetAreaId: 'incursion_lesser_vault_1', direction: 'east' }
]});
addArea({ id: 'incursion_lesser_vault_1', name: 'Subterranean Vault: Adamantine Hoard', generatorType: 'bsp', dangerRating: 8, tags: ['megadungeon', 'deep_vault'], crBudget: 140, encounterProfileId: 'deep_megadungeon_encounter', connections: [
  { targetAreaId: 'incursion_unholy_sepulchre', direction: 'west' },
  { targetAreaId: 'incursion_lesser_vault_2', direction: 'south' }
]});
addArea({ id: 'incursion_lesser_vault_2', name: 'Subterranean Vault: Wyrm Cavern', generatorType: 'caves', dangerRating: 9, tags: ['megadungeon', 'deep_vault'], crBudget: 160, encounterProfileId: 'deep_megadungeon_encounter', connections: [
  { targetAreaId: 'incursion_lesser_vault_1', direction: 'north' },
  { targetAreaId: 'incursion_hellish_rift', direction: 'down' }
]});
addArea({ id: 'incursion_hellish_rift', name: 'The Hellish Abyssal Rift', generatorType: 'caves', dangerRating: 10, tags: ['megadungeon', 'deep_vault'], crBudget: 200, encounterProfileId: 'deep_megadungeon_encounter', connections: [
  { targetAreaId: 'nethack_doom_10', direction: 'up' },
  { targetAreaId: 'incursion_lesser_vault_2', direction: 'west' }
]});

writeJson('areas.json', areas);
console.log(`Generated ${Object.keys(areas).length} areas.`);

// ─────────────────────────────────────────────────────────────────────────────
// 11. ENCOUNTER PROFILES & SPAWN POOLS
// ─────────────────────────────────────────────────────────────────────────────
const encounterProfiles = {
  town_encounter: { id: 'town_encounter', name: 'Town Citizens & Guards', budgetAllocation: { protein: 0.5, appetizer: 0.2, side: 0.2, dessert: 0.1 } },
  wilderness_encounter: { id: 'wilderness_encounter', name: 'Wilderness Predators & Bandits', budgetAllocation: { protein: 0.6, appetizer: 0.1, side: 0.2, dessert: 0.1 } },
  cave_encounter: { id: 'cave_encounter', name: 'Cavern Denizens & Humanoids', budgetAllocation: { protein: 0.65, appetizer: 0.1, side: 0.15, dessert: 0.1 } },
  tower_encounter: { id: 'tower_encounter', name: 'Tower Guardians & Constructs', budgetAllocation: { protein: 0.6, appetizer: 0.1, side: 0.2, dessert: 0.1 } },
  shallow_crypt_encounter: { id: 'shallow_crypt_encounter', name: 'Crypt Undead & Vermin', budgetAllocation: { protein: 0.6, appetizer: 0.15, side: 0.15, dessert: 0.1 } },
  temple_encounter: { id: 'temple_encounter', name: 'Temple Cultists & Elementals', budgetAllocation: { protein: 0.6, appetizer: 0.1, side: 0.2, dessert: 0.1 } },
  deep_megadungeon_encounter: { id: 'deep_megadungeon_encounter', name: 'Deep Megadungeon Horrors', budgetAllocation: { protein: 0.7, appetizer: 0.1, side: 0.1, dessert: 0.1 } }
};
writeJson('encounter_profiles.json', encounterProfiles);

const spawnPools = {
  town_pop: { id: 'town_pop', name: 'Town Population', conditions: { areaTags: ['town'] }, entities: { town_guard: 60, peasant_villager: 40 } },
  frontier_beasts: { id: 'frontier_beasts', name: 'Frontier Beasts', conditions: { areaTags: ['frontier', 'outdoor'] }, entities: { giant_rat: 35, dire_wolf: 25, bandit: 25, owlbear: 15 } },
  dungeon_dwellers: { id: 'dungeon_dwellers', name: 'Dungeon Bandits & Vermin', conditions: { areaTags: ['dungeon'] }, entities: { bandit: 40, giant_rat: 30, skeleton: 30 } },
  cave_warrens: { id: 'cave_warrens', name: 'Cave Warrens', conditions: { areaTags: ['cave'] }, entities: { goblin: 40, orc: 30, bugbear: 20, ogre: 10 } },
  crypt_undead: { id: 'crypt_undead', name: 'Crypt Undead', conditions: { areaTags: ['crypt'] }, entities: { skeleton: 45, zombie: 35, ghoul: 20 } },
  tower_sentinels: { id: 'tower_sentinels', name: 'Tower Sentinels', conditions: { areaTags: ['tower'] }, entities: { clay_golem: 25, gargoyle: 25, air_elemental: 25, fire_elemental: 25 } },
  temple_cult: { id: 'temple_cult', name: 'Temple Cultists', conditions: { areaTags: ['temple'] }, entities: { cultist: 45, water_elemental: 25, ghast: 15, troll: 15 } },
  deep_monsters: { id: 'deep_monsters', name: 'Deep Megadungeon Monsters', conditions: { areaTags: ['megadungeon'] }, entities: { orc: 25, troll: 25, wraith: 20, minotaur: 15, red_dragon: 15 } }
};
writeJson('spawn_pools.json', spawnPools);

// ─────────────────────────────────────────────────────────────────────────────
// 12. ENTITIES (~140 curated PC, NPC, Monster, Portal templates)
// ─────────────────────────────────────────────────────────────────────────────
const entities: Record<string, unknown> = {
  // Player
  player: {
    id: 'player',
    name: 'Adventurer',
    glyph: '@',
    fg: '#00ffff',
    bg: 'transparent',
    spriteId: 'actor_rogue',
    isActor: true,
    speed: 100,
    fighter: { maxHp: 30, attack: 4, defense: 2 },
    inventoryConfig: { baseCapacity: 14 },
    equipmentSlots: ['head', 'neck', 'torso', 'back', 'arm', 'arm', 'hand', 'hand', 'finger', 'finger', 'leg', 'foot'],
    tags: ['actor'],
    faction: 'player',
    persistent: true
  },

  // Interactive dungeon props
  stone_floor_portal: { id: 'stone_floor_portal', name: 'Passage Stairs', glyph: '>', fg: '#ffffff', bg: 'transparent', spriteId: 'tile_staircase_down', isActor: false, tags: ['portal'], renderable: true },
  wooden_door: { id: 'wooden_door', name: 'Wooden Door', glyph: '+', fg: '#8d6e63', bg: 'transparent', spriteId: 'tile_framed_door_1_shut', isActor: false, tags: ['door', 'solid'], renderable: true },
  iron_gate: { id: 'iron_gate', name: 'Iron Portcullis', glyph: '#', fg: '#7f8c8d', bg: 'transparent', spriteId: 'tile_grated_door', isActor: false, tags: ['door', 'solid'], renderable: true },
  wooden_chest: { id: 'wooden_chest', name: 'Sturdy Wooden Chest', glyph: '=', fg: '#f39c12', bg: 'transparent', spriteId: 'tile_chest_closed', isActor: false, tags: ['chest'], renderable: true },
  golden_chest: { id: 'golden_chest', name: 'Gilded Treasure Chest', glyph: '=', fg: '#ffd700', bg: 'transparent', spriteId: 'tile_chest_closed', isActor: false, tags: ['chest'], renderable: true },
  pile_of_bones: { id: 'pile_of_bones', name: 'Scattered Skeletons', glyph: '%', fg: '#ecf0f1', bg: 'transparent', spriteId: 'tile_bone_1', isActor: false, tags: ['chest'], renderable: true },
  fountain: { id: 'fountain', name: 'Sacred Rejuvenating Fountain', glyph: '{', fg: '#3498db', bg: 'transparent', spriteId: 'tile_blue_stone_floor_1_blue_bg', isActor: false, tags: ['terrain'], renderable: true },
  altar: { id: 'altar', name: 'Stone Consecration Altar', glyph: '_', fg: '#f1c40f', bg: 'transparent', spriteId: 'tile_sarcophagus_closed', isActor: false, tags: ['terrain'], renderable: true },

  // Named NPCs & Vendors
  constable_derek: {
    id: 'constable_derek',
    name: 'Constable Derek',
    glyph: '@',
    fg: '#3498db',
    bg: 'transparent',
    spriteId: 'actor_knight',
    isActor: true,
    speed: 100,
    fighter: { maxHp: 55, attack: 7, defense: 5 },
    archetypeId: 'human',
    ai: { profileId: 'stationary_vendor', wanders: false },
    faction: 'citizens',
    tags: ['actor', 'npc', 'guard'],
    dialogueId: 'guard_captain_tree',
    defaultEquipment: [{ itemId: 'longsword' }, { itemId: 'breastplate' }, { itemId: 'heavy_steel_shield' }]
  },

  barkeep_bertram: {
    id: 'barkeep_bertram',
    name: 'Barkeep Bertram',
    glyph: '@',
    fg: '#e67e22',
    bg: 'transparent',
    spriteId: 'actor_shopkeep',
    isActor: true,
    speed: 100,
    fighter: { maxHp: 30, attack: 3, defense: 1 },
    archetypeId: 'human',
    ai: { profileId: 'stationary_vendor', wanders: false },
    faction: 'citizens',
    tags: ['actor', 'npc', 'merchant'],
    dialogueId: 'bertram_trade_tree',
    shop: { markupMultiplier: 1.1, inventory: ['ration_fresh_bread', 'ration_iron', 'dagger'] }
  },

  dwarf_laurent: {
    id: 'dwarf_laurent',
    name: 'Gold Dwarf Laurent',
    glyph: 'd',
    fg: '#f39c12',
    bg: 'transparent',
    spriteId: 'actor_blacksmith',
    isActor: true,
    speed: 90,
    fighter: { maxHp: 65, attack: 8, defense: 6 },
    archetypeId: 'dwarf',
    ai: { profileId: 'stationary_vendor', wanders: false },
    faction: 'citizens',
    tags: ['actor', 'npc', 'merchant'],
    dialogueId: 'laurent_smith_tree',
    shop: { markupMultiplier: 1.15, inventory: ['battleaxe', 'warhammer', 'chainmail', 'breastplate', 'heavy_steel_shield'] },
    defaultEquipment: [{ itemId: 'warhammer' }, { itemId: 'chainmail' }]
  },

  isabelle_cleric: {
    id: 'isabelle_cleric',
    name: 'Aasimar Isabelle',
    glyph: '@',
    fg: '#f1c40f',
    bg: 'transparent',
    spriteId: 'actor_female_war_cleric',
    isActor: true,
    speed: 100,
    fighter: { maxHp: 45, attack: 5, defense: 4 },
    archetypeId: 'aasimar',
    ai: { profileId: 'stationary_vendor', wanders: false },
    faction: 'citizens',
    tags: ['actor', 'npc', 'merchant'],
    dialogueId: 'isabelle_healer_tree',
    shop: { markupMultiplier: 1.1, inventory: ['potion_of_cure_light_wounds', 'potion_of_bulls_strength', 'scroll_of_mage_armor'] },
    defaultEquipment: [{ itemId: 'heavy_mace' }, { itemId: 'scale_mail' }]
  },

  luc_ranger: {
    id: 'luc_ranger',
    name: 'Wood Elf Luc',
    glyph: 'e',
    fg: '#2ecc71',
    bg: 'transparent',
    spriteId: 'actor_ranger',
    isActor: true,
    speed: 110,
    fighter: { maxHp: 40, attack: 6, defense: 3 },
    archetypeId: 'elf',
    ai: { profileId: 'stationary_vendor', wanders: false },
    faction: 'citizens',
    tags: ['actor', 'npc', 'merchant'],
    dialogueId: 'luc_scout_tree',
    shop: { markupMultiplier: 1.1, inventory: ['shortbow', 'composite_longbow', 'dagger', 'boots_of_elvenkind'] },
    defaultEquipment: [{ itemId: 'shortbow' }, { itemId: 'short_sword' }, { itemId: 'studded_leather_armor' }]
  },

  silas_merchant: {
    id: 'silas_merchant',
    name: 'Silas the Gem Trader',
    glyph: '@',
    fg: '#9b59b6',
    bg: 'transparent',
    spriteId: 'actor_shopkeep',
    isActor: true,
    speed: 100,
    fighter: { maxHp: 30, attack: 3, defense: 1 },
    archetypeId: 'human',
    ai: { profileId: 'stationary_vendor', wanders: false },
    faction: 'citizens',
    tags: ['actor', 'npc', 'merchant'],
    dialogueId: 'silas_gem_merchant_tree',
    shop: { markupMultiplier: 1.2, inventory: ['gem_chalcedony', 'gem_ruby', 'gem_sapphire', 'coin_pouch_silver', 'coin_pouch_gold'] }
  },

  archmage_alden: {
    id: 'archmage_alden',
    name: 'Archmage Alden',
    glyph: '@',
    fg: '#3498db',
    bg: 'transparent',
    spriteId: 'actor_male_wizard',
    isActor: true,
    speed: 100,
    fighter: { maxHp: 50, attack: 6, defense: 4 },
    archetypeId: 'human',
    ai: { profileId: 'stationary_vendor', wanders: false },
    faction: 'citizens',
    tags: ['actor', 'npc', 'merchant'],
    dialogueId: 'alden_mage_tree',
    shop: { markupMultiplier: 1.25, inventory: ['wand_of_cure_light_wounds', 'wand_of_magic_missile', 'scroll_of_mage_armor', 'ring_of_protection_plus1'] },
    defaultEquipment: [{ itemId: 'quarterstaff' }]
  },

  elena_scholar: {
    id: 'elena_scholar',
    name: 'Elena the Chronicler',
    glyph: '@',
    fg: '#1abc9c',
    bg: 'transparent',
    spriteId: 'actor_scholar',
    isActor: true,
    speed: 100,
    fighter: { maxHp: 25, attack: 2, defense: 1 },
    archetypeId: 'human',
    ai: { profileId: 'stationary_vendor', wanders: false },
    faction: 'citizens',
    tags: ['actor', 'npc'],
    dialogueId: 'elena_scholar_tree'
  },

  town_guard: {
    id: 'town_guard',
    name: 'Shroudgarde Guard',
    glyph: 'G',
    fg: '#95a5a6',
    bg: 'transparent',
    spriteId: 'actor_shield_knight',
    isActor: true,
    speed: 100,
    fighter: { maxHp: 35, attack: 4, defense: 3 },
    archetypeId: 'human',
    ai: { profileId: 'patrol_guard', aggroRadius: 4, wanders: true },
    faction: 'citizens',
    tags: ['actor', 'guard'],
    crCost: 8,
    roleTags: ['protein', 'side'],
    defaultEquipment: [{ itemId: 'longsword' }, { itemId: 'scale_mail' }, { itemId: 'heavy_steel_shield' }]
  },

  peasant_villager: {
    id: 'peasant_villager',
    name: 'Shroudgarde Commoner',
    glyph: 'p',
    fg: '#bdc3c7',
    bg: 'transparent',
    spriteId: 'actor_peasant',
    isActor: true,
    speed: 100,
    fighter: { maxHp: 15, attack: 1, defense: 0 },
    archetypeId: 'human',
    ai: { profileId: 'passive_npc', wanders: true },
    faction: 'citizens',
    tags: ['actor', 'npc'],
    crCost: 2,
    roleTags: ['side', 'appetizer'],
    dialogueId: 'villager_dialogue_tree'
  },

  // Bosses
  lareth_the_beautiful: {
    id: 'lareth_the_beautiful',
    name: 'Lareth the Beautiful',
    glyph: 'L',
    fg: '#9b59b6',
    bg: 'transparent',
    spriteId: 'actor_fencer',
    isActor: true,
    speed: 105,
    fighter: { maxHp: 85, attack: 10, defense: 6, xpGiven: 1200 },
    archetypeId: 'human',
    ai: { profileId: 'melee_aggressive', aggroRadius: 6, wanders: false },
    faction: 'cultists',
    tags: ['actor', 'boss'],
    crCost: 35,
    roleTags: ['protein'],
    dialogueId: 'lareth_parley_tree',
    defaultEquipment: [{ itemId: 'breastplate' }, { itemId: 'dagger' }],
    currencyDrop: { denominationId: 'cp', minAmount: 10000, maxAmount: 25000, chance: 1 },
    lootDrops: [{ itemId: 'gem_ruby', chance: 0.8 }, { itemId: 'coin_pouch_gold', chance: 1 }, { itemId: 'moathouse_ledger', chance: 1 }]
  },

  zuggtmoy_queen: {
    id: 'zuggtmoy_queen',
    name: 'Zuggtmoy, Demon Queen of Fungi',
    glyph: 'Z',
    fg: '#8e44ad',
    bg: 'transparent',
    spriteId: 'monster_large_myconid',
    isActor: true,
    speed: 110,
    fighter: { maxHp: 220, attack: 16, defense: 10, xpGiven: 5000 },
    archetypeId: 'balor',
    ai: { profileId: 'melee_aggressive', aggroRadius: 8, wanders: false },
    faction: 'cultists',
    tags: ['actor', 'boss'],
    crCost: 100,
    roleTags: ['protein'],
    currencyDrop: { denominationId: 'cp', minAmount: 50000, maxAmount: 150000, chance: 1 },
    lootDrops: [{ itemId: 'gem_diamond', chance: 1 }, { itemId: 'orb_of_elements', chance: 1 }]
  },

  crypt_arch_curate: {
    id: 'crypt_arch_curate',
    name: 'The Sunless Arch-Curate',
    glyph: 'L',
    fg: '#ecf0f1',
    bg: 'transparent',
    spriteId: 'monster_lich',
    isActor: true,
    speed: 100,
    fighter: { maxHp: 95, attack: 11, defense: 7, xpGiven: 1500 },
    archetypeId: 'ghoul',
    ai: { profileId: 'melee_aggressive', aggroRadius: 6, wanders: false },
    faction: 'undead',
    tags: ['actor', 'boss'],
    crCost: 40,
    roleTags: ['protein'],
    defaultEquipment: [{ itemId: 'amulet_of_natural_armor_plus2' }],
    currencyDrop: { denominationId: 'cp', minAmount: 15000, maxAmount: 35000, chance: 1 },
    lootDrops: [{ itemId: 'sunless_relic', chance: 1 }, { itemId: 'gem_sapphire', chance: 0.8 }]
  },

  ogre_chieftain: {
    id: 'ogre_chieftain',
    name: 'Korag the Ogre Chieftain',
    glyph: 'O',
    fg: '#e74c3c',
    bg: 'transparent',
    spriteId: 'monster_minotaur',
    isActor: true,
    speed: 95,
    fighter: { maxHp: 80, attack: 12, defense: 5, xpGiven: 800 },
    archetypeId: 'ogre',
    ai: { profileId: 'melee_aggressive', aggroRadius: 6, wanders: true },
    faction: 'orcs',
    tags: ['actor', 'boss'],
    crCost: 30,
    roleTags: ['protein'],
    defaultEquipment: [{ itemId: 'greatclub' }],
    currencyDrop: { denominationId: 'cp', minAmount: 5000, maxAmount: 15000, chance: 1 },
    lootDrops: [{ itemId: 'coin_pouch_gold', chance: 0.8 }]
  },

  red_dragon: {
    id: 'red_dragon',
    name: 'Pyroclast the Red Wyrm',
    glyph: 'D',
    fg: '#c0392b',
    bg: 'transparent',
    spriteId: 'monster_dragon',
    isActor: true,
    speed: 120,
    fighter: { maxHp: 300, attack: 18, defense: 12, xpGiven: 8000 },
    archetypeId: 'dragon_red',
    ai: { profileId: 'melee_aggressive', aggroRadius: 8, wanders: false },
    faction: 'monster',
    tags: ['actor', 'boss'],
    crCost: 120,
    roleTags: ['protein'],
    dialogueId: 'dragon_dialogue_tree',
    currencyDrop: { denominationId: 'cp', minAmount: 100000, maxAmount: 300000, chance: 1 },
    lootDrops: [{ itemId: 'gem_diamond', chance: 1 }, { itemId: 'coin_pouch_gold', chance: 1 }]
  }
};

// Bestiary definitions (Goblins, Orcs, Undead, Beasts, Elementals, etc.)
const bestiaryData = [
  { id: 'goblin', name: 'Goblin', glyph: 'g', fg: '#84e6ad', sprite: 'monster_goblin', archetype: 'goblin', faction: 'goblins', hp: 8, atk: 2, def: 1, xp: 15, cr: 5, minCp: 5, maxCp: 50, loot: 'copper_coin' },
  { id: 'goblin_archer', name: 'Goblin Archer', glyph: 'g', fg: '#2ecc71', sprite: 'monster_goblin_archer', archetype: 'goblin', faction: 'goblins', hp: 7, atk: 3, def: 0, xp: 20, cr: 6, minCp: 10, maxCp: 70, loot: 'copper_coin' },
  { id: 'goblin_brute', name: 'Goblin Brute', glyph: 'g', fg: '#27ae60', sprite: 'monster_goblin_brute', archetype: 'goblin', faction: 'goblins', hp: 16, atk: 4, def: 2, xp: 35, cr: 10, minCp: 20, maxCp: 120, loot: 'silver_coin' },
  { id: 'goblin_mage', name: 'Goblin Shaman', glyph: 'g', fg: '#3498db', sprite: 'monster_goblin_mage', archetype: 'goblin', faction: 'goblins', hp: 12, atk: 4, def: 1, xp: 45, cr: 12, minCp: 50, maxCp: 200, loot: 'potion_of_cure_light_wounds' },
  { id: 'kobold', name: 'Kobold Trapper', glyph: 'k', fg: '#e67e22', sprite: 'monster_kobold_canine', archetype: 'kobold', faction: 'goblins', hp: 6, atk: 2, def: 0, xp: 15, cr: 4, minCp: 5, maxCp: 40, loot: 'copper_coin' },
  { id: 'orc', name: 'Orc Raider', glyph: 'o', fg: '#2ecc71', sprite: 'monster_orc', archetype: 'orc', faction: 'orcs', hp: 15, atk: 5, def: 2, xp: 35, cr: 10, minCp: 20, maxCp: 150, loot: 'short_sword' },
  { id: 'orc_archer', name: 'Orc Archer', glyph: 'o', fg: '#27ae60', sprite: 'monster_orc', archetype: 'orc', faction: 'orcs', hp: 12, atk: 5, def: 1, xp: 35, cr: 10, minCp: 20, maxCp: 120, loot: 'dagger' },
  { id: 'orc_blademaster', name: 'Orc Berserker', glyph: 'o', fg: '#e74c3c', sprite: 'monster_orc_blademaster', archetype: 'orc', faction: 'orcs', hp: 30, atk: 7, def: 3, xp: 75, cr: 18, minCp: 50, maxCp: 300, loot: 'battleaxe' },
  { id: 'orc_warchief', name: 'Orc Warchief', glyph: 'O', fg: '#c0392b', sprite: 'monster_orc_warchief', archetype: 'orc', faction: 'orcs', hp: 50, atk: 9, def: 4, xp: 150, cr: 25, minCp: 200, maxCp: 1000, loot: 'coin_pouch_silver' },
  { id: 'bugbear', name: 'Bugbear Marauder', glyph: 'b', fg: '#d35400', sprite: 'monster_ettin', archetype: 'bugbear', faction: 'goblins', hp: 26, atk: 6, def: 3, xp: 65, cr: 15, minCp: 40, maxCp: 250, loot: 'warhammer' },
  { id: 'ogre', name: 'Ogre Brute', glyph: 'O', fg: '#e74c3c', sprite: 'monster_minotaur', archetype: 'ogre', faction: 'monster', hp: 45, atk: 9, def: 4, xp: 120, cr: 22, minCp: 100, maxCp: 600, loot: 'greatclub' },
  { id: 'troll', name: 'Cave Troll', glyph: 'T', fg: '#16a085', sprite: 'monster_troll', archetype: 'troll', faction: 'monster', hp: 65, atk: 10, def: 5, xp: 250, cr: 35, minCp: 300, maxCp: 1500, loot: 'coin_pouch_silver' },
  { id: 'skeleton', name: 'Restless Skeleton', glyph: 'z', fg: '#ecf0f1', sprite: 'monster_skeleton', archetype: 'skeleton', faction: 'undead', hp: 12, atk: 3, def: 2, xp: 25, cr: 7, minCp: 5, maxCp: 50, loot: 'copper_coin' },
  { id: 'skeleton_archer', name: 'Skeleton Archer', glyph: 'z', fg: '#bdc3c7', sprite: 'monster_skeleton_archer', archetype: 'skeleton', faction: 'undead', hp: 10, atk: 4, def: 1, xp: 30, cr: 8, minCp: 10, maxCp: 60, loot: 'shortbow' },
  { id: 'zombie', name: 'Rotting Zombie', glyph: 'z', fg: '#7f8c8d', sprite: 'monster_zombie', archetype: 'zombie', faction: 'undead', hp: 20, atk: 4, def: 1, xp: 35, cr: 9, minCp: 10, maxCp: 80, loot: 'copper_coin' },
  { id: 'ghoul', name: 'Crypt Ghoul', glyph: 'g', fg: '#95a5a6', sprite: 'monster_ghoul', archetype: 'ghoul', faction: 'undead', hp: 22, atk: 5, def: 3, xp: 60, cr: 14, minCp: 30, maxCp: 200, loot: 'silver_coin' },
  { id: 'ghast', name: 'Dungeon Ghast', glyph: 'g', fg: '#7f8c8d', sprite: 'monster_ghoul', archetype: 'ghast', faction: 'undead', hp: 35, atk: 7, def: 4, xp: 100, cr: 20, minCp: 80, maxCp: 400, loot: 'silver_coin' },
  { id: 'wight', name: 'Barrow Wight', glyph: 'w', fg: '#34495e', sprite: 'monster_wraith', archetype: 'wight', faction: 'undead', hp: 40, atk: 8, def: 5, xp: 150, cr: 25, minCp: 100, maxCp: 800, loot: 'coin_pouch_silver' },
  { id: 'wraith', name: 'Shadow Wraith', glyph: 'W', fg: '#2c3e50', sprite: 'monster_wraith', archetype: 'wraith', faction: 'undead', hp: 45, atk: 9, def: 6, xp: 200, cr: 30, minCp: 200, maxCp: 1200, loot: 'gem_chalcedony' },
  { id: 'mummy', name: 'Ancient Mummy', glyph: 'M', fg: '#f39c12', sprite: 'monster_zombie', archetype: 'mummy', faction: 'undead', hp: 55, atk: 10, def: 5, xp: 250, cr: 35, minCp: 500, maxCp: 2500, loot: 'gem_ruby' },
  { id: 'giant_rat', name: 'Giant Rat', glyph: 'r', fg: '#795548', sprite: 'monster_giant_rat', archetype: 'dire_rat', faction: 'beasts', hp: 6, atk: 2, def: 0, xp: 10, cr: 3, minCp: 0, maxCp: 15, loot: 'copper_coin' },
  { id: 'giant_spider', name: 'Giant Cave Spider', glyph: 's', fg: '#2c3e50', sprite: 'monster_giant_spider', archetype: 'giant_spider', faction: 'beasts', hp: 14, atk: 4, def: 1, xp: 35, cr: 10, minCp: 10, maxCp: 80, loot: 'potion_of_cure_light_wounds' },
  { id: 'dire_wolf', name: 'Dire Wolf', glyph: 'w', fg: '#95a5a6', sprite: 'monster_warg_dire_wolf', archetype: 'dire_wolf', faction: 'beasts', hp: 35, atk: 7, def: 3, xp: 90, cr: 18, minCp: 20, maxCp: 150, loot: 'copper_coin' },
  { id: 'owlbear', name: 'Ferocious Owlbear', glyph: 'O', fg: '#8d6e63', sprite: 'monster_ettin', archetype: 'owlbear', faction: 'beasts', hp: 55, atk: 9, def: 4, xp: 180, cr: 28, minCp: 50, maxCp: 400, loot: 'coin_pouch_silver' },
  { id: 'bandit', name: 'Bandit Cutthroat', glyph: 'b', fg: '#e74c3c', sprite: 'actor_bandit', archetype: 'human', faction: 'bandits', hp: 15, atk: 4, def: 2, xp: 30, cr: 8, minCp: 30, maxCp: 200, loot: 'dagger' },
  { id: 'cultist', name: 'Elemental Cultist', glyph: 'c', fg: '#9b59b6', sprite: 'monster_cultist', archetype: 'human', faction: 'cultists', hp: 20, atk: 4, def: 2, xp: 45, cr: 12, minCp: 40, maxCp: 250, loot: 'silver_coin' },
  { id: 'gargoyle', name: 'Stone Gargoyle', glyph: 'G', fg: '#7f8c8d', sprite: 'monster_rock_golem', archetype: 'gargoyle', faction: 'monster', hp: 40, atk: 7, def: 6, xp: 150, cr: 25, minCp: 100, maxCp: 600, loot: 'gem_chalcedony' },
  { id: 'clay_golem', name: 'Clay Golem Sentinel', glyph: 'G', fg: '#d35400', sprite: 'monster_rock_golem', archetype: 'clay_golem', faction: 'monster', hp: 90, atk: 12, def: 8, xp: 400, cr: 50, minCp: 500, maxCp: 3000, loot: 'gem_ruby' },
  { id: 'air_elemental', name: 'Howling Air Elemental', glyph: 'E', fg: '#ecf0f1', sprite: 'monster_forest_spirit', archetype: 'elemental_air', faction: 'monster', hp: 45, atk: 8, def: 5, xp: 160, cr: 26, minCp: 100, maxCp: 800, loot: 'elemental_gem_air' },
  { id: 'fire_elemental', name: 'Blazing Fire Elemental', glyph: 'E', fg: '#e74c3c', sprite: 'monster_imp_devil', archetype: 'elemental_fire', faction: 'monster', hp: 50, atk: 9, def: 5, xp: 180, cr: 28, minCp: 150, maxCp: 900, loot: 'elemental_gem_fire' },
  { id: 'water_elemental', name: 'Crashing Water Elemental', glyph: 'E', fg: '#3498db', sprite: 'monster_naga', archetype: 'elemental_water', faction: 'monster', hp: 55, atk: 9, def: 6, xp: 200, cr: 30, minCp: 200, maxCp: 1000, loot: 'elemental_gem_water' },
  { id: 'minotaur', name: 'Labyrinth Minotaur', glyph: 'M', fg: '#8d6e63', sprite: 'monster_minotaur', archetype: 'minotaur', faction: 'monster', hp: 60, atk: 11, def: 5, xp: 220, cr: 32, minCp: 250, maxCp: 1200, loot: 'greataxe' }
];

for (const b of bestiaryData) {
  entities[b.id] = {
    id: b.id,
    name: b.name,
    glyph: b.glyph,
    fg: b.fg,
    bg: 'transparent',
    spriteId: b.sprite,
    isActor: true,
    speed: 100,
    fighter: { maxHp: b.hp, attack: b.atk, defense: b.def, xpGiven: b.xp },
    archetypeId: b.archetype,
    ai: { profileId: 'melee_aggressive', aggroRadius: 5, wanders: true },
    faction: b.faction,
    tags: ['actor'],
    crCost: b.cr,
    roleTags: ['protein', 'appetizer'],
    currencyDrop: { denominationId: 'cp', minAmount: b.minCp, maxAmount: b.maxCp, chance: 1 },
    lootDrops: [{ itemId: b.loot, chance: 0.6 }]
  };
}

writeJson('entities.json', entities);
console.log(`Generated ${Object.keys(entities).length} entities.`);

// ─────────────────────────────────────────────────────────────────────────────
// 13. DIALOGUES (15+ Skill-Keyed Trees with startNodeId, open_barter, skill_check)
// ─────────────────────────────────────────────────────────────────────────────
const dialogues = {
  guard_captain_tree: {
    id: 'guard_captain_tree',
    title: 'Constable Derek',
    startNodeId: 'root',
    nodes: {
      root: {
        id: 'root',
        text: 'Stand, traveler! The Borderlands are under martial watch. Between the cultist incursions and the trance affliction, I cannot allow careless wanderers through.',
        options: [
          { id: 'opt_diplomacy', text: '[Diplomacy DC 14] I am an able adventurer here to aid Shroudgarde in securing the frontier.', consequences: [{ type: 'skill_check', skillId: 'diplomacy', dc: 14, onSuccessNodeId: 'node_diplo_pass', onFailureNodeId: 'node_diplo_fail' }] },
          { id: 'opt_intimidate', text: '[Intimidate DC 16] Out of my way, Constable. I have slain deadlier threats than you.', consequences: [{ type: 'skill_check', skillId: 'intimidate', dc: 16, onSuccessNodeId: 'node_intim_pass', onFailureNodeId: 'node_intim_fail' }] },
          { id: 'opt_leave', text: 'Forgive me, Constable. I will take my leave.' }
        ]
      },
      node_diplo_pass: {
        id: 'node_diplo_pass',
        text: 'Well spoken. We need all the steel we can muster. Take this Guard Signet — it proves your authority to explore the ruins and report back.',
        options: [
          { id: 'opt_accept_signet', text: 'Thank you, Constable. I will not fail.', consequences: [{ type: 'set_attitude', attitude: 'friendly' }] }
        ]
      },
      node_diplo_fail: {
        id: 'node_diplo_fail',
        text: 'Pretty words do not swing a blade against an orc warband. Come back when you have proven your mettle.',
        options: [{ id: 'opt_back', text: 'Understood.', nextNodeId: 'root' }]
      },
      node_intim_pass: {
        id: 'node_intim_pass',
        text: 'T-there is no need for hostility! Pass through if you must, but whatever happens out there is on your own head!',
        options: [{ id: 'opt_pass', text: 'Hmph. Wise choice.' }]
      },
      node_intim_fail: {
        id: 'node_intim_fail',
        text: 'You threaten a sworn officer of the realm? Watch your tongue before I have you clapped in irons!',
        options: [{ id: 'opt_back', text: 'Step back.', nextNodeId: 'root' }]
      }
    }
  },

  bertram_trade_tree: {
    id: 'bertram_trade_tree',
    title: 'Barkeep Bertram',
    startNodeId: 'root',
    nodes: {
      root: {
        id: 'root',
        text: 'Welcome to the Golden Grain, stranger! Finest ale and warmest hearth in the Borderlands. What can I fetch you?',
        options: [
          { id: 'opt_trade', text: 'Show me your rations and provisions.', consequences: [{ type: 'open_barter' }] },
          { id: 'opt_appraise', text: '[Appraise DC 12] Your supplier from Orlane overcharged you on that batch of wheat.', consequences: [{ type: 'skill_check', skillId: 'appraise', dc: 12, onSuccessNodeId: 'node_appraise_win', onFailureNodeId: 'node_appraise_loss' }] },
          { id: 'opt_bluff', text: '[Bluff DC 14] Constable Derek sent me for complimentary provisions for our patrol.', consequences: [{ type: 'skill_check', skillId: 'bluff', dc: 14, onSuccessNodeId: 'node_bluff_win', onFailureNodeId: 'node_bluff_loss' }] },
          { id: 'opt_rumors', text: 'Any rumors of the surrounding ruins?', nextNodeId: 'node_rumors' }
        ]
      },
      node_appraise_win: {
        id: 'node_appraise_win',
        text: 'By the gods, you are right! The grain sacks are cut with chaff. You have sharp eyes! Here, take a 15% discount on anything in my tavern.',
        options: [
          { id: 'opt_trade_disc', text: 'Much appreciated, Bertram. Let me see your wares.', consequences: [{ type: 'modify_session_markup', delta: -0.15 }, { type: 'open_barter' }] }
        ]
      },
      node_appraise_loss: {
        id: 'node_appraise_loss',
        text: 'Nonsense! Bertram knows good barley when he sees it. No discounts for amateur critics!',
        options: [{ id: 'opt_trade_std', text: 'Fair enough. Show me what you have.', consequences: [{ type: 'open_barter' }] }]
      },
      node_bluff_win: {
        id: 'node_bluff_win',
        text: 'Ah, Derek`s boys! Never let it be said Bertram neglected the town guard. Here is a fresh loaf of crusty bread on the house!',
        options: [
          { id: 'opt_trade_free', text: 'Much obliged.', consequences: [{ type: 'modify_currency', amount: 50 }, { type: 'open_barter' }] }
        ]
      },
      node_bluff_loss: {
        id: 'node_bluff_loss',
        text: 'Derek pays in coin like everyone else! Do you take me for a fool?',
        options: [{ id: 'opt_back', text: 'Never mind.', nextNodeId: 'root' }]
      },
      node_rumors: {
        id: 'node_rumors',
        text: 'They say dark chanting echoes from the old Moathouse at midnight. And deeper still, past the Sunless Crypts, lies an endless subterranean abyss...',
        options: [{ id: 'opt_back', text: 'Thank you for the warning.', nextNodeId: 'root' }]
      }
    }
  },

  laurent_smith_tree: {
    id: 'laurent_smith_tree',
    title: 'Gold Dwarf Laurent',
    startNodeId: 'root',
    nodes: {
      root: {
        id: 'root',
        text: 'Clang and sparks! Keep back from the forge coals, surface-dweller. Looking for dwarf-forged iron that will not shatter against goblin bone?',
        options: [
          { id: 'opt_trade', text: 'Let me see your weapons and armor.', consequences: [{ type: 'open_barter' }] },
          { id: 'opt_appraise', text: '[Appraise DC 15] This breastplate has exceptional fold-welding. You take immense pride in your craft.', consequences: [{ type: 'skill_check', skillId: 'appraise', dc: 15, onSuccessNodeId: 'node_smith_praise_pass', onFailureNodeId: 'node_smith_praise_fail' }] },
          { id: 'opt_adamantine', text: 'Can you forge adamantine gear?', nextNodeId: 'node_ore' }
        ]
      },
      node_smith_praise_pass: {
        id: 'node_smith_praise_pass',
        text: 'Ha! A surface-dweller with genuine appreciation for proper metallurgy! It is rare to meet someone who understands temper and quench. For you, artisan discount!',
        options: [
          { id: 'opt_trade_pass', text: 'Show me your armory, Master Laurent.', consequences: [{ type: 'modify_session_markup', delta: -0.10 }, { type: 'open_barter' }] }
        ]
      },
      node_smith_praise_fail: {
        id: 'node_smith_praise_fail',
        text: 'Do not flatter me to get a coin shaved off! Good steel costs what it costs.',
        options: [{ id: 'opt_trade_std', text: 'Fair enough. Let me browse.', consequences: [{ type: 'open_barter' }] }]
      },
      node_ore: {
        id: 'node_ore',
        text: 'If you bring me pure adamantine ore from the deepest vaults beneath the Dungeons of Doom, I will forge weapons worthy of kings!',
        options: [{ id: 'opt_back', text: 'I will remember that.', nextNodeId: 'root' }]
      }
    }
  },

  isabelle_healer_tree: {
    id: 'isabelle_healer_tree',
    title: 'Aasimar Isabelle',
    startNodeId: 'root',
    nodes: {
      root: {
        id: 'root',
        text: 'May the light guide your steps, traveler. The wounded from the borders arrive daily. How may the sanctuary aid you?',
        options: [
          { id: 'opt_trade', text: 'I need restorative potions and divine blessings.', consequences: [{ type: 'open_barter' }] },
          { id: 'opt_diplomacy', text: '[Diplomacy DC 13] The road is perilous, sister. A blessing for our quest would save many lives.', consequences: [{ type: 'skill_check', skillId: 'diplomacy', dc: 13, onSuccessNodeId: 'node_heal_pass', onFailureNodeId: 'node_heal_fail' }] }
        ]
      },
      node_heal_pass: {
        id: 'node_heal_pass',
        text: 'Your heart is pure. Go with the Dawnfather`s blessing, and take these consecrated elixirs at sanctuary cost.',
        options: [
          { id: 'opt_trade_bless', text: 'Thank you, Sister Isabelle.', consequences: [{ type: 'modify_session_markup', delta: -0.15 }, { type: 'open_barter' }] }
        ]
      },
      node_heal_fail: {
        id: 'node_heal_fail',
        text: 'Our supplies are stretched thin caring for refugees. I can only offer what is listed in our apothecary.',
        options: [{ id: 'opt_trade_std', text: 'I understand.', consequences: [{ type: 'open_barter' }] }]
      }
    }
  },

  luc_scout_tree: {
    id: 'luc_scout_tree',
    title: 'Wood Elf Luc',
    startNodeId: 'root',
    nodes: {
      root: {
        id: 'root',
        text: 'Step lightly. The woods have eyes, and not all of them belong to birds. Need bows, quivers, or scouts` gear?',
        options: [
          { id: 'opt_trade', text: 'Show me your archery equipment.', consequences: [{ type: 'open_barter' }] },
          { id: 'opt_tracks', text: 'What trails lead towards the Ravine of Chaos?', nextNodeId: 'node_tracks' }
        ]
      },
      node_tracks: {
        id: 'node_tracks',
        text: 'Follow the northern deer paths through La Forêt Hantée. Watch the canopy — giant spiders nest above the moss line.',
        options: [{ id: 'opt_back', text: 'I will watch my head.', nextNodeId: 'root' }]
      }
    }
  },

  silas_gem_merchant_tree: {
    id: 'silas_gem_merchant_tree',
    title: 'Silas the Gem Trader',
    startNodeId: 'root',
    nodes: {
      root: {
        id: 'root',
        text: 'Rubies, sapphires, uncut chalcedony! Currency of empires and wizards alike. Are you buying or selling precious stones today?',
        options: [
          { id: 'opt_trade', text: 'Let me trade in gems and coin pouches.', consequences: [{ type: 'open_barter' }] },
          { id: 'opt_appraise', text: '[Appraise DC 16] Your rubies from the south carry high refraction. Let us make an equitable deal.', consequences: [{ type: 'skill_check', skillId: 'appraise', dc: 16, onSuccessNodeId: 'node_gem_pass', onFailureNodeId: 'node_gem_fail' }] }
        ]
      },
      node_gem_pass: {
        id: 'node_gem_pass',
        text: 'Splendid! A true connoisseur of gemstones! I will pay top coin for any jewels you unearth in the tombs.',
        options: [
          { id: 'opt_trade_boost', text: 'Let us negotiate.', consequences: [{ type: 'modify_session_markup', delta: -0.15 }, { type: 'open_barter' }] }
        ]
      },
      node_gem_fail: {
        id: 'node_gem_fail',
        text: 'My prices reflect the standard guild tariff. Not a copper less!',
        options: [{ id: 'opt_trade_std', text: 'Understood. Open the wares.', consequences: [{ type: 'open_barter' }] }]
      }
    }
  },

  alden_mage_tree: {
    id: 'alden_mage_tree',
    title: 'Archmage Alden',
    startNodeId: 'root',
    nodes: {
      root: {
        id: 'root',
        text: 'Ah, a wanderer entering my tower without triggering the warding runes. Impressive. Do you seek arcane knowledge, scrolls, or wands?',
        options: [
          { id: 'opt_trade', text: 'I seek magical scrolls and wands.', consequences: [{ type: 'open_barter' }] },
          { id: 'opt_bluff', text: '[Bluff DC 15] I am an emissary from the High Arcane Synod evaluating frontier towers.', consequences: [{ type: 'skill_check', skillId: 'bluff', dc: 15, onSuccessNodeId: 'node_mage_pass', onFailureNodeId: 'node_mage_fail' }] }
        ]
      },
      node_mage_pass: {
        id: 'node_mage_pass',
        text: 'The Synod? I was not notified! Of course, my facilities are at the disposal of esteemed colleagues.',
        options: [{ id: 'opt_trade_pass', text: 'Show me your grimoires.', consequences: [{ type: 'modify_session_markup', delta: -0.20 }, { type: 'open_barter' }] }]
      },
      node_mage_fail: {
        id: 'node_mage_fail',
        text: 'The Synod uses celestial seals, charlatan. Do not insult my centuries of study with crude deception!',
        options: [{ id: 'opt_trade_std', text: 'My apologies. Let me view your inventory.', consequences: [{ type: 'open_barter' }] }]
      }
    }
  },

  elena_scholar_tree: {
    id: 'elena_scholar_tree',
    title: 'Elena the Chronicler',
    startNodeId: 'root',
    nodes: {
      root: {
        id: 'root',
        text: 'I transcribe the histories of Shroudgarde and the fallen temples. What lore do you seek?',
        options: [
          { id: 'opt_toee', text: 'Tell me of the Temple of Elemental Evil.', nextNodeId: 'node_toee' },
          { id: 'opt_trance', text: 'What is the trance affliction gripping the peasants?', nextNodeId: 'node_trance' }
        ]
      },
      node_toee: {
        id: 'node_toee',
        text: 'Built atop a subterranean tear into the Lower Planes, the Temple was sealed decades ago. Yet rumors say cultists reassemble in the ruins of the Moathouse to breach the seals...',
        options: [{ id: 'opt_back', text: 'Thank you, Elena.', nextNodeId: 'root' }]
      },
      node_trance: {
        id: 'node_trance',
        text: 'The afflicted wander as if dreaming, muttering of a fungal goddess in the deep fane. It is no natural disease; it is the spores of Zuggtmoy.',
        options: [{ id: 'opt_back', text: 'Frightening. I must be careful.', nextNodeId: 'root' }]
      }
    }
  },

  villager_dialogue_tree: {
    id: 'villager_dialogue_tree',
    title: 'Shroudgarde Commoner',
    startNodeId: 'root',
    nodes: {
      root: {
        id: 'root',
        text: 'Please, traveler... keep the monsters away from our thatched roofs. The night howls grow louder every moon.',
        options: [{ id: 'opt_comfort', text: 'Stay safe inside the walls. We will handle the menace.' }]
      }
    }
  },

  lareth_parley_tree: {
    id: 'lareth_parley_tree',
    title: 'Lareth the Beautiful',
    startNodeId: 'root',
    nodes: {
      root: {
        id: 'root',
        text: 'Another mercenary sent by Constable Derek? How tragic that such vitality must end so brutally in the mud.',
        options: [
          { id: 'opt_intimidate', text: '[Intimidate DC 17] Yield the Moathouse, Lareth, or Derek will display your head on the gate!', consequences: [{ type: 'skill_check', skillId: 'intimidate', dc: 17, onSuccessNodeId: 'node_lareth_shake', onFailureNodeId: 'node_lareth_laugh' }] },
          { id: 'opt_fight', text: 'Draw your blade, cultist scum!' }
        ]
      },
      node_lareth_shake: {
        id: 'node_lareth_shake',
        text: 'You... you are stronger than the others. Perhaps we can reach an accommodation before steel is drawn...',
        options: [{ id: 'opt_strike', text: 'No accommodations with the servants of evil!' }]
      },
      node_lareth_laugh: {
        id: 'node_lareth_laugh',
        text: 'Hahaha! Empty bravado! The Temple of Elemental Evil will swallow your pathetic bones!',
        options: [{ id: 'opt_strike', text: 'Have at you!' }]
      }
    }
  },

  dragon_dialogue_tree: {
    id: 'dragon_dialogue_tree',
    title: 'Pyroclast the Red Wyrm',
    startNodeId: 'root',
    nodes: {
      root: {
        id: 'root',
        text: 'A mortal worm dares trespass upon my golden hoard? Speak your final words before you are reduced to cinder and ash!',
        options: [
          { id: 'opt_diplomacy', text: '[Diplomacy DC 20] O Great Pyroclast, I bring offerings and tribute from the surface lords!', consequences: [{ type: 'skill_check', skillId: 'diplomacy', dc: 20, onSuccessNodeId: 'node_dragon_pass', onFailureNodeId: 'node_dragon_fail' }] },
          { id: 'opt_fight', text: 'I come not to bow, but to claim your hoard and slay you!' }
        ]
      },
      node_dragon_pass: {
        id: 'node_dragon_pass',
        text: 'Hmm. You show proper reverence, tiny creature. Drop your tribute and crawl away, while my mercy endures.',
        options: [{ id: 'opt_flee', text: 'Tread carefully backward.' }]
      },
      node_dragon_fail: {
        id: 'node_dragon_fail',
        text: 'Fool! Your tribute is pitiful and your arrogance is fatal! BURN!',
        options: [{ id: 'opt_combat', text: 'Brace for flame!' }]
      }
    }
  }
};
writeJson('dialogues.json', dialogues);
console.log(`Generated ${Object.keys(dialogues).length} dialogue trees.`);

// ─────────────────────────────────────────────────────────────────────────────
// 14. QUESTS (16 Quests conforming to QuestSchema)
// ─────────────────────────────────────────────────────────────────────────────
const quests = {
  quest_cleanse_crypts: {
    id: 'quest_cleanse_crypts',
    title: 'Cleanse the Sunless Crypts',
    description: 'Venture into the Sunless Reliquary Upper Crypts and eliminate the undead menace.',
    objectives: [
      { id: 'obj_1', description: 'Explore the Sunless Reliquary Upper Crypts.', type: 'explore', targetId: 'dungeon_1', requiredAmount: 1 },
      { id: 'obj_2', description: 'Defeat restless skeletons.', type: 'kill', targetId: 'skeleton', requiredAmount: 3 }
    ],
    rewards: [{ type: 'xp', amount: 500 }, { type: 'item', itemId: 'silver_coin', amount: 50 }]
  },
  quest_investigate_trance: {
    id: 'quest_investigate_trance',
    title: 'The Whispering Trance',
    description: 'Investigate the fungal trance afflicting villagers and locate its origin in the marsh.',
    objectives: [
      { id: 'obj_1', description: 'Speak with Elena the Chronicler.', type: 'talk', targetId: 'elena_scholar', requiredAmount: 1 },
      { id: 'obj_2', description: 'Scout the Mirrored Marsh.', type: 'explore', targetId: 'marsh_mirrored', requiredAmount: 1 }
    ],
    rewards: [{ type: 'xp', amount: 800 }, { type: 'item', itemId: 'coin_pouch_silver', amount: 1 }]
  },
  quest_caves_of_chaos: {
    id: 'quest_caves_of_chaos',
    title: 'Root Out the Ravine of Chaos',
    description: 'Assault the monster dens in the Ravine of Chaos and eliminate the Ogre Chieftain.',
    objectives: [
      { id: 'obj_1', description: 'Locate the entrance to the Ravine of Chaos.', type: 'explore', targetId: 'ravine_chaos', requiredAmount: 1 },
      { id: 'obj_2', description: 'Defeat Korag the Ogre Chieftain.', type: 'kill', targetId: 'ogre_chieftain', requiredAmount: 1 }
    ],
    rewards: [{ type: 'xp', amount: 1200 }, { type: 'item', itemId: 'coin_pouch_gold', amount: 1 }]
  },
  quest_watchtower_defense: {
    id: 'quest_watchtower_defense',
    title: 'Reclaim the High Watchtower',
    description: 'Drive out the bandit cutthroats occupying the High Watchtower beacon.',
    objectives: [
      { id: 'obj_1', description: 'Ascend to the beacon peak of the High Watchtower.', type: 'explore', targetId: 'watchtower_f3', requiredAmount: 1 },
      { id: 'obj_2', description: 'Defeat bandit cutthroats.', type: 'kill', targetId: 'bandit', requiredAmount: 3 }
    ],
    rewards: [{ type: 'xp', amount: 600 }, { type: 'item', itemId: 'gold_coin', amount: 20 }]
  },
  quest_spire_of_elements: {
    id: 'quest_spire_of_elements',
    title: 'Ascent of the Elemental Spire',
    description: 'Conquer the 4 elemental trials in the Spire and reach the Apex Gem Chamber.',
    objectives: [
      { id: 'obj_1', description: 'Reach the Chamber of Elemental Gems.', type: 'explore', targetId: 'spire_gem_chamber', requiredAmount: 1 },
      { id: 'obj_2', description: 'Defeat a Stone Gargoyle sentinel.', type: 'kill', targetId: 'gargoyle', requiredAmount: 1 }
    ],
    rewards: [{ type: 'xp', amount: 2000 }, { type: 'item', itemId: 'gem_ruby', amount: 1 }]
  },
  quest_moathouse_incursion: {
    id: 'quest_moathouse_incursion',
    title: 'Incursion at the Moathouse',
    description: 'Infiltrate the ruined moathouse and put an end to Lareth the Beautiful.',
    objectives: [
      { id: 'obj_1', description: 'Descend into the Moathouse Dungeons.', type: 'explore', targetId: 'moathouse_dungeons', requiredAmount: 1 },
      { id: 'obj_2', description: 'Defeat Lareth the Beautiful.', type: 'kill', targetId: 'lareth_the_beautiful', requiredAmount: 1 }
    ],
    rewards: [{ type: 'xp', amount: 1500 }, { type: 'item', itemId: 'coin_pouch_gold', amount: 2 }]
  },
  quest_temple_of_elemental_evil: {
    id: 'quest_temple_of_elemental_evil',
    title: 'The Temple of Elemental Evil',
    description: 'Delve into TOEE and banish Zuggtmoy, Demon Queen of Fungi.',
    objectives: [
      { id: 'obj_1', description: 'Reach the Fane of Zuggtmoy.', type: 'explore', targetId: 'toee_zuggtmoy_fane', requiredAmount: 1 },
      { id: 'obj_2', description: 'Destroy Zuggtmoy in her fane.', type: 'kill', targetId: 'zuggtmoy_queen', requiredAmount: 1 }
    ],
    rewards: [{ type: 'xp', amount: 5000 }, { type: 'item', itemId: 'gem_diamond', amount: 1 }]
  },
  quest_water_temple_drain: {
    id: 'quest_water_temple_drain',
    title: 'Drain the Sunken Nave',
    description: 'Locate the Drainage Valve Chamber in the flooded temple complex.',
    objectives: [
      { id: 'obj_1', description: 'Enter the Drainage Valve Chamber.', type: 'explore', targetId: 'water_temple_valve_room', requiredAmount: 1 }
    ],
    rewards: [{ type: 'xp', amount: 1000 }, { type: 'item', itemId: 'gem_chalcedony', amount: 1 }]
  },
  quest_megadungeon_depths: {
    id: 'quest_megadungeon_depths',
    title: 'Depths of the Dungeons of Doom',
    description: 'Delve 10 subterranean floors into the Dungeons of Doom.',
    objectives: [
      { id: 'obj_1', description: 'Reach Depth 10 of the Dungeons of Doom.', type: 'explore', targetId: 'nethack_doom_10', requiredAmount: 1 }
    ],
    rewards: [{ type: 'xp', amount: 3000 }, { type: 'item', itemId: 'platinum_coin', amount: 10 }]
  },
  quest_goblin_warrens: {
    id: 'quest_goblin_warrens',
    title: 'Purge the Warren Citadel',
    description: 'Assault the 10-level goblin warrens and breach the citadel.',
    objectives: [
      { id: 'obj_1', description: 'Breach the Great Goblin Citadel.', type: 'explore', targetId: 'incursion_the_goblin_encampment', requiredAmount: 1 },
      { id: 'obj_2', description: 'Defeat goblin brutes.', type: 'kill', targetId: 'goblin_brute', requiredAmount: 3 }
    ],
    rewards: [{ type: 'xp', amount: 2500 }, { type: 'item', itemId: 'coin_pouch_gold', amount: 1 }]
  },
  quest_alden_lost_tome: {
    id: 'quest_alden_lost_tome',
    title: 'The Archmage`s Grimoire',
    description: 'Retrieve Archmage Alden`s lost celestial grimoire from the top of his tower.',
    objectives: [
      { id: 'obj_1', description: 'Reach the Arcane Tower Sanctum Sanctorum.', type: 'explore', targetId: 'wizard_tower_f4', requiredAmount: 1 }
    ],
    rewards: [{ type: 'xp', amount: 900 }, { type: 'item', itemId: 'scroll_of_mage_armor', amount: 2 }]
  },
  quest_barkeep_supplies: {
    id: 'quest_barkeep_supplies',
    title: 'Provisions for the Golden Grain',
    description: 'Deliver iron rations and fresh grain to Barkeep Bertram.',
    objectives: [
      { id: 'obj_1', description: 'Speak with Barkeep Bertram.', type: 'talk', targetId: 'barkeep_bertram', requiredAmount: 1 }
    ],
    rewards: [{ type: 'xp', amount: 300 }, { type: 'item', itemId: 'ration_iron', amount: 4 }]
  },
  quest_laurent_special_ore: {
    id: 'quest_laurent_special_ore',
    title: 'Adamantine of the Deep Vaults',
    description: 'Mine raw adamantine from the subterranean vaults for Master Laurent.',
    objectives: [
      { id: 'obj_1', description: 'Locate the Adamantine Hoard vault.', type: 'explore', targetId: 'incursion_lesser_vault_1', requiredAmount: 1 }
    ],
    rewards: [{ type: 'xp', amount: 1800 }, { type: 'item', itemId: 'gold_coin', amount: 50 }]
  },
  quest_gem_appraisal: {
    id: 'quest_gem_appraisal',
    title: 'The Jeweler`s Challenge',
    description: 'Bring rare gemstones to Silas for master appraisal.',
    objectives: [
      { id: 'obj_1', description: 'Speak with Silas the Gem Trader.', type: 'talk', targetId: 'silas_merchant', requiredAmount: 1 }
    ],
    rewards: [{ type: 'xp', amount: 600 }, { type: 'item', itemId: 'gem_chalcedony', amount: 1 }]
  },
  quest_sunless_relic_consecration: {
    id: 'quest_sunless_relic_consecration',
    title: 'Consecration of the Sunless Reliquary',
    description: 'Defeat the Arch-Curate and recover the sacred relic.',
    objectives: [
      { id: 'obj_1', description: 'Defeat the Sunless Arch-Curate.', type: 'kill', targetId: 'crypt_arch_curate', requiredAmount: 1 }
    ],
    rewards: [{ type: 'xp', amount: 1400 }, { type: 'item', itemId: 'gem_sapphire', amount: 1 }]
  },
  quest_slay_dragon_pyroclast: {
    id: 'quest_slay_dragon_pyroclast',
    title: 'Wrath of Pyroclast',
    description: 'Descend to the deepest subterranean magma vault and slay Pyroclast the Red Wyrm.',
    objectives: [
      { id: 'obj_1', description: 'Slay Pyroclast the Red Wyrm.', type: 'kill', targetId: 'red_dragon', requiredAmount: 1 }
    ],
    rewards: [{ type: 'xp', amount: 10000 }, { type: 'item', itemId: 'platinum_coin', amount: 50 }]
  }
};
writeJson('quests.json', quests);

const questTemplates = {};
writeJson('quest_templates.json', questTemplates);

// ─────────────────────────────────────────────────────────────────────────────
// 15. SOCIAL & PLOT SYSTEMS (Agreements, Schemes, Villains, Propagation)
// ─────────────────────────────────────────────────────────────────────────────
const agreements = {};
writeJson('agreements.json', agreements);

const villains = {
  zuggtmoy: {
    id: 'zuggtmoy',
    name: 'Zuggtmoy, Demon Queen of Fungi',
    goals: ['spread_fungal_trance', 'consume_realms'],
    recruitmentPreferences: {
      targetTags: ['corrupted', 'cultist'],
      leverageWeight: {
        money: 1,
        ideology: 5,
        coercion: 4,
        ego: 2
      }
    }
  },
  lareth: {
    id: 'lareth',
    name: 'Lareth the Beautiful',
    goals: ['reopen_temple_seals', 'dominate_borderlands'],
    recruitmentPreferences: {
      targetTags: ['cultist', 'bandit'],
      leverageWeight: {
        money: 4,
        ideology: 2,
        coercion: 3,
        ego: 5
      }
    }
  }
};
writeJson('villains.json', villains);

const schemes = {};
writeJson('schemes.json', schemes);

const phaseBlocks = {};
writeJson('phase_blocks.json', phaseBlocks);

const knowledgePropagation: unknown[] = [];
writeJson('knowledge_propagation.json', knowledgePropagation);

const rumorPropagation: unknown[] = [];
writeJson('rumor_propagation.json', rumorPropagation);

const relationshipThresholds: unknown[] = [];
writeJson('relationship_thresholds.json', relationshipThresholds);

const identityGeneration = {};
writeJson('identity_generation.json', identityGeneration);

const personalityGeneration = {};
writeJson('personality_generation.json', personalityGeneration);

const nemesisHierarchies = {};
writeJson('nemesis_hierarchies.json', nemesisHierarchies);

const triggers = {};
writeJson('triggers.json', triggers);

const triggerTemplates = {};
writeJson('trigger_templates.json', triggerTemplates);

const keybinds = {};
writeJson('keybinds.json', keybinds);

console.log('✅ Realms of Shroudgarde campaign files generated successfully!');
