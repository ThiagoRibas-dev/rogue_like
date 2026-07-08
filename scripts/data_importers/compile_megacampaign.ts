import * as fs from 'fs';
import * as path from 'path';
import { RawMonster, RawItem, RawStaticMap } from './types.ts';
import { prefixId, clamp, nethackAcToDefense, nethackSpeedToEngine, mapColor } from './utils.ts';
import { NETHACK_GLYPH_MAP, NETHACK_MATERIAL_MAP, NETHACK_FLAG_MAP, INCURSION_FLAG_MAP, INCURSION_MATERIAL_MAP } from './constants.ts';

const INTERMEDIATE_DIR = path.resolve(process.cwd(), 'scripts/data_importers/intermediate');
const OUT_DIR = path.resolve(process.cwd(), 'public/data/campaigns/megacampaign');
const DEFAULT_CAMPAIGN_DIR = path.resolve(process.cwd(), 'public/data/campaigns/default');

if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

function loadIntermediate<T>(filename: string): T[] {
  const filepath = path.join(INTERMEDIATE_DIR, filename);
  if (!fs.existsSync(filepath)) return [];
  return JSON.parse(fs.readFileSync(filepath, 'utf-8'));
}

function getTagsFromSource(source: string, rawFlags: string[], rawMaterial: string | undefined): string[] {
  const tags = new Set<string>();
  tags.add(source); // e.g., 'nethack' or 'incursion'
  
  if (source === 'nethack') {
    rawFlags.forEach(f => {
      const mapped = NETHACK_FLAG_MAP[f];
      if (mapped) mapped.forEach(t => tags.add(t));
    });
    if (rawMaterial) {
      const mapped = NETHACK_MATERIAL_MAP[rawMaterial];
      if (mapped) mapped.forEach(t => tags.add(t));
    }
  } else {
    rawFlags.forEach(f => {
      const mapped = INCURSION_FLAG_MAP[f];
      if (mapped) mapped.forEach(t => tags.add(t));
    });
    if (rawMaterial) {
      const mapped = INCURSION_MATERIAL_MAP[rawMaterial];
      if (mapped) mapped.forEach(t => tags.add(t));
    }
  }
  return Array.from(tags);
}

function compileEntities(monsters: RawMonster[]): void {
  console.log('Compiling entities...');
  const entities: Record<string, any> = {};
  const tagsSet = new Set<string>();

  // Deduplicate monsters by rawId, preferring incursion
  const deduplicated = new Map<string, RawMonster>();
  for (const m of monsters) {
    if (deduplicated.has(m.rawId) && deduplicated.get(m.rawId)!.source === 'incursion' && m.source === 'nethack') {
      continue; // Skip nethack if incursion already exists
    }
    deduplicated.set(m.rawId, m);
  }

  for (const m of deduplicated.values()) {
    const id = m.rawId; // Dropped the source prefix
    let speed = m.speed;
    let defense = m.ac;
    let maxHp = m.hp;
    let crCost = m.level;
    let attack = 1;
    let glyph = m.glyph;

    if (m.source === 'nethack') {
      speed = nethackSpeedToEngine(m.speed);
      defense = nethackAcToDefense(m.ac);
      maxHp = clamp(m.level * 8, 1, 500);
      crCost = clamp(m.level * 2, 1, 100);
      glyph = NETHACK_GLYPH_MAP[m.glyph] || m.glyph.charAt(m.glyph.length - 1);
      // Average NetHack attacks for engine attack bonus (simplified)
      if (m.attacks.length > 0) {
        attack = clamp(m.attacks.length * 2, 1, 50); // very rough approx
      }
    } else {
      speed = clamp(m.speed, 50, 200);
      defense = clamp(m.ac, 0, 30);
      maxHp = clamp(m.hp, 1, 500);
      crCost = clamp(m.level, 1, 100);
      attack = clamp(Math.round(crCost * 1.5), 1, 50);
    }

    const tags = getTagsFromSource(m.source, m.flags, m.material);
    tags.forEach(t => tagsSet.add(t));

    // Determine AI Profile
    let profileId = 'melee_aggressive';
    if (tags.includes('flyer')) profileId = 'melee_aggressive'; // Maybe tweak later
    
    // Determine Faction
    let faction = 'monster';

    entities[id] = {
      id,
      name: m.name,
      glyph,
      fg: mapColor(m.source, m.color),
      bg: 'transparent',
      isActor: true,
      speed,
      fighter: {
        maxHp,
        attack,
        defense,
        xpGiven: crCost * 10
      },
      ai: {
        profileId,
        aggroRadius: 5,
        wanders: true
      },
      faction,
      crCost,
      roleTags: ['protein'],
      tags
    };
  }

  // Also import ALL default entities to satisfy default spawn pools (chests, etc.)
  const defaultEntities = JSON.parse(fs.readFileSync(path.join(DEFAULT_CAMPAIGN_DIR, 'entities.json'), 'utf-8'));
  for (const [key, val] of Object.entries(defaultEntities)) {
    if (!entities[key]) {
      entities[key] = val;
    }
  }

  fs.writeFileSync(path.join(OUT_DIR, 'entities.json'), JSON.stringify(entities, null, 2));

  // Write new tags to tag_registry.json
  compileTagRegistry(Array.from(tagsSet));
}

function compileItems(rawItems: RawItem[]): void {
  console.log('Compiling items and effects...');
  const items: Record<string, any> = {};
  const effects: Record<string, any> = {};
  const tagsSet = new Set<string>();

  // Copy default effects first so we don't overwrite standard ones
  const defaultEffects = JSON.parse(fs.readFileSync(path.join(DEFAULT_CAMPAIGN_DIR, 'effects.json'), 'utf-8'));
  Object.assign(effects, defaultEffects);

  // Deduplicate items by rawId, preferring incursion
  const deduplicated = new Map<string, RawItem>();
  for (const item of rawItems) {
    if (deduplicated.has(item.rawId) && deduplicated.get(item.rawId)!.source === 'incursion' && item.source === 'nethack') {
      continue; // Skip nethack if incursion already exists
    }
    deduplicated.set(item.rawId, item);
  }

  for (const item of deduplicated.values()) {
    const id = item.rawId; // Dropped the source prefix
    const tags = getTagsFromSource(item.source, item.flags, item.material);
    tags.forEach(t => tagsSet.add(t));
    
    const baseItem: any = {
      id,
      name: item.name,
      unidentifiedName: item.category.charAt(0).toUpperCase() + item.category.slice(1),
      description: `A ${item.category} from ${item.source}.`,
      glyph: item.glyph,
      fg: mapColor(item.source, item.color),
      bg: 'transparent',
      category: 'tool', // placeholder
      tags,
      weight: clamp(item.weight, 0, 100),
      baseValue: item.cost
    };

    if (item.category === 'weapon') {
      baseItem.category = 'weapon';
      let attackBonus = item.smallDamage || 0;
      baseItem.equippable = {
        slot: 'hand',
        attackBonus: clamp(attackBonus, 1, 20),
        defenseBonus: 0,
        maxHpBonus: 0,
        carryBonus: 0
      };
    } else if (item.category === 'armor') {
      baseItem.category = 'armor';
      baseItem.equippable = {
        slot: 'torso',
        attackBonus: 0,
        defenseBonus: clamp(item.acBonus || 1, 1, 15),
        maxHpBonus: 0,
        carryBonus: 0
      };
    } else if (item.category === 'potion' || item.category === 'scroll') {
      baseItem.category = 'consumable';
      const effectId = `${id}_effect`;
      baseItem.consumable = { effectId, charges: 1 };
      
      // Auto-generate effect
      effects[effectId] = {
        id: effectId,
        type: 'heal', // Fallback
        value: 10,
        message: `You use the ${item.name}.`
      };
    } else if (item.category === 'ring') {
      baseItem.category = 'armor';
      baseItem.equippable = {
        slot: 'finger',
        attackBonus: 0,
        defenseBonus: 1,
        maxHpBonus: 0,
        carryBonus: 0
      };
      if (item.power) {
        baseItem.traits = [item.power];
      }
    }

    items[id] = baseItem;
  }

  // Also import ALL default items to satisfy references from default entities (like merchant shop inventories)
  const defaultItems = JSON.parse(fs.readFileSync(path.join(DEFAULT_CAMPAIGN_DIR, 'items.json'), 'utf-8'));
  for (const [key, val] of Object.entries(defaultItems)) {
    if (!items[key]) {
      items[key] = val;
    }
  }

  fs.writeFileSync(path.join(OUT_DIR, 'items.json'), JSON.stringify(items, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, 'effects.json'), JSON.stringify(effects, null, 2));

  // Write new tags (merging with existing set from entities)
  compileTagRegistry(Array.from(tagsSet), true);
}

function compileTagRegistry(newTags: string[], append: boolean = false): void {
  const registryPath = path.join(OUT_DIR, 'tag_registry.json');
  const registry: Record<string, any> = append && fs.existsSync(registryPath) ? JSON.parse(fs.readFileSync(registryPath, 'utf-8')) : {};
  
  if (!append) {
    // Start by copying default
    const defaultRegistry = JSON.parse(fs.readFileSync(path.join(DEFAULT_CAMPAIGN_DIR, 'tag_registry.json'), 'utf-8'));
    Object.assign(registry, defaultRegistry);
  }

  for (const tag of newTags) {
    if (!registry[tag]) {
      registry[tag] = {
        category: 'misc',
        color: '#ffffff',
        description: `Imported tag: ${tag}`
      };
    }
  }

  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
}

function compileAreasAndPools(): void {
  console.log('Compiling areas and spawn pools...');
  const rawMaps: RawStaticMap[] = loadIntermediate('incursion_maps_raw.json');
  const allMonsters = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'entities.json'), 'utf-8'));
  
  const areas: Record<string, any> = {};
  
  // Hub
  areas['megadungeon_hub'] = {
    id: 'megadungeon_hub',
    name: 'Megadungeon Hub',
    generatorType: 'static',
    dangerRating: 0,
    tags: ['hub', 'safe'],
    connections: [
      { targetAreaId: 'nethack_doom_1', direction: 'down', placementX: 2, placementY: 2 },
      { targetAreaId: 'incursion_goblin_1', direction: 'down', placementX: 12, placementY: 2 }
    ],
    staticMap: {
      layout: [
        "###############",
        "#.............#",
        "#.>.........>.#",
        "#.............#",
        "###############"
      ],
      legend: { "#": "stone_wall", ".": "stone_floor", ">": "stone_floor" }
    }
  };

  // Generate NetHack Dungeons of Doom (1-10)
  for (let i = 1; i <= 10; i++) {
    const dr = Math.ceil(i / 3);
    const id = `nethack_doom_${i}`;
    areas[id] = {
      id,
      name: `Dungeons of Doom ${i}`,
      generatorType: 'digger',
      dangerRating: dr,
      crBudget: dr * 15 + 10,
      encounterProfileId: 'standard_dungeon',
      tags: ['dungeon', 'nethack'],
      connections: [
        { 
          targetAreaId: i === 1 ? 'megadungeon_hub' : `nethack_doom_${i - 1}`, 
          direction: 'up',
          ...(i === 1 ? { targetX: 2, targetY: 2 } : {})
        },
        { 
          targetAreaId: i === 10 ? 'megadungeon_hub' : `nethack_doom_${i + 1}`, 
          direction: 'down',
          ...(i === 10 ? { targetX: 7, targetY: 2 } : {}) 
        }
      ]
    };
  }

  // Generate Incursion Goblin Caves (1-10)
  for (let i = 1; i <= 10; i++) {
    const dr = Math.ceil(i / 3);
    const id = `incursion_goblin_${i}`;
    areas[id] = {
      id,
      name: `Goblin Caves ${i}`,
      generatorType: 'cellular',
      dangerRating: dr,
      crBudget: dr * 15 + 10,
      encounterProfileId: 'standard_dungeon',
      tags: ['cave', 'incursion'],
      connections: [
        { 
          targetAreaId: i === 1 ? 'megadungeon_hub' : `incursion_goblin_${i - 1}`, 
          direction: 'up',
          ...(i === 1 ? { targetX: 12, targetY: 2 } : {})
        },
        { 
          targetAreaId: i === 10 ? 'megadungeon_hub' : `incursion_goblin_${i + 1}`, 
          direction: 'down',
          ...(i === 10 ? { targetX: 7, targetY: 2 } : {}) 
        }
      ]
    };
  }

  // Inject any parsed static rooms from Incursion as special sub-areas or standalone (e.g., boss room)
  for (const m of rawMaps) {
    const id = prefixId('incursion', m.rawId);
    areas[id] = {
      id,
      name: m.name,
      generatorType: 'static',
      dangerRating: 4,
      tags: ['static', 'incursion'],
      connections: [
        { targetAreaId: 'megadungeon_hub', direction: 'up', targetX: 7, targetY: 2 } 
      ],
      staticMap: {
        layout: m.layout,
        legend: {
          "%": "stone_wall",
          ".": "stone_floor",
          " ": "empty_space"
        },
        entityLegend: {}
      }
    };
    // Map Incursion legend to engine tiles as best effort
    for (const [char, srcName] of Object.entries(m.legend)) {
      if (!areas[id].staticMap.legend[char]) {
        areas[id].staticMap.legend[char] = "stone_floor";
      }
    }

    // Auto-resolve stray characters: if it's a glyph used by an entity, spawn that entity!
    for (const row of m.layout) {
      for (const char of row) {
        if (!areas[id].staticMap.legend[char] && !areas[id].staticMap.entityLegend[char]) {
           const matchingMonsterId = Object.keys(allMonsters).find(key => allMonsters[key].glyph === char && allMonsters[key].isActor);
           
           if (matchingMonsterId) {
             areas[id].staticMap.entityLegend[char] = matchingMonsterId;
           }
           
           // We always need a floor tile underneath whatever it is
           areas[id].staticMap.legend[char] = "stone_floor"; 
        }
      }
    }

    // Fix unreachable validation: add a connection from the hub to this area
    areas['megadungeon_hub'].connections.push({
      targetAreaId: id,
      direction: 'down',
      placementX: 7,
      placementY: 2
    });
  }

  fs.writeFileSync(path.join(OUT_DIR, 'areas.json'), JSON.stringify(areas, null, 2));

  // Build Spawn Pools
  console.log('Compiling spawn pools...');
  const spawnPools: Record<string, any> = {};
  
  // Group monsters by CR
  const tiers = { 1: [], 2: [], 3: [], 4: [] } as Record<number, string[]>;
  for (const key of Object.keys(allMonsters)) {
    const m = allMonsters[key];
    if (!m.isActor || key === 'player' || m.crCost === undefined) continue;
    let tier = 1;
    if (m.crCost >= 5 && m.crCost < 10) tier = 2;
    if (m.crCost >= 10 && m.crCost < 20) tier = 3;
    if (m.crCost >= 20) tier = 4;
    tiers[tier].push(key);
  }

  for (const tier of [1, 2, 3, 4]) {
    const id = `tier_${tier}_monsters`;
    const entitiesRecord: Record<string, number> = {};
    for (const mId of tiers[tier]) {
      // Weight is inversely proportional to CR tier roughly
      entitiesRecord[mId] = Math.max(1, 100 - (tier * 20)); 
    }

    spawnPools[id] = {
      id,
      name: `Tier ${tier} Monsters`,
      conditions: {}, // Applies globally for simplicity, or we could filter by tags
      entities: entitiesRecord
    };
  }

  // Also copy default spawn pools (like chests)
  const defaultPools = JSON.parse(fs.readFileSync(path.join(DEFAULT_CAMPAIGN_DIR, 'spawn_pools.json'), 'utf-8'));
  if (defaultPools.dungeon_appetizers) spawnPools.dungeon_appetizers = defaultPools.dungeon_appetizers;

  fs.writeFileSync(path.join(OUT_DIR, 'spawn_pools.json'), JSON.stringify(spawnPools, null, 2));
}

function copySupportingFiles(): void {
  console.log('Copying supporting files...');
  const toCopy = [
    'factions.json',
    'theme.json',
    'status.json',
    'trigger_templates.json',
    'reactions.json',
    'ai.json',
    'tiles.json',
    'encounter_profiles.json',
    'advancement.json',
    'fields.json',
    'trait_registry.json',
    'identity_generation.json'
  ];

  for (const file of toCopy) {
    const content = fs.readFileSync(path.join(DEFAULT_CAMPAIGN_DIR, file), 'utf-8');
    fs.writeFileSync(path.join(OUT_DIR, file), content);
  }

  // Create empty arrays/objects for unsupported systems
  fs.writeFileSync(path.join(OUT_DIR, 'dialogues.json'), '{}');
  fs.writeFileSync(path.join(OUT_DIR, 'quests.json'), '{}');
  fs.writeFileSync(path.join(OUT_DIR, 'quest_templates.json'), '{}');
  fs.writeFileSync(path.join(OUT_DIR, 'schemes.json'), '{}');
  fs.writeFileSync(path.join(OUT_DIR, 'villains.json'), '{}');
  fs.writeFileSync(path.join(OUT_DIR, 'phase_blocks.json'), '{}');
  fs.writeFileSync(path.join(OUT_DIR, 'agreements.json'), '{}');
  fs.writeFileSync(path.join(OUT_DIR, 'triggers.json'), '{}');
  fs.writeFileSync(path.join(OUT_DIR, 'nemesis_hierarchies.json'), '{}');
  fs.writeFileSync(path.join(OUT_DIR, 'knowledge_propagation.json'), '[]');
  fs.writeFileSync(path.join(OUT_DIR, 'rumor_propagation.json'), '[]');

  // Modify rules.json
  const rules = JSON.parse(fs.readFileSync(path.join(DEFAULT_CAMPAIGN_DIR, 'rules.json'), 'utf-8'));
  rules.map.startingAreaId = 'megadungeon_hub';
  fs.writeFileSync(path.join(OUT_DIR, 'rules.json'), JSON.stringify(rules, null, 2));
}

function main() {
  const nethackMonsters = loadIntermediate<RawMonster>('nethack_monsters_raw.json');
  const incursionMonsters = loadIntermediate<RawMonster>('incursion_monsters_raw.json');
  compileEntities([...nethackMonsters, ...incursionMonsters]);

  const nethackItems = loadIntermediate<RawItem>('nethack_items_raw.json');
  const incursionItems = loadIntermediate<RawItem>('incursion_items_raw.json');
  compileItems([...nethackItems, ...incursionItems]);

  compileAreasAndPools();
  copySupportingFiles();
  
  console.log('Megacampaign compilation complete!');
}

main();
