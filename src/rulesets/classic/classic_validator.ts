import type { CampaignData } from '../../types/campaign.types.ts';
import type { ValidationError } from '../../types/ruleset.types.ts';

/**
 * Validates Classic roguelike ruleset invariants for a campaign.
 * Ensures no foreign system content leaked into the campaign, XP advancement thresholds
 * are strictly increasing, and classic fighter templates have valid baseline stats.
 *
 * @param campaign The campaign data being validated.
 * @returns Array of validation errors or warnings.
 */
export function checkClassicRuleset(campaign: Readonly<CampaignData>): ReadonlyArray<ValidationError> {
  const errors: ValidationError[] = [];

  if (campaign.systemContent && Object.keys(campaign.systemContent).length > 0) {
    errors.push({
      path: 'campaign.systemContent',
      message: 'Classic campaign must not contain foreign ruleset systemContent entries.',
      severity: 'error'
    });
  }

  const advancement = campaign.advancement;
  if (Array.isArray(advancement)) {
    for (let i = 1; i < advancement.length; i++) {
      const prev = advancement[i - 1]!;
      const curr = advancement[i]!;
      if (curr.requiredXp <= prev.requiredXp) {
        errors.push({
          path: `advancement[${i}].requiredXp`,
          message: `Classic requiredXp at level ${curr.level} (${curr.requiredXp}) must be strictly greater than level ${prev.level} (${prev.requiredXp}).`,
          severity: 'error'
        });
      }
    }
  }

  for (const [entityId, entity] of Object.entries(campaign.entities)) {
    if (entity.fighter) {
      if (entity.fighter.maxHp <= 0) {
        errors.push({
          path: `entities.${entityId}.fighter.maxHp`,
          message: `Classic fighter entity "${entityId}" must have positive HP (got ${entity.fighter.maxHp}).`,
          severity: 'error'
        });
      }
    }
  }

  return errors;
}
