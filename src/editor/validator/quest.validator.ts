import type { CampaignData } from '../../types/campaign.types.ts';
import type { ValidationError } from './validator.types.ts';
import { assertNever } from '../../utils/assert.ts';

export async function validateQuests(campaign: Readonly<CampaignData>): Promise<ReadonlyArray<ValidationError>> {
  const errors: ValidationError[] = [];

  // Collect all item IDs present in the loot table (including weight=0 for hand-placed items)
  const lootTableItems = new Set<string>();
  const lootTable = campaign.rules.spawning.lootTable;
  for (const itemId of Object.keys(lootTable)) {
    lootTableItems.add(itemId);
  }

  // Check quests
  for (const [questId, quest] of Object.entries(campaign.quests)) {
    for (let i = 0; i < quest.objectives.length; i++) {
      const obj = quest.objectives[i];
      if (!obj) continue;

      switch (obj.type) {
        case 'gather': {
          const targetId = obj.targetId;
          if (!campaign.items[targetId]) {
            errors.push({
              path: `/quests/${questId}/objectives/${i}/targetId`,
              message: `Quest requires gathering unknown item '${targetId}'.`,
              severity: 'error'
            });
          } else if (!lootTableItems.has(targetId)) {
            errors.push({
              path: `/quests/${questId}/objectives/${i}/targetId`,
              message: `Quest requires gathering '${targetId}', but it does not appear in the loot table (add it with weight 0 if hand-placed, or a positive weight for random drops).`,
              severity: 'warning'
            });
          }
          break;
        }
        case 'kill': {
          const targetId = obj.targetId;
          if (!campaign.entities[targetId]) {
            errors.push({
              path: `/quests/${questId}/objectives/${i}/targetId`,
              message: `Quest requires killing unknown entity '${targetId}'.`,
              severity: 'error'
            });
          }
          break;
        }
        case 'explore':
        case 'interact':
        case 'talk':
          // No specific validation required for these types during smoke test
          break;
        default:
          return assertNever(obj.type);
      }
    }
    // Yield to the event loop
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return errors;
}
