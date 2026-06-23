/**
 * Export Public Folder
 *
 * Walks the `public/` directory recursively and writes every file's
 * relative path followed by its content into a single `.txt` file.
 *
 * Usage:
 *   bun scripts/export-public.ts
 *   bun scripts/export-public.ts --out ./my-export.txt
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// ──────────────────────────────────────────────
// CLI
// ──────────────────────────────────────────────

const args = process.argv.slice(2);
const outFile = (() => {
    const idx = args.indexOf('--out');
    if (idx !== -1 && idx + 1 < args.length) {
        return resolve(process.cwd(), args[idx + 1]!);
    }
    return resolve(process.cwd(), 'public-export.txt');
})();

// ──────────────────────────────────────────────
// Walk
// ──────────────────────────────────────────────

const PUBLIC_DIR = resolve(process.cwd(), 'public');

/** Recursively collect all file paths relative to `public/`. */
function collectFiles(dir: string, baseDir: string): string[] {
    const entries = readdirSync(dir, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...collectFiles(fullPath, baseDir));
        } else if (entry.isFile()) {
            files.push(fullPath);
        }
    }

    return files;
}

// ──────────────────────────────────────────────
// Render
// ──────────────────────────────────────────────

const allFiles = collectFiles(PUBLIC_DIR, PUBLIC_DIR);
const lines: string[] = [];

for (const filePath of allFiles) {
    const relative = filePath.slice(PUBLIC_DIR.length + 1).replace(/\\/g, '/');
    const content = readFileSync(filePath, 'utf-8');

    lines.push(`${relative}`);
    lines.push(content);
    // blank line separator between files (but no trailing blank after the last)
    if (filePath !== allFiles[allFiles.length - 1]) {
        lines.push('');
    }
}

// ──────────────────────────────────────────────
// Write
// ──────────────────────────────────────────────

writeFileSync(outFile, lines.join('\n'), 'utf-8');
console.log(`✅ Exported ${allFiles.length} file(s) to: ${outFile}`);
