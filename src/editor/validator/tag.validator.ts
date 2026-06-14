import type { CampaignData } from '../../types/campaign.types.ts';
import type { ValidationError } from './validator.types.ts';

export async function validateTags(campaign: Readonly<CampaignData>): Promise<ValidationError[]> {
  const errors: ValidationError[] = [];

  const registeredTags = Object.keys(campaign.tagRegistry || {});
  const tagSet = new Set(registeredTags);

  // Validate Items
  if (campaign.items) {
    for (const [itemId, item] of Object.entries(campaign.items)) {
      if (item.tags) {
        for (const tag of item.tags) {
          if (!tagSet.has(tag)) {
            errors.push({
              severity: 'error',
              path: `/items/${itemId}/tags`,
              message: `Item references unregistered tag: "${tag}"`
            });
          }
        }
      }
    }
  }

  // Validate Reactions
  if (campaign.reactions) {
    for (let i = 0; i < campaign.reactions.length; i++) {
      const reaction = campaign.reactions[i];
      if (reaction && reaction.sourceTag && !tagSet.has(reaction.sourceTag)) {
        errors.push({
          severity: 'error',
          path: `/reactions/${i}/sourceTag`,
          message: `Reaction references unregistered source tag: "${reaction.sourceTag}"`
        });
      }
      if (reaction && reaction.targetTag && !tagSet.has(reaction.targetTag)) {
        errors.push({
          severity: 'error',
          path: `/reactions/${i}/targetTag`,
          message: `Reaction references unregistered target tag: "${reaction.targetTag}"`
        });
      }
    }
  }

  return errors;
}
