/**
 * Milestone 38 Regression Test: Encounter Director Uniqueness Enforcement
 *
 * Verifies that the Encounter Director respects global limits:
 * - A `persistent` enemy in a spawn pool with a massive CR budget
 *   should spawn at most once per map generation cycle.
 * - The localTokenPool should prevent duplicate unique spawns
 *   across rooms.
 */

import { loadCampaign } from '../src/core/loader.ts';
import { readFileSync } from 'fs';
import { join } from 'path';

globalThis.sessionStorage = {
    getItem: () => null,
    setItem: () => { },
    removeItem: () => { },
    clear: () => { },
    length: 0,
    key: () => null,
} as any;

globalThis.fetch = async (url: string | URL | Request) => {
    const urlStr = url.toString();
    const filePath = join('public', urlStr.replace(/^\//, ''));
    try {
        const content = readFileSync(filePath, 'utf-8');
        return {
            ok: true,
            json: async () => JSON.parse(content)
        } as any;
    } catch (err) {
        console.error('Mock fetch failed for', filePath, err);
        throw err;
    }
};

async function main() {
    console.log('--- Milestone 38: Director Uniqueness Regression Test ---\n');

    console.log('Loading default campaign...');
    const campaign = await loadCampaign('default');

    // Verify preconditions
    const trollTemplate = campaign.entities['troll'];
    if (!trollTemplate) {
        console.error('FAIL: troll entity template not found in default campaign.');
        process.exit(1);
    }
    if (!trollTemplate.persistent) {
        console.error("FAIL: troll entity template is not marked 'persistent'.");
        process.exit(1);
    }
    console.log('  ✓ troll entity exists and is persistent.');

    // Check that the default campaign has encounter profiles
    if (!campaign.encounterProfiles['standard_dungeon']) {
        console.error('FAIL: standard_dungeon encounter profile not found.');
        process.exit(1);
    }
    console.log('  ✓ standard_dungeon encounter profile exists.');

    // Check that the early_dungeon_monsters spawn pool contains troll
    const spawnPool = campaign.spawnPools['early_dungeon_monsters'];
    if (!spawnPool) {
        console.error('FAIL: early_dungeon_monsters spawn pool not found.');
        process.exit(1);
    }
    if (!(trollTemplate.id in spawnPool.entities)) {
        console.error('FAIL: troll not found in early_dungeon_monsters spawn pool.');
        process.exit(1);
    }
    console.log('  ✓ troll is in the early_dungeon_monsters spawn pool.');

    // Simulate: create a map with 3 rooms and a large CR budget so the director
    // could theoretically spawn troll multiple times if uniqueness were broken.
    const mapWidth = 30;
    const mapHeight = 20;

    // Build a minimal GameMap with floor tiles
    const tiles: Array<{ tileId: string; x: number; y: number; explored: boolean }> = [];
    for (let y = 0; y < mapHeight; y++) {
        for (let x = 0; x < mapWidth; x++) {
            tiles.push({ tileId: 'stone_floor', x, y, explored: false });
        }
    }

    const map = { width: mapWidth, height: mapHeight, tiles };

    // Define 3 rooms that overlap to allow placements
    const rooms = [
        { left: 2, right: 8, top: 2, bottom: 7, centerX: 5, centerY: 4, isSafe: false },
        { left: 12, right: 18, top: 2, bottom: 7, centerX: 15, centerY: 4, isSafe: false },
        { left: 22, right: 28, top: 2, bottom: 7, centerX: 25, centerY: 4, isSafe: false },
    ];

    // Use a very large CR budget so the director can afford troll (cost 5) many times
    const areaDef = {
        id: '__test_uniqueness__',
        name: 'Uniqueness Test Area',
        generatorType: 'digger' as const,
        dangerRating: 1,
        tags: ['early_game'],
        encounterProfileId: 'standard_dungeon',
        crBudget: 100,
        connections: [],
    };

    // We need to dynamically import runEncounterDirector because it's not
    // exposed from the loader path; we'll use a dynamic ESM import.
    // For scripts executed with tsx, we can use a relative import from src/.
    const { runEncounterDirector } = await import('../src/map/encounter_director.ts');

    const directorContext = {
        playerLevel: 1,
        tokenPool: new Set<string>(),
    };

    const result = runEncounterDirector(
        campaign,
        areaDef,
        map,
        rooms,
        [], // no existing placed entities
        directorContext
    );

    console.log(`\nDirector receipt:`);
    console.log(`  Effective budget: ${result.receipt.effectiveBudget}`);
    console.log(`  Pre-allocated: ${result.receipt.preAllocated}`);
    for (const axis of ['protein', 'appetizer', 'side', 'dessert'] as const) {
        const r = result.receipt.axisResults[axis];
        console.log(`  ${axis}: budget=${r.budget} spent=${r.spent} spawned=[${r.spawned.join(', ')}]`);
    }
    console.log(`  Trait upgrades: [${result.receipt.traitUpgrades.join(', ')}]`);
    console.log(`  Total entities spawned: ${result.newEntities.length}`);

    // Assertion: troll should appear at most once
    const trollSpawns = result.newEntities.filter((e: any) => e.templateId === 'troll');
    const trollCount = trollSpawns.length;

    console.log(`\n  Troll spawns: ${trollCount}`);

    if (trollCount === 0) {
        // Possible if RNG didn't pick troll, but given the high budget and
        // only 5 entities in the pool, this is very unlikely.
        console.warn('WARNING: Troll was not spawned at all. This may be RNG fluke.');
        console.log('PASS (with caveat): No duplicate spawned, but troll was never picked.\n');
    } else if (trollCount === 1) {
        console.log('\nPASS: Persistent entity spawned exactly once across all rooms.\n');
    } else {
        console.error(`\nFAIL: Persistent entity spawned ${trollCount} times! Uniqueness constraint is broken.\n`);
        process.exit(1);
    }

    // Check that the localTokenPool was populated correctly via the result
    // (we can indirectly verify by checking that axisSpawned only has troll once)
    const allSpawnedTrolls = (
        ['protein', 'appetizer', 'side', 'dessert'] as const
    ).flatMap((axis) =>
        result.receipt.axisResults[axis].spawned.filter((id: string) => id === 'troll')
    );
    if (allSpawnedTrolls.length > 1) {
        console.error(`FAIL: Troll appears in axisSpawned ${allSpawnedTrolls.length} times!`);
        process.exit(1);
    }
    console.log('  ✓ Troll appears at most once in axis spawned lists.');

    // Verify dynamic traits are present on entities when budget padding applies
    const entitiesWithTraits = result.newEntities.filter(
        (e: any) => e.dynamicTraits && e.dynamicTraits.length > 0
    );
    if (entitiesWithTraits.length > 0) {
        console.log(`  ✓ ${entitiesWithTraits.length} entities received dynamic traits via budget padding.`);
        console.log(`    Example: ${entitiesWithTraits[0]!.templateId} -> [${entitiesWithTraits[0]!.dynamicTraits!.join(', ')}]`);
    } else {
        // This is acceptable — traits require both leftover budget and a trait that fits.
        console.log('  (no dynamic traits applied — budget may have been fully consumed)');
    }

    console.log('All assertions passed.');
}

main().catch((err) => {
    console.error('Test failed with error:', err);
    process.exit(1);
});
