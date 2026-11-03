import { readdir, readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { validateSsotRegistries, writeSsotMarkdownDocs } from './ssot_parity.ts';

/**
 * Recursively walks a directory and returns all .ts files.
 */
async function getTypeScriptFiles(dir: string, fileList: string[] = []): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await getTypeScriptFiles(fullPath, fileList);
    } else if (extname(entry.name) === '.ts') {
      fileList.push(fullPath);
    }
  }

  return fileList;
}

/**
 * Extracts exports and their JSDoc summaries from a TypeScript file's content.
 */
function extractExports(content: string): Array<{ name: string; type: string; summary: string }> {
  const exports: Array<{ name: string; type: string; summary: string }> = [];

  const exportRegex = /(?:\/\*\*([\s\S]*?)\*\/\s*)?export\s+(const|function|type|interface|enum|class)(?:\s+enum)?\s+([A-Za-z0-9_]+)/g;

  let match;
  while ((match = exportRegex.exec(content)) !== null) {
    const jsDoc = match[1];
    const exportType = match[2];
    const exportName = match[3];

    let summary = '';
    if (jsDoc) {
      const lines = jsDoc.split('\n');
      for (const line of lines) {
        const cleanLine = line.replace(/^\s*\*\s*/, '').trim();
        if (cleanLine && !cleanLine.startsWith('@')) {
          summary = cleanLine;
          break;
        }
      }
    }

    exports.push({
      name: exportName!,
      type: exportType!,
      summary: summary || 'No description provided.'
    });
  }

  return exports;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const isCheckMode = args.includes('--check');

  if (isCheckMode) {
    console.log('🔍 Checking SSOT Registries Parity...\n');
    const report = validateSsotRegistries(process.cwd());
    for (const w of report.warnings) {
      console.warn(`⚠️  ${w}`);
    }
    if (report.errors.length > 0) {
      for (const err of report.errors) {
        console.error(`❌ ${err}`);
      }
      console.error(`\n💥 Parity check failed with ${report.errors.length} error(s).`);
      process.exit(1);
    }
    console.log(`✅ All ${report.checkedFiles} source files pass SSOT registry and markdown parity!\n`);
    return;
  }

  console.log('📝 Generating SSOT Markdown Documentation...');
  writeSsotMarkdownDocs(process.cwd());
  console.log('✅ Generated docs/SSOT_CONSOLE.md and docs/SSOT_DND35E.md\n');

  console.log('🗺️  Mapping Codebase Exports...\n');

  const srcDir = join(process.cwd(), 'src');
  const files = await getTypeScriptFiles(srcDir);

  let totalExports = 0;

  const useColor = process.stdout.isTTY;
  const color = {
    cyan: (str: string) => (useColor ? `\x1b[36m${str}\x1b[0m` : str),
    yellow: (str: string) => (useColor ? `\x1b[33m${str}\x1b[0m` : str),
    green: (str: string) => (useColor ? `\x1b[32m${str}\x1b[0m` : str)
  };

  for (const file of files) {
    const content = await readFile(file, 'utf-8');
    const fileExports = extractExports(content);

    if (fileExports.length > 0) {
      const relativePath = file.substring(srcDir.length + 1).replace(/\\/g, '/');
      console.log(color.cyan(`📄 src/${relativePath}`));

      for (const exp of fileExports) {
        console.log(`  ${color.yellow(`[${exp.type}]`)} ${color.green(exp.name)}: ${exp.summary}`);
        totalExports++;
      }
      console.log('');
    }
  }

  console.log(`\n✅ Mapped ${totalExports} exports across ${files.length} files.`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

