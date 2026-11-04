/**
 * SSOT Parity Engine & Documentation Generator
 *
 * Enforces 100% architectural coverage, disjoint partitioning, and export parity
 * between the source tree (TypeScript files in src) and the Single Source of Truth registries
 * (`docs/ssot/ssot_console.json` and `docs/ssot/ssot_dnd35e.json`).
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

export const SsotFileTierSchema = z.enum([
  'tier1_console',
  'tier1_types',
  'tier2_cartridge',
  'tier2_ui'
]);
export type SsotFileTier = z.infer<typeof SsotFileTierSchema>;

export const SsotFileEntrySchema = z.object({
  domain: z.string().min(1),
  tier: SsotFileTierSchema,
  responsibility: z.string().min(1),
  canonicalEntryPoints: z.array(z.string()),
  ownershipBoundary: z.object({
    includes: z.string().min(1),
    excludes: z.string().min(1)
  }),
  antiPatterns: z.array(z.string())
});
export type SsotFileEntry = z.infer<typeof SsotFileEntrySchema>;

export const SsotRegistrySchema = z.record(z.string(), SsotFileEntrySchema);
export type SsotRegistry = z.infer<typeof SsotRegistrySchema>;

export interface SsotParityReport {
  readonly checkedFiles: number;
  readonly errors: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
}

/**
 * Recursively retrieves all TypeScript source files under a directory.
 */
export function getAllTypeScriptFiles(dir: string, baseDir: string = dir): string[] {
  const result: string[] = [];
  if (!existsSync(dir)) return result;

  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      result.push(...getAllTypeScriptFiles(fullPath, baseDir));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      const relPath = fullPath.substring(baseDir.length + 1).replace(/\\/g, '/');
      result.push(`src/${relPath}`);
    } else if (entry === 'vite-env.d.ts') {
      result.push('src/vite-env.d.ts');
    }
  }
  return result.sort();
}

/**
 * Determines whether a given source file belongs to the D&D 3.5e Cartridge partition.
 */
export function isDnd35eFile(filePath: string): boolean {
  return filePath.startsWith('src/rulesets/dnd35e/') || filePath.startsWith('src/rendering/ui/dnd35e_');
}

/**
 * Extracts exported identifier names from a TypeScript file.
 */
export function extractExportedNames(content: string, filePath?: string, visited: Set<string> = new Set()): Set<string> {
  const exports = new Set<string>();
  if (filePath) {
    if (visited.has(filePath)) return exports;
    visited.add(filePath);
  }

  const exportRegex =
    /export\s+(?:let|const|async\s+function|function|type|interface|enum|class)(?:\s+enum)?\s+([A-Za-z0-9_]+)/g;

  let match;
  while ((match = exportRegex.exec(content)) !== null) {
    if (match[1]) {
      exports.add(match[1]);
    }
  }

  // Also support: export { a, b as c } or export type { a, b as c }
  const namedExportsRegex = /export\s+(?:type\s+)?\{([^}]+)\}/g;
  while ((match = namedExportsRegex.exec(content)) !== null) {
    if (match[1]) {
      const parts = match[1].split(',');
      for (const part of parts) {
        const trimmed = part.trim();
        if (trimmed) {
          const aliasParts = trimmed.split(/\s+as\s+/);
          const rawName = aliasParts[1] ?? aliasParts[0];
          // Strip possible leading 'type ' in 'export { type Foo }'
          const exportedName = rawName?.replace(/^type\s+/, '').trim();
          if (exportedName) {
            exports.add(exportedName);
          }
        }
      }
    }
  }

  // Also support: export * from './path.ts'
  if (filePath) {
    const starExportRegex = /export\s+\*\s+from\s+['"]([^'"]+)['"]/g;
    while ((match = starExportRegex.exec(content)) !== null) {
      const relPath = match[1];
      if (relPath) {
        const targetPath = join(filePath, '..', relPath);
        if (existsSync(targetPath)) {
          const subContent = readFileSync(targetPath, 'utf-8');
          const subExports = extractExportedNames(subContent, targetPath, visited);
          for (const subEp of subExports) {
            exports.add(subEp);
          }
        }
      }
    }
  }

  return exports;
}

/**
 * Formats Markdown output from a validated SSOT registry.
 */
export function generateSsotMarkdown(
  registry: SsotRegistry,
  title: string,
  description: string
): string {
  const domains = new Map<string, Array<{ path: string; entry: SsotFileEntry }>>();

  for (const [path, entry] of Object.entries(registry).sort((a, b) => a[0].localeCompare(b[0]))) {
    const list = domains.get(entry.domain) ?? [];
    list.push({ path, entry });
    domains.set(entry.domain, list);
  }

  const sortedDomainNames = Array.from(domains.keys()).sort();

  const lines: string[] = [
    `# ${title}`,
    '',
    `*${description}*`,
    '',
    '## Table of Contents',
    ''
  ];

  for (const domain of sortedDomainNames) {
    const count = domains.get(domain)!.length;
    const anchor = domain.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    lines.push(`- [${domain} (${count} files)](#${anchor})`);
  }

  lines.push('', '---', '');

  for (const domain of sortedDomainNames) {
    const files = domains.get(domain)!;
    lines.push(`## ${domain}`, '', `**Modules in this domain:** ${files.length}`, '');

    lines.push(
      '| File | Tier | Responsibility | Canonical Entry Points | Ownership Boundary (Includes / Excludes) | Anti-Patterns |',
      '| :--- | :--- | :--- | :--- | :--- | :--- |'
    );

    for (const { path, entry } of files) {
      const entryPoints =
        entry.canonicalEntryPoints.length > 0
          ? entry.canonicalEntryPoints.map((e) => `\`${e}\``).join(', ')
          : '*None (Internal / Leaf / Ambient)*';

      const boundary = `**Includes:** ${entry.ownershipBoundary.includes}<br>**Excludes:** ${entry.ownershipBoundary.excludes}`;
      const antiPatterns =
        entry.antiPatterns.length > 0
          ? entry.antiPatterns.map((a) => `• ${a}`).join('<br>')
          : '*None documented*';

      lines.push(
        `| \`${path}\` | \`${entry.tier}\` | ${entry.responsibility} | ${entryPoints} | ${boundary} | ${antiPatterns} |`
      );
    }

    lines.push('');
  }

  lines.push('---', '', '*Generated by `scripts/map-codebase.ts`. Do not edit directly.*', '');
  return lines.join('\n');
}

/**
 * Validates 5-point parity across the codebase and SSOT registries:
 * 1. 100% coverage of all TypeScript source files under src/.
 * 2. Strict disjoint partition (Console vs D&D 3.5e).
 * 3. Zero ghost files in JSON registries.
 * 4. Verification that all canonical entry points exist as live exports in source files.
 * 5. Freshness check: ensures docs/SSOT_CONSOLE.md and docs/SSOT_DND35E.md match the JSON.
 */
export function validateSsotRegistries(projectRoot: string): SsotParityReport {
  const errors: string[] = [];
  const warnings: string[] = [];

  const srcDir = join(projectRoot, 'src');
  const diskFiles = getAllTypeScriptFiles(srcDir);

  const consoleJsonPath = join(projectRoot, 'docs', 'ssot', 'ssot_console.json');
  const dndJsonPath = join(projectRoot, 'docs', 'ssot', 'ssot_dnd35e.json');

  if (!existsSync(consoleJsonPath)) {
    errors.push(`Missing SSOT registry file: ${consoleJsonPath}`);
    return { checkedFiles: diskFiles.length, errors, warnings };
  }
  if (!existsSync(dndJsonPath)) {
    errors.push(`Missing SSOT registry file: ${dndJsonPath}`);
    return { checkedFiles: diskFiles.length, errors, warnings };
  }

  let consoleRaw: unknown;
  let dndRaw: unknown;
  try {
    consoleRaw = JSON.parse(readFileSync(consoleJsonPath, 'utf-8'));
  } catch (err) {
    errors.push(`Failed to parse ${consoleJsonPath}: ${(err as Error).message}`);
    return { checkedFiles: diskFiles.length, errors, warnings };
  }
  try {
    dndRaw = JSON.parse(readFileSync(dndJsonPath, 'utf-8'));
  } catch (err) {
    errors.push(`Failed to parse ${dndJsonPath}: ${(err as Error).message}`);
    return { checkedFiles: diskFiles.length, errors, warnings };
  }

  const parseConsole = SsotRegistrySchema.safeParse(consoleRaw);
  if (!parseConsole.success) {
    for (const issue of parseConsole.error.issues) {
      errors.push(`[ssot_console.json] ${issue.path.join('.')}: ${issue.message}`);
    }
  }

  const parseDnd = SsotRegistrySchema.safeParse(dndRaw);
  if (!parseDnd.success) {
    for (const issue of parseDnd.error.issues) {
      errors.push(`[ssot_dnd35e.json] ${issue.path.join('.')}: ${issue.message}`);
    }
  }

  if (!parseConsole.success || !parseDnd.success) {
    return { checkedFiles: diskFiles.length, errors, warnings };
  }

  const consoleRegistry = parseConsole.data;
  const dndRegistry = parseDnd.data;

  const consoleKeys = new Set(Object.keys(consoleRegistry));
  const dndKeys = new Set(Object.keys(dndRegistry));

  // 1. Partition & Ghost File Checks
  for (const file of consoleKeys) {
    if (dndKeys.has(file)) {
      errors.push(`File "${file}" is duplicated in both ssot_console.json and ssot_dnd35e.json!`);
    }
    if (isDnd35eFile(file)) {
      errors.push(`File "${file}" belongs to D&D 3.5e partition but is listed in ssot_console.json!`);
    }
    const fullPath = join(projectRoot, file);
    if (!existsSync(fullPath)) {
      errors.push(`Ghost file in ssot_console.json does not exist on disk: "${file}"`);
    }
  }

  for (const file of dndKeys) {
    if (!isDnd35eFile(file)) {
      errors.push(`File "${file}" belongs to Console partition but is listed in ssot_dnd35e.json!`);
    }
    const fullPath = join(projectRoot, file);
    if (!existsSync(fullPath)) {
      errors.push(`Ghost file in ssot_dnd35e.json does not exist on disk: "${file}"`);
    }
  }

  // 2. Unmapped Disk File Coverage
  for (const file of diskFiles) {
    const isDnd = isDnd35eFile(file);
    if (isDnd && !dndKeys.has(file)) {
      errors.push(`D&D 3.5e source file "${file}" is not registered in docs/ssot/ssot_dnd35e.json!`);
    } else if (!isDnd && !consoleKeys.has(file)) {
      errors.push(`Console source file "${file}" is not registered in docs/ssot/ssot_console.json!`);
    }
  }

  // 3. Export Verification
  const combinedEntries = [
    ...Object.entries(consoleRegistry),
    ...Object.entries(dndRegistry)
  ];

  for (const [file, entry] of combinedEntries) {
    const fullPath = join(projectRoot, file);
    if (!existsSync(fullPath)) continue;
    const content = readFileSync(fullPath, 'utf-8');
    const exports = extractExportedNames(content, fullPath);

    for (const ep of entry.canonicalEntryPoints) {
      if (!exports.has(ep)) {
        errors.push(
          `Canonical entry point "${ep}" in "${file}" was not found in the file's exports on disk.`
        );
      }
    }
  }

  // 4. Markdown Freshness Verification
  const consoleMdPath = join(projectRoot, 'docs', 'SSOT_CONSOLE.md');
  const dndMdPath = join(projectRoot, 'docs', 'SSOT_DND35E.md');

  if (existsSync(consoleMdPath)) {
    const expected = generateSsotMarkdown(
      consoleRegistry,
      'Console Engine & Shared Subsystems SSOT Map',
      'Canonical Single Source of Truth, Responsibility Boundaries, and Forbidden Anti-Patterns for the Core Console Engine.'
    );
    const actual = readFileSync(consoleMdPath, 'utf-8');
    if (expected.trim() !== actual.trim()) {
      errors.push(
        'docs/SSOT_CONSOLE.md is out of sync with docs/ssot/ssot_console.json. Run `bun scripts/map-codebase.ts` to regenerate.'
      );
    }
  } else {
    warnings.push('docs/SSOT_CONSOLE.md does not exist yet. Run `bun scripts/map-codebase.ts` to generate.');
  }

  if (existsSync(dndMdPath)) {
    const expected = generateSsotMarkdown(
      dndRegistry,
      'D&D 3.5e Ruleset Cartridge SSOT Map',
      'Canonical Single Source of Truth, Responsibility Boundaries, and Forbidden Anti-Patterns for the D&D 3.5e Ruleset Cartridge.'
    );
    const actual = readFileSync(dndMdPath, 'utf-8');
    if (expected.trim() !== actual.trim()) {
      errors.push(
        'docs/SSOT_DND35E.md is out of sync with docs/ssot/ssot_dnd35e.json. Run `bun scripts/map-codebase.ts` to regenerate.'
      );
    }
  } else {
    warnings.push('docs/SSOT_DND35E.md does not exist yet. Run `bun scripts/map-codebase.ts` to generate.');
  }

  return {
    checkedFiles: diskFiles.length,
    errors,
    warnings
  };
}

/**
 * Regenerates `docs/SSOT_CONSOLE.md` and `docs/SSOT_DND35E.md` from the JSON registries.
 */
export function writeSsotMarkdownDocs(projectRoot: string): void {
  const consoleJsonPath = join(projectRoot, 'docs', 'ssot', 'ssot_console.json');
  const dndJsonPath = join(projectRoot, 'docs', 'ssot', 'ssot_dnd35e.json');

  const consoleRegistry = SsotRegistrySchema.parse(
    JSON.parse(readFileSync(consoleJsonPath, 'utf-8'))
  );
  const dndRegistry = SsotRegistrySchema.parse(
    JSON.parse(readFileSync(dndJsonPath, 'utf-8'))
  );

  const consoleMd = generateSsotMarkdown(
    consoleRegistry,
    'Console Engine & Shared Subsystems SSOT Map',
    'Canonical Single Source of Truth, Responsibility Boundaries, and Forbidden Anti-Patterns for the Core Console Engine.'
  );
  const dndMd = generateSsotMarkdown(
    dndRegistry,
    'D&D 3.5e Ruleset Cartridge SSOT Map',
    'Canonical Single Source of Truth, Responsibility Boundaries, and Forbidden Anti-Patterns for the D&D 3.5e Ruleset Cartridge.'
  );

  writeFileSync(join(projectRoot, 'docs', 'SSOT_CONSOLE.md'), consoleMd, 'utf-8');
  writeFileSync(join(projectRoot, 'docs', 'SSOT_DND35E.md'), dndMd, 'utf-8');
}
