import type { CampaignData } from '../../types/campaign.types.ts';
import type { ValidationError } from './validator.types.ts';

/**
 * Validates Item definitions in the campaign.
 * Specifically checks that key/unique items cannot be thrown and silently destroyed.
 */
export async function validateItems(campaign: Readonly<CampaignData>): Promise<ValidationError[]> {
  const errors: ValidationError[] = [];
  const sysSpells = (campaign.systemContent as Record<string, unknown> | undefined)?.['spells'] as
    Record<string, unknown> | undefined;

  for (const item of Object.values(campaign.items)) {
    const isKeyItem = item.tags?.includes('key_item') || item.tags?.includes('unique');

    if (isKeyItem && item.throwable?.destroyOnImpact) {
      errors.push({
        severity: 'error',
        message: `Item "${item.id}" is a unique or key item but has throwable.destroyOnImpact set to true. This could soft-lock the campaign.`,
        path: `items.${item.id}.throwable.destroyOnImpact`
      });
    }

    if (item.consumable?.effectId && !campaign.effects[item.consumable.effectId]) {
      errors.push({
        severity: 'error',
        message: `Item "${item.id}" references non-existent consumable effectId "${item.consumable.effectId}".`,
        path: `items.${item.id}.consumable.effectId`
      });
    }

    if (item.coating?.statusId && !campaign.status[item.coating.statusId]) {
      errors.push({
        severity: 'error',
        message: `Item "${item.id}" references non-existent coating statusId "${item.coating.statusId}".`,
        path: `items.${item.id}.coating.statusId`
      });
    }

    if (item.zappable?.spellId && sysSpells && !sysSpells[item.zappable.spellId]) {
      errors.push({
        severity: 'error',
        message: `Item "${item.id}" references non-existent zappable spellId "${item.zappable.spellId}".`,
        path: `items.${item.id}.zappable.spellId`
      });
    }
  }

  return errors;
}
