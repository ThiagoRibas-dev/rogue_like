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
        case 'explore': {
          const targetId = obj.targetId;
          if (!campaign.areas[targetId]) {
            errors.push({
              path: `/quests/${questId}/objectives/${i}/targetId`,
              message: `Quest requires exploring unknown area '${targetId}'.`,
              severity: 'error'
            });
          }
          break;
        }
        case 'interact':
        case 'talk': {
          const targetId = obj.targetId;
          if (!campaign.entities[targetId]) {
            errors.push({
              path: `/quests/${questId}/objectives/${i}/targetId`,
              message: `Quest objective requires unknown entity '${targetId}'.`,
              severity: 'error'
            });
          }
          break;
        }
        default:
          return assertNever(obj.type);
      }
    }

    // Check rewards exhaustively
    if (quest.rewards) {
      for (let r = 0; r < quest.rewards.length; r++) {
        const reward = quest.rewards[r];
        if (!reward) continue;
        switch (reward.type) {
          case 'item': {
            if (!campaign.items[reward.itemId]) {
              errors.push({
                path: `/quests/${questId}/rewards/${r}/itemId`,
                message: `Quest grants unknown item reward '${reward.itemId}'.`,
                severity: 'error'
              });
            }
            break;
          }
          case 'standing': {
            if (!campaign.factions[reward.factionId]) {
              errors.push({
                path: `/quests/${questId}/rewards/${r}/factionId`,
                message: `Quest grants standing for unknown faction '${reward.factionId}'.`,
                severity: 'error'
              });
            }
            break;
          }
          case 'xp':
          case 'event':
            break;
          default:
            return assertNever(reward);
        }
      }
    }

    // Check follow-up quest
    if (quest.nextQuestId && !campaign.quests[quest.nextQuestId]) {
      errors.push({
        path: `/quests/${questId}/nextQuestId`,
        message: `Quest references unknown follow-up quest '${quest.nextQuestId}'.`,
        severity: 'error'
      });
    }

    // Yield to the event loop
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return errors;
}
