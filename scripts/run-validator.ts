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
import type { ValidationError } from '../src/editor/validator/validator.types.ts';
import { validateCampaign } from '../src/editor/campaign_validator.ts';
import { collectMissingSpriteMappings } from '../src/rendering/sprite_keys.ts';
import { getRuleset } from '../src/rulesets/registry.ts';
import type { RulesetId } from '../src/types/ruleset.types.ts';

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function isCampaignDir(dirPath: string): boolean {
  return existsSync(join(dirPath, 'manifest.json'));
}

/**
 * Category keys whose on-disk JSON filename diverges from the snake_case
 * convention. `schemeRecipes` is persisted as `schemes.json` — the filename
 * the runtime loader fetches (`src/core/loader.ts`) — not `scheme_recipes.json`.
 */
const CATEGORY_FILE_OVERRIDES: Partial<Record<keyof CampaignData, string>> = {
  schemeRecipes: 'schemes.json'
};

/** Resolves the on-disk campaign JSON filename for a category key. */
function resolveCategoryFilename(key: keyof CampaignData): string {
  return CATEGORY_FILE_OVERRIDES[key] ?? `${toSnakeCase(key)}.json`;
}

// ──────────────────────────────────────────────
// Parse CLI arguments
// ──────────────────────────────────────────────

const args = process.argv.slice(2);
const helpFlags = ['--help', '-h', '-?'];

if (args.some((a) => helpFlags.includes(a))) {
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
    return {
      id: 'custom',
      name: 'Custom Campaign',
      description: '',
      version: '1.0.0',
      author: 'Unknown',
      tags: [],
      schemaVersion: 0,
      rulesetId: 'classic'
    };
  }
  if (key === 'rules') {
    return {
      map: {
        width: 80,
        height: 30,
        minRoomWidth: 3,
        maxRoomWidth: 8,
        minRoomHeight: 3,
        maxRoomHeight: 6,
        minCorridorLength: 2,
        maxCorridorLength: 8,
        dugPercentage: 0.15,
        startingAreaId: 'start',
        fovRadius: 8
      },
      hunger: { maxSatiation: 1000, thresholds: { satiated: 800, normal: 500, hungry: 200, starving: 0 } },
      spawning: { maxMonstersPerRoom: 3, maxItemsPerRoom: 2, spawnWeights: {}, lootTable: {} }
    };
  }
  if (key === 'theme') {
    return {
      colors: {
        background: '#000',
        floorDimFg: '#333',
        playerFg: '#fff',
        stairsFg: '#fff',
        transparent: '#fff',
        wallDimFg: '#222'
      },
      glyphs: { stairsDown: '>', stairsUp: '<' },
      ui: { displayWidth: 80, displayHeight: 30, fontSize: 16, fontFamily: 'monospace' }
    };
  }
  if (key === 'factions') {
    return { player: { player: 'friendly' } };
  }
  return {};
}

// ──────────────────────────────────────────────
// ai-prompt-kit parity (generated mirror of the default campaign)
// ──────────────────────────────────────────────

const DEFAULT_CAMPAIGN_ROOT = join(CAMPAIGNS_ROOT, 'default');
const AI_KIT_DEFAULT_CAMPAIGN = join(PROJECT_ROOT, 'ai-prompt-kit', 'default-campaign');

interface ParityResult {
  checked: number;
  errors: string[];
  warnings: string[];
}

/** Order-independent JSON stringification for semantic mirror comparison. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort((a, b) => a.localeCompare(b))
      .map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * Verifies that the generated ai-prompt-kit mirror matches the default campaign.
 *
 * The kit is a gitignored generated artifact (`bun scripts/generate-ai-prompt-kit.ts`).
 * When it is present, every mirrored campaign JSON must be byte-equivalent at the
 * JSON value level; stale mirrors (e.g. a hand-patched status.json or a theme.json
 * generated before a schema addition) are reported as errors so drift cannot hide.
 * When the kit is absent (fresh clone / CI), the check is skipped with a warning.
 *
 * @returns Comparison counts, blocking errors, and informational warnings.
 */
function validateAiPromptKitParity(): ParityResult {
  const result: ParityResult = { checked: 0, errors: [], warnings: [] };

  if (!existsSync(AI_KIT_DEFAULT_CAMPAIGN)) {
    result.warnings.push(
      'ai-prompt-kit/ not found — parity check skipped (run `bun scripts/generate-ai-prompt-kit.ts` to generate it).'
    );
    return result;
  }

  const expectedFiles = (Object.keys(CampaignCategorySchemas) as (keyof CampaignData)[])
    .filter((key) => key !== 'triggerBuckets' && key !== 'systemContent')
    .map((key) => resolveCategoryFilename(key));
  expectedFiles.push('keybinds.json');

  for (const file of expectedFiles) {
    const campaignPath = join(DEFAULT_CAMPAIGN_ROOT, file);
    if (!existsSync(campaignPath)) {
      // Category is optional and unauthored in the default campaign (e.g. world_events.json).
      continue;
    }

    const kitPath = join(AI_KIT_DEFAULT_CAMPAIGN, file);
    if (!existsSync(kitPath)) {
      result.errors.push(`ai-prompt-kit/default-campaign/${file} is missing from the generated mirror`);
      continue;
    }

    result.checked++;
    try {
      const campaignJson = JSON.parse(readFileSync(campaignPath, 'utf-8'));
      const kitJson = JSON.parse(readFileSync(kitPath, 'utf-8'));
      if (stableStringify(campaignJson) !== stableStringify(kitJson)) {
        result.errors.push(
          `ai-prompt-kit/default-campaign/${file} is stale (differs from public/data/campaigns/default/${file}); regenerate with \`bun scripts/generate-ai-prompt-kit.ts\``
        );
      }
    } catch (err) {
      result.errors.push(`Failed to parse ${file} during parity check: ${(err as Error).message}`);
    }
  }

  const expectedSet = new Set(expectedFiles);
  for (const entry of readdirSync(AI_KIT_DEFAULT_CAMPAIGN)) {
    if (entry.endsWith('.json') && !expectedSet.has(entry)) {
      result.warnings.push(`ai-prompt-kit/default-campaign/${entry} is not part of the generated mirror set`);
    }
  }

  return result;
}

// ──────────────────────────────────────────────
// Mock environment for validators that expect browser globals
// ──────────────────────────────────────────────

(globalThis as any).sessionStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
  clear: () => {},
  length: 0,
  key: () => null
};

(globalThis as any).localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
  clear: () => {},
  length: 0,
  key: () => null
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
    if (key === 'triggerBuckets' || key === 'systemContent') continue;

    const filename = resolveCategoryFilename(key);
    let filePath = join(dir, filename);
    if (!existsSync(filePath) && basename(dir) !== 'default') {
      const defaultPath = join(CAMPAIGNS_ROOT, 'default', filename);
      if (existsSync(defaultPath)) {
        filePath = defaultPath;
      }
    }

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

  const manifestObj = campaignData['manifest'] as Record<string, unknown> | undefined;
  const rulesetId =
    typeof manifestObj?.['rulesetId'] === 'string' ? (manifestObj['rulesetId'] as RulesetId) : 'classic';
  const ruleset = getRuleset(rulesetId);
  const rulesetDir = join(PROJECT_ROOT, 'public', 'data', 'rulesets', ruleset.id);
  const readRulesetJson = (filename: string): Record<string, unknown> => {
    const p = join(rulesetDir, filename);
    return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf-8')) as Record<string, unknown>) : {};
  };

  const systemDescriptors = ruleset.getSystemContentFiles?.() ?? [];
  const rawSystemContent: Record<string, Record<string, unknown>> = {};
  for (const desc of systemDescriptors) {
    const incoming = readRulesetJson(desc.filename);
    const normalizedIncoming =
      typeof incoming['id'] === 'string' && typeof incoming['name'] === 'string'
        ? { [incoming['id']]: incoming }
        : incoming;
    const existing = rawSystemContent[desc.key];
    rawSystemContent[desc.key] = existing !== undefined ? { ...existing, ...normalizedIncoming } : normalizedIncoming;
  }
  campaignData['systemContent'] = ruleset.parseSystemContent
    ? ruleset.parseSystemContent(rawSystemContent)
    : rawSystemContent;

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
    const errorDetails = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    return { errors: result.error.issues.length, errorDetails };
  }

  console.log(
    `  ✅ Zod schema validation passed (${missingCount > 0 ? `${missingCount} missing file(s) used fallbacks` : 'all files present'})`
  );
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
  let crossErrors: ReadonlyArray<ValidationError> = [];
  let crossWarnings: ReadonlyArray<ValidationError> = [];
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

  // Sprite-artibility check. A template with no resolvable sprite is not fatal: it is
  // rendered as its ASCII glyph on the overlay canvas. Unresolved keys are still worth
  // surfacing because they usually indicate a typo.
  const spriteIssues = collectMissingSpriteMappings(campaign);
  if (spriteIssues.length > 0) {
    console.log(`  ⚠ ${spriteIssues.length} sprite-mapping warning(s):`);
    for (let i = 0; i < spriteIssues.length; i++) {
      const issue = spriteIssues[i]!;
      const detail =
        issue.reason === 'no-spriteId'
          ? `${issue.kind} "${issue.id}" has no spriteId (renders as ASCII glyph fallback)`
          : `${issue.kind} "${issue.id}" references unknown spriteId "${issue.spriteId}" (renders as ASCII glyph fallback)`;
      console.log(`    [${i + 1}] ${detail}`);
    }
  }

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
    warnings: crossWarnings.length + spriteIssues.length,
    errorDetails: allErrorDetails,
    passed
  };
}

/**
 * Validates on-disk file hygiene for all modular ruleset registries in `public/data/rulesets/<rulesetId>/`.
 * Ensures every file declared in `getSystemContentFiles()` exists on disk, no unreferenced orphan files
 * exist in modular subdirectories, and each modular file has exact key/id/filename parity.
 */
function validateRulesetDiskParity(): { readonly errors: ReadonlyArray<string>; readonly checkedFiles: number } {
  const errors: string[] = [];
  let checkedFiles = 0;
  const rulesetsDir = join(PROJECT_ROOT, 'public', 'data', 'rulesets');
  if (!existsSync(rulesetsDir)) return { errors, checkedFiles };

  const rulesetEntries = readdirSync(rulesetsDir).filter((e) => statSync(join(rulesetsDir, e)).isDirectory());
  for (const rulesetId of rulesetEntries) {
    const ruleset = getRuleset(rulesetId as RulesetId);
    const descriptors = ruleset.getSystemContentFiles?.() ?? [];
    const declaredFiles = new Set(descriptors.map((d) => d.filename));

    // 1. Verify every declared descriptor file exists on disk
    const rulesetPath = join(rulesetsDir, rulesetId);
    for (const desc of descriptors) {
      const fullPath = join(rulesetPath, desc.filename);
      if (!existsSync(fullPath)) {
        errors.push(`Ruleset "${rulesetId}" declares descriptor "${desc.filename}", but file is missing on disk.`);
      }
    }

    // 2. Scan every modular subdirectory on disk and verify no orphans, plus key/id parity
    const subdirs = readdirSync(rulesetPath).filter((e) => statSync(join(rulesetPath, e)).isDirectory());
    for (const sub of subdirs) {
      const subPath = join(rulesetPath, sub);
      const jsonFiles = readdirSync(subPath).filter((f) => f.endsWith('.json'));
      for (const file of jsonFiles) {
        checkedFiles++;
        const relFilename = `${sub}/${file}`;
        if (!declaredFiles.has(relFilename)) {
          errors.push(
            `Ruleset "${rulesetId}" has file "${relFilename}" on disk not declared in getSystemContentFiles().`
          );
        }
        const stem = file.replace(/\.json$/, '');
        try {
          const raw = JSON.parse(readFileSync(join(subPath, file), 'utf-8')) as Record<string, unknown>;
          const keys = Object.keys(raw);
          if (keys.length !== 1 || keys[0] !== stem) {
            errors.push(
              `Ruleset "${rulesetId}" file "${relFilename}" must have a single top-level key matching "${stem}" (got ${JSON.stringify(keys)}).`
            );
          } else {
            const inner = raw[stem] as Record<string, unknown>;
            const innerId = inner['id'] ?? inner['archetypeId'] ?? inner['templateId'] ?? inner['typeId'];
            if (innerId !== stem) {
              errors.push(
                `Ruleset "${rulesetId}" file "${relFilename}" inner identifier (${String(innerId)}) does not match filename stem "${stem}".`
              );
            }
          }
        } catch (err) {
          errors.push(
            `Ruleset "${rulesetId}" file "${relFilename}" failed to parse as JSON: ${(err as Error).message}`
          );
        }
      }
    }
  }

  return { errors, checkedFiles };
}

// ──────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('        Campaign Validator');
  console.log('═══════════════════════════════════════════');

  if (useJsonOutput && !campaignDir) {
    console.error('❌ --json requires --campaign-dir (single campaign mode).');
    process.exit(1);
  }

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
      .map((e) => join(CAMPAIGNS_ROOT, e))
      .filter((d) => statSync(d).isDirectory() && isCampaignDir(d))
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

    // Ruleset System Content Disk Parity
    console.log('');
    console.log('─── Ruleset System Content Disk Parity ───');
    const rulesetParity = validateRulesetDiskParity();
    if (rulesetParity.errors.length > 0) {
      for (const err of rulesetParity.errors) console.error(`  ❌ ${err}`);
    } else {
      console.log(
        `  ✅ Validated ${rulesetParity.checkedFiles} modular ruleset file(s) on disk (zero orphans, 100% key parity)`
      );
    }

    // ai-prompt-kit parity (generated artifact mirror of the default campaign)
    console.log('');
    console.log('─── ai-prompt-kit parity ───');
    const parity = validateAiPromptKitParity();
    let parityErrors = 0;
    if (parity.checked === 0 && parity.errors.length === 0) {
      for (const warn of parity.warnings) console.log(`  ℹ ${warn}`);
    } else {
      console.log(`  🔍 Compared ${parity.checked} mirrored file(s)`);
      for (const err of parity.errors) console.error(`  ❌ ${err}`);
      for (const warn of parity.warnings) console.log(`  ⚠ ${warn}`);
      if (parity.errors.length === 0) {
        console.log('  ✅ ai-prompt-kit mirror matches default campaign');
      }
      parityErrors = parity.errors.length;
    }

    // Summary
    console.log('');
    console.log('═══════════════════════════════════════════');
    console.log('              SUMMARY');
    console.log('═══════════════════════════════════════════');
    let totalErrors = parityErrors + rulesetParity.errors.length;
    let totalWarnings = 0;
    for (const r of results) {
      const errCount = r.zodErrors + r.crossErrors;
      const status = r.passed ? '✅' : '❌';
      console.log(`  ${status} ${r.campaignName} (${r.campaignId}): ${errCount} error(s), ${r.warnings} warning(s)`);
      totalErrors += errCount;
      totalWarnings += r.warnings;
    }
    if (rulesetParity.errors.length > 0) {
      console.log(`  ❌ Ruleset disk parity: ${rulesetParity.errors.length} error(s)`);
    }
    if (parityErrors > 0) {
      console.log(`  ❌ ai-prompt-kit: ${parityErrors} parity error(s)`);
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

