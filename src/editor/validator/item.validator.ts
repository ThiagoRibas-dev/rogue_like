import type { CampaignData } from '../../types/campaign.types.ts';
import type { ValidationError } from './validator.types.ts';

/**
 * Validates Item definitions in the campaign.
 * Specifically checks that key/unique items cannot be thrown and silently destroyed.
 */
export async function validateItems(campaign: Readonly<CampaignData>): Promise<ValidationError[]> {
  const errors: ValidationError[] = [];

  for (const item of Object.values(campaign.items)) {
    const isKeyItem = item.tags?.includes('key_item') || item.tags?.includes('unique');

    if (isKeyItem && item.throwable?.destroyOnImpact) {
      errors.push({
        severity: 'error',
        message: `Item "${item.id}" is a unique or key item but has throwable.destroyOnImpact set to true. This could soft-lock the campaign.`,
        path: `items.${item.id}.throwable.destroyOnImpact`
      });
    }

    // You could also check if any reaction consumes it on impact, but keeping it simple for now
  }

  return errors;
}
