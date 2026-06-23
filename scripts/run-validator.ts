/**
 * Campaign Validator Runner
 *
 * Validates campaign data against the engine's Zod schemas and
 * cross-reference validators. By default, validates ALL campaigns
 * in public/data/campaigns/. Use --campaign-dir to validate a single
 * campaign directory.
 *
 * This script is self-contained and does NOT depend on the Vite-based
 * loader.ts or campaign_store.ts (which require a browser DOM).
 * It reads JSON files directly from disk and validates them.
 *
 * Usage:
 *   bun scripts/run-validator.ts                           # Validate ALL campaigns
 *   bun scripts/run-validator.ts --campaign-dir ./my-camp  # Validate a single campaign dir
 *   bun scripts/run-validator.ts --all                     # Explicitly validate ALL campaigns
 *   bun scripts/run-validator.ts --json                    # Machine-parseable JSON output (single only)
 *   bun scripts/run-validator.ts --help                    # Show help
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CampaignData } from '../src/types/campaign.types.ts';
import { CampaignDataSchema, CampaignCategorySchemas } from '../src/types/campaign.types.ts';
import type { ValidationError, ValidationReport } from '../src/editor/validator/validator.types.ts';
import { validateCampaign } from '../src/editor/campaign_validator.ts';

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

function isCampaignDir(dirPath: string): boolean {
  return existsSync(join(dirPath, 'manifest.json'));
}

// ──────────────────────────────────────────────
// Parse CLI arguments
// ──────────────────────────────────────────────

const args = process.argv.slice(2);
const helpFlags = ['--help', '-h', '-?'];

if (args.some(a => helpFlags.includes(a))) {
  console.log(`
  Campaign Validator Runner

  Usage:
    bun scripts/run-validator.ts                           Validate ALL campaigns
    bun scripts/run-validator.ts --all                     Same as above (explicit)
    bun scripts/run-validator.ts --campaign-dir ./my-camp  Validate a single campaign directory
    bun scripts/run-validator.ts --json                    Output machine-readable JSON report
    bun scripts/run-validator.ts --help                    Show this help

  The --campaign-dir flag expects a path to a directory containing the
  campaign JSON files (manifest.json, rules.json, etc.).

  Without --campaign-dir, the script scans public/data/campaigns/ and
  validates EVERY subdirectory that has a manifest.json.

  With --json, the output is a single JSON object (only for single campaign):
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
const validateAll = args.includes('--all') || (campaignDir === null && !useJsonOutput);

// ──────────────────────────────────────────────
// Path setup
// ──────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');
const CAMPAIGNS_ROOT = join(PROJECT_ROOT, 'public', 'data', 'campaigns');

/** Generates an empty-but-valid default for a missing file. */
function getFallbackForFile(key: keyof CampaignData): unknown {
  const schema = CampaignCategorySchemas[key];
  if (schema && (schema as any)._def?.typeName === 'ZodArray') {
    if (key === 'advancement') return [{ level: 1, requiredXp: 0, hpGain: 5, attackGain: 1, defenseGain: 1 }];
    return [];
  }
  if (key === 'manifest') {
    return { id: 'custom', name: 'Custom Campaign', description: '', version: '1.0.0', author: 'Unknown', tags: [], schemaVersion: 0 };
  }
  if (key === 'rules') {
    return {
      map: { width: 80, height: 30, minRoomWidth: 3, maxRoomWidth: 8, minRoomHeight: 3, maxRoomHeight: 6, minCorridorLength: 2, maxCorridorLength: 8, dugPercentage: 0.15, startingAreaId: 'start', fovRadius: 8 },
      hunger: { maxSatiation: 1000, thresholds: { satiated: 800, normal: 500, hungry: 200, starving: 0 } },
      spawning: { maxMonstersPerRoom: 3, maxItemsPerRoom: 2, spawnWeights: {}, lootTable: {} }
    };
  }
  if (key === 'theme') {
    return { colors: { background: '#000', floorDimFg: '#333', playerFg: '#fff', stairsFg: '#fff', transparent: '#fff', wallDimFg: '#222' }, glyphs: { stairsDown: '>', stairsUp: '<' }, ui: { displayWidth: 80, displayHeight: 30, fontSize: 16, fontFamily: 'monospace' } };
  }
  if (key === 'factions') {
    return { player: { player: 'friendly' } };
  }
  return {};
}

// ──────────────────────────────────────────────
// Mock environment for validators that expect browser globals
// ──────────────────────────────────────────────

(globalThis as any).sessionStorage = {
  getItem: () => null,
  setItem: () => { },
  removeItem: () => { },
  clear: () => { },
  length: 0,
  key: () => null,
};

(globalThis as any).localStorage = {
  getItem: () => null,
  setItem: () => { },
  removeItem: () => { },
  clear: () => { },
  length: 0,
  key: () => null,
};

// ──────────────────────────────────────────────
// Validation logic
// ──────────────────────────────────────────────

interface CampaignResult {
  campaignId: string;
  campaignName: string;
  dir: string;
  zodErrors: number;
  crossErrors: number;
  warnings: number;
  errorDetails: string[];
  passed: boolean;
}

function loadAndValidateZod(dir: string): { data?: CampaignData; errors: number; errorDetails: string[] } {
  const campaignData: Record<string, unknown> = {};
  let missingCount = 0;

  const keys = Object.keys(CampaignCategorySchemas) as (keyof CampaignData)[];
  for (const key of keys) {
    if (key === 'triggerBuckets') continue;

    const filename = `${toSnakeCase(key)}.json`;
    const filePath = join(dir, filename);

    if (!existsSync(filePath)) {
      campaignData[key] = getFallbackForFile(key);
      missingCount++;
    } else {
      try {
        campaignData[key] = JSON.parse(readFileSync(filePath, 'utf-8'));
      } catch (err) {
        return { errors: 1, errorDetails: [`Failed to parse ${filename}: ${(err as Error).message}`] };
      }
    }
  }

  // Build trigger buckets
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

  const result = CampaignDataSchema.safeParse(campaignData);
  if (!result.success) {
    const errorDetails = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`);
    return { errors: result.error.issues.length, errorDetails };
  }

  console.log(`  ✅ Zod schema validation passed (${missingCount > 0 ? `${missingCount} missing file(s) used fallbacks` : 'all files present'})`);
  return { data: result.data, errors: 0, errorDetails: [] };
}

async function validateSingleCampaign(dir: string): Promise<CampaignResult> {
  const campaignName = basename(dir);
  console.log(`\n🔍 Validating campaign: ${campaignName} (${dir})`);

  const zodResult = loadAndValidateZod(dir);
  if (zodResult.errors > 0) {
    for (const detail of zodResult.errorDetails) {
      console.error(`  ❌ ${detail}`);
    }
    return {
      campaignId: campaignName,
      campaignName,
      dir,
      zodErrors: zodResult.errors,
      crossErrors: 0,
      warnings: 0,
      errorDetails: zodResult.errorDetails,
      passed: false
    };
  }

  const campaign = zodResult.data!;

  // Deep cross-reference validation
  console.log('   Running deep cross-reference validation...');
  let crossErrors: ValidationError[] = [];
  let crossWarnings: ValidationError[] = [];
  try {
    const report = await validateCampaign(campaign);
    crossErrors = report.errors;
    crossWarnings = report.warnings;
  } catch (err) {
    console.error(`  ❌ Cross-reference validation threw: ${(err as Error).message}`);
    return {
      campaignId: campaign.manifest?.id ?? campaignName,
      campaignName: campaign.manifest?.name ?? campaignName,
      dir,
      zodErrors: 0,
      crossErrors: 1,
      warnings: 0,
      errorDetails: [`Cross-reference validation threw: ${(err as Error).message}`],
      passed: false
    };
  }

  const allErrorDetails: string[] = [];
  let totalCrossErrors = 0;

  if (crossErrors.length > 0) {
    console.error(`  ❌ Found ${crossErrors.length} cross-reference error(s):`);
    for (let i = 0; i < crossErrors.length; i++) {
      const e = crossErrors[i]!;
      console.error(`    [${i + 1}] ${e.severity.toUpperCase()} @ ${e.path} — ${e.message}`);
      allErrorDetails.push(`${e.path}: ${e.message}`);
      totalCrossErrors++;
    }
  }

  if (crossWarnings.length > 0) {
    console.log(`  ⚠ ${crossWarnings.length} warning(s):`);
    for (let i = 0; i < crossWarnings.length; i++) {
      const w = crossWarnings[i]!;
      console.log(`    [${i + 1}] ${w.severity.toUpperCase()} @ ${w.path} — ${w.message}`);
    }
  }

  const passed = totalCrossErrors === 0;

  return {
    campaignId: campaign.manifest?.id ?? campaignName,
    campaignName: campaign.manifest?.name ?? campaignName,
    dir,
    zodErrors: 0,
    crossErrors: totalCrossErrors,
    warnings: crossWarnings.length,
    errorDetails: allErrorDetails,
    passed
  };
}

// ──────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('        Campaign Validator');
  console.log('═══════════════════════════════════════════');

  if (campaignDir) {
    // ── Single-campaign mode ──
    console.log(`Mode: Single campaign`);
    const result = await validateSingleCampaign(campaignDir);

    console.log('');
    console.log('───');
    console.log(`Campaign: ${result.campaignName} (${result.campaignId})`);
    console.log(`Errors:   ${result.zodErrors + result.crossErrors}`);
    console.log(`Warnings: ${result.warnings}`);
    console.log(`Status:   ${result.passed ? '✅ PASS' : '❌ FAIL'}`);

    process.exit(result.passed ? 0 : 1);
  } else {
    // ── Multi-campaign mode ──
    console.log(`Mode: Validate all campaigns`);
    console.log(`Scanning: ${CAMPAIGNS_ROOT}`);
    console.log('');

    const entries = readdirSync(CAMPAIGNS_ROOT);
    const campaignDirs = entries
      .map(e => join(CAMPAIGNS_ROOT, e))
      .filter(d => statSync(d).isDirectory() && isCampaignDir(d))
      .sort();

    if (campaignDirs.length === 0) {
      console.error('❌ No campaign directories found in:', CAMPAIGNS_ROOT);
      process.exit(1);
    }

    console.log(`Found ${campaignDirs.length} campaign(s):`);
    for (const dir of campaignDirs) {
      console.log(`  - ${basename(dir)}`);
    }

    const results: CampaignResult[] = [];

    for (const dir of campaignDirs) {
      const result = await validateSingleCampaign(dir);
      results.push(result);
    }

    // Summary
    console.log('');
    console.log('═══════════════════════════════════════════');
    console.log('              SUMMARY');
    console.log('═══════════════════════════════════════════');
    let totalErrors = 0;
    let totalWarnings = 0;
    for (const r of results) {
      const errCount = r.zodErrors + r.crossErrors;
      const status = r.passed ? '✅' : '❌';
      console.log(`  ${status} ${r.campaignName} (${r.campaignId}): ${errCount} error(s), ${r.warnings} warning(s)`);
      totalErrors += errCount;
      totalWarnings += r.warnings;
    }
    console.log('');
    console.log(`Total: ${results.length} campaign(s), ${totalErrors} error(s), ${totalWarnings} warning(s)`);
    console.log(`Overall: ${totalErrors === 0 ? '✅ ALL PASSED' : '❌ SOME FAILED'}`);
    process.exit(totalErrors > 0 ? 1 : 0);
  }
}

main().catch((err: Error) => {
  console.error('Fatal error:', err.message);
  console.error(err.stack);
  process.exit(2);
});
