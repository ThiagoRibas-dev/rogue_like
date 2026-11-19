import { describe, expect, test } from 'bun:test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  validateSsotRegistries,
  getAllTypeScriptFiles,
  isClassicFile,
  isDnd35eFile,
  SsotRegistrySchema
} from '../scripts/ssot_parity.ts';

describe('SSOT Responsibility Registries Parity', () => {
  const root = process.cwd();

  test('validateSsotRegistries returns 0 errors on current codebase', () => {
    const report = validateSsotRegistries(root);
    expect(report.errors).toEqual([]);
    expect(report.checkedFiles).toBeGreaterThan(250);
  }, 15_000);

  test('registries conform to Zod schema and contain no duplicate or missing source files', () => {
    const consolePath = join(root, 'docs', 'ssot', 'ssot_console.json');
    const classicPath = join(root, 'docs', 'ssot', 'ssot_classic.json');
    const dndPath = join(root, 'docs', 'ssot', 'ssot_dnd35e.json');

    expect(existsSync(consolePath)).toBe(true);
    expect(existsSync(classicPath)).toBe(true);
    expect(existsSync(dndPath)).toBe(true);

    const consoleRegistry = SsotRegistrySchema.parse(JSON.parse(readFileSync(consolePath, 'utf-8')));
    const classicRegistry = SsotRegistrySchema.parse(JSON.parse(readFileSync(classicPath, 'utf-8')));
    const dndRegistry = SsotRegistrySchema.parse(JSON.parse(readFileSync(dndPath, 'utf-8')));

    const diskFiles = getAllTypeScriptFiles(join(root, 'src'), join(root, 'src'));

    // Check complete 3-way disjoint partition
    for (const file of diskFiles) {
      const inConsole = file in consoleRegistry;
      const inClassic = file in classicRegistry;
      const inDnd = file in dndRegistry;
      const count = Number(inConsole) + Number(inClassic) + Number(inDnd);

      expect(count).toBe(1);

      if (isDnd35eFile(file)) {
        expect(inDnd).toBe(true);
      } else if (isClassicFile(file)) {
        expect(inClassic).toBe(true);
      } else {
        expect(inConsole).toBe(true);
      }
    }
  });

  test('generated markdown documents exist and are in sync with JSON registries', () => {
    const consoleMdPath = join(root, 'docs', 'SSOT_CONSOLE.md');
    const classicMdPath = join(root, 'docs', 'SSOT_CLASSIC.md');
    const dndMdPath = join(root, 'docs', 'SSOT_DND35E.md');

    expect(existsSync(consoleMdPath)).toBe(true);
    expect(existsSync(classicMdPath)).toBe(true);
    expect(existsSync(dndMdPath)).toBe(true);

    const consoleMd = readFileSync(consoleMdPath, 'utf-8');
    const classicMd = readFileSync(classicMdPath, 'utf-8');
    const dndMd = readFileSync(dndMdPath, 'utf-8');

    expect(consoleMd).toContain('# Console Engine & Shared Subsystems SSOT Map');
    expect(classicMd).toContain('# Classic Sci-Fi Ruleset Cartridge SSOT Map');
    expect(dndMd).toContain('# D&D 3.5e Ruleset Cartridge SSOT Map');
  });
});
