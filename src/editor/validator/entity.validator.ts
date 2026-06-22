import type { CampaignData } from '../../types/campaign.types.ts';
import type { ValidationError } from './validator.types.ts';

/**
 * Validates Entity definitions in the campaign.
 * Checks for referential integrity in shop inventories and configurations.
 */
export async function validateEntities(campaign: Readonly<CampaignData>): Promise<ValidationError[]> {
  const errors: ValidationError[] = [];

  for (const [entityId, entity] of Object.entries(campaign.entities)) {
    if (entity.shop) {
      const shop = entity.shop;
      if (shop.inventory) {
        shop.inventory.forEach((itemId, idx) => {
          if (!campaign.items[itemId]) {
            errors.push({
              severity: 'error',
              message: `Entity template "${entityId}" has shop inventory referencing unknown item: "${itemId}"`,
              path: `entities.${entityId}.shop.inventory[${idx}]`
            });
          }
        });
      }

      if (shop.markupMultiplier < 0) {
        errors.push({
          severity: 'error',
          message: `Entity template "${entityId}" has shop markupMultiplier < 0: ${shop.markupMultiplier}`,
          path: `entities.${entityId}.shop.markupMultiplier`
        });
      }
    }
  }

  return errors;
}
