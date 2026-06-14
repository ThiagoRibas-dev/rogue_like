import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'fs';
import { join } from 'path';

const mapping: Record<string, string> = {
  IntentType: 'intent.enum.ts',
  WaitIntent: 'core.intents.ts',
  ToggleEngineModeIntent: 'core.intents.ts',
  TogglePauseIntent: 'core.intents.ts',
  SetRTwPSpeedIntent: 'core.intents.ts',
  MoveIntent: 'movement.intents.ts',
  InteractIntent: 'movement.intents.ts',
  ChangeAreaIntent: 'movement.intents.ts',
  MeleeAttackIntent: 'combat.intents.ts',
  ToggleTargetingIntent: 'combat.intents.ts',
  MoveTargetIntent: 'combat.intents.ts',
  FireAimedIntent: 'combat.intents.ts',
  UseAbilityIntent: 'combat.intents.ts',
  PickUpIntent: 'inventory.intents.ts',
  DropIntent: 'inventory.intents.ts',
  UseItemIntent: 'inventory.intents.ts',
  EquipItemIntent: 'inventory.intents.ts',
  UnequipItemIntent: 'inventory.intents.ts',
  ToggleInventoryIntent: 'ui.intents.ts',
  ToggleFactionsIntent: 'ui.intents.ts',
  ToggleSettingsIntent: 'ui.intents.ts',
  StartDialogueIntent: 'ui.intents.ts',
  SelectDialogueOptionIntent: 'ui.intents.ts',
  CloseDialogueIntent: 'ui.intents.ts',
  ToggleQuestsIntent: 'ui.intents.ts',
  ToggleInvestigationIntent: 'ui.intents.ts',
  ToggleDebugIntent: 'ui.intents.ts',
  ToggleRotatedIntent: 'camera.intents.ts',
  Toggle3DIntent: 'camera.intents.ts',
  SetZoomLevelIntent: 'camera.intents.ts',
  DebugRevealMapIntent: 'debug.intents.ts',
  DebugGodModeIntent: 'debug.intents.ts',
  DebugSpawnEntityIntent: 'debug.intents.ts',
  ToggleInspectIntent: 'inspect.intents.ts',
  MoveInspectIntent: 'inspect.intents.ts',
  Intent: 'intent.union.ts',
  ActionResult: 'intent.union.ts'
};

function getAllTsFiles(dir: string): string[] {
  let results: string[] = [];
  const list = readdirSync(dir);
  for (const file of list) {
    const filePath = join(dir, file);
    const stat = statSync(filePath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getAllTsFiles(filePath));
    } else if (file.endsWith('.ts')) {
      results.push(filePath);
    }
  }
  return results;
}

const srcDir = join(process.cwd(), 'src');
const testDir = join(process.cwd(), 'scratch'); // just in case
const allFiles = [...getAllTsFiles(srcDir), ...(existsSync(testDir) ? getAllTsFiles(testDir) : [])];

const importRegex = /import\s+(?:type\s+)?{([^}]+)}\s+from\s+['"]([^'"]*intents\.types\.ts)['"];/g;

let updatedFiles = 0;

for (const file of allFiles) {
  let content = readFileSync(file, 'utf-8');
  let hasChanges = false;

  content = content.replace(importRegex, (match, importsStr, importPath) => {
    hasChanges = true;
    
    // Parse imported items: "type MoveIntent", "IntentType", "type ActionResult as AR" (we don't have aliases but just in case)
    const items = importsStr.split(',').map((s: string) => s.trim()).filter((s: string) => s.length > 0);
    
    // Group by target file
    const fileGroups: Record<string, string[]> = {};
    
    for (const item of items) {
      // item might be "type MoveIntent" or "IntentType"
      const isType = item.startsWith('type ');
      const rawName = isType ? item.substring(5).trim() : item;
      
      const targetFile = mapping[rawName];
      if (!targetFile) {
        console.warn(`[WARNING] Unmapped intent type: ${rawName} in file ${file}`);
        continue;
      }
      
      if (!fileGroups[targetFile]) {
        fileGroups[targetFile] = [];
      }
      fileGroups[targetFile].push(item);
    }
    
    // Generate new import statements
    const newImports = Object.entries(fileGroups).map(([targetFile, importedItems]) => {
      const newPath = importPath.replace('intents.types.ts', `intents/${targetFile}`);
      if (importedItems.length === 1) {
        return `import { ${importedItems[0]} } from '${newPath}';`;
      } else {
        return `import {\n  ${importedItems.join(',\n  ')}\n} from '${newPath}';`;
      }
    });
    
    return newImports.join('\n');
  });

  if (hasChanges) {
    writeFileSync(file, content, 'utf-8');
    console.log(`Updated: ${file}`);
    updatedFiles++;
  }
}

console.log(`\nMigration complete. Updated ${updatedFiles} files.`);
