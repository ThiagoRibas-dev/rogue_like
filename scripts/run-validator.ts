/**
 * Campaign Validator Runner
 *
 * Validates campaign data against the engine's Zod schemas and
 * cross-reference validators. Supports validating the built-in
 * 'default' campaign or a user-specified campaign directory.
 *
 * This script is self-contained and does NOT depend on the Vite-based
 * loader.ts or campaign_store.ts (which require a browser DOM).
 * It reads JSON files directly from disk and validates them.
 *
 * Usage:
 *   bun scripts/run-validator.ts                           # Validate 'default'
 *   bun scripts/run-validator.ts --campaign-dir ./my-camp  # Validate custom dir
 *   bun scripts/run-validator.ts --json                    # Machine-parseable JSON output
 *   bun scripts/run-validator.ts --help                    # Show help
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CampaignData } from '../src/types/campaign.types.ts';
import { CampaignDataSchema } from '../src/types/campaign.types.ts';
import { validateCampaign } from '../src/editor/campaign_validator.ts';
import type { ValidationError, ValidationReport } from '../src/editor/validator/validator.types.ts';

// ──────────────────────────────────────────────
// Parse CLI arguments
// ──────────────────────────────────────────────

const args = process.argv.slice(2);
const helpFlags = ['--help', '-h', '-?'];

if (args.some(a => helpFlags.includes(a))) {
  console.log(`
  Campaign Validator Runner

  Usage:
    bun scripts/run-validator.ts                           Validate the built-in 'default' campaign
    bun scripts/run-validator.ts --campaign-dir ./my-camp  Validate JSON files from a directory
    bun scripts/run-validator.ts --json                    Output machine-readable JSON report
    bun scripts/run-validator.ts --help                    Show this help

  The --campaign-dir flag expects a path to a directory containing the
  26 campaign JSON files (manifest.json, rules.json, etc.).

  With --json, the output is a single JSON object:
    { "valid": boolean, "errors": ValidationError[], "warnings": ValidationError[] }
  `);
  process.exit(0);
}

const campaignDirIdx = args.indexOf('--campaign-dir');
let campaignDir: string | null = null;
if (campaignDirIdx !== -1 && campaignDirIdx + 1 < args.length) {
  campaignDir = resolve(process.cwd(), args[campaignDirIdx + 1]!);
}

const useJsonOutput = args.includes('--json');

// ──────────────────────────────────────────────
// Path setup
// ──────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');
const DEFAULT_CAMPAIGN_DIR = join(PROJECT_ROOT, 'public', 'data', 'campaigns', 'default');

// ──────────────────────────────────────────────
// Required files and their fallback defaults
// ──────────────────────────────────────────────

const REQUIRED_JSON_FILES: string[] = [
  'manifest.json', 'rules.json', 'theme.json', 'advancement.json',
  'items.json', 'effects.json', 'entities.json', 'status.json',
  'tiles.json', 'factions.json', 'ai.json', 'areas.json',
  'dialogues.json', 'quests.json', 'quest_templates.json',
  'villains.json', 'schemes.json', 'agreements.json',
  'triggers.json', 'tag_registry.json', 'reactions.json',
  'fields.json', 'spawn_pools.json', 'encounter_profiles.json',
  'trait_registry.json'
];

/** Generates an empty-but-valid default for a missing file. */
function getFallbackForFile(filename: string): unknown {
  const name = filename.replace('.json', '');
  switch (name) {
    case 'manifest':
      return { id: 'custom', name: 'Custom Campaign', description: '', version: '1.0.0', author: 'Unknown', tags: [], schemaVersion: 0 };
    case 'rules':
      return {
        map: { width: 80, height: 30, minRoomWidth: 3, maxRoomWidth: 8, minRoomHeight: 3, maxRoomHeight: 6, minCorridorLength: 2, maxCorridorLength: 8, dugPercentage: 0.15, startingAreaId: 'start', fovRadius: 8 },
        hunger: { maxSatiation: 1000, thresholds: { satiated: 800, normal: 500, hungry: 200, starving: 0 } },
        spawning: { maxMonstersPerRoom: 3, maxItemsPerRoom: 2, spawnWeights: {}, lootTable: {} }
      };
    case 'theme':
      return { colors: { background: '#000', floorDimFg: '#333', playerFg: '#fff', stairsFg: '#fff', transparent: '#fff', wallDimFg: '#222' }, glyphs: { stairsDown: '>', stairsUp: '<' }, ui: { displayWidth: 80, displayHeight: 30, fontSize: 16, fontFamily: 'monospace' } };
    case 'advancement':
      return [{ level: 1, requiredXp: 0, hpGain: 5, attackGain: 1, defenseGain: 1 }];
    case 'factions':
      return { player: { player: 'friendly' } };
    case 'tag_registry':
    case 'fields':
    case 'trait_registry':
    case 'encounter_profiles':
    case 'quest_templates':
    case 'spawn_pools':
      return {};
    case 'reactions':
      return [];
    default:
      return {};
  }
}

// ──────────────────────────────────────────────
// Campaign loader (standalone, no Vite dependencies)
// ──────────────────────────────────────────────

function loadCampaignFromDir(dir: string): CampaignData {
  console.log(`Loading campaign from: ${dir}`);

  // Verify directory exists
  if (!existsSync(dir)) {
    console.error(`❌ Directory not found: ${dir}`);
    process.exit(1);
  }

  // Read all files
  const rawData: Record<string, unknown> = {};
  let missingCount = 0;

  for (const filename of REQUIRED_JSON_FILES) {
    const filePath = join(dir, filename);
    const key = filename.replace('.json', '');

    if (!existsSync(filePath)) {
      console.warn(`  ⚠ Missing file: ${filename} — using fallback defaults`);
      rawData[key] = getFallbackForFile(filename);
      missingCount++;
    } else {
      try {
        const content = readFileSync(filePath, 'utf-8');
        rawData[key] = JSON.parse(content);
      } catch (err) {
        console.error(`  ❌ Failed to parse ${filename}:`, err);
        process.exit(1);
      }
    }
  }

  // Map file names to CampaignData property names
  const campaignData: Record<string, unknown> = {
    manifest: rawData['manifest'],
    rules: rawData['rules'],
    theme: rawData['theme'],
    advancement: rawData['advancement'],
    areas: rawData['areas'],
    items: rawData['items'],
    effects: rawData['effects'],
    entities: rawData['entities'],
    status: rawData['status'],
    tiles: rawData['tiles'],
    factions: rawData['factions'],
    ai: rawData['ai'],
    dialogues: rawData['dialogues'],
    quests: rawData['quests'],
    questTemplates: rawData['quest_templates'],
    villains: rawData['villains'],
    schemes: rawData['schemes'],
    agreements: rawData['agreements'],
    triggers: rawData['triggers'],
    tagRegistry: rawData['tag_registry'],
    reactions: rawData['reactions'],
    fields: rawData['fields'],
    spawnPools: rawData['spawn_pools'],
    encounterProfiles: rawData['encounter_profiles'],
    traitRegistry: rawData['trait_registry'],
  };

  // Build trigger buckets (needed by the trigger system at runtime)
  const triggers = campaignData.triggers as Record<string, { eventType: string }> | undefined;
  const triggerBuckets: Record<string, unknown[]> = {};
  if (triggers) {
    for (const trigger of Object.values(triggers)) {
      const t = trigger as { eventType: string };
      const bucket = triggerBuckets[t.eventType] ?? [];
      bucket.push(trigger);
      triggerBuckets[t.eventType] = bucket;
    }
  }
  campaignData.triggerBuckets = triggerBuckets;

  // Validate against Zod schema
  console.log('Running Zod schema validation...');
  const result = CampaignDataSchema.safeParse(campaignData);
  if (!result.success) {
    console.error('❌ Zod schema validation FAILED:');
    for (const issue of result.error.issues) {
      console.error(`  Path: ${issue.path.join('.')} — ${issue.message}`);
      console.error(`    Code: ${issue.code}`);
    }
    process.exit(1);
  }

  console.log(`  ✅ Zod schema validation passed (${missingCount} missing files used fallbacks)`);
  return result.data;
}

// ──────────────────────────────────────────────
// Mock environment for validators that expect browser globals
// ──────────────────────────────────────────────

// Some validators may reference sessionStorage
(globalThis as any).sessionStorage = {
  getItem: () => null,
  setItem: () => { },
  removeItem: () => { },
  clear: () => { },
  length: 0,
  key: () => null,
};

// Mock localStorage for any dependencies
(globalThis as any).localStorage = {
  getItem: () => null,
  setItem: () => { },
  removeItem: () => { },
  clear: () => { },
  length: 0,
  key: () => null,
};

// ──────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────

async function main() {
  const dir = campaignDir ?? DEFAULT_CAMPAIGN_DIR;

  console.log('═══ Campaign Validator ═══');
  console.log(`Mode: ${campaignDir ? 'Custom directory' : 'Built-in default campaign'}`);
  console.log('');

  const campaign = loadCampaignFromDir(dir);

  console.log('Running deep cross-reference validation...');
  const report: ValidationReport = await validateCampaign(campaign);

  if (useJsonOutput) {
    // Machine-parseable JSON output for AI feedback loop
    const output = {
      valid: report.errors.length === 0,
      campaignId: campaign.manifest?.id ?? 'unknown',
      campaignName: campaign.manifest?.name ?? 'Unknown',
      errorCount: report.errors.length,
      warningCount: report.warnings.length,
      errors: report.errors.map((e: ValidationError) => ({
        severity: e.severity,
        path: e.path,
        message: e.message,
      })),
      warnings: report.warnings.map((w: ValidationError) => ({
        severity: w.severity,
        path: w.path,
        message: w.message,
      })),
    };
    console.log(JSON.stringify(output, null, 2));
  } else {
    // Human-readable output
    console.log('');
    console.log('═══ Validation Report ═══');
    console.log('');

    if (report.errors.length === 0) {
      console.log('✅ VALIDATION PASSED — no errors found.');
    } else {
      console.log(`❌ Found ${report.errors.length} error(s):`);
      for (let i = 0; i < report.errors.length; i++) {
        const err = report.errors[i]!;
        console.log(`  [Error ${i + 1}] ${err.severity.toUpperCase()} @ ${err.path}`);
        console.log(`         ${err.message}`);
      }
    }

    if (report.warnings.length > 0) {
      console.log(`\n⚠ Found ${report.warnings.length} warning(s):`);
      for (let i = 0; i < report.warnings.length; i++) {
        const warn = report.warnings[i]!;
        console.log(`  [Warning ${i + 1}] ${warn.severity.toUpperCase()} @ ${warn.path}`);
        console.log(`           ${warn.message}`);
      }
    }

    console.log('');
    console.log('───');
    console.log(`Campaign: ${campaign.manifest?.name ?? 'Unknown'} (${campaign.manifest?.id ?? 'unknown'})`);
    console.log(`Errors:   ${report.errors.length}`);
    console.log(`Warnings: ${report.warnings.length}`);
    console.log(`Status:   ${report.errors.length === 0 ? '✅ PASS' : '❌ FAIL'}`);
  }

  process.exit(report.errors.length > 0 ? 1 : 0);
}

main().catch((err: Error) => {
  console.error('Fatal error:', err.message);
  console.error(err.stack);
  process.exit(2);
});
