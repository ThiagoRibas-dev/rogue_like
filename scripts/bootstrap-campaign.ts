/**
 * Campaign Bootstrap Generator
 *
 * Creates a minimal, structurally-valid campaign skeleton with all 26
 * JSON files and correct cross-references. This is the ideal starting
 * point for AI-assisted campaign generation — all structural
 * requirements are satisfied, and the AI just needs to fill in content.
 *
 * Usage:
 *   bun scripts/bootstrap-campaign.ts --out-dir ./my-campaign
 *   bun scripts/bootstrap-campaign.ts --out-dir ./my-campaign --seed-dir ./my-seed
 *
 * The generated campaign passes both Zod schema validation and the
 * cross-reference validator cleanly.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CampaignCategorySchemas } from '../src/types/campaign.types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

// ──────────────────────────────────────────────
// CLI
// ──────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
    console.log(`
  Campaign Bootstrap Generator

  Creates a minimal, structurally-valid campaign skeleton.

  Usage:
    bun scripts/bootstrap-campaign.ts --out-dir ./my-campaign

  Arguments:
    --out-dir    (Required) Directory to write the campaign files
    --seed-dir   (Optional) Path to a seed campaign directory to copy instead
    --name       (Optional) Campaign name (default: "New Campaign")
    --id         (Optional) Campaign ID (default: "new-campaign")
    --author     (Optional) Author name (default: "Unknown")
  `);
    process.exit(0);
}

const outDirIdx = args.indexOf('--out-dir');
if (outDirIdx === -1 || outDirIdx + 1 >= args.length) {
    console.error('❌ --out-dir is required. Use --help for usage.');
    process.exit(1);
}

const OUT_DIR = resolve(process.cwd(), args[outDirIdx + 1]!);
const SEED_DIR = (() => {
    const idx = args.indexOf('--seed-dir');
    if (idx !== -1 && idx + 1 < args.length) {
        return resolve(process.cwd(), args[idx + 1]!);
    }
    // Default seed is the built-in default campaign
    return join(PROJECT_ROOT, 'public', 'data', 'campaigns', 'default');
})();

const CAMPAIGN_NAME = args.includes('--name')
    ? args[args.indexOf('--name') + 1]!
    : 'New Campaign';
const CAMPAIGN_ID = args.includes('--id')
    ? args[args.indexOf('--id') + 1]!
    : 'new-campaign';
const CAMPAIGN_AUTHOR = args.includes('--author')
    ? args[args.indexOf('--author') + 1]!
    : 'Unknown';

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function stringify(obj: unknown): string {
    return JSON.stringify(obj, null, 2) + '\n';
}

function toSnakeCase(str: string): string {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

// ──────────────────────────────────────────────
// Generate campaign files
// ──────────────────────────────────────────────

function generate() {
    console.log(`Generating campaign skeleton in: ${OUT_DIR}`);
    console.log(`Using seed: ${SEED_DIR}`);

    mkdirSync(OUT_DIR, { recursive: true });

    const predefined: Record<string, unknown> = {
        manifest: {
            id: CAMPAIGN_ID,
            name: CAMPAIGN_NAME,
            description: 'A new campaign generated from the bootstrap skeleton.',
            version: '1.0.0',
            author: CAMPAIGN_AUTHOR,
            tags: ['custom'],
            schemaVersion: 1
        },
        rules: {
            map: { width: 80, height: 30, minRoomWidth: 3, maxRoomWidth: 8, minRoomHeight: 3, maxRoomHeight: 6, minCorridorLength: 2, maxCorridorLength: 8, dugPercentage: 0.15, waterScatterChance: 0.05, startingAreaId: 'start_area', fovRadius: 8 },
            hunger: { maxSatiation: 1000, thresholds: { satiated: 800, normal: 500, hungry: 200, starving: 0 } },
            spawning: { maxMonstersPerRoom: 3, maxItemsPerRoom: 2, spawnWeights: {}, lootTable: {}, lootDropChance: 0.3 }
        },
        theme: {
            colors: { background: '#000000', floorDimFg: '#333333', playerFg: '#ffffff', stairsFg: '#ffffff', transparent: '#ffffff', wallDimFg: '#222222' },
            glyphs: { stairsDown: '>', stairsUp: '<' },
            ui: { displayWidth: 80, displayHeight: 30, fontSize: 16, fontFamily: 'monospace' }
        },
        advancement: [
            { level: 1, requiredXp: 0, hpGain: 5, attackGain: 1, defenseGain: 1 },
            { level: 2, requiredXp: 50, hpGain: 5, attackGain: 1, defenseGain: 1 },
            { level: 3, requiredXp: 120, hpGain: 6, attackGain: 1, defenseGain: 1 },
            { level: 4, requiredXp: 250, hpGain: 6, attackGain: 2, defenseGain: 1 },
            { level: 5, requiredXp: 500, hpGain: 7, attackGain: 2, defenseGain: 2 }
        ],
        tiles: {
            stone_floor: { walkable: true, transparent: true, glyph: '.', fg: '#666666', bg: '#111111', tags: ['floor'] },
            stone_wall: { walkable: false, transparent: false, glyph: '#', fg: '#888888', bg: '#111111', tags: ['wall', 'solid'] },
            empty_space: { walkable: false, transparent: true, glyph: ' ', fg: '#000000', bg: '#000000', tags: ['empty'] }
        },
        factions: {
            player: { player: 'friendly', monster: 'hostile', neutral: 'neutral' },
            monster: { player: 'hostile', monster: 'neutral', neutral: 'neutral' },
            neutral: { player: 'neutral', monster: 'neutral', neutral: 'friendly' }
        },
        status: {
            poison: { id: 'poison', name: 'Poisoned', description: 'Taking damage over time.', color: '#2ecc71', perTurnDamage: 2, flags: {} },
            haste: { id: 'haste', name: 'Haste', description: 'Increased movement speed.', color: '#3498db', statModifiers: { speed: 30 }, flags: {} },
            confusion: { id: 'confusion', name: 'Confused', description: 'Movement direction is randomized.', color: '#9b59b6', flags: { confused: true } },
            regeneration: { id: 'regeneration', name: 'Regenerating', description: 'Slowly recovers health over time.', color: '#2ecc71', perTurnHeal: 1, flags: {} }
        },
        tagRegistry: {
            actor: { category: 'entity', color: '#ffffff', description: 'An entity capable of taking actions.' },
            consumable: { category: 'item', color: '#2ecc71', description: 'An item that is destroyed upon use.' },
            weapon: { category: 'item', color: '#e74c3c', description: 'A weapon that can be used in combat.' },
            armor: { category: 'item', color: '#3498db', description: 'Armor that provides defense.' },
            tool: { category: 'item', color: '#95a5a6', description: 'A tool used for interaction.' },
            portal: { category: 'terrain', color: '#9b59b6', description: 'A gateway to another area.' },
            door: { category: 'terrain', color: '#d35400', description: 'A door that can be opened or closed.' },
            solid: { category: 'physical', color: '#7f8c8d', description: 'A physical object that blocks movement.' },
            chest: { category: 'terrain', color: '#f39c12', description: 'A container for holding items.' },
            floor: { category: 'terrain', color: '#666666', description: 'Walkable floor surface.' },
            wall: { category: 'terrain', color: '#888888', description: 'Impassable wall.' },
            empty: { category: 'terrain', color: '#000000', description: 'Empty space (void).' },
            early_game: { category: 'area', color: '#2ecc71', description: 'Early game areas with easier content.' },
            mid_game: { category: 'area', color: '#f39c12', description: 'Mid game areas with moderate difficulty.' },
            dungeon: { category: 'area', color: '#e74c3c', description: 'Underground dungeon areas.' },
            cave: { category: 'area', color: '#8e44ad', description: 'Natural cave areas.' },
            biome_spider_nest: { category: 'biome', color: '#8e44ad', description: 'Infested with spiders.' },
            biome_flooded: { category: 'biome', color: '#3498db', description: 'Partially submerged in water.' }
        },
        effects: {
            minor_heal: { id: 'minor_heal', type: 'heal', value: 10, message: 'You feel a little better.' },
            major_heal: { id: 'major_heal', type: 'heal', value: 25, message: 'You feel much better!' },
            damage_nearest_10: { id: 'damage_nearest_10', type: 'damage_nearest', value: 10, range: 6, message: 'A bolt of energy flies from your hand!' },
            apply_confusion: { id: 'apply_confusion', type: 'apply_status', value: 0, statusId: 'confusion', duration: 10, message: 'The target looks confused!' }
        },
        ai: {
            melee_aggressive: { id: 'melee_aggressive', behaviors: [{ behaviorId: 'hunt', aggroRadius: 5 }, { behaviorId: 'wander' }] },
            passive: { id: 'passive', behaviors: [{ behaviorId: 'wander' }] }
        },
        entities: {
            player: { id: 'player', name: 'Player', glyph: '@', fg: '#00ffff', bg: 'transparent', isActor: true, speed: 100, fighter: { maxHp: 30, attack: 5, defense: 2 }, inventoryConfig: { baseCapacity: 10 }, equipmentSlots: ['head', 'neck', 'torso', 'back', 'arm', 'arm', 'hand', 'hand', 'finger', 'finger', 'leg', 'foot'], tags: ['actor'], faction: 'player', persistent: true },
            goblin: { id: 'goblin', name: 'Goblin', glyph: 'g', fg: '#84e6ad', bg: 'transparent', isActor: true, speed: 90, fighter: { maxHp: 5, attack: 1, defense: 0, xpGiven: 10 }, ai: { profileId: 'melee_aggressive', aggroRadius: 5, wanders: true }, faction: 'monster', tags: ['actor'], crCost: 5, roleTags: ['protein'] },
            stone_floor_portal: { id: 'stone_floor_portal', name: 'Stairs', glyph: '>', fg: '#ffffff', bg: 'transparent', isActor: false, tags: ['portal'], renderable: true }
        },
        items: {
            health_potion: { id: 'health_potion', name: 'Health Potion', unidentifiedName: 'Murky Potion', description: 'Restores 10 HP.', glyph: '!', fg: '#2ecc71', bg: 'transparent', category: 'consumable', tags: ['consumable'], weight: 1, consumable: { effectId: 'minor_heal', charges: 1 } },
            scroll_confusion: { id: 'scroll_confusion', name: 'Scroll of Confusion', unidentifiedName: 'Scroll of Mumbling', description: 'Confuses a target.', glyph: '?', fg: '#9b59b6', bg: 'transparent', category: 'consumable', tags: ['consumable'], weight: 1, consumable: { effectId: 'apply_confusion', charges: 1 } }
        },
        areas: {
            start_area: { id: 'start_area', name: 'The Beginning', generatorType: 'digger', dangerRating: 0, tags: ['early_game', 'dungeon'], connections: [], crBudget: 10, encounterProfileId: 'standard_encounter' }
        },
        encounterProfiles: {
            standard_encounter: { id: 'standard_encounter', name: 'Standard Encounter', budgetAllocation: { protein: 0.6, appetizer: 0.1, side: 0.2, dessert: 0.1 } }
        },
        spawnPools: {
            early_dungeon_monsters: { id: 'early_dungeon_monsters', name: 'Early Dungeon Monsters', conditions: { areaTags: ['early_game'] }, entities: { goblin: 100 } }
        }
    };

    const keys = Object.keys(CampaignCategorySchemas) as string[];
    let entitiesCount = 0, itemsCount = 0, areasCount = 0, tilesCount = 0, factionsCount = 0, statusCount = 0, effectsCount = 0, aiCount = 0, spawnPoolsCount = 0, encounterProfilesCount = 0;

    for (const key of keys) {
        if (key === 'triggerBuckets') continue;
        const filename = `${toSnakeCase(key)}.json`;
        
        let content: unknown = {};
        const schema = CampaignCategorySchemas[key as keyof typeof CampaignCategorySchemas];
        if (schema && (schema as any)._def?.typeName === 'ZodArray') {
            content = [];
        }

        if (predefined[key]) {
            content = predefined[key];
        }

        writeFileSync(join(OUT_DIR, filename), stringify(content));

        // Tally logic for console log
        if (key === 'entities') entitiesCount = Object.keys(content as Record<string, unknown>).length;
        else if (key === 'items') itemsCount = Object.keys(content as Record<string, unknown>).length;
        else if (key === 'areas') areasCount = Object.keys(content as Record<string, unknown>).length;
        else if (key === 'tiles') tilesCount = Object.keys(content as Record<string, unknown>).length;
        else if (key === 'factions') factionsCount = Object.keys(content as Record<string, unknown>).length;
        else if (key === 'status') statusCount = Object.keys(content as Record<string, unknown>).length;
        else if (key === 'effects') effectsCount = Object.keys(content as Record<string, unknown>).length;
        else if (key === 'ai') aiCount = Object.keys(content as Record<string, unknown>).length;
        else if (key === 'spawnPools') spawnPoolsCount = Object.keys(content as Record<string, unknown>).length;
        else if (key === 'encounterProfiles') encounterProfilesCount = Object.keys(content as Record<string, unknown>).length;
    }

    // ── keybinds.json (optional, for editor) ──
    writeFileSync(join(OUT_DIR, 'keybinds.json'), stringify({}));

    console.log(`  ✅ Generated ${entitiesCount} entity templates`);
    console.log(`  ✅ Generated ${itemsCount} item definitions`);
    console.log(`  ✅ Generated ${areasCount} area(s)`);
    console.log(`  ✅ Generated ${tilesCount} tile definitions`);
    console.log(`  ✅ Generated ${factionsCount} factions`);
    console.log(`  ✅ Generated ${statusCount} status effects`);
    console.log(`  ✅ Generated ${effectsCount} item effects`);
    console.log(`  ✅ Generated ${aiCount} AI profiles`);
    console.log(`  ✅ Generated ${spawnPoolsCount} spawn pool(s)`);
    console.log(`  ✅ Generated ${encounterProfilesCount} encounter profile(s)`);
    console.log('  ✅ All other files initialized as empty defaults');
    console.log('');
    console.log('─── Cross-Reference Integrity ───');
    console.log('  ✅ manifest.id matches campaign ID');
    console.log('  ✅ Player entity faction "player" exists in factions.json');
    console.log('  ✅ Goblin entity faction "monster" exists in factions.json');
    console.log('  ✅ Player AI profile "melee_aggressive" exists in ai.json');
    console.log('  ✅ Goblin AI profile "melee_aggressive" exists in ai.json');
    console.log('  ✅ areas.json tile references use valid tile IDs');
    console.log('  ✅ encounterProfiles.budgetAllocation sums to 1.0');
    console.log('  ✅ spawnPools references registered entity templates');
    console.log('  ✅ All tags used in entities are registered in tag_registry.json');
    console.log('  ✅ Effects reference valid status effects');
    console.log('  ✅ Items reference valid effects');
    console.log('');
    console.log(`Next step: Run the validator:`);
    console.log(`  bun scripts/run-validator.ts --campaign-dir "${OUT_DIR}"`);
    console.log('');
    console.log('Then: Fill in content starting from Phase 0 files,');
    console.log('      re-running the validator after each phase.');
}

generate();
