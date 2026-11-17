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
              path: `entities.${entityId}.shop.inventory[${idx}]`,
              fixSuggestion: `Add "${itemId}" to items.json or select a valid item from the dropdown.`
            });
          }
        });
      }

      if (shop.markupMultiplier < 0) {
        errors.push({
          severity: 'error',
          message: `Entity template "${entityId}" has shop markupMultiplier < 0: ${shop.markupMultiplier}`,
          path: `entities.${entityId}.shop.markupMultiplier`,
          fixSuggestion: 'Change markupMultiplier to a positive number (e.g., 1.5 for a 50% markup).'
        });
      }
    }

    if (entity.defaultEquipment) {
      entity.defaultEquipment.forEach((entry, idx) => {
        if (!campaign.items[entry.itemId]) {
          errors.push({
            severity: 'error',
            message: `Entity template "${entityId}" defaultEquipment references unknown item: "${entry.itemId}"`,
            path: `entities.${entityId}.defaultEquipment[${idx}].itemId`,
            fixSuggestion: `Define "${entry.itemId}" in campaign items.json or system content items.`
          });
        }
      });
    }

    if (entity.lootDrops) {
      entity.lootDrops.forEach((drop, idx) => {
        if (!campaign.items[drop.itemId]) {
          errors.push({
            severity: 'error',
            message: `Entity template "${entityId}" lootDrops references unknown item: "${drop.itemId}"`,
            path: `entities.${entityId}.lootDrops[${idx}].itemId`,
            fixSuggestion: `Define "${drop.itemId}" in campaign items.json or system content items.`
          });
        }
        if (drop.maxCount < drop.minCount) {
          errors.push({
            severity: 'error',
            message: `Entity template "${entityId}" lootDrops[${idx}] has maxCount < minCount.`,
            path: `entities.${entityId}.lootDrops[${idx}].maxCount`,
            fixSuggestion: 'Set maxCount >= minCount.'
          });
        }
      });
    }

    if (entity.currencyDrop) {
      if (entity.currencyDrop.maxAmount < entity.currencyDrop.minAmount) {
        errors.push({
          severity: 'error',
          message: `Entity template "${entityId}" currencyDrop has maxAmount < minAmount.`,
          path: `entities.${entityId}.currencyDrop.maxAmount`,
          fixSuggestion: 'Set maxAmount >= minAmount.'
        });
      }
      const currencyCfg = campaign.rules.currency;
      if (currencyCfg && !currencyCfg.denominations.some((d) => d.id === entity.currencyDrop!.denominationId)) {
        errors.push({
          severity: 'error',
          message: `Entity template "${entityId}" currencyDrop references unknown denomination: "${entity.currencyDrop.denominationId}"`,
          path: `entities.${entityId}.currencyDrop.denominationId`,
          fixSuggestion: 'Use one of the denominations declared in campaign rules.currency.denominations.'
        });
      }
    }
  }

  return errors;
}
