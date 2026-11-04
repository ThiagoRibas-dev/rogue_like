import fs from 'node:fs';
import path from 'node:path';

/** Maximum recommended line count per file before triggering a warning (AGENTS.md Rule 8). */
const MAX_RECOMMENDED_LINES = 300;

/** Root source directory to analyze. */
const SRC_DIR = path.resolve(process.cwd(), 'src');

/** ANSI terminal color codes for styled output. */
const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m'
} as const;

interface FileLengthReport {
  readonly filePath: string;
  readonly relativePath: string;
  readonly lines: number;
}

/**
 * Recursively collects all TypeScript source files under a directory, ignoring declaration files.
 *
 * @param dir Target directory.
 * @returns Array of absolute file paths.
 */
function collectTsFiles(dir: string): ReadonlyArray<string> {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      results.push(fullPath);
    }
  }

  return results;
}

/**
 * Analyzes file lengths for all TypeScript source files in `src/` and prints a warning report.
 */
export function runFileLengthCheck(): void {
  const files = collectTsFiles(SRC_DIR);
  const reports: FileLengthReport[] = [];

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    const lines = content.split('\n').length;
    reports.push({
      filePath: file,
      relativePath: path.relative(process.cwd(), file),
      lines
    });
  }

  const warnings = reports.filter((r) => r.lines > MAX_RECOMMENDED_LINES);
  warnings.sort((a, b) => b.lines - a.lines);

  console.log(`\n${ANSI.bold}${ANSI.cyan}====================================${ANSI.reset}`);
  console.log(`${ANSI.bold}File Length Check (AGENTS.md Rule 8: target <= ${MAX_RECOMMENDED_LINES} lines)${ANSI.reset}`);
  console.log(`${ANSI.cyan}====================================${ANSI.reset}`);
  console.log(`Scanned ${ANSI.bold}${files.length}${ANSI.reset} TypeScript files under ${ANSI.gray}src/${ANSI.reset}`);

  if (warnings.length === 0) {
    console.log(`\n${ANSI.green}✔ All TypeScript files in src/ are under ${MAX_RECOMMENDED_LINES} lines!${ANSI.reset}\n`);
  } else {
    console.log(
      `\n${ANSI.yellow}⚠ Found ${warnings.length} file(s) exceeding ${MAX_RECOMMENDED_LINES} lines:${ANSI.reset}`
    );
    for (const w of warnings) {
      console.log(`  ${ANSI.yellow}•${ANSI.reset} ${w.relativePath} ${ANSI.gray}(${w.lines} lines)${ANSI.reset}`);
    }
    console.log(
      `\n${ANSI.gray}Note: This is an advisory check to encourage modularity. Existing files will be incrementally decomposed.${ANSI.reset}\n`
    );
  }
}

if (import.meta.main) {
  runFileLengthCheck();
}
