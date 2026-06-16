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
      if (!reaction) continue;

      if (reaction.sourceMatcher && reaction.sourceMatcher.tags) {
        for (const tag of reaction.sourceMatcher.tags) {
          if (!tagSet.has(tag)) {
            errors.push({
              severity: 'error',
              path: `/reactions/${i}/sourceMatcher/tags`,
              message: `Reaction references unregistered source tag: "${tag}"`
            });
          }
        }
      }

      if (reaction.targetMatcher && reaction.targetMatcher.tags) {
        for (const tag of reaction.targetMatcher.tags) {
          if (!tagSet.has(tag)) {
            errors.push({
              severity: 'error',
              path: `/reactions/${i}/targetMatcher/tags`,
              message: `Reaction references unregistered target tag: "${tag}"`
            });
          }
        }
      }
    }
  }

  return errors;
}
