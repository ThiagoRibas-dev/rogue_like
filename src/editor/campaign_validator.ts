import type { CampaignData } from '../types/campaign.types.ts';
import type { ValidationReport, ValidationError } from './validator/validator.types.ts';
import { runFuzzerBatch } from './simulation/narrative_fuzzer.ts';
import { validateReachability } from './validator/reachability.validator.ts';
import { validateQuests } from './validator/quest.validator.ts';
import { validateTriggers } from './validator/trigger.validator.ts';
import { validateTags } from './validator/tag.validator.ts';
import { validateReactions } from './validator/reaction.validator.ts';
import { validateItems } from './validator/item.validator.ts';
import { validateEncounters } from './validator/encounter.validator.ts';
import { validateAreas } from './validator/area.validator.ts';
import { validateDialogues } from './validator/dialogue.validator.ts';
import { validateEntities } from './validator/entity.validator.ts';
import { loadCampaign } from '../core/loader.ts';
import { compileTrigger } from '../systems/trigger-composer.system.ts';
import type { GameState } from '../types/game-state.types.ts';

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

  function validateTriggerTemplates(campaign: Readonly<CampaignData>): ValidationError[] {
    const errors: ValidationError[] = [];
    const templates = campaign.triggerTemplates || {};

    for (const [templateId, template] of Object.entries(templates)) {
      try {
        const vars = new Set<string>();
        const serialized = JSON.stringify(template);
        const regex = /\$[A-Z0-9_]+/g;
        let match;
        while ((match = regex.exec(serialized)) !== null) {
          vars.add(match[0]);
        }

        const bindings: Record<string, string | number | boolean> = {};
        vars.forEach((v) => {
          const upper = v.toUpperCase();
          if (
            upper.includes('BUDGET') ||
            upper.includes('COUNT') ||
            upper.includes('AMOUNT') ||
            upper.includes('XP') ||
            upper.includes('LEVEL') ||
            upper.includes('TURNS') ||
            upper.includes('HP') ||
            upper.includes('ATTACK') ||
            upper.includes('DEFENSE') ||
            upper.includes('X') ||
            upper.includes('Y') ||
            upper.includes('GAIN') ||
            upper.includes('VALUE') ||
            upper.includes('COST') ||
            upper.includes('DAMAGE') ||
            upper.includes('HEAL')
          ) {
            bindings[v] = 1;
          } else if (
            upper.includes('IS_') ||
            upper.includes('HAS_') ||
            upper.includes('ENABLED') ||
            upper.includes('ACTIVE') ||
            upper.includes('SUCCESS')
          ) {
            bindings[v] = true;
          } else if (upper.includes('ITEM') && Object.keys(campaign.items).length > 0) {
            bindings[v] = Object.keys(campaign.items)[0]!;
          } else if (
            (upper.includes('ENTITY') || upper.includes('ACTOR') || upper.includes('NEMESIS')) &&
            Object.keys(campaign.entities).length > 0
          ) {
            bindings[v] = Object.keys(campaign.entities)[0]!;
          } else if (upper.includes('AREA') && Object.keys(campaign.areas).length > 0) {
            bindings[v] = Object.keys(campaign.areas)[0]!;
          } else if (upper.includes('FACTION') && Object.keys(campaign.factions).length > 0) {
            bindings[v] = Object.keys(campaign.factions)[0]!;
          } else if (upper.includes('EFFECT') && Object.keys(campaign.effects).length > 0) {
            bindings[v] = Object.keys(campaign.effects)[0]!;
          } else if (upper.includes('STATUS') && Object.keys(campaign.status).length > 0) {
            bindings[v] = Object.keys(campaign.status)[0]!;
          } else if (upper.includes('DIALOGUE') && Object.keys(campaign.dialogues).length > 0) {
            bindings[v] = Object.keys(campaign.dialogues)[0]!;
          } else {
            bindings[v] = 'mock_value';
          }
        });

        const dummyState = {
          campaign: {
            triggerTemplates: templates
          }
        } as unknown as GameState;

        const compiled = compileTrigger(templateId, bindings, dummyState, `${templateId}_mock_test`);

        for (const consequence of compiled.consequences) {
          if (consequence.type === 'apply_status' && consequence.statusId && !campaign.status[consequence.statusId]) {
            errors.push({
              path: `triggerTemplates.${templateId}`,
              message: `Template compiles to invalid 'apply_status' referencing non-existent status ID: '${consequence.statusId}'`,
              severity: 'error'
            });
          }
          if (consequence.type === 'apply_coating' && consequence.statusId && !campaign.status[consequence.statusId]) {
            errors.push({
              path: `triggerTemplates.${templateId}`,
              message: `Template compiles to invalid 'apply_coating' referencing non-existent status ID: '${consequence.statusId}'`,
              severity: 'error'
            });
          }
          if (
            consequence.type === 'spawn_entity' &&
            consequence.entityTemplateId &&
            !campaign.entities[consequence.entityTemplateId] &&
            !campaign.items[consequence.entityTemplateId]
          ) {
            errors.push({
              path: `triggerTemplates.${templateId}`,
              message: `Template compiles to invalid 'spawn_entity' referencing non-existent entity/item ID: '${consequence.entityTemplateId}'`,
              severity: 'error'
            });
          }
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        errors.push({
          path: `triggerTemplates.${templateId}`,
          message: `Trigger Template failed compilation validation: ${errMsg}`,
          severity: 'error'
        });
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
  const entityErrs = await validateEntities(campaign);
  const aiPersonalityErrs = validateAIPersonalityModifiers(campaign);
  const triggerTemplateErrs = validateTriggerTemplates(campaign);

  function validateWithFuzzer(campaign: Readonly<CampaignData>): ValidationError[] {
    const fuzzerErrors: ValidationError[] = [];
    try {
      const report = runFuzzerBatch(campaign, {
        runs: 5,
        maxTurns: 100,
        stopOnFirstError: true
      });
      for (const res of report.results) {
        if (res.error) {
          fuzzerErrors.push({
            path: `fuzzer.${res.error.type}`,
            message: `Fuzzer Seed ${res.seed} failed at Turn ${res.error.turn}: ${res.error.message}`,
            severity: 'error'
          });
        }
      }
    } catch (err) {
      fuzzerErrors.push({
        path: 'fuzzer.crash',
        message: `Fuzzer crashed during smoke test: ${err instanceof Error ? err.message : String(err)}`,
        severity: 'error'
      });
    }
    return fuzzerErrors;
  }

  const fuzzerErrs = validateWithFuzzer(campaign);

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
    ...entityErrs,
    ...aiPersonalityErrs,
    ...triggerTemplateErrs,
    ...fuzzerErrs
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
