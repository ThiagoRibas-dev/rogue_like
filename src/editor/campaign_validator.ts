import type { CampaignData } from '../types/campaign.types.ts';
import type { ValidationReport, ValidationError } from './validator/validator.types.ts';
import { validateReachability } from './validator/reachability.validator.ts';
import { validateQuests } from './validator/quest.validator.ts';
import { validateTriggers } from './validator/trigger.validator.ts';
import { validateTags } from './validator/tag.validator.ts';
import { validateReactions } from './validator/reaction.validator.ts';
import { validateItems } from './validator/item.validator.ts';
import { validateEncounters } from './validator/encounter.validator.ts';
import { validateAreas } from './validator/area.validator.ts';
import { validateDialogues } from './validator/dialogue.validator.ts';
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

  function validateAIPersonalityModifiers(campaign: Readonly<CampaignData>): ValidationError[] {
    const errors: ValidationError[] = [];

    // If personality generation is missing or has no facets, we can't strictly validate.
    const definedFacets = Object.values(campaign.personalityGeneration || {}).flatMap((t) => t.facets || []);
    const validFacets = new Set(definedFacets);

    if (validFacets.size === 0) return errors;

    for (const [profileId, profile] of Object.entries(campaign.ai)) {
      for (let i = 0; i < profile.behaviors.length; i++) {
        const behavior = profile.behaviors[i];
        if (behavior && behavior.weightModifiers) {
          for (const facet of Object.keys(behavior.weightModifiers)) {
            if (!validFacets.has(facet)) {
              errors.push({
                path: `ai.${profileId}.behaviors[${i}].weightModifiers`,
                message: `AI profile references unknown personality facet: ${facet}`,
                severity: 'warning'
              });
            }
          }
        }
      }
    }
    return errors;
  }

  // Run validators sequentially to keep CPU yielding predictable
  const reachabilityErrs = await validateReachability(campaign);
  const questErrs = await validateQuests(campaign);
  const triggerErrs = await validateTriggers(campaign);
  const tagErrs = await validateTags(campaign);
  const reactionErrs = await validateReactions(campaign);
  const itemErrs = await validateItems(campaign);
  const encounterErrs = validateEncounters(campaign);
  const areaErrs = await validateAreas(campaign);
  const dialogueErrs = await validateDialogues(campaign);
  const aiPersonalityErrs = validateAIPersonalityModifiers(campaign);

  const allErrs = [
    ...reachabilityErrs,
    ...questErrs,
    ...triggerErrs,
    ...tagErrs,
    ...reactionErrs,
    ...itemErrs,
    ...encounterErrs,
    ...areaErrs,
    ...dialogueErrs,
    ...aiPersonalityErrs
  ];

  for (const e of allErrs) {
    if (e.severity === 'error') {
      errors.push(e);
    } else {
      warnings.push(e);
    }
  }

  return { errors, warnings };
}
