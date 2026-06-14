import type { CampaignData } from '../types/campaign.types.ts';
import type { ValidationReport, ValidationError } from './validator/validator.types.ts';
import { validateReachability } from './validator/reachability.validator.ts';
import { validateQuests } from './validator/quest.validator.ts';
import { validateTriggers } from './validator/trigger.validator.ts';
import { validateTags } from './validator/tag.validator.ts';
import { loadCampaign } from '../core/loader.ts';

/**
 * Headless state-diffing runner to validate that a campaign's triggers
 * function correctly without requiring a full browser DOM.
 */
export async function runHeadlessSmokeTest(campaignId: string = 'default'): Promise<boolean> {
  console.log(`Starting headless smoke test for campaign: ${campaignId}`);
  try {
    const campaign = await loadCampaign(campaignId);
    const report = await validateCampaign(campaign);
    if (report.errors.length > 0) {
      console.error('❌ Smoke Test Failed: Validation errors found', report.errors);
      return false;
    }
    console.log('✅ Smoke Test Passed: Campaign validation clean.');
    return true;
  } catch (err) {
    console.error('❌ Smoke Test Exception:', err);
    return false;
  }
}

/**
 * Orchestrates all asynchronous deep validation checks for a campaign.
 * Returns a comprehensive report of all errors and warnings.
 *
 * @param campaign The campaign data to validate
 * @returns A promise that resolves to the ValidationReport
 */
export async function validateCampaign(campaign: Readonly<CampaignData>): Promise<ValidationReport> {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  // Run validators sequentially to keep CPU yielding predictable
  const reachabilityErrs = await validateReachability(campaign);
  const questErrs = await validateQuests(campaign);
  const triggerErrs = await validateTriggers(campaign);
  const tagErrs = await validateTags(campaign);

  const allErrs = [...reachabilityErrs, ...questErrs, ...triggerErrs, ...tagErrs];

  for (const e of allErrs) {
    if (e.severity === 'error') {
      errors.push(e);
    } else {
      warnings.push(e);
    }
  }

  return { errors, warnings };
}
