import { readdir, readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';

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
function extractExports(content: string): Array<{ name: string, type: string, summary: string }> {
  const exports: Array<{ name: string, type: string, summary: string }> = [];
  
  // Regex to match a JSDoc block followed by an export statement
  // Group 1: The entire JSDoc block (optional)
  // Group 2: The type of export (const, function, type, interface, enum, class)
  // Group 3: The name of the exported symbol
  const exportRegex = /(?:\/\*\*([\s\S]*?)\*\/\s*)?export\s+(const|function|type|interface|enum|class)(?:\s+enum)?\s+([A-Za-z0-9_]+)/g;

  let match;
  while ((match = exportRegex.exec(content)) !== null) {
    const jsDoc = match[1];
    const exportType = match[2];
    const exportName = match[3];

    let summary = '';
    if (jsDoc) {
      // Find the first line of the JSDoc that isn't just a star or empty
      const lines = jsDoc.split('\n');
      for (const line of lines) {
        const cleanLine = line.replace(/^\s*\*\s*/, '').trim();
        if (cleanLine && !cleanLine.startsWith('@')) {
          summary = cleanLine;
          break; // Take only the first sentence/line of the summary
        }
      }
    }

    exports.push({
      name: exportName,
      type: exportType,
      summary: summary || 'No description provided.'
    });
  }

  return exports;
}

async function main() {
  console.log('🗺️  Mapping Codebase Exports...\n');
  
  const srcDir = join(process.cwd(), 'src');
  const files = await getTypeScriptFiles(srcDir);
  
  let totalExports = 0;

  for (const file of files) {
    const content = await readFile(file, 'utf-8');
    const fileExports = extractExports(content);
    
    if (fileExports.length > 0) {
      // Print the file path relative to src/
      const relativePath = file.substring(srcDir.length + 1).replace(/\\/g, '/');
      console.log(`\x1b[36m📄 src/${relativePath}\x1b[0m`);
      
      for (const exp of fileExports) {
        console.log(`  \x1b[33m[${exp.type}]\x1b[0m \x1b[32m${exp.name}\x1b[0m: ${exp.summary}`);
        totalExports++;
      }
      console.log(''); // Empty line between files
    }
  }

  console.log(`\n✅ Mapped ${totalExports} exports across ${files.length} files.`);
}

main().catch(console.error);
